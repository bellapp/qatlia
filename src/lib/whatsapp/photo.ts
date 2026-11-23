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
import { failPhotoRead, reservePhotoRead } from '@/lib/whatsapp/photo-store';
import { fetchMediaDataUrl } from '@/lib/whatsapp/media';
import { classifyPhoto, readCutList, type ReadPiece, type ReadSheet } from '@/lib/vision/read-cut-list';
import { photoLink } from '@/lib/whatsapp/photo-summary';
import { MAX_BOT_PIECES, planAndAnswer, type PhotoMessageKind } from '@/lib/whatsapp/plan-answer';
import type { PlanCard } from '@/lib/whatsapp/send';
import { countBotMessages, recordOutbound } from '@/lib/whatsapp/store';

export type PhotoOutcome = 'handled' | 'hint' | 'silent';
export { MAX_BOT_PIECES };
export type { PhotoMessageKind };

/**
 * Time budget inside the webhook's 60 s: the media requests have 10 s each
 * (media.ts), the model 30 s, and the plan is bounded by the piece count.
 */
const READ_TIMEOUT_MS = 30_000;
/**
 * A read with no pieces asks what the photo showed (classifyPhoto), with this
 * deadline, only while no more than CLASSIFY_UNTIL_MS have gone since the
 * start: the failed reads seen took 5 to 7 s, a slow one keeps its old text.
 */
const CLASSIFY_TIMEOUT_MS = 8_000;
const CLASSIFY_UNTIL_MS = 30_000;
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
   * Sends the plan picture by link: as `card`, with its button to the link,
   * or with its caption; false when it could not go out. Absent, or false,
   * the answer goes as text (photoResultText).
   */
  deliverImage?: (link: string, caption: string, kind: PhotoMessageKind, card: PlanCard) => Promise<boolean>;
  /** Milliseconds now; tests move it. */
  clock?: () => number;
}): Promise<PhotoOutcome> {
  const { db, config, event, lang, now, deliver, deliverImage } = input;
  const clock = input.clock ?? Date.now;
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
    // Photos sent together all pass the check above before any answer is
    // stored (anas, 20/11/2026: four identical answers in two seconds). The
    // claim's wamid is unique per number and 10-minute window: one wins.
    const window = Math.floor(now.getTime() / ALREADY_COOLDOWN_MS);
    const claimed = await recordOutbound(db, {
      waId: event.waId,
      wamid: `claim:photo_already:${event.waId}:${window}`,
      direction: 'bot',
      kind: 'photo_already_claim',
      body: null,
    });
    if (!claimed) return 'silent';
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

  let read: { pieces: ReadPiece[]; sheet: ReadSheet | null };
  const started = clock();
  try {
    await deliver(PHOTO_COPY.reading[lang], 'photo_reading');
    announced = true;

    const media = await fetchMediaDataUrl(config, event.mediaId);
    if (!media.ok) return await fail(`media ${media.reason} ${media.status ?? ''}`.trim());

    const answer = await readCutList(media.dataUrl, { readPanel: true, timeoutMs: READ_TIMEOUT_MS });
    if (answer.status === 'unreadable' && clock() - started <= CLASSIFY_UNTIL_MS) {
      // A drawing or the furniture itself: say what the bot needs, never "take it again".
      const kind = await classifyPhoto(media.dataUrl, { timeoutMs: CLASSIFY_TIMEOUT_MS });
      if (kind) return await fail(`read unreadable, ${kind}`, PHOTO_COPY.notAList[kind][lang]);
    }
    if (answer.status !== 'ok') return await fail(`read ${answer.status}`);
    read = answer;
  } catch (error) {
    console.error('[whatsapp] photo read threw', describe(error));
    return await fail('threw');
  }

  return planAndAnswer({ db, readId, read, lang, now, deliver, deliverImage, fail });
}
