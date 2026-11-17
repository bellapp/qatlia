/**
 * The cut-list sheets of one project (spec 2026-11-17): a list too long for
 * one page is photographed as up to MAX_SCAN_SHEETS sheets, read one by one,
 * and merged into one piece list and one plan.
 *
 * - Each piece read from a photo carries `scanIndex`, the number (from 1) of
 *   its sheet, so removing a sheet removes its pieces only.
 * - A project keeps one entry per sheet in `options_json.scans`, in order:
 *   `{ thumb?, path? }`. Projects saved before keep `scanThumb`/`scanPath`,
 *   read here as a list of one. Every reader goes through `readScanSheets`.
 * - The thumbnails of a project share the budget one thumbnail had
 *   (SCAN_THUMB_MAX_CHARS): the history list loads every project at once.
 *
 * Pure module: the downscale is passed in.
 */

import type { Piece } from '@/lib/cutting/binpacking';
import { MAX_SCANS_PER_ANALYSIS } from '@/lib/billing/policy';
import { SCAN_THUMB_MAX_CHARS, sanitizeScanThumb } from './scan-thumb';
import { isOwnScanPath } from './scan-image';

export const MAX_SCAN_SHEETS = MAX_SCANS_PER_ANALYSIS;

export interface ScanSheet {
  /** Small JPEG data URL shown in the atelier and the history. */
  thumb?: string;
  /** Path of the 1600 px image in the private bucket. */
  path?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const PATH_SHAPE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/i;

function readSheet(value: unknown): ScanSheet {
  const source = isRecord(value) ? value : {};
  const sheet: ScanSheet = {};
  const thumb = sanitizeScanThumb(source.thumb);
  if (thumb) sheet.thumb = thumb;
  if (typeof source.path === 'string' && PATH_SHAPE.test(source.path)) sheet.path = source.path;
  return sheet;
}

/**
 * The sheets a saved project carries, in order: its `scans` list, else its
 * old single scan, else none. Read-side only: a stored path is still checked
 * against its owner before anything is signed.
 */
export function readScanSheets(options: unknown): ScanSheet[] {
  if (!isRecord(options)) return [];
  if (Array.isArray(options.scans)) return options.scans.slice(0, MAX_SCAN_SHEETS).map(readSheet);
  const legacy = readSheet({ thumb: options.scanThumb, path: options.scanPath });
  return legacy.thumb || legacy.path ? [legacy] : [];
}

/**
 * The list after reading sheet number `sheetNumber` (from 1). The first sheet
 * replaces the list on screen, as a scan always did; a later one adds its
 * pieces at the end. Every read piece is tagged with its sheet.
 */
export function appendSheetPieces(pieces: Piece[], read: Piece[], sheetNumber: number): Piece[] {
  const tagged = read.map((piece) => ({ ...piece, scanIndex: sheetNumber }));
  return sheetNumber <= 1 ? tagged : [...pieces, ...tagged];
}

/**
 * The list after removing sheet number `sheetNumber`: its pieces go, even
 * edited ones; the sheets after it move down one; pieces added by hand stay.
 */
export function removeScanSheet(pieces: Piece[], sheetNumber: number): Piece[] {
  return pieces
    .filter((piece) => piece.scanIndex !== sheetNumber)
    .map((piece) =>
      typeof piece.scanIndex === 'number' && piece.scanIndex > sheetNumber ? { ...piece, scanIndex: piece.scanIndex - 1 } : piece
    );
}

/** Characters each thumbnail of a project of `count` sheets may take. */
export function thumbBudgetFor(count: number): number {
  return Math.floor(SCAN_THUMB_MAX_CHARS / Math.max(1, count));
}

/** The sizes tried, largest first: 600 px is what a single scan always got. */
const THUMB_SIDES = [600, 480, 400, 320, 240] as const;
const THUMB_QUALITY = 0.7;

export type Downscale = (dataUrl: string, maxSide: number, quality: number) => Promise<string | null>;

/**
 * A thumbnail of `source` that fits `budget` characters: the source itself
 * when it already fits, else the largest size that does. Undefined when none
 * fits or the browser cannot downscale.
 */
export async function fitThumb(source: string | null | undefined, budget: number, downscale: Downscale): Promise<string | undefined> {
  if (!source) return undefined;
  if (source.length <= budget) return source;
  for (const side of THUMB_SIDES) {
    // eslint-disable-next-line no-await-in-loop
    const reduced = await downscale(source, side, THUMB_QUALITY);
    if (!reduced) return undefined;
    if (reduced.length <= budget) return reduced;
  }
  return undefined;
}

/**
 * The sheets of a save request worth storing, or undefined for none. At most
 * MAX_SCAN_SHEETS; a thumbnail is kept only while the total stays within
 * SCAN_THUMB_MAX_CHARS, a path only when it is `ownerId`'s own. A sheet whose
 * thumbnail or path is refused keeps its place, so the sheet numbers carried
 * by the pieces stay right.
 */
export function sanitizeScanSheets(value: unknown, ownerId?: string): ScanSheet[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SCAN_SHEETS) return undefined;
  let used = 0;
  return value.map((entry) => {
    const source = isRecord(entry) ? entry : {};
    const sheet: ScanSheet = {};
    const thumb = sanitizeScanThumb(source.thumb);
    if (thumb && used + thumb.length <= SCAN_THUMB_MAX_CHARS) {
      sheet.thumb = thumb;
      used += thumb.length;
    }
    if (ownerId && isOwnScanPath(source.path, ownerId)) sheet.path = source.path;
    return sheet;
  });
}

/**
 * A project's saved data with the kept image of sheet 1 attached: on the list
 * when the project has one, else under the old `scanPath` key.
 */
export function withFirstScanPath(existing: Record<string, unknown>, path: string): Record<string, unknown> {
  if (Array.isArray(existing.scans) && existing.scans.length > 0) {
    const [first, ...rest] = existing.scans;
    return { ...existing, scans: [{ ...(isRecord(first) ? first : {}), path }, ...rest] };
  }
  return { ...existing, scanPath: path };
}
