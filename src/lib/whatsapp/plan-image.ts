/**
 * The picture the bot sends after reading a cut list (owner, 21/11/2026): the
 * first panel of the free preview plan, drawn as the atelier draws it (the
 * owner asked for "the same display as in the application" the same day):
 * each piece in the atelier's colors with its number (#N) and its size
 * (« 228.0×9.0 cm »), the offcuts hatched with their size, "1 / N" and the
 * brand. The whole plan (all panels, PDF) stays in the app, after sign-up
 * (plan 2026-11-19-whatsapp-plan-apercu).
 *
 * The sizes and font rules are the atelier's own (the plan SVG in
 * src/app/(site)/atelier/page.tsx), in centimetres, scaled to the picture.
 *
 * Pure: the route src/app/(site)/w/[code]/plan.png draws this layout.
 */

import type { OptimizationResult } from '@/lib/cutting/binpacking';
import { PIECE_COLOR_PALETTE } from '@/lib/pieces/catalog';

export const PLAN_IMAGE_WIDTH = 1080;
const MARGIN = 60;
/** The band under the panel, for the brand and "1 / N". */
export const PLAN_IMAGE_FOOTER = 130;
/** Keeps a tall panel on one phone screen. */
const MAX_PANEL_HEIGHT = 1300;

export interface PlanImageBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PlanImagePiece extends PlanImageBox {
  color: string;
  /** "#12", the piece number the atelier shows. */
  number: string;
  numberFont: number;
  /** « 228.0×9.0 cm » as placed; null on a piece under 10 cm on its short side, as in the atelier. */
  size: string | null;
  sizeFont: number;
}

export interface PlanImageOffcut extends PlanImageBox {
  /** « 41.0 × 208.0 cm »; null under 14 × 10 cm, as in the atelier. */
  size: string | null;
  font: number;
}

export interface PlanImageLayout {
  width: number;
  height: number;
  panel: PlanImageBox;
  /** Pixels per centimetre: the atelier's strokes are in centimetres too. */
  scale: number;
  pieces: PlanImagePiece[];
  offcuts: PlanImageOffcut[];
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
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
/** The atelier's formatDisplayValue in centimetres: one decimal, always. */
const cm = (value: number) => value.toFixed(1);

/** The atelier's piece color: its own, or the palette by piece number. */
export function pieceColor(placed: { color?: string; pieceNumber: number }): string {
  return placed.color || PIECE_COLOR_PALETTE[(placed.pieceNumber - 1) % PIECE_COLOR_PALETTE.length];
}

export function planImageLayout(result: Pick<OptimizationResult, 'sheets' | 'sheetsUsed'>): PlanImageLayout | null {
  const sheet = result.sheets[0];
  if (!sheet || sheet.width <= 0 || sheet.height <= 0) return null;

  const scale = Math.min((PLAN_IMAGE_WIDTH - 2 * MARGIN) / sheet.width, MAX_PANEL_HEIGHT / sheet.height);
  const panelWidth = round(sheet.width * scale);
  const panelHeight = round(sheet.height * scale);
  const panel = { left: round((PLAN_IMAGE_WIDTH - panelWidth) / 2), top: MARGIN, width: panelWidth, height: panelHeight };
  const box = (item: { x: number; y: number; width: number; height: number }): PlanImageBox => ({
    left: round(panel.left + item.x * scale),
    top: round(panel.top + item.y * scale),
    width: round(item.width * scale),
    height: round(item.height * scale),
  });

  // Same rules as the atelier's plan, in cm then scaled: "#N" in
  // min(5.5, max(2.5, side/12)), the size in min(4.5, max(2, side/14)) from 10 cm.
  const pieces = sheet.pieces.map((placed): PlanImagePiece => {
    const minSide = Math.min(placed.width, placed.height);
    return {
      ...box(placed),
      color: pieceColor(placed),
      number: `#${placed.pieceNumber}`,
      numberFont: round(clamp(minSide / 12, 2.5, 5.5) * scale),
      size: minSide >= 10 ? `${cm(placed.height)}×${cm(placed.width)} cm` : null,
      sizeFont: round(clamp(minSide / 14, 2, 4.5) * scale),
    };
  });

  const offcuts = (sheet.offcuts ?? []).map((offcut): PlanImageOffcut => ({
    ...box(offcut),
    size: offcut.width >= 14 && offcut.height >= 10 ? `${cm(offcut.height)} × ${cm(offcut.width)} cm` : null,
    font: round(clamp(Math.min(offcut.width, offcut.height) / 12, 2.2, 4.5) * scale),
  }));

  const sheetCount = Math.max(result.sheetsUsed, result.sheets.length);
  return {
    width: PLAN_IMAGE_WIDTH,
    height: Math.round(panel.top + panelHeight + PLAN_IMAGE_FOOTER),
    panel,
    scale: round(scale),
    pieces,
    offcuts,
    sheetCount,
    badge: `1 / ${sheetCount}`,
  };
}
