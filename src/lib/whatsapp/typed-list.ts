/**
 * Measurements a prospect types instead of photographing the sheet
 * (22/11/2026: « 180x160/140x120/260x60 »; a carpenter giving his doors one
 * message at a time was told six times to write them on paper). The model
 * reads them like a sheet (readTypedCutList), then the answer is the photo's
 * (src/lib/whatsapp/plan-answer.ts), and the list is the number's one free read.
 *
 * Outcomes for the webhook:
 * - 'handled': the plan card (or its text) went out;
 * - 'silent': another read of this number is running;
 * - 'fallback': nothing read, or the number cannot have a read now: the
 *   assistant answers the message as before.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { WhatsAppConfig } from '@/lib/whatsapp/config';
import type { Lang } from '@/lib/whatsapp/copy';
import { failPhotoRead, latestPhotoRead, reservePhotoRead } from '@/lib/whatsapp/photo-store';
import { readTypedCutList } from '@/lib/vision/read-cut-list';
import { usablePieces } from '@/lib/whatsapp/photo-summary';
import { planAndAnswer, type PhotoMessageKind } from '@/lib/whatsapp/plan-answer';
import type { PlanCard } from '@/lib/whatsapp/send';

export type TypedListOutcome = 'handled' | 'silent' | 'fallback';

/** Inside the webhook's 60 s: the wait for a following message, this read, then the plan picture. */
export const TYPED_READ_TIMEOUT_MS = 20_000;

const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error');

export async function handleTypedList(input: {
  db: SupabaseClient;
  config: Pick<WhatsAppConfig, 'photoDailyCap'>;
  waId: string;
  /** The typed measurements: this message, after the ones sent just before it. */
  text: string;
  lang: Lang;
  now: Date;
  deliver: (text: string, kind: PhotoMessageKind) => Promise<boolean>;
  deliverImage?: (link: string, caption: string, kind: PhotoMessageKind, card: PlanCard) => Promise<boolean>;
  /** Less than TYPED_READ_TIMEOUT_MS when the route has less time left (a voice note already heard). */
  readTimeoutMs?: number;
}): Promise<TypedListOutcome> {
  const { db, config, waId, text, lang, now, deliver, deliverImage } = input;
  if (config.photoDailyCap <= 0) return 'fallback';

  // A number already served: the assistant points to the atelier, and the
  // model is not paid for a list the bot would not plan.
  try {
    if (await latestPhotoRead(db, waId, now)) return 'fallback';
  } catch (error) {
    console.error('[whatsapp] typed list: latest read lookup failed', describe(error));
    return 'fallback';
  }

  // Read before reserving: a panel size or a question with numbers in it
  // must not use up the number's read, nor count as a failed one.
  let read;
  try {
    read = await readTypedCutList(text, { timeoutMs: Math.min(input.readTimeoutMs ?? TYPED_READ_TIMEOUT_MS, TYPED_READ_TIMEOUT_MS) });
  } catch (error) {
    console.error('[whatsapp] typed list read threw', describe(error));
    return 'fallback';
  }
  if (read.status !== 'ok' || usablePieces(read.pieces).length === 0) {
    console.log('[whatsapp] typed list: nothing to plan', read.status);
    return 'fallback';
  }

  let reservation;
  try {
    reservation = await reservePhotoRead(db, waId, now, config.photoDailyCap);
  } catch (error) {
    console.error('[whatsapp] typed list reservation failed', describe(error));
    return 'fallback';
  }
  if (reservation.status === 'busy') return 'silent';
  if (reservation.status !== 'reserved') return 'fallback';
  const readId = reservation.id;

  // Nothing was announced: a list that cannot be planned frees the read and the assistant answers.
  const fail = async (reason: string): Promise<TypedListOutcome> => {
    console.log('[whatsapp] typed list not planned', reason);
    try {
      await failPhotoRead(db, readId);
    } catch (error) {
      console.error('[whatsapp] could not mark the typed list failed', describe(error));
    }
    return 'fallback';
  };

  return planAndAnswer({ db, readId, read, lang, now, deliver, deliverImage, fail });
}
