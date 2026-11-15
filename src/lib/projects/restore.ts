/**
 * Checks a plan saved in a project before the atelier puts it back on screen.
 *
 * A project keeps its full `OptimizationResult` in `options_json.result`, but
 * an old save may hold only a summary (sheet count, waste rate), and a stored
 * value can be damaged. Drawing either would crash the plan, so only a result
 * with everything the plan needs is accepted; anything else is `null` and the
 * caller falls back to running the optimizer again.
 *
 * Pure module: no Supabase, no env, no network.
 */

import type { OptimizationResult } from '@/lib/cutting/binpacking';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPlacedPieceOnASheet(value: unknown, sheetsUsed: number): boolean {
  if (!isRecord(value)) return false;
  const { x, y, width, height, sheetIndex } = value;
  return (
    isFiniteNumber(x) &&
    isFiniteNumber(y) &&
    isFiniteNumber(width) &&
    isFiniteNumber(height) &&
    Number.isInteger(sheetIndex) &&
    (sheetIndex as number) >= 0 &&
    (sheetIndex as number) < sheetsUsed
  );
}

/**
 * The saved result, ready to draw, or `null` when it is not a usable plan.
 * Missing `offcuts` and `unplacedPieces` read as none; every other field is
 * returned as saved, `costBreakdown` and `costingInput` included.
 */
export function pickRestorableResult(value: unknown): OptimizationResult | null {
  if (!isRecord(value)) return null;

  const { sheetsUsed, sheets, placedPieces, wastePercentage } = value;
  if (!Number.isInteger(sheetsUsed) || (sheetsUsed as number) < 1) return null;
  if (!Array.isArray(sheets) || sheets.length < (sheetsUsed as number)) return null;
  if (!sheets.every(isRecord)) return null;
  if (!Array.isArray(placedPieces)) return null;
  if (!placedPieces.every((piece) => isPlacedPieceOnASheet(piece, sheetsUsed as number))) return null;
  if (!isFiniteNumber(wastePercentage)) return null;

  return {
    ...value,
    offcuts: Array.isArray(value.offcuts) ? value.offcuts : [],
    unplacedPieces: Array.isArray(value.unplacedPieces) ? value.unplacedPieces : [],
  } as unknown as OptimizationResult;
}

/**
 * The save date the history leaves next to a reopened project
 * (`qatlia_restored_project_meta`), or `null` when it is missing, unreadable
 * or not a date. The notice above the plan only shows with a real date.
 */
export function readRestoredProjectDate(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const meta: unknown = JSON.parse(raw);
    if (!isRecord(meta) || typeof meta.createdAt !== 'string') return null;
    return Number.isNaN(new Date(meta.createdAt).getTime()) ? null : meta.createdAt;
  } catch {
    return null;
  }
}
