/**
 * The scan image kept for a saved project: the 1600 px version the atelier
 * already makes for AI reading, stored in the private `scans` bucket so a
 * reopened project can show it in full.
 *
 * A data URL header is the client's claim, so `parseScanImage` also checks
 * the decoded bytes against the real magic bytes of the declared type. A
 * stored path is only ever `{userId}/{uuid}.{ext}` and only the owner's own
 * is accepted back, so a path from another artisan can neither be saved nor
 * served.
 *
 * Pure module: no Supabase, no env, no network.
 */

/**
 * Upper bound on an incoming image, in dataURL characters (about 1 MB of
 * image). Only the reduced version is kept, never a phone original.
 */
export const SCAN_IMAGE_MAX_CHARS = 1_400_000;

export const SCAN_BUCKET = 'scans';

export type ScanMime = 'image/jpeg' | 'image/png' | 'image/webp';
export type ScanExt = 'jpg' | 'png' | 'webp';

export interface ParsedScanImage {
  mime: ScanMime;
  ext: ScanExt;
  bytes: Buffer;
}

const EXT_BY_MIME: Record<ScanMime, ScanExt> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const DATA_URL_HEADER = /^data:(image\/(?:jpeg|png|webp));base64,/;
const BASE64_BODY = /^[A-Za-z0-9+/]+={0,2}$/;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const USER_ID_PATTERN = new RegExp(`^${UUID}$`);
const SCAN_FILE_PATTERN = new RegExp(`^${UUID}\\.(jpg|png|webp)$`);

function hasMagicBytes(mime: ScanMime, bytes: Buffer): boolean {
  switch (mime) {
    case 'image/jpeg':
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case 'image/png':
      return (
        bytes.length >= 8 &&
        bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
        bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
      );
    case 'image/webp':
      return (
        bytes.length >= 12 &&
        bytes.toString('latin1', 0, 4) === 'RIFF' &&
        bytes.toString('latin1', 8, 12) === 'WEBP'
      );
  }
}

/** The decoded image of a bounded jpeg/png/webp dataURL, or null for anything else. */
export function parseScanImage(dataUrl: unknown): ParsedScanImage | null {
  if (typeof dataUrl !== 'string' || dataUrl.length > SCAN_IMAGE_MAX_CHARS) return null;
  const header = DATA_URL_HEADER.exec(dataUrl);
  if (!header) return null;
  const mime = header[1] as ScanMime;
  const body = dataUrl.slice(header[0].length);
  if (!BASE64_BODY.test(body)) return null;
  const bytes = Buffer.from(body, 'base64');
  if (!hasMagicBytes(mime, bytes)) return null;
  return { mime, ext: EXT_BY_MIME[mime], bytes };
}

export function scanPathFor(userId: string, fileId: string, ext: string): string {
  return `${userId}/${fileId}.${ext}`;
}

/** True only for `<userId>/<uuid>.(jpg|png|webp)`, with `userId` the artisan's own. */
export function isOwnScanPath(path: unknown, userId: string): path is string {
  if (typeof path !== 'string' || typeof userId !== 'string' || !USER_ID_PATTERN.test(userId)) return false;
  const parts = path.split('/');
  return parts.length === 2 && parts[0] === userId && SCAN_FILE_PATTERN.test(parts[1]);
}
