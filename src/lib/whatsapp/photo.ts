/**
 * The bot reads a photographed cut list (plan 2026-11-19): once per number,
 * it says it is reading, downloads the photo, reads it with the site's reader
 * (plus the panel size), computes the plan on that panel or the default one,
 * stores the result behind a short code and answers with a picture of the
 * plan's first panel, the summary and the link (the summary as text when the
 * picture cannot go out). The full plan stays in the app, after sign-up.
 *
 * Outcomes for the webhook:
 * - 'handled': this flow sent its answer;
 * - 'silent': nothing to send (another read of this number is running, or the
 *   "already read" answer went out minutes ago);
 * - 'hint': the reading cannot help (off, capped, unreadable photo, any
 *   failure); the webhook sends today's image hint instead.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { WhatsAppConfig } from '@/lib/whatsapp/config';
import type { InboundEvent } from '@/lib/whatsapp/payload';
import { PHOTO_COPY, type Lang } from '@/lib/whatsapp/copy';
import { completePhotoRead, failPhotoRead, newPhotoCode, reservePhotoRead } from '@/lib/whatsapp/photo-store';
import { fetchMediaDataUrl } from '@/lib/whatsapp/media';
import { readCutList } from '@/lib/vision/read-cut-list';
import {
  BOT_PLAN_MAX_PIECES,
  bigListText,
  listSummary,
  photoLink,
  photoResultCaption,
  photoResultText,
  plausiblePanel,
  summarizeCutList,
  usablePieces,
} from '@/lib/whatsapp/photo-summary';
import { planImageUrl } from '@/lib/whatsapp/plan-image';
import { countBotMessages } from '@/lib/whatsapp/store';

export type PhotoOutcome = 'handled' | 'hint' | 'silent';
export type PhotoMessageKind = 'photo_reading' | 'photo_result' | 'photo_already' | 'photo_failed';

/**
 * Time budget inside the webhook's 60 s: the media requests have 10 s each
 * (media.ts), the model 30 s, and the plan is bounded by the piece count.
 */
const READ_TIMEOUT_MS = 30_000;
/**
 * Above this many pieces (quantities expanded) the bot does not take the list:
 * the reader is not trusted that far, and the atelier reads it. Raised from 300
 * to 900 by the owner (21/11/2026); the plan itself stops at BOT_PLAN_MAX_PIECES.
 */
export const MAX_BOT_PIECES = 900;

/** One "already read" answer per number in this window, however many photos follow. */
const ALREADY_COOLDOWN_MS = 10 * 60 * 1000;

const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error');

export async function handlePhoto(input: {
  db: SupabaseClient;
  config: Pick<WhatsAppConfig, 'photoDailyCap' | 'accessToken' | 'graphVersion'>;
  event: InboundEvent;
  lang: Lang;
  now: Date;
  deliver: (text: string, kind: PhotoMessageKind) => Promise<boolean>;
  /**
   * Sends the plan picture by link with its caption; false when it could not
   * go out. Absent, or false, the answer goes as text (photoResultText).
   */
  deliverImage?: (link: string, caption: string, kind: PhotoMessageKind) => Promise<boolean>;
}): Promise<PhotoOutcome> {
  const { db, config, event, lang, now, deliver, deliverImage } = input;
  if (!event.mediaId) return 'hint';

  let reservation;
  try {
    reservation = await reservePhotoRead(db, event.waId, now, config.photoDailyCap);
  } catch (error) {
    console.error('[whatsapp] photo reservation failed', describe(error));
    return 'hint';
  }

  if (reservation.status === 'busy') return 'silent';
  if (reservation.status === 'already') {
    const since = new Date(now.getTime() - ALREADY_COOLDOWN_MS);
    if ((await countBotMessages(db, event.waId, 'photo_already', since)) > 0) return 'silent';
    const link = reservation.code ? photoLink(reservation.code) : null;
    await deliver(PHOTO_COPY.already(lang, link), 'photo_already');
    return 'handled';
  }
  if (reservation.status !== 'reserved') return 'hint';

  const readId = reservation.id;
  let announced = false;
  // Frees the number. Once "je lis" went out the prospect gets the failed-read
  // text (never the hint, whose cooldown could leave "je lis" unanswered).
  const fail = async (reason: string, text: string = PHOTO_COPY.unreadable[lang]): Promise<PhotoOutcome> => {
    console.log('[whatsapp] photo read failed', reason);
    try {
      await failPhotoRead(db, readId);
    } catch (error) {
      console.error('[whatsapp] could not mark the photo read failed', describe(error));
    }
    if (!announced) return 'hint';
    try {
      await deliver(text, 'photo_failed');
    } catch (error) {
      console.error('[whatsapp] could not send the failed-read text', describe(error));
    }
    return 'handled';
  };

  let result: { text: string; caption: string; image: string | null };
  try {
    await deliver(PHOTO_COPY.reading[lang], 'photo_reading');
    announced = true;

    const media = await fetchMediaDataUrl(config, event.mediaId);
    if (!media.ok) return await fail(`media ${media.reason} ${media.status ?? ''}`.trim());

    const read = await readCutList(media.dataUrl, { readPanel: true, timeoutMs: READ_TIMEOUT_MS });
    if (read.status !== 'ok') return await fail(`read ${read.status}`);

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
      image: planned ? planImageUrl(code) : null,
    };
  } catch (error) {
    console.error('[whatsapp] photo read threw', describe(error));
    return await fail('threw');
  }

  // The read is stored and the number served: a failing send is logged, never undone.
  // The plan picture first (owner, 21/11/2026); the text answer if it cannot go out.
  try {
    if (deliverImage && result.image && (await deliverImage(result.image, result.caption, 'photo_result'))) return 'handled';
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
