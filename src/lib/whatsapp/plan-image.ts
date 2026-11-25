/**
 * The picture the bot sends after reading a cut list (owner, 21/11/2026): a
 * "screenshot" of the atelier's result screen for the free preview plan (the
 * owner, on a screenshot of the atelier: « garde ce format d'envoi sous forme
 * de capture d'écran du résultat »). Top to bottom, as in
 * src/app/(site)/atelier/page.tsx:
 *  - the cost banner: « COÛT TOTAL ESTIMÉ », the amount, the metres of cut and the panels;
 *  - the panel tabs (src/components/SheetTabs.tsx): « Panneau N » and its yield, the first active;
 *  - the plan of panel 1, drawn as the atelier draws it: each piece in its
 *    line's color with « #N » and « H×W cm », the offcuts hatched with their size;
 *  - the export buttons (CSV, JSON, PNG, DXF, the PDF report, the client quote).
 * The whole plan (all panels, the exports) stays in the app, after sign-up
 * (plan 2026-11-19-whatsapp-plan-apercu). French, as on the owner's screenshot:
 * the bundled font draws Latin text only.
 *
 * The plan's sizes and font rules are the atelier's own, in centimetres,
 * scaled to the picture.
 *
 * Pure: the route src/app/(site)/w/[code]/plan.png draws this layout.
 */

import type { OptimizationResult } from '@/lib/cutting/binpacking';
import { PIECE_COLOR_PALETTE } from '@/lib/pieces/catalog';
import { EDGE_DASH_CM, EDGE_HALO_CM, EDGE_STROKE_CM, edgeLines, type EdgeLine } from '@/lib/cutting/edge-lines';

export const PLAN_IMAGE_WIDTH = 1080;
/** The page's side margin. */
const PAD = 40;
/** Between the banner, the plan card and the exports. */
const GAP = 28;
const BANNER_HEIGHT = 250;
/** The tabs row on top of the plan card. */
export const PLAN_IMAGE_TABS_HEIGHT = 112;
const TABS_HEIGHT = PLAN_IMAGE_TABS_HEIGHT;
const TAB_HEIGHT = 72;
const TAB_WIDTH = 188;
const TAB_GAP = 12;
/** The "‹" and "›" at the ends of the tabs row. */
const ARROW_WIDTH = 40;
/** Around the panel, inside the plan card. */
const PLAN_PAD = 30;
/** Keeps a tall panel on one phone screen. */
const MAX_PANEL_HEIGHT = 1150;
/** The line under the panel saying what the blue dashes are. */
const EDGE_LEGEND = 52;
const EXPORT_ROW = 84;
const EXPORT_PDF = 96;
const EXPORT_GAP = 14;
/** The brand under the exports. */
const FOOTER = 90;

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

/** The atelier's cost banner (atelier.cost.* in src/i18n/messages/fr.ts). */
export interface PlanImageBanner {
  label: string;
  /** « 32 612,83 », or « — » when the plan has no price, as in the atelier. */
  amount: string;
  currency: string;
  /** « 641,9 m linéaires de coupe · 47 panneaux ». */
  meta: string;
}

/** One chip of the panel tabs. */
export interface PlanImageTab extends PlanImageBox {
  label: string;
  /** The panel's yield, 0-100, as SheetTabs shows it. */
  yield: number;
  active: boolean;
}

export interface PlanImageExports {
  files: string[];
  pdf: string;
  quote: string;
}

/** The chants of panel 1, in pixels from the panel's corner, and their strokes. */
export interface PlanImageEdges {
  lines: EdgeLine[];
  stroke: number;
  halo: number;
  dash: [number, number];
}

export interface PlanImageLayout {
  width: number;
  height: number;
  banner: PlanImageBanner;
  bannerBox: PlanImageBox;
  /** The plan card: the tabs row, then the panel. */
  card: PlanImageBox;
  tabsTop: number;
  tabs: PlanImageTab[];
  /** More panels than the row holds: the row ends on "›", as it scrolls in the atelier. */
  moreTabs: boolean;
  panel: PlanImageBox;
  /** Pixels per centimetre: the atelier's strokes are in centimetres too. */
  scale: number;
  pieces: PlanImagePiece[];
  offcuts: PlanImageOffcut[];
  /** null when no piece of the panel is banded; so is the legend. */
  edges: PlanImageEdges | null;
  edgeLegend: (PlanImageBox & { label: string }) | null;
  sheetCount: number;
  exportsTop: number;
  exports: PlanImageExports;
}

/**
 * The webhook may run 60 s. Reading a photo can take ~50 s (two media requests
 * of 10 s, 30 s for the reader); past PICTURE_DEADLINE_MS the picture is not
 * tried, so the text answer still has time to go out.
 */
export const PICTURE_DEADLINE_MS = 45_000;
/** A big list takes 7 to 10 s to draw once; the stored file then goes at once (22/11/2026). */
const PICTURE_CHECK_MS = 15_000;
const PICTURE_CHECK_MIN_MS = 2_000;

/** How long the webhook may spend fetching the picture `elapsedMs` into the message; null: send the text. */
export function pictureCheckMs(elapsedMs: number): number | null {
  const left = PICTURE_DEADLINE_MS - elapsedMs;
  if (!(left >= PICTURE_CHECK_MIN_MS)) return null;
  return Math.min(PICTURE_CHECK_MS, left);
}

/**
 * The plan picture's cache: drawing it takes ~7 s and WhatsApp gave up on it
 * ("(#131053) Media upload error", 21/11/2026). Vercel's CDN keeps it an hour:
 * the webhook's check draws it once, WhatsApp then downloads it at once. A
 * code's pieces never change, and its link page still expires after 24 h.
 */
export const PICTURE_CACHE = 'public, max-age=0, s-maxage=3600';

/** The code in a planImageUrl link, or null for another link. */
export function planCodeFromImageUrl(link: string): string | null {
  return /^https:\/\/qatlia\.ma\/w\/([a-z0-9]+)\/plan\.jpg$/.exec(link)?.[1] ?? null;
}

export function planImageUrl(code: string): string {
  // The JPEG: WhatsApp never delivered the PNG (21/11/2026).
  return `https://qatlia.ma/w/${code}/plan.jpg`;
}

const round = (value: number) => Math.round(value * 10) / 10;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
/** The atelier's formatDisplayValue in centimetres: one decimal, always. */
const cm = (value: number) => value.toFixed(1);

/** The atelier's piece color: its own, or the palette by piece number. */
export function pieceColor(placed: { color?: string; pieceNumber: number }): string {
  return placed.color || PIECE_COLOR_PALETTE[(placed.pieceNumber - 1) % PIECE_COLOR_PALETTE.length];
}

/** A French figure as the atelier prints it: « 32 612,83 », « 641,9 ». */
function frenchNumber(value: number, decimals: number, keepZeros: boolean): string {
  const fixed = value.toFixed(decimals);
  const [whole, fraction = ''] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const shown = keepZeros ? fraction : fraction.replace(/0+$/, '');
  return shown ? `${grouped},${shown}` : grouped;
}

/** Yield of one panel, as SheetTabs (sheetYield) rounds it: 100 minus the waste. */
function sheetYield(wasteRate: number | undefined): number {
  const waste = Number.isFinite(wasteRate) ? Number(wasteRate) : 0;
  return Math.max(0, Math.min(100, Math.round(100 - waste)));
}

type PlanImageSource = Pick<OptimizationResult, 'sheets' | 'sheetsUsed'> &
  Partial<Pick<OptimizationResult, 'costBreakdown' | 'totalLinearCutMeters'>>;

export function planImageLayout(result: PlanImageSource): PlanImageLayout | null {
  const sheet = result.sheets[0];
  if (!sheet || sheet.width <= 0 || sheet.height <= 0) return null;
  const sheetCount = Math.max(result.sheetsUsed, result.sheets.length);

  const bannerBox = { left: PAD, top: PAD, width: PLAN_IMAGE_WIDTH - 2 * PAD, height: BANNER_HEIGHT };
  const cost = result.costBreakdown;
  const banner: PlanImageBanner = {
    label: 'COÛT TOTAL ESTIMÉ',
    amount: cost ? frenchNumber(cost.subtotal, 2, true) : '—',
    currency: cost?.currency || 'MAD',
    meta: `${frenchNumber(result.totalLinearCutMeters || 0, 1, false)} m linéaires de coupe · ${sheetCount} ${sheetCount === 1 ? 'panneau' : 'panneaux'}`,
  };

  // The tabs: as many whole chips as the row holds between its arrows.
  const tabsTop = bannerBox.top + BANNER_HEIGHT + GAP;
  const rowLeft = PAD + 16 + ARROW_WIDTH + 8;
  const rowWidth = PLAN_IMAGE_WIDTH - 2 * rowLeft;
  const fits = Math.max(1, Math.floor((rowWidth + TAB_GAP) / (TAB_WIDTH + TAB_GAP)));
  const shown = Math.min(sheetCount, fits);
  // A full row stretches its chips to the arrow; a short one keeps their width.
  const tabWidth = sheetCount > shown ? round((rowWidth - TAB_GAP * (shown - 1)) / shown) - 0.1 : TAB_WIDTH;
  const tabs: PlanImageTab[] = Array.from({ length: shown }, (_, i) => ({
    left: round(rowLeft + i * (tabWidth + TAB_GAP)),
    top: tabsTop + (TABS_HEIGHT - TAB_HEIGHT) / 2,
    width: tabWidth,
    height: TAB_HEIGHT,
    label: `Panneau ${i + 1}`,
    yield: sheetYield(result.sheets[i]?.wasteRate),
    active: i === 0,
  }));

  const scale = Math.min((PLAN_IMAGE_WIDTH - 2 * PAD - 2 * PLAN_PAD) / sheet.width, MAX_PANEL_HEIGHT / sheet.height);
  const panelWidth = round(sheet.width * scale);
  const panelHeight = round(sheet.height * scale);
  const panel = {
    left: round((PLAN_IMAGE_WIDTH - panelWidth) / 2),
    top: tabsTop + TABS_HEIGHT + PLAN_PAD,
    width: panelWidth,
    height: panelHeight,
  };
  // As the atelier draws them, scaled (src/lib/cutting/edge-lines.ts).
  const chants = sheet.pieces.flatMap((placed) => edgeLines(placed));
  const edges: PlanImageEdges | null = chants.length === 0 ? null : {
    lines: chants.map((l) => ({ x1: round(l.x1 * scale), y1: round(l.y1 * scale), x2: round(l.x2 * scale), y2: round(l.y2 * scale) })),
    stroke: round(EDGE_STROKE_CM * scale),
    halo: round(EDGE_HALO_CM * scale),
    dash: [round(EDGE_DASH_CM[0] * scale), round(EDGE_DASH_CM[1] * scale)],
  };
  const legendHeight = edges ? EDGE_LEGEND : 0;
  const edgeLegend = edges
    ? { left: PAD + PLAN_PAD, top: round(panel.top + panelHeight + PLAN_PAD / 2), width: PLAN_IMAGE_WIDTH - 2 * PAD - 2 * PLAN_PAD, height: EDGE_LEGEND, label: 'Chant' }
    : null;

  const card = { left: PAD, top: tabsTop, width: PLAN_IMAGE_WIDTH - 2 * PAD, height: TABS_HEIGHT + 2 * PLAN_PAD + panelHeight + legendHeight };
  const exportsTop = round(card.top + card.height + GAP);
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

  return {
    width: PLAN_IMAGE_WIDTH,
    height: Math.round(exportsTop + EXPORT_ROW + EXPORT_GAP + EXPORT_PDF + EXPORT_GAP + EXPORT_ROW + FOOTER),
    banner,
    bannerBox,
    card,
    tabsTop,
    tabs,
    moreTabs: sheetCount > shown,
    panel,
    scale: round(scale),
    pieces,
    offcuts,
    edges,
    edgeLegend,
    sheetCount,
    exportsTop,
    exports: { files: ['CSV', 'JSON', 'PNG', 'DXF'], pdf: 'Exporter le rapport PDF', quote: 'Devis client' },
  };
}

/** The export buttons' rows, from `exportsTop`: the files, the PDF report, the client quote. */
export const PLAN_IMAGE_EXPORT_ROWS = { files: EXPORT_ROW, pdf: EXPORT_PDF, quote: EXPORT_ROW, gap: EXPORT_GAP } as const;
