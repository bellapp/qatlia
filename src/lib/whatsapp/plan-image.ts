/**
 * The picture the bot sends after reading a cut list (owner, 21/11/2026): the
 * first panel of the free preview plan, its pieces as colored boxes, with no
 * measure on it, "1 / N" and the brand. It shows that the list was understood
 * and makes the link worth opening; the plan itself (all panels, measures,
 * PDF) stays in the app, after sign-up (plan 2026-11-19-whatsapp-plan-apercu).
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

export interface PlanImageLayout {
  width: number;
  height: number;
  panel: PlanImageBox;
  pieces: Array<PlanImageBox & { color: string }>;
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

export function planImageLayout(result: Pick<OptimizationResult, 'sheets' | 'sheetsUsed'>): PlanImageLayout | null {
  const sheet = result.sheets[0];
  if (!sheet || sheet.width <= 0 || sheet.height <= 0) return null;

  const scale = Math.min((PLAN_IMAGE_WIDTH - 2 * MARGIN) / sheet.width, MAX_PANEL_HEIGHT / sheet.height);
  const panelWidth = round(sheet.width * scale);
  const panelHeight = round(sheet.height * scale);
  const panel = { left: round((PLAN_IMAGE_WIDTH - panelWidth) / 2), top: MARGIN, width: panelWidth, height: panelHeight };

  const pieces = sheet.pieces.map((placed) => ({
    left: round(panel.left + placed.x * scale),
    top: round(panel.top + placed.y * scale),
    width: round(placed.width * scale),
    height: round(placed.height * scale),
    color: PLAN_COLORS[(placed.originalIndex ?? placed.pieceNumber) % PLAN_COLORS.length],
  }));

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
