import type { WhatsAppConfig } from '@/lib/whatsapp/config';

/**
 * Downloads a photo a prospect sent to the bot, through the Meta Graph media
 * API: the media id from the webhook is looked up, then the URL it returns is
 * downloaded, both with the bot's token. Only an image the cut-list reader
 * takes (JPEG, PNG, WebP) and no larger than MAX_MEDIA_BYTES comes back, as a
 * data URL. Never throws; the photo is held in memory only.
 */

export const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
/** Each Meta request gets this long, so a stuck call fails instead of eating the webhook's time. */
export const MEDIA_TIMEOUT_MS = 10_000;

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
type AcceptedType = (typeof ACCEPTED_TYPES)[number];

export type MediaResult =
  | { ok: true; dataUrl: string; mimeType: AcceptedType; bytes: number }
  | { ok: false; reason: 'lookup_refused' | 'lookup_failed' | 'download_failed' | 'too_large' | 'bad_type'; status?: number };

const isAccepted = (value: unknown): value is AcceptedType =>
  typeof value === 'string' && (ACCEPTED_TYPES as readonly string[]).includes(value);

export async function fetchMediaDataUrl(
  config: Pick<WhatsAppConfig, 'accessToken' | 'graphVersion'>,
  mediaId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MediaResult> {
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
  if (!isAccepted(info.mime_type)) return { ok: false, reason: 'bad_type' };
  if (typeof info.file_size === 'number' && info.file_size > MAX_MEDIA_BYTES) return { ok: false, reason: 'too_large' };

  let buffer: ArrayBuffer;
  try {
    const download = await fetchImpl(info.url, { headers, signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS) });
    if (!download.ok) return { ok: false, reason: 'download_failed', status: download.status };
    buffer = await download.arrayBuffer();
  } catch {
    return { ok: false, reason: 'download_failed' };
  }
  if (buffer.byteLength > MAX_MEDIA_BYTES) return { ok: false, reason: 'too_large' };

  return {
    ok: true,
    mimeType: info.mime_type,
    bytes: buffer.byteLength,
    dataUrl: `data:${info.mime_type};base64,${Buffer.from(buffer).toString('base64')}`,
  };
}
