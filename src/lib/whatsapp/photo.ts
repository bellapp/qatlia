/**
 * The bot reads a photographed cut list (plan 2026-11-19): once per number,
 * it says it is reading, downloads the photo, reads it with the site's reader
 * (plus the panel size), computes the plan on that panel or the default one,
 * stores the result behind a short code and answers with the summary and the
 * link. The full plan stays in the app, after sign-up.
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
import { photoLink, photoResultText, summarizeCutList } from '@/lib/whatsapp/photo-summary';
import { countBotMessages } from '@/lib/whatsapp/store';

export type PhotoOutcome = 'handled' | 'hint' | 'silent';
export type PhotoMessageKind = 'photo_reading' | 'photo_result' | 'photo_already';

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
}): Promise<PhotoOutcome> {
  const { db, config, event, lang, now, deliver } = input;
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
  const fail = async (reason: string): Promise<PhotoOutcome> => {
    console.log('[whatsapp] photo read failed', reason);
    try {
      await failPhotoRead(db, readId);
    } catch (error) {
      console.error('[whatsapp] could not mark the photo read failed', describe(error));
    }
    return 'hint';
  };

  try {
    await deliver(PHOTO_COPY.reading[lang], 'photo_reading');

    const media = await fetchMediaDataUrl(config, event.mediaId);
    if (!media.ok) return await fail(`media ${media.reason} ${media.status ?? ''}`.trim());

    const read = await readCutList(media.dataUrl, { readPanel: true });
    if (read.status !== 'ok') return await fail(`read ${read.status}`);

    const summary = summarizeCutList(read.pieces, read.sheet);
    const code = newPhotoCode();
    await completePhotoRead(db, readId, { code, pieces: read.pieces, sheet: read.sheet, summary, now });
    await deliver(photoResultText(lang, summary, read.pieces, photoLink(code)), 'photo_result');
    return 'handled';
  } catch (error) {
    console.error('[whatsapp] photo read threw', describe(error));
    return await fail('threw');
  }
}
