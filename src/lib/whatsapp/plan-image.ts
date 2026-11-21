/**
 * The picture the bot sends after reading a cut list (owner, 21/11/2026): the
 * first panel of the free preview plan, its pieces as colored boxes, each with
 * its line on the sheet and its size (the owner asked for them the same day,
 * after a first version without), "1 / N" and the brand. It shows that the list
 * was understood; the whole plan (all panels, PDF) stays in the app, after
 * sign-up (plan 2026-11-19-whatsapp-plan-apercu).
 *
 * Pure: the route src/app/(site)/w/[code]/plan.png draws this layout.
 */

import type { OptimizationResult } from '@/lib/cutting/binpacking';

export const PLAN_IMAGE_WIDTH = 1080;
const MARGIN = 60;
/** The band under the panel, for the brand and "1 / N". */
export const PLAN_IMAGE_FOOTER = 130;
/** Keeps a tall panel on one phone screen. */
const MAX_PANEL_HEIGHT = 1300;

/** Soft, distinct fills; copies of one line of the list share one. */
export const PLAN_COLORS: readonly string[] = [
  '#FDBA74',
  '#93C5FD',
  '#86EFAC',
  '#F9A8D4',
  '#C4B5FD',
  '#FDE047',
  '#67E8F9',
  '#FCA5A5',
  '#BEF264',
  '#D6D3D1',
];

export interface PlanImageBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** What a piece shows: its line on the sheet, and its size when there is room. */
export interface PlanImageLabel {
  /** The line of the cut list, from 1, as on the prospect's sheet. */
  line: number;
  /** "207.5 × 78", as written on the sheet; null when only the line fits. */
  size: string | null;
  /** Turned a quarter for a piece taller than wide, so the text runs along it. */
  vertical: boolean;
  fontSize: number;
}

export interface PlanImageLayout {
  width: number;
  height: number;
  panel: PlanImageBox;
  pieces: Array<PlanImageBox & { color: string; label: PlanImageLabel | null }>;
  sheetCount: number;
  /** "1 / N": the picture is one panel of N. */
  badge: string;
}

/**
 * The webhook may run 60 s. Reading a photo can take ~50 s (two media requests
 * of 10 s, 30 s for the reader); past PICTURE_DEADLINE_MS the picture is not
 * tried, so the text answer still has time to go out.
 */
export const PICTURE_DEADLINE_MS = 45_000;
const PICTURE_CHECK_MS = 8_000;
const PICTURE_CHECK_MIN_MS = 2_000;

/** How long the webhook may spend fetching the picture `elapsedMs` into the message; null: send the text. */
export function pictureCheckMs(elapsedMs: number): number | null {
  const left = PICTURE_DEADLINE_MS - elapsedMs;
  if (!(left >= PICTURE_CHECK_MIN_MS)) return null;
  return Math.min(PICTURE_CHECK_MS, left);
}

export function planImageUrl(code: string): string {
  return `https://qatlia.ma/w/${code}/plan.png`;
}

const round = (value: number) => Math.round(value * 10) / 10;

/** A piece's size as the prospect wrote it: height × width, one decimal at most. */
export function pieceSize(height: number, width: number): string {
  return `${round(height)} × ${round(width)}`;
}

const MAX_FONT = 34;
const MIN_FONT = 12;
/** Average glyph width of the bundled sans font, as a share of its size. */
const GLYPH = 0.6;
/** The line's dark pill and the gap after it, in font sizes. */
const PILL = 1.6;

/**
 * The label of one piece drawn `width` × `height` pixels: its line and size in
 * the largest size that fits (MAX_FONT at most), along the long side; the line
 * alone when the size does not fit in MIN_FONT; nothing when even that does not.
 */
export function pieceLabel(line: number, size: string, width: number, height: number): PlanImageLabel | null {
  const vertical = height > width * 1.2;
  const long = vertical ? height : width;
  const thick = vertical ? width : height;
  const lineChars = String(line).length;
  const fit = (chars: number, pill: number) =>
    Math.floor(Math.min(MAX_FONT, thick * 0.6, (long - 12) / (chars * GLYPH + pill)));

  const full = fit(lineChars + size.length, PILL);
  if (full >= MIN_FONT) return { line, size, vertical, fontSize: full };
  const alone = fit(lineChars, 1);
  if (alone >= MIN_FONT) return { line, size: null, vertical, fontSize: alone };
  return null;
}

export function planImageLayout(result: Pick<OptimizationResult, 'sheets' | 'sheetsUsed'>): PlanImageLayout | null {
  const sheet = result.sheets[0];
  if (!sheet || sheet.width <= 0 || sheet.height <= 0) return null;

  const scale = Math.min((PLAN_IMAGE_WIDTH - 2 * MARGIN) / sheet.width, MAX_PANEL_HEIGHT / sheet.height);
  const panelWidth = round(sheet.width * scale);
  const panelHeight = round(sheet.height * scale);
  const panel = { left: round((PLAN_IMAGE_WIDTH - panelWidth) / 2), top: MARGIN, width: panelWidth, height: panelHeight };

  const pieces = sheet.pieces.map((placed) => {
    const width = round(placed.width * scale);
    const height = round(placed.height * scale);
    // originalIndex is the line of the list the bot read (atelierPieces keeps its order).
    const line = (placed.originalIndex ?? placed.pieceNumber - 1) + 1;
    return {
      left: round(panel.left + placed.x * scale),
      top: round(panel.top + placed.y * scale),
      width,
      height,
      color: PLAN_COLORS[(placed.originalIndex ?? placed.pieceNumber) % PLAN_COLORS.length],
      label: pieceLabel(line, pieceSize(placed.originalHeight, placed.originalWidth), width, height),
    };
  });

  const sheetCount = Math.max(result.sheetsUsed, result.sheets.length);
  return {
    width: PLAN_IMAGE_WIDTH,
    height: Math.round(panel.top + panelHeight + PLAN_IMAGE_FOOTER),
    panel,
    pieces,
    sheetCount,
    badge: `1 / ${sheetCount}`,
  };
}
