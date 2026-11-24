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
 *   "already read" answer went out minutes ago). A photo that came during a
 *   read is marked as waiting: the read says, after its plan, that the plan is
 *   of one photo (one read per number);
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
 * (media.ts), the model what is left of READ_DEADLINE_MS, up to
 * READ_TIMEOUT_MS (30 s until a clear sheet failed 32 s in, 23/11/2026; the
 * reads that worked took up to 27 s), and the plan is bounded by the piece
 * count. Past PICTURE_DEADLINE_MS the answer goes as text.
 */
const READ_TIMEOUT_MS = 40_000;
const READ_DEADLINE_MS = 45_000;
/**
 * A read with no pieces asks what the photo showed (classifyPhoto), with this
 * deadline, only while no more than CLASSIFY_UNTIL_MS have gone since the
 * start: the failed reads seen took 5 to 7 s, a slow one keeps its old text.
 */
const CLASSIFY_TIMEOUT_MS = 8_000;
const CLASSIFY_UNTIL_MS = 30_000;
/** A photo that came during another's read: no text, only its mark (see sayOthersWaiting). */
const WAITING_KIND = 'photo_waiting';
/** The database's clock and this server's may differ by a little. */
const CLOCK_SKEW_MS = 5_000;
/** One "already read" answer per number in this window, however many photos follow. */
const ALREADY_COOLDOWN_MS = 10 * 60 * 1000;

const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error');

/**
 * One "already read" message per number and ALREADY_COOLDOWN_MS: true for the
 * caller that may send it. Photos sent together all pass the count before any
 * answer is stored (anas, 20/11/2026: four identical answers in two seconds).
 * The claim's wamid is unique per number and 10-minute window: one wins.
 */
async function claimAlready(db: SupabaseClient, waId: string, now: Date): Promise<boolean> {
  const since = new Date(now.getTime() - ALREADY_COOLDOWN_MS);
  if ((await countBotMessages(db, waId, 'photo_already', since)) > 0) return false;
  const window = Math.floor(now.getTime() / ALREADY_COOLDOWN_MS);
  return recordOutbound(db, {
    waId,
    wamid: `claim:photo_already:${waId}:${window}`,
    direction: 'bot',
    kind: 'photo_already_claim',
    body: null,
  });
}

/** Marks a photo that came during another's read; a failure only leaves it unmentioned, as before. */
async function markWaiting(db: SupabaseClient, event: InboundEvent): Promise<void> {
  try {
    await recordOutbound(db, {
      waId: event.waId,
      wamid: `claim:photo_waiting:${event.wamid}`,
      direction: 'bot',
      kind: WAITING_KIND,
      body: null,
    });
  } catch (error) {
    console.error('[whatsapp] could not mark a waiting photo', describe(error));
  }
}

/**
 * After the plan: photos that came during the read (markWaiting) were not
 * read, and the prospect is told once (azzeadden, 23/11/2026: two sheets sent
 * together, the plan of one, not a word about the other). Never throws.
 */
async function sayOthersWaiting(
  db: SupabaseClient,
  waId: string,
  lang: Lang,
  now: Date,
  deliver: (text: string, kind: PhotoMessageKind) => Promise<boolean>,
): Promise<void> {
  try {
    const since = new Date(now.getTime() - CLOCK_SKEW_MS);
    if ((await countBotMessages(db, waId, WAITING_KIND, since)) === 0) return;
    if (!(await claimAlready(db, waId, now))) return;
    await deliver(PHOTO_COPY.others[lang], 'photo_already');
  } catch (error) {
    console.error('[whatsapp] could not mention the other photos', describe(error));
  }
}

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
  const started = clock();
  if (!event.mediaId) return 'hint';

  let reservation;
  try {
    reservation = await reservePhotoRead(db, event.waId, now, config.photoDailyCap);
  } catch (error) {
    console.error('[whatsapp] photo reservation failed', describe(error));
    return 'hint';
  }

  if (reservation.status === 'busy') {
    await markWaiting(db, event);
    return 'silent';
  }
  if (reservation.status === 'already') {
    if (!(await claimAlready(db, event.waId, now))) return 'silent';
    const link = reservation.code ? photoLink(reservation.code) : null;
    await deliver(PHOTO_COPY.already(lang, link), 'photo_already');
    return 'handled';
  }
  if (reservation.status !== 'reserved') return 'hint';

  const readId = reservation.id;
  let announced = false;
  let failed = false;
  // Frees the number. Once "je lis" went out the prospect gets the failed-read
  // text (never the hint, whose cooldown could leave "je lis" unanswered).
  const fail = async (reason: string, text: string = PHOTO_COPY.unreadable[lang]): Promise<PhotoOutcome> => {
    failed = true;
    console.log('[whatsapp] photo read failed', reason);
    try {
      await failPhotoRead(db, readId, { reason, ms: clock() - started });
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
  try {
    await deliver(PHOTO_COPY.reading[lang], 'photo_reading');
    announced = true;

    const media = await fetchMediaDataUrl(config, event.mediaId);
    if (!media.ok) {
      const reason = `media ${media.reason} ${media.status ?? ''}`.trim();
      const photoRefused = media.reason === 'too_large' || media.reason === 'bad_type';
      return await fail(reason, photoRefused ? undefined : PHOTO_COPY.ourFault[lang]);
    }

    // Never 0: that would mean no deadline.
    const timeoutMs = Math.max(1_000, Math.min(READ_TIMEOUT_MS, READ_DEADLINE_MS - (clock() - started)));
    const answer = await readCutList(media.dataUrl, { readPanel: true, timeoutMs });
    if (answer.status === 'unreadable' && clock() - started <= CLASSIFY_UNTIL_MS) {
      // A drawing or the furniture itself: say what the bot needs, never "take it again".
      const kind = await classifyPhoto(media.dataUrl, { timeoutMs: CLASSIFY_TIMEOUT_MS });
      if (kind) return await fail(`read unreadable, ${kind}`, PHOTO_COPY.notAList[kind][lang]);
    }
    if (answer.status === 'unreadable') return await fail('read unreadable');
    // Out of time, refused or no provider: nothing to do with the photo. httpStatus 0 is out of time.
    if (answer.status === 'error') return await fail(`read error ${answer.httpStatus}`, PHOTO_COPY.ourFault[lang]);
    if (answer.status !== 'ok') return await fail(`read ${answer.status}`, PHOTO_COPY.ourFault[lang]);
    read = answer;
  } catch (error) {
    console.error('[whatsapp] photo read threw', describe(error));
    return await fail('threw', PHOTO_COPY.ourFault[lang]);
  }

  const outcome = await planAndAnswer({ db, readId, read, lang, now, deliver, deliverImage, fail });
  if (!failed) await sayOthersWaiting(db, event.waId, lang, now, deliver);
  return outcome;
}
