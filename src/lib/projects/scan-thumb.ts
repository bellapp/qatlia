/**
 * The thumbnail of a scanned cut list, as stored with a project.
 *
 * Pure module: no Supabase, no env, no network.
 */

/**
 * Upper bound on the thumbnails of one project, in dataURL characters (~110 KB
 * of image): one thumbnail, or the sum of a project's sheets (scan-sheets.ts).
 * `GET /api/projects` returns every project's options_json at once, so the
 * history page must stay light on a mobile connection.
 */
export const SCAN_THUMB_MAX_CHARS = 150_000;

const SCAN_THUMB_PATTERN = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

export function sanitizeScanThumb(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > SCAN_THUMB_MAX_CHARS) return undefined;
  return SCAN_THUMB_PATTERN.test(value) ? value : undefined;
}
