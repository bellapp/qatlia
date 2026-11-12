/**
 * The history extras a saved project carries next to its geometry: the
 * artisan's own job name, a thumbnail of the scanned cut list, the time the
 * PDF was last generated, and the full list of stock sheets.
 *
 * `/api/projects` used to keep only options/pieces/sheet/result, so for a
 * signed-in artisan the scan and the PDF marker never reached the history
 * page. These validators decide what of a client payload may be stored in
 * `options_json`: anything malformed or oversized is dropped, never stored.
 *
 * Pure module: no Supabase, no env, no network.
 */

/**
 * Upper bound on a stored thumbnail, in dataURL characters (~110 KB of image).
 * `GET /api/projects` returns every project's options_json at once, so the
 * history page must stay light on a mobile connection.
 */
export const SCAN_THUMB_MAX_CHARS = 150_000;

export const PROJECT_NAME_MAX_CHARS = 120;

/** A saved project never needs more stock sheets than this. */
export const MAX_STORED_SHEETS = 50;

const SCAN_THUMB_PATTERN = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const ISO_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

export function sanitizeScanThumb(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > SCAN_THUMB_MAX_CHARS) return undefined;
  return SCAN_THUMB_PATTERN.test(value) ? value : undefined;
}

/** A real instant, normalised to `toISOString()`; anything else is dropped. */
export function sanitizePdfGeneratedAt(value: unknown): string | undefined {
  if (typeof value !== 'string' || !ISO_DATETIME_PATTERN.test(value)) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

export function sanitizeProjectName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.trim();
  return name && name.length <= PROJECT_NAME_MAX_CHARS ? name : undefined;
}

export function sanitizeSheets(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_STORED_SHEETS) return undefined;
  return value.every((sheet) => sheet !== null && typeof sheet === 'object' && !Array.isArray(sheet)) ? value : undefined;
}

export interface ProjectHistoryMetadata {
  projectName?: string;
  scanThumb?: string;
  pdfGeneratedAt?: string;
  sheets?: unknown[];
}

/**
 * The extras worth storing from a save request, under the exact keys the
 * history page and the atelier restore already read from `options_json`.
 * Absent or invalid fields are left out rather than stored as null.
 */
export function pickProjectHistoryMetadata(body: unknown): ProjectHistoryMetadata {
  const source = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const metadata: ProjectHistoryMetadata = {};
  const projectName = sanitizeProjectName(source.projectName);
  if (projectName) metadata.projectName = projectName;
  const scanThumb = sanitizeScanThumb(source.scanThumb);
  if (scanThumb) metadata.scanThumb = scanThumb;
  const pdfGeneratedAt = sanitizePdfGeneratedAt(source.pdfGeneratedAt);
  if (pdfGeneratedAt) metadata.pdfGeneratedAt = pdfGeneratedAt;
  const sheets = sanitizeSheets(source.sheets);
  if (sheets) metadata.sheets = sheets;
  return metadata;
}
