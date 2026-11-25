/**
 * One saved project as the back office shows it in full (spec 2026-11-25):
 * the cut-list photos, the pieces as they were when the plan was computed,
 * the plan itself and its settings. Used to understand a customer's report.
 *
 * `options_json` is written by the browser (src/lib/projects/persistence-payload.ts),
 * so everything is read defensively. The quotation's content (the artisan's
 * own customers and prices) is never read: only whether there is one.
 *
 * `readProjectDetail` is pure; `getClientProject` reads with the service-role
 * client from ./db and signs the photos of the project's own owner only.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { isUuid } from '@/lib/billing/grant';
import { SCAN_BUCKET, isOwnScanPath } from '@/lib/projects/scan-image';
import { readScanSheets } from '@/lib/projects/scan-sheets';

/** Same lifetime as the artisan's own link (src/app/api/projects/[id]/scan/route.ts). */
export const SCAN_LINK_SECONDS = 300;

/** Bounds on what one page draws: a malformed or huge result must not stall it. */
const MAX_SHEETS = 30;
const MAX_PIECES = 500;
const MAX_PLACED_PER_SHEET = 400;

export interface ProjectDetailRow {
  id: string;
  user_id?: string;
  name: string | null;
  material: string | null;
  sheet_width: number | string | null;
  sheet_height: number | string | null;
  created_at: string;
  options_json: unknown;
}

export interface DetailPiece {
  name: string | null;
  width: number | null;
  height: number | null;
  quantity: number;
  /** The cut-list sheet (from 1) the piece was read from; null when added by hand. */
  scanIndex: number | null;
  /** The banded sides, in French (« haut, gauche »), or null for none. */
  edges: string | null;
  grain: 'vertical' | 'horizontal' | null;
}

export interface DetailPlacedPiece {
  x: number;
  y: number;
  width: number;
  height: number;
  name: string | null;
  rotated: boolean;
}

export interface DetailSheet {
  index: number;
  width: number;
  height: number;
  label: string | null;
  /** 0..1 as the optimizer writes it, or null. */
  wasteRate: number | null;
  pieces: DetailPlacedPiece[];
}

export interface DetailUnplaced {
  name: string | null;
  width: number | null;
  height: number | null;
  reason: string | null;
}

export interface ProjectDetail {
  id: string;
  name: string;
  createdAt: string;
  material: string;
  pdfGeneratedAt: string | null;
  hasQuotation: boolean;
  scans: { thumb: string | null; path: string | null }[];
  pieces: DetailPiece[];
  sheet: { width: number | null; height: number | null; kerf: number | null; margin: number | null; label: string | null } | null;
  options: { kerf: number | null; priority: string | null } | null;
  result: {
    sheetsUsed: number | null;
    wastePercentage: number | null;
    sheets: DetailSheet[];
    unplaced: DetailUnplaced[];
  } | null;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function num(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

const SIDES: [string, string][] = [
  ['top', 'haut'],
  ['bottom', 'bas'],
  ['left', 'gauche'],
  ['right', 'droite'],
];

function edgesOf(value: unknown): string | null {
  const edges = asRecord(value);
  if (!edges) return null;
  const sides = SIDES.filter(([key]) => edges[key] === true).map(([, label]) => label);
  return sides.length > 0 ? sides.join(', ') : null;
}

function grainOf(value: unknown): 'vertical' | 'horizontal' | null {
  return value === 'vertical' || value === 'horizontal' ? value : null;
}

function readPiece(value: unknown): DetailPiece | null {
  const piece = asRecord(value);
  if (!piece) return null;
  const quantity = num(piece.quantity);
  const scanIndex = num(piece.scanIndex);
  return {
    name: text(piece.name),
    width: num(piece.width),
    height: num(piece.height),
    quantity: quantity !== null && quantity >= 1 ? Math.floor(quantity) : 1,
    scanIndex: scanIndex !== null && scanIndex >= 1 ? Math.floor(scanIndex) : null,
    edges: edgesOf(piece.edges),
    grain: grainOf(piece.grain),
  };
}

function readPlaced(value: unknown): DetailPlacedPiece | null {
  const piece = asRecord(value);
  if (!piece) return null;
  const x = num(piece.x);
  const y = num(piece.y);
  const width = num(piece.width);
  const height = num(piece.height);
  if (x === null || y === null || width === null || height === null || width <= 0 || height <= 0) return null;
  return { x, y, width, height, name: text(piece.name), rotated: piece.rotated === true };
}

function readResultSheet(value: unknown, position: number): DetailSheet | null {
  const sheet = asRecord(value);
  if (!sheet) return null;
  const width = num(sheet.width);
  const height = num(sheet.height);
  if (width === null || height === null || width <= 0 || height <= 0) return null;
  return {
    index: num(sheet.index) ?? position,
    width,
    height,
    label: text(sheet.label),
    wasteRate: num(sheet.wasteRate),
    pieces: asArray(sheet.pieces)
      .slice(0, MAX_PLACED_PER_SHEET)
      .map(readPlaced)
      .filter((p): p is DetailPlacedPiece => p !== null),
  };
}

function readUnplaced(value: unknown): DetailUnplaced | null {
  const piece = asRecord(value);
  if (!piece) return null;
  return {
    name: text(piece.name),
    width: num(piece.width),
    height: num(piece.height),
    reason: text(piece.unplacedReason),
  };
}

export function readProjectDetail(row: ProjectDetailRow): ProjectDetail {
  const options = asRecord(row.options_json) ?? {};
  const result = asRecord(options.result);
  const sheet = asRecord(options.sheet);
  const settings = asRecord(options.options);

  return {
    id: row.id,
    name: text(row.name) ?? 'Sans nom',
    createdAt: row.created_at,
    material: text(row.material) ?? '—',
    pdfGeneratedAt: text(options.pdfGeneratedAt),
    hasQuotation: asRecord(options.quotation) !== null,
    scans: readScanSheets(options).map((s) => ({ thumb: s.thumb ?? null, path: s.path ?? null })),
    pieces: asArray(options.pieces)
      .slice(0, MAX_PIECES)
      .map(readPiece)
      .filter((p): p is DetailPiece => p !== null),
    sheet: sheet
      ? { width: num(sheet.width), height: num(sheet.height), kerf: num(sheet.kerf), margin: num(sheet.margin), label: text(sheet.label) }
      : null,
    options: settings ? { kerf: num(settings.kerfWidth), priority: text(settings.optimizationPriority) } : null,
    result: result
      ? {
          sheetsUsed: num(result.sheetsUsed),
          wastePercentage: num(result.wastePercentage),
          sheets: asArray(result.sheets)
            .slice(0, MAX_SHEETS)
            .map(readResultSheet)
            .filter((s): s is DetailSheet => s !== null),
          unplaced: asArray(result.unplacedPieces)
            .slice(0, MAX_PIECES)
            .map(readUnplaced)
            .filter((p): p is DetailUnplaced => p !== null),
        }
      : null,
  };
}

export type ClientProjectResult =
  | { status: 'ok'; project: ProjectDetail; /** One per scan, in order: a short-lived link, or null. */ scanUrls: (string | null)[] }
  | { status: 'not_found' }
  | { status: 'error' };

async function signScan(db: SupabaseClient, path: string | null, ownerId: string): Promise<string | null> {
  // A stored path is browser-written: it is checked against the owner again.
  if (!isOwnScanPath(path, ownerId)) return null;
  try {
    const { data, error } = await db.storage.from(SCAN_BUCKET).createSignedUrl(path, SCAN_LINK_SECONDS);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

/**
 * A project of one client, read by its id AND the client's id: a project of
 * someone else under this client's URL is not found.
 */
export async function getClientProject(db: SupabaseClient, userId: string, projectId: string): Promise<ClientProjectResult> {
  if (!isUuid(userId) || !isUuid(projectId)) return { status: 'not_found' };

  const { data, error } = await db
    .from('projects')
    .select('id, user_id, name, material, sheet_width, sheet_height, created_at, options_json')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.error('admin project read failed:', error.message);
    return { status: 'error' };
  }
  const row = asRecord(data);
  if (!row) return { status: 'not_found' };

  const project = readProjectDetail(row as unknown as ProjectDetailRow);
  const scanUrls = await Promise.all(project.scans.map((scan) => signScan(db, scan.path, userId)));
  return { status: 'ok', project, scanUrls };
}
