/**
 * One line of the history, whichever way it is shown (cards or table), and the
 * remembered choice between those two views.
 *
 * `toHistoryRow` is a pure summary of a saved project: an old project that
 * kept nothing but its geometry still makes a row, with null where a figure
 * is unknown so the views print a dash instead of a made-up value.
 *
 * Pure module: no Supabase, no env, no network.
 */

import { MATERIAL_LABEL_KEYS } from '@/i18n/domain';
import { sanitizePdfGeneratedAt, sanitizeProjectName, sanitizeScanThumb } from '@/lib/projects/history-metadata';
import { pickRestorableResult } from '@/lib/projects/restore';

export interface HistoryRow {
  id: string;
  name: string;
  createdAt: string;
  material: string;
  sheetHeight: number;
  sheetWidth: number;
  pieceCount: number;
  sheetsUsed: number | null;
  wastePercentage: number | null;
  scanThumb: string | null;
  hasFullScan: boolean;
  pdfGeneratedAt: string | null;
  hasPlan: boolean;
  isCloud: boolean;
}

export interface HistoryProject {
  id: string;
  name: string;
  material: string;
  sheet_width: number;
  sheet_height: number;
  created_at: string;
  options_json?: unknown;
}

/** A cloud project has a database id; a local one is `optimize_<timestamp>`. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Pieces to cut: the sum of the quantities. A piece with no quantity counts
 * once (the atelier reads `quantity || 1`); a zero, negative or
 * non-numeric quantity counts for nothing.
 */
function countPieces(pieces: unknown): number {
  if (!Array.isArray(pieces)) return 0;
  let total = 0;
  for (const piece of pieces) {
    if (!isRecord(piece)) continue;
    const quantity = piece.quantity === undefined ? 1 : piece.quantity;
    if (typeof quantity === 'number' && Number.isFinite(quantity) && quantity > 0) total += quantity;
  }
  return total;
}

export function toHistoryRow(project: HistoryProject): HistoryRow {
  const options = isRecord(project.options_json) ? project.options_json : {};
  const result = isRecord(options.result) ? options.result : {};

  return {
    id: project.id,
    name: project.name,
    createdAt: project.created_at,
    material: project.material,
    sheetHeight: project.sheet_height,
    sheetWidth: project.sheet_width,
    pieceCount: countPieces(options.pieces),
    sheetsUsed: finiteOrNull(result.sheetsUsed),
    wastePercentage: finiteOrNull(result.wastePercentage),
    scanThumb: sanitizeScanThumb(options.scanThumb) ?? null,
    hasFullScan: typeof options.scanPath === 'string' && options.scanPath.length > 0,
    pdfGeneratedAt: sanitizePdfGeneratedAt(options.pdfGeneratedAt) ?? null,
    hasPlan: pickRestorableResult(options.result) !== null,
    isCloud: UUID_PATTERN.test(project.id),
  };
}

/** The columns a project row keeps outside `options_json`. */
export interface ProjectRowGeometry {
  name: string;
  material: string;
  sheet_width: number;
  sheet_height: number;
  kerf?: number;
  grain_direction?: boolean;
}

function isPositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * What the atelier can reopen for a project that kept no saved data
 * (`options_json` null): its panel and its name, in the shape the atelier's
 * restore reads (`sheet` as a stock panel, `projectName`). A value the row does
 * not hold in a usable form is left to the atelier's defaults.
 */
export function restoreSeedFromRow(project: ProjectRowGeometry): Record<string, unknown> {
  const seed: Record<string, unknown> = {};
  if (isPositive(project.sheet_width) && isPositive(project.sheet_height)) {
    const kerf = typeof project.kerf === 'number' && Number.isFinite(project.kerf) && project.kerf >= 0 ? project.kerf : 0;
    seed.sheet = {
      id: 's0',
      width: project.sheet_width,
      height: project.sheet_height,
      kerf,
      margin: 0,
      grainDirection: project.grain_direction === true,
      material: Object.prototype.hasOwnProperty.call(MATERIAL_LABEL_KEYS, project.material) ? project.material : 'mdf',
      quantity: 1,
    };
  }
  const projectName = sanitizeProjectName(project.name);
  if (projectName) seed.projectName = projectName;
  return seed;
}

export type HistoryView = 'cards' | 'table';

export const HISTORY_VIEW_KEY = 'qatlia_history_view';

const DEFAULT_HISTORY_VIEW: HistoryView = 'cards';

/** The remembered view, or cards when nothing valid is stored or storage is unavailable. */
export function readHistoryView(storage: Pick<Storage, 'getItem'> | null): HistoryView {
  if (!storage) return DEFAULT_HISTORY_VIEW;
  try {
    const stored = storage.getItem(HISTORY_VIEW_KEY);
    return stored === 'table' || stored === 'cards' ? stored : DEFAULT_HISTORY_VIEW;
  } catch {
    return DEFAULT_HISTORY_VIEW;
  }
}

/** Remembers the view; a blocked or full storage is not worth an error. */
export function writeHistoryView(storage: Pick<Storage, 'setItem'> | null, view: HistoryView): void {
  if (!storage) return;
  try {
    storage.setItem(HISTORY_VIEW_KEY, view);
  } catch {
    // The choice just is not remembered.
  }
}
