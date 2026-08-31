/**
 * Decodes and validates an artisan-supplied company logo for
 * `/api/export-quotation`, before any byte of it reaches jsPDF.
 *
 * `src/lib/quotation.ts`'s `LogoDataUrlSchema` only bounds the *string*
 * (format prefix, base64 charset, overall length) — it cannot decode
 * base64 or inspect image bytes inside a Zod schema. This module does the
 * rest, in order:
 *   1. strict base64 decode (never `atob`-style lenient decoding);
 *   2. a hard 500KB cap on the *decoded* size (the string-length bound in
 *      the schema is only an approximation of this);
 *   3. real magic-number verification of the decoded bytes against the
 *      MIME the caller declared — a `data:image/png;...` prefix around
 *      JPEG (or arbitrary) bytes is rejected, never trusted;
 *   4. a minimal, dependency-free dimension read (PNG IHDR / JPEG SOF0..3)
 *      to reject a "dimension bomb" — a tiny file that decodes to an
 *      enormous canvas and would blow up PDF rendering.
 *
 * SVG (or any other format) is rejected by construction: the MIME check
 * only ever recognizes `image/png` and `image/jpeg`.
 *
 * Never logs and never returns the raw decoded bytes on failure — only a
 * stable, machine-readable `code`. On success the bytes are returned (the
 * caller needs them to embed the image), but the route that calls this must
 * still never log them; see route.ts's own logging discipline.
 */

export type LogoMime = 'image/png' | 'image/jpeg';

export type LogoValidationErrorCode =
  | 'UNSUPPORTED_FORMAT'
  | 'DECODE_FAILED'
  | 'TOO_LARGE'
  | 'MAGIC_MISMATCH'
  | 'DIMENSION_BOMB';

export type LogoValidationResult =
  | { ok: true; mime: LogoMime; bytes: Uint8Array; width: number; height: number }
  | { ok: false; code: LogoValidationErrorCode };

/** Decoded-size cap, matching `LOGO_MAX_DECODED_BYTES` documented in src/lib/quotation.ts. */
const MAX_DECODED_BYTES = 500 * 1024;

/**
 * Generous upper bound for any legitimate business logo — real logos are a
 * few hundred pixels per side. Guards against a crafted file whose header
 * claims an enormous canvas (a "dimension bomb") while staying well under
 * the 500KB decoded-size cap, which would make PDF/canvas rendering of that
 * claimed size disproportionately expensive relative to the file's size.
 */
const MAX_DIMENSION_PX = 4000;
const MAX_PIXEL_COUNT = 8_000_000; // 4000 x 2000, generous for any real logo

// The body is captured loosely (anything but a comma) rather than restricted
// to the base64 alphabet here: a body containing invalid characters must
// still reach `decodeBase64`'s stricter round-trip check and fail with
// `DECODE_FAILED`, not be mistaken for "not a data URL at all" (`UNSUPPORTED_FORMAT`).
const DATA_URL_PATTERN = /^data:(image\/png|image\/jpeg);base64,([^,]+)$/;

function decodeBase64(base64: string): Uint8Array | null {
  try {
    const buffer = Buffer.from(base64, 'base64');
    // Buffer.from silently drops invalid characters instead of throwing —
    // round-tripping and comparing lengths is what actually catches malformed
    // base64 (e.g. stray non-alphabet characters the regex already rejects,
    // but this is a second, independent check rather than trusting the regex alone).
    const roundTrip = buffer.toString('base64');
    const normalize = (s: string) => s.replace(/=+$/, '');
    if (normalize(roundTrip) !== normalize(base64)) return null;
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  } catch {
    return null;
  }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function bytesStartWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((value, index) => bytes[index] === value);
}

/** Reads width/height from a PNG's mandatory first chunk (IHDR), which always immediately follows the 8-byte signature. */
function readPngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  // Signature(8) + length(4) + type(4, "IHDR") + width(4) + height(4) = 24 bytes minimum.
  if (bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunkType = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (chunkType !== 'IHDR') return null;
  return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
}

const JPEG_SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/** Walks JPEG markers to the first Start-Of-Frame segment, which carries the real pixel dimensions. */
function readJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null; // every segment must start with a marker
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2; // markers with no payload
      continue;
    }
    if (marker === 0xd9) return null; // EOI reached with no SOF found
    const segmentLength = view.getUint16(offset + 2, false);
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (offset + 9 > bytes.length) return null;
      const height = view.getUint16(offset + 5, false);
      const width = view.getUint16(offset + 7, false);
      return { width, height };
    }
    offset += 2 + segmentLength;
  }
  return null;
}

function withinDimensionBudget(width: number, height: number): boolean {
  if (width <= 0 || height <= 0) return false;
  if (width > MAX_DIMENSION_PX || height > MAX_DIMENSION_PX) return false;
  return width * height <= MAX_PIXEL_COUNT;
}

/**
 * Validates a `data:image/(png|jpeg);base64,...` logo end to end. Never
 * throws — every rejection is a typed `{ ok: false, code }` result so the
 * route can map it to a stable, non-leaking error response.
 */
export function validateLogoDataUrl(dataUrl: string): LogoValidationResult {
  const match = DATA_URL_PATTERN.exec(dataUrl);
  if (!match) return { ok: false, code: 'UNSUPPORTED_FORMAT' };
  const declaredMime = match[1] as LogoMime;
  const base64 = match[2];

  const bytes = decodeBase64(base64);
  if (!bytes) return { ok: false, code: 'DECODE_FAILED' };
  if (bytes.byteLength > MAX_DECODED_BYTES) return { ok: false, code: 'TOO_LARGE' };

  const isPng = bytesStartWith(bytes, PNG_SIGNATURE);
  const isJpeg = bytesStartWith(bytes, [0xff, 0xd8, 0xff]);

  if (declaredMime === 'image/png' && !isPng) return { ok: false, code: 'MAGIC_MISMATCH' };
  if (declaredMime === 'image/jpeg' && !isJpeg) return { ok: false, code: 'MAGIC_MISMATCH' };

  const dimensions = declaredMime === 'image/png' ? readPngDimensions(bytes) : readJpegDimensions(bytes);
  if (!dimensions) return { ok: false, code: 'DECODE_FAILED' };
  if (!withinDimensionBudget(dimensions.width, dimensions.height)) return { ok: false, code: 'DIMENSION_BOMB' };

  return { ok: true, mime: declaredMime, bytes, width: dimensions.width, height: dimensions.height };
}
