/**
 * From a read cut list to the prospect's answer, whatever the list came from
 * (a photo, src/lib/whatsapp/photo.ts, or typed measurements,
 * src/lib/whatsapp/typed-list.ts): check the lines, plan them on the panel,
 * store the read behind a short code, then send the plan card (the text
 * answer when the card cannot go out).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { PHOTO_COPY, type Lang } from '@/lib/whatsapp/copy';
import { completePhotoRead, newPhotoCode } from '@/lib/whatsapp/photo-store';
import type { ReadPiece, ReadSheet } from '@/lib/vision/read-cut-list';
import {
  BOT_PLAN_MAX_PIECES,
  bigListText,
  listSummary,
  photoLink,
  photoResultCaption,
  photoResultCard,
  photoResultText,
  plausiblePanel,
  summarizeCutList,
  usablePieces,
} from '@/lib/whatsapp/photo-summary';
import { planImageUrl } from '@/lib/whatsapp/plan-image';
import type { PlanCard } from '@/lib/whatsapp/send';

export type PhotoMessageKind = 'photo_reading' | 'photo_result' | 'photo_already' | 'photo_failed';

/**
 * Above this many pieces (quantities expanded) the bot does not take the list:
 * the reader is not trusted that far, and the atelier reads it. Raised from 300
 * to 900 by the owner (21/11/2026); the plan itself stops at BOT_PLAN_MAX_PIECES.
 */
export const MAX_BOT_PIECES = 900;

const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error');

export async function planAndAnswer<Failed>(input: {
  db: SupabaseClient;
  /** The reserved read (reservePhotoRead) this list completes. */
  readId: string;
  read: { pieces: ReadPiece[]; sheet: ReadSheet | null };
  lang: Lang;
  now: Date;
  deliver: (text: string, kind: PhotoMessageKind) => Promise<boolean>;
  deliverImage?: (link: string, caption: string, kind: PhotoMessageKind, card: PlanCard) => Promise<boolean>;
  /** Frees the read and says what the caller does instead; `text` is what to tell the prospect, when anything. */
  fail: (reason: string, text?: string) => Promise<Failed>;
}): Promise<Failed | 'handled'> {
  const { db, readId, read, lang, now, deliver, deliverImage, fail } = input;

  let result: { text: string; caption: string; card: PlanCard; image: string | null };
  try {
    // The reader's numbers are not trusted blindly: no line without a usable
    // size, no panel outside a plausible range, no plan too big for the budget.
    const pieces = usablePieces(read.pieces);
    if (pieces.length === 0) return await fail('no usable line');
    const pieceCount = pieces.reduce((sum, p) => sum + p.quantity, 0);
    // Read, but too long for WhatsApp: say so, never "unreadable" (21/11/2026).
    if (pieceCount > MAX_BOT_PIECES) return await fail('too many pieces', PHOTO_COPY.tooBig(lang, pieceCount));
    const sheet = plausiblePanel(read.sheet);

    // Over BOT_PLAN_MAX_PIECES the plan would not fit in the webhook's time:
    // the list is stored and linked, and the atelier plans it after sign-up.
    const planned = pieceCount <= BOT_PLAN_MAX_PIECES;
    const summary = planned ? summarizeCutList(pieces, sheet) : listSummary(pieces, sheet);
    if (planned && summary.sheetsUsed === 0) return await fail('nothing fits the panel');
    const code = newPhotoCode();
    await completePhotoRead(db, readId, { code, pieces, sheet, summary, now });
    result = {
      text: planned ? photoResultText(lang, summary, pieces, photoLink(code)) : bigListText(lang, summary, photoLink(code)),
      // No picture for a list the bot does not plan (over BOT_PLAN_MAX_PIECES).
      caption: photoResultCaption(lang, summary, photoLink(code)),
      card: photoResultCard(lang, summary, photoLink(code)),
      image: planned ? planImageUrl(code) : null,
    };
  } catch (error) {
    console.error('[whatsapp] plan answer threw', describe(error));
    return await fail('threw');
  }

  // The read is stored and the number served: a failing send is logged, never undone.
  // The plan picture first (owner, 21/11/2026); the text answer if it cannot go out.
  try {
    if (deliverImage && result.image && (await deliverImage(result.image, result.caption, 'photo_result', result.card))) return 'handled';
  } catch (error) {
    console.error('[whatsapp] could not send the plan picture', describe(error));
  }
  try {
    await deliver(result.text, 'photo_result');
  } catch (error) {
    console.error('[whatsapp] could not send the photo result', describe(error));
  }
  return 'handled';
}
