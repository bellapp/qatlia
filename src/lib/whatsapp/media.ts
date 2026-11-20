import type { WhatsAppConfig } from '@/lib/whatsapp/config';

/**
 * Downloads a photo or a voice note a prospect sent to the bot, through the
 * Meta Graph media API: the media id from the webhook is looked up, then the
 * URL it returns is downloaded, both with the bot's token. Only a type the
 * next step takes comes back, as a data URL: an image the cut-list reader
 * takes (JPEG, PNG, WebP, up to MAX_MEDIA_BYTES), or audio Gemini takes (Ogg,
 * MP3, AAC, up to MAX_VOICE_BYTES). Never throws; the file is held in memory
 * only.
 */

export const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
/** About 8 minutes of a WhatsApp voice note: a longer file is a forwarded recording, not a question. */
export const MAX_VOICE_BYTES = 1024 * 1024;
/** Each Meta request gets this long, so a stuck call fails instead of eating the webhook's time. */
export const MEDIA_TIMEOUT_MS = 10_000;

export type MediaKind = 'image' | 'audio';

const ACCEPTED: Record<MediaKind, { types: readonly string[]; maxBytes: number }> = {
  image: { types: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: MAX_MEDIA_BYTES },
  // audio/mp4 and audio/amr are left out: Gemini does not list them.
  audio: { types: ['audio/ogg', 'audio/mpeg', 'audio/aac'], maxBytes: MAX_VOICE_BYTES },
};

export type MediaResult =
  | { ok: true; dataUrl: string; mimeType: string; bytes: number }
  | { ok: false; reason: 'lookup_refused' | 'lookup_failed' | 'download_failed' | 'too_large' | 'bad_type'; status?: number };

/** `audio/ogg; codecs=opus` (a WhatsApp voice note) is `audio/ogg`. */
function plainType(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.split(';')[0].trim().toLowerCase() || null;
}

export async function fetchMediaDataUrl(
  config: Pick<WhatsAppConfig, 'accessToken' | 'graphVersion'>,
  mediaId: string,
  fetchImpl: typeof fetch = fetch,
  kind: MediaKind = 'image',
): Promise<MediaResult> {
  const { types, maxBytes } = ACCEPTED[kind];
  const headers = { Authorization: `Bearer ${config.accessToken}` };

  let lookup: Response;
  try {
    lookup = await fetchImpl(`https://graph.facebook.com/${config.graphVersion}/${encodeURIComponent(mediaId)}`, {
      headers,
      signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: 'lookup_failed' };
  }
  if (!lookup.ok) {
    // 4xx: Meta answered and said no (permission, unknown or expired id).
    const reason = lookup.status >= 400 && lookup.status < 500 ? 'lookup_refused' : 'lookup_failed';
    return { ok: false, reason, status: lookup.status };
  }

  let info: { url?: unknown; mime_type?: unknown; file_size?: unknown };
  try {
    info = (await lookup.json()) as typeof info;
  } catch {
    return { ok: false, reason: 'lookup_failed', status: lookup.status };
  }
  if (typeof info.url !== 'string' || !info.url) return { ok: false, reason: 'lookup_failed', status: lookup.status };
  const mimeType = plainType(info.mime_type);
  if (!mimeType || !types.includes(mimeType)) return { ok: false, reason: 'bad_type' };
  if (typeof info.file_size === 'number' && info.file_size > maxBytes) return { ok: false, reason: 'too_large' };

  let buffer: ArrayBuffer;
  try {
    const download = await fetchImpl(info.url, { headers, signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS) });
    if (!download.ok) return { ok: false, reason: 'download_failed', status: download.status };
    buffer = await download.arrayBuffer();
  } catch {
    return { ok: false, reason: 'download_failed' };
  }
  if (buffer.byteLength > maxBytes) return { ok: false, reason: 'too_large' };

  return {
    ok: true,
    mimeType,
    bytes: buffer.byteLength,
    dataUrl: `data:${mimeType};base64,${Buffer.from(buffer).toString('base64')}`,
  };
}
