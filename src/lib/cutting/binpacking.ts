import {
  computeCostBreakdown,
  resolveEdgeRatePerMeter,
  type CostBreakdown,
  type CostBreakdownInput,
  type LaborPricing,
  type StockPricing,
  type SheetCostLine,
  type EdgeSegmentCostLine,
} from '@/lib/costing';

// Single source of truth for supported material types, shared by the API
// schema (enum validation) and the material library below, so neither can
// silently drift from the other.
export const MATERIAL_TYPE_VALUES = ['mdf', 'aluminium', 'verre', 'contreplaques', 'melamine', 'chene', 'stratifié', 'medium'] as const;
export type MaterialType = (typeof MATERIAL_TYPE_VALUES)[number];
export type CutMode = '2d' | '1d';

export interface MaterialDef {
  type: MaterialType; label: string; color: string;
  bgClass: string; borderClass: string; pricePerM2: number;
}

export const MATERIAL_LIBRARY: MaterialDef[] = [
  { type: 'mdf', label: 'MDF / Bois', color: 'text-emerald-400', bgClass: 'bg-emerald-500/10', borderClass: 'border-emerald-500/20', pricePerM2: 120 },
  { type: 'melamine', label: 'Mélaminé Blanc', color: 'text-slate-300', bgClass: 'bg-slate-400/10', borderClass: 'border-slate-500/20', pricePerM2: 150 },
  { type: 'chene', label: 'Chêne Massif', color: 'text-amber-600', bgClass: 'bg-amber-600/10', borderClass: 'border-amber-600/20', pricePerM2: 350 },
  { type: 'contreplaques', label: 'Contreplaqué', color: 'text-yellow-500', bgClass: 'bg-yellow-500/10', borderClass: 'border-yellow-500/20', pricePerM2: 180 },
  { type: 'stratifié', label: 'Stratifié', color: 'text-cyan-400', bgClass: 'bg-cyan-500/10', borderClass: 'border-cyan-500/20', pricePerM2: 200 },
  { type: 'medium', label: 'Médium (MDF Sup.)', color: 'text-purple-400', bgClass: 'bg-purple-500/10', borderClass: 'border-purple-500/20', pricePerM2: 160 },
  { type: 'aluminium', label: 'Aluminium', color: 'text-slate-400', bgClass: 'bg-slate-500/10', borderClass: 'border-slate-500/20', pricePerM2: 400 },
  { type: 'verre', label: 'Verre', color: 'text-sky-400', bgClass: 'bg-sky-500/10', borderClass: 'border-sky-500/20', pricePerM2: 500 },
];
export function getMaterialDef(t?: MaterialType | string | null): MaterialDef { return MATERIAL_LIBRARY.find(m => m.type === t) || MATERIAL_LIBRARY[0]; }

export interface EdgeBandingConfig { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean; color?: string; pricePerM?: number; }
export interface EdgeBandingPreset { id: string; label: string; color: string; pricePerM: number; }
export const EDGEBANDING_PRESETS: EdgeBandingPreset[] = [
  { id: 'none', label: 'Aucun', color: '', pricePerM: 0 },
  { id: 'white', label: 'Blanc', color: '#FFFFFF', pricePerM: 8 },
  { id: 'beech', label: 'Hêtre', color: '#D4A574', pricePerM: 10 },
  { id: 'oak', label: 'Chêne', color: '#B8860B', pricePerM: 12 },
  { id: 'grey', label: 'Gris', color: '#A0A0A0', pricePerM: 9 },
  { id: 'black', label: 'Noir', color: '#333333', pricePerM: 8 },
  { id: 'walnut', label: 'Noyer', color: '#5C4033', pricePerM: 14 },
];

export interface Piece {
  id?: string; name?: string; height: number; width: number; quantity: number;
  material?: MaterialType | null; grainDirection?: boolean; edges?: EdgeBandingConfig;
  preCut?: { height?: number; width?: number }; rotatable?: boolean; color?: string;
}
export interface Sheet {
  id?: string; height: number; width: number; kerf: number; margin?: number;
  grainDirection?: boolean; material?: MaterialType; quantity?: number; label?: string;
}
// Single source of truth for supported optimization goals, shared by the API
// schema (enum validation) and the options UI (rendered choices), so neither
// can silently drift from what the optimizer actually implements.
export const OPTIMIZATION_PRIORITY_VALUES = ['linear_guillotine', 'min_waste', 'min_sheets', 'balanced'] as const;
export type OptimizationPriority = (typeof OPTIMIZATION_PRIORITY_VALUES)[number];

export interface OptimizationOptions {
  kerfWidth: number; showLabels: boolean; singleSheetOnly: boolean;
  considerMaterial: boolean; edgeBanding: boolean; grainDirection: boolean;
  optimizationPriority: OptimizationPriority;
  defaultMaterial?: MaterialType;
  /** Minimum offcut width in cm below which a remnant is not classified as reusable. */
  minReusableOffcutWidth?: number;
  /** Minimum offcut height in cm below which a remnant is not classified as reusable. */
  minReusableOffcutHeight?: number;
  /**
   * Cut/labor pricing fed into the shared cost calculator (see
   * `src/lib/costing.ts`). Defaults to a $0 fixed charge so a caller that
   * never configures labor pricing sees no fabricated cost, rather than an
   * invented per-meter estimate.
   */
  laborPricing?: LaborPricing;
  /**
   * Per-material stock price override fed into the shared cost calculator.
   * A material absent from this map keeps using the material library's
   * `pricePerM2` (today's default behavior) — this is strictly an opt-in
   * override, never a required input, so existing callers see no change.
   */
  stockPricingOverrides?: Partial<Record<MaterialType, StockPricing>>;
}
const DEFAULT_LABOR_PRICING: LaborPricing = { mode: 'fixed', value: 0 };
export const OPTIONS_DEFAULTS: OptimizationOptions = {
  kerfWidth: 3, showLabels: true, singleSheetOnly: false, considerMaterial: false,
  edgeBanding: false, grainDirection: false, optimizationPriority: 'linear_guillotine', defaultMaterial: 'mdf',
  minReusableOffcutWidth: 15, minReusableOffcutHeight: 15, laborPricing: DEFAULT_LABOR_PRICING,
};

export interface PlacedPiece {
  pieceId?: string; pieceNumber: number;
  /**
   * The internal *display* name used for on-plan labels (SVG, cut list):
   * the artisan's own name when given, a numbered fallback ("Pièce N"/
   * "Barre N") when not, and — for a 2D piece requested with quantity > 1 —
   * a "× qty" suffix appended to every one of that piece's placed copies.
   * Never the right field for a commercial document: use `baseName`/
   * `isUnnamed` instead (see `deriveQuotationPieces` in
   * src/lib/quotation-items.ts), which keep the artisan's clean, unsuffixed
   * name (or its absence) separate from this display-only string.
   */
  name?: string;
  /**
   * The artisan's own typed name, trimmed — never a fallback and never the
   * "× qty" suffix `name` above may carry. Absent when the piece was left
   * unnamed (see `isUnnamed`).
   *
   * Optional at the type level (rather than required alongside `isUnnamed`)
   * because a `PlacedPiece[]` restored from a project saved before this
   * field existed (a "legacy result") carries neither this nor `isUnnamed`
   * at all — `deriveQuotationPieces` falls back to stripping the known "×
   * qty" suffix from `name` itself in that case.
   */
  baseName?: string;
  /**
   * True when the artisan left this piece's name blank. Absent (never
   * `false`) only for a legacy result predating this field — see `baseName`.
   */
  isUnnamed?: boolean;
  originalHeight: number; originalWidth: number; height: number; width: number;
  x: number; y: number; rotated: boolean; sheetIndex: number; material?: MaterialType | null; color?: string;
  /** Which original request-level `pieces[]` entry this placed unit expands from (see `ExpandedPiece.originalIndex`). */
  originalIndex?: number;
  /** Copied verbatim from the source piece — see `computeCostBreakdown`'s edge cost, which sums this per *placed* unit rather than per requested quantity. */
  edges?: EdgeBandingConfig;
}
export interface Offcut { id: string; x: number; y: number; width: number; height: number; sheetIndex: number; areaM2: number; isReusable: boolean; }
/**
 * One straight guillotine saw pass, produced exactly when `splitFreeRect`
 * divides a free rectangle to free up a placed piece. `lengthCm` is the
 * literal span of that cut (never a perimeter or area-derived estimate) —
 * see `splitFreeRect` for where each instruction comes from.
 */
export interface CutInstruction { id: string; sheetIndex: number; axis: 'horizontal' | 'vertical'; lengthCm: number; }
export interface SheetResult { index: number; material: MaterialType; width: number; height: number; pieces: PlacedPiece[]; offcuts: Offcut[]; cuts: CutInstruction[]; usedArea: number; wasteRate: number; }
export interface MaterialStats { material: MaterialType; sheetsUsed: number; totalPieces: number; usedArea: number; wasteRate: number; }

// Customer-safe summary of how a plan was chosen: what goal was pursued, which
// optional constraints were active, and how many candidate layouts were
// evaluated. Deliberately excludes strategy names/ids or any other
// implementation detail of the packing algorithm.
export interface OptimizationExplanation {
  chosenGoal: OptimizationPriority;
  activeConstraints: string[];
  candidatesEvaluated: number;
}

export interface OptimizationResult {
  success?: boolean; cutMode?: CutMode;
  sheetsUsed: number; sheets: SheetResult[];
  placedPieces: PlacedPiece[]; offcuts: Offcut[]; unplacedPieces: ExpandedPiece[];
  totalAreaAvailable: number; totalAreaUsed: number; wastePercentage: number;
  totalLinearCutMeters: number;
  /** Computed once by the shared calculator (src/lib/costing.ts). Absent when no pricing input is available (e.g. 1D mode today). */
  costBreakdown?: CostBreakdown;
  /**
   * The exact `CostBreakdownInput` passed to `computeCostBreakdown` to
   * produce `costBreakdown` above. Callers that render cost figures from an
   * untrusted copy of this result (e.g. the PDF export route, which receives
   * it back over the network) must recompute `costBreakdown` from this field
   * themselves rather than trust the `costBreakdown` a client sent — see
   * src/app/api/export-pdf/route.ts. Absent exactly when `costBreakdown` is.
   */
  costingInput?: CostBreakdownInput;
  materialStats?: MaterialStats[];
  explanation?: OptimizationExplanation;
}

/** Reason code for a piece left unplaced for a structural (non-geometric) reason. */
export type UnplacedReasonCode = 'no_matching_stock' | 'single_sheet_material_limit';

// Fixed, translated-safe sentences for each `UnplacedReasonCode`. These are
// deliberately static strings — never built by interpolating the piece's raw
// `material` (or any other user-controlled value) — so a malicious or very
// long material string can never be reflected back in API output. The
// material itself remains available, untouched, as the separate typed
// `material` field on `ExpandedPiece`.
const UNPLACED_REASON_TEXT: Record<UnplacedReasonCode, string> = {
  no_matching_stock: 'Aucun panneau en stock ne correspond au matériau de cette pièce.',
  single_sheet_material_limit: 'Cette pièce n\'a pas pu être incluse car une seule plaque est utilisée pour l\'ensemble de la commande, réservée à un autre matériau.',
};

export interface ExpandedPiece extends Required<Pick<Piece, 'height' | 'width' | 'quantity' | 'material'>> {
  originalIndex: number; id?: string; name?: string;
  /** See `PlacedPiece.baseName` — the artisan's own trimmed name, never a fallback/suffix. Undefined when `isUnnamed`. */
  baseName?: string;
  /** See `PlacedPiece.isUnnamed` — always a definite boolean here (never absent), since this is only ever produced fresh, never restored from a legacy record. */
  isUnnamed: boolean;
  originalHeight: number; originalWidth: number;
  rotatable: boolean; edges?: EdgeBandingConfig; color?: string;
  /** Set when a piece was never attempted for packing (e.g. no compatible stock). */
  unplacedReasonCode?: UnplacedReasonCode;
  /** Customer-safe, human-readable explanation of `unplacedReasonCode`. */
  unplacedReason?: string;
}

function expandPieces(pieces: Piece[], defaultMaterial: MaterialType, globalGrain: boolean): ExpandedPiece[] {
  const result: ExpandedPiece[] = [];
  pieces.forEach((p, i) => {
    const qty = Math.max(1, p.quantity || 1);
    const baseName = p.name && p.name.trim() ? p.name.trim() : undefined;
    const isUnnamed = baseName === undefined;
    for (let j = 0; j < qty; j++) {
      result.push({
        originalIndex: i, id: p.id ? `${p.id}_${j}` : `p${i}_${j}`,
        // Internal *display* name only (see PlacedPiece.name's doc comment)
        // — the artisan's own clean name lives in `baseName` below.
        name: qty > 1 ? `${baseName ?? `Pièce ${i + 1}`} ×${qty}` : baseName ?? `Pièce ${i + 1}`,
        baseName,
        isUnnamed,
        height: p.height, width: p.width, quantity: 1,
        material: (p.material || defaultMaterial) as MaterialType,
        originalHeight: p.height, originalWidth: p.width,
        rotatable: p.rotatable !== false && !(p.grainDirection || globalGrain),
        edges: p.edges,
        color: p.color,
      });
    }
  });
  return result;
}

// ─── 1D Linear Bar Optimization ───────────────────────────────────
export interface BarResult {
  barIndex: number; length: number;
  pieces: { name: string; baseName?: string; isUnnamed: boolean; length: number; x: number; color?: string }[];
  usedLength: number; wasteRate: number;
}

function optimize1D(pieces: Piece[], stockLength: number, kerf: number): BarResult[] {
  const items: { name: string; baseName?: string; isUnnamed: boolean; length: number; color?: string }[] = [];
  pieces.forEach(p => {
    const baseName = p.name && p.name.trim() ? p.name.trim() : undefined;
    const isUnnamed = baseName === undefined;
    for (let j = 0; j < Math.max(1, p.quantity || 1); j++) {
      // Internal *display* name only (see PlacedPiece.name's doc comment) —
      // the artisan's own clean name lives in `baseName` below.
      items.push({ name: baseName ?? `Barre ${items.length + 1}`, baseName, isUnnamed, length: Math.max(p.width, p.height), color: p.color });
    }
  });
  items.sort((a, b) => b.length - a.length); // Largest-first fit
  const bars: BarResult[] = [];
  for (const item of items) {
    let placed = false;
    for (const bar of bars) {
      const usedSoFar = bar.pieces.reduce((s, p) => s + p.length + kerf, 0);
      if (usedSoFar + item.length <= bar.length) {
        const x = bar.pieces.length === 0 ? 0 : usedSoFar;
        bar.pieces.push({ ...item, x });
        bar.usedLength = usedSoFar + item.length;
        placed = true; break;
      }
    }
    if (!placed) {
      bars.push({
        barIndex: bars.length, length: stockLength, pieces: [{ ...item, x: 0 }],
        usedLength: item.length, wasteRate: 0,
      });
    }
  }
  for (const b of bars) { b.wasteRate = Math.round((1 - b.usedLength / b.length) * 1000) / 10; }
  return bars;
}

export function optimizeCutting1D(pieces: Piece[], stockLength: number, kerf: number): OptimizationResult {
  const bars = optimize1D(pieces, stockLength, kerf / 10);
  const sheets: SheetResult[] = bars.map((b, i) => ({
    index: i, material: 'mdf' as MaterialType, width: stockLength, height: 1,
    pieces: b.pieces.map((p, j) => ({
      pieceNumber: j + 1, name: p.name, baseName: p.baseName, isUnnamed: p.isUnnamed,
      originalHeight: 1, originalWidth: p.length,
      height: 1, width: p.length, x: p.x, y: 0, rotated: false,
      sheetIndex: i, material: 'mdf' as MaterialType,
      color: p.color,
    })),
    offcuts: [{ id: `sheet${i}_offcut_bar`, x: b.usedLength, y: 0, width: stockLength - b.usedLength, height: 1, sheetIndex: i, areaM2: 0, isReusable: (stockLength - b.usedLength) > 1 }],
    // 1D mode does not (yet) model individual guillotine cuts per bar — see
    // optimizeCutting2D's `cuts`/`totalLinearCutMeters` for the 2D model.
    cuts: [],
    usedArea: b.usedLength, wasteRate: b.wasteRate,
  }));
  const totalAvail = bars.length * stockLength;
  const totalUsed = bars.reduce((s, b) => s + b.usedLength, 0);
  return {
    cutMode: '1d', sheetsUsed: bars.length, sheets,
    placedPieces: sheets.flatMap(s => s.pieces), offcuts: sheets.flatMap(s => s.offcuts),
    unplacedPieces: [], totalAreaAvailable: totalAvail, totalAreaUsed: totalUsed,
    wastePercentage: totalAvail > 0 ? Math.round((1 - totalUsed / totalAvail) * 1000) / 10 : 0,
    totalLinearCutMeters: bars.reduce((s, b) => s + b.pieces.length, 0) * kerf / 10000,
    // No pricing input flows into 1D mode today (no per-bar stock price is
    // configured anywhere upstream), so costBreakdown is left undefined
    // rather than fabricated — see src/lib/costing.ts's module doc.
  };
}

// ─── 2D Guillotine Packer ─────────────────────────────────────────
type StripAxis = 'rows' | 'columns';
type PieceOrdering = 'area_desc' | 'height_desc' | 'width_desc' | 'long_side_desc' | 'perimeter_desc';
type LevelSelection = 'first_fit' | 'tight_primary' | 'tight_secondary';

interface PackingStrategy {
  id: string;
  axis: StripAxis;
  order: PieceOrdering;
  levelSelection: LevelSelection;
}

interface PlacementCandidate {
  freeRectIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotated: boolean;
  score: [number, number, number, number];
}

interface FreeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SheetPackingCandidate {
  pieces: PlacedPiece[];
  remaining: ExpandedPiece[];
  usedArea: number;
  freeRects: FreeRect[];
  cuts: CutInstruction[];
}

interface PlanCandidate {
  sheets: SheetResult[];
  placedPieces: PlacedPiece[];
  unplacedPieces: ExpandedPiece[];
  totalAreaUsed: number;
  totalAreaAvailable: number;
}

interface PartialPlanCandidate extends PlanCandidate {
  remaining: ExpandedPiece[];
  nextPieceNumber: number;
}

const PACKING_STRATEGIES: PackingStrategy[] = [
  { id: 'row-area-first', axis: 'rows', order: 'area_desc', levelSelection: 'first_fit' },
  { id: 'row-height-tight-primary', axis: 'rows', order: 'height_desc', levelSelection: 'tight_primary' },
  { id: 'row-width-tight-secondary', axis: 'rows', order: 'width_desc', levelSelection: 'tight_secondary' },
  { id: 'row-long-side-tight-primary', axis: 'rows', order: 'long_side_desc', levelSelection: 'tight_primary' },
  { id: 'column-area-first', axis: 'columns', order: 'area_desc', levelSelection: 'first_fit' },
  { id: 'column-width-tight-primary', axis: 'columns', order: 'width_desc', levelSelection: 'tight_primary' },
  { id: 'column-height-tight-secondary', axis: 'columns', order: 'height_desc', levelSelection: 'tight_secondary' },
  { id: 'column-perimeter-tight-primary', axis: 'columns', order: 'perimeter_desc', levelSelection: 'tight_primary' },
];

function compareNumbersDesc(a: number, b: number): number {
  return b - a;
}

function compareTuples(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function getPieceSortComparator(order: PieceOrdering): (a: ExpandedPiece, b: ExpandedPiece) => number {
  return (a, b) => {
    const areaDiff = compareNumbersDesc(a.width * a.height, b.width * b.height);
    const longSideDiff = compareNumbersDesc(Math.max(a.width, a.height), Math.max(b.width, b.height));
    const heightDiff = compareNumbersDesc(a.height, b.height);
    const widthDiff = compareNumbersDesc(a.width, b.width);
    const perimeterDiff = compareNumbersDesc((a.width + a.height), (b.width + b.height));
    const idDiff = String(a.id || '').localeCompare(String(b.id || ''));

    switch (order) {
      case 'height_desc':
        return heightDiff || widthDiff || areaDiff || idDiff;
      case 'width_desc':
        return widthDiff || heightDiff || areaDiff || idDiff;
      case 'long_side_desc':
        return longSideDiff || areaDiff || heightDiff || widthDiff || idDiff;
      case 'perimeter_desc':
        return perimeterDiff || areaDiff || longSideDiff || idDiff;
      case 'area_desc':
      default:
        return areaDiff || longSideDiff || heightDiff || widthDiff || idDiff;
    }
  };
}

function getStockSequence(sheets: Sheet[]): Sheet[] {
  const expanded: Sheet[] = [];
  for (const sheet of sheets) {
    const qty = Math.max(1, Math.floor(sheet.quantity || 1));
    for (let i = 0; i < qty; i += 1) expanded.push(sheet);
  }
  return expanded.length > 0 ? expanded : [{ width: 0, height: 0, kerf: 0 }];
}

function getSheetForIndex(stockSequence: Sheet[], originalSheets: Sheet[], sheetIndex: number): Sheet {
  if (sheetIndex < stockSequence.length) return stockSequence[sheetIndex];
  return stockSequence[stockSequence.length - 1] || originalSheets[originalSheets.length - 1];
}

function buildPlacementScore(
  strategy: PackingStrategy,
  primarySlack: number,
  secondarySlack: number,
  areaSlack: number,
  origin: number
): [number, number, number, number] {
  if (strategy.levelSelection === 'first_fit') {
    return [
      origin,
      primarySlack,
      secondarySlack,
      areaSlack,
    ];
  }

  if (strategy.levelSelection === 'tight_secondary') {
    return [
      secondarySlack,
      primarySlack,
      areaSlack,
      origin,
    ];
  }

  return [
    primarySlack,
    secondarySlack,
    areaSlack,
    origin,
  ];
}

function tryPlaceOnSheet(
  item: ExpandedPiece,
  sheet: Sheet,
  strategy: PackingStrategy,
  freeRects: FreeRect[]
): PlacementCandidate | null {
  const allowRotation = item.rotatable;
  const candidates: PlacementCandidate[] = [];

  for (let rotationIndex = 0; rotationIndex <= (allowRotation ? 1 : 0); rotationIndex += 1) {
    const rotated = rotationIndex === 1;
    const width = rotated ? item.height : item.width;
    const height = rotated ? item.width : item.height;
    if (width <= 0 || height <= 0) continue;

    for (let freeRectIndex = 0; freeRectIndex < freeRects.length; freeRectIndex += 1) {
      const freeRect = freeRects[freeRectIndex];
      if (width > freeRect.width + 1e-9 || height > freeRect.height + 1e-9) continue;

      const primarySlack = strategy.axis === 'rows' ? freeRect.width - width : freeRect.height - height;
      const secondarySlack = strategy.axis === 'rows' ? freeRect.height - height : freeRect.width - width;
      const areaSlack = (freeRect.width * freeRect.height) - (width * height);
      const origin = strategy.axis === 'rows'
        ? (freeRect.y * Math.max(1, sheet.width)) + freeRect.x
        : (freeRect.x * Math.max(1, sheet.height)) + freeRect.y;

      candidates.push({
        freeRectIndex,
        x: freeRect.x,
        y: freeRect.y,
        width,
        height,
        rotated,
        score: buildPlacementScore(strategy, primarySlack, secondarySlack, areaSlack, origin),
      });
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const scoreDiff = compareTuples(a.score, b.score);
    if (scoreDiff !== 0) return scoreDiff;
    return a.rotated === b.rotated ? 0 : (a.rotated ? 1 : -1);
  });

  return candidates[0];
}

interface SplitCut { axis: 'horizontal' | 'vertical'; lengthCm: number; }
interface SplitOutcome { rects: FreeRect[]; cuts: SplitCut[]; }

// Every branch below both (a) carves the leftover free area and (b) records
// the exact saw pass that carving represents — the two are the same
// geometric fact, so `lengthCm` is never anything but the literal span
// `splitFreeRect` itself computes (no perimeter/area-derived estimate).
function splitFreeRect(rect: FreeRect, width: number, height: number, kerf: number, axis: StripAxis): SplitOutcome {
  const rightWidth = rect.width - width - kerf;
  const bottomHeight = rect.height - height - kerf;
  const rects: FreeRect[] = [];
  const cuts: SplitCut[] = [];

  if (axis === 'rows') {
    if (rightWidth > 1e-9 && height > 1e-9) {
      rects.push({ x: rect.x + width + kerf, y: rect.y, width: rightWidth, height });
      // Vertical cut trimming the placed piece from the rest of its shelf.
      cuts.push({ axis: 'vertical', lengthCm: height });
    }
    if (bottomHeight > 1e-9) {
      rects.push({ x: rect.x, y: rect.y + height + kerf, width: rect.width, height: bottomHeight });
      // Horizontal cut separating this shelf from the remainder below it.
      cuts.push({ axis: 'horizontal', lengthCm: rect.width });
    }
  } else {
    if (rightWidth > 1e-9) {
      rects.push({ x: rect.x + width + kerf, y: rect.y, width: rightWidth, height: rect.height });
      // Vertical cut separating this column from the remainder to its right.
      cuts.push({ axis: 'vertical', lengthCm: rect.height });
    }
    if (bottomHeight > 1e-9 && width > 1e-9) {
      rects.push({ x: rect.x, y: rect.y + height + kerf, width, height: bottomHeight });
      // Horizontal cut trimming the placed piece from the rest of its column.
      cuts.push({ axis: 'horizontal', lengthCm: width });
    }
  }

  return { rects, cuts };
}

function pruneFreeRects(freeRects: FreeRect[]): FreeRect[] {
  return freeRects.filter((rect, rectIndex) => !freeRects.some((other, otherIndex) => {
    if (rectIndex === otherIndex) return false;
    const contained = (
      rect.x >= other.x - 1e-9 &&
      rect.y >= other.y - 1e-9 &&
      rect.x + rect.width <= other.x + other.width + 1e-9 &&
      rect.y + rect.height <= other.y + other.height + 1e-9
    );
    if (!contained) return false;
    // Exact duplicates are mutually "contained" in each other; without a tiebreaker
    // every copy would drop itself, leaving zero survivors instead of one. Keep the
    // lowest-indexed copy so exact duplicates dedupe to a single rectangle.
    const isExactDuplicate = (
      Math.abs(rect.x - other.x) <= 1e-9 &&
      Math.abs(rect.y - other.y) <= 1e-9 &&
      Math.abs(rect.width - other.width) <= 1e-9 &&
      Math.abs(rect.height - other.height) <= 1e-9
    );
    return isExactDuplicate ? otherIndex < rectIndex : true;
  }));
}

function sortFreeRects(freeRects: FreeRect[], axis: StripAxis): FreeRect[] {
  return [...freeRects].sort((a, b) => {
    if (axis === 'rows') return a.y - b.y || a.x - b.x || a.width - b.width || a.height - b.height;
    return a.x - b.x || a.y - b.y || a.height - b.height || a.width - b.width;
  });
}

function packSheetWithStrategy(
  items: ExpandedPiece[],
  sheet: Sheet,
  strategy: PackingStrategy,
  sheetIndex: number,
  nextPieceNumber: number
): SheetPackingCandidate {
  const margin = Math.max(0, sheet.margin || 0);
  const usableWidth = Math.max(0, sheet.width - (margin * 2));
  const usableHeight = Math.max(0, sheet.height - (margin * 2));
  const kerf = Math.max(0, sheet.kerf || 0);
  let freeRects: FreeRect[] = usableWidth > 0 && usableHeight > 0
    ? [{ x: margin, y: margin, width: usableWidth, height: usableHeight }]
    : [];
  const orderedItems = [...items].sort(getPieceSortComparator(strategy.order));
  const placedIds = new Set<string>();
  const pieces: PlacedPiece[] = [];
  const cuts: CutInstruction[] = [];
  let usedArea = 0;

  for (const item of orderedItems) {
    const placement = tryPlaceOnSheet(item, sheet, strategy, freeRects);
    if (!placement) continue;

    const targetRect = freeRects[placement.freeRectIndex];
    freeRects = freeRects.filter((_, index) => index !== placement.freeRectIndex);
    const split = splitFreeRect(targetRect, placement.width, placement.height, kerf, strategy.axis);
    freeRects.push(...split.rects);
    freeRects = sortFreeRects(pruneFreeRects(freeRects), strategy.axis);
    for (const cut of split.cuts) {
      cuts.push({ id: `sheet${sheetIndex}_cut_${cuts.length}`, sheetIndex, axis: cut.axis, lengthCm: cut.lengthCm });
    }

    placedIds.add(item.id || '');
    pieces.push({
      pieceId: item.id,
      pieceNumber: nextPieceNumber + pieces.length,
      name: item.name,
      baseName: item.baseName,
      isUnnamed: item.isUnnamed,
      originalHeight: item.originalHeight,
      originalWidth: item.originalWidth,
      height: placement.height,
      width: placement.width,
      x: placement.x,
      y: placement.y,
      rotated: placement.rotated,
      sheetIndex,
      material: item.material,
      color: item.color,
      originalIndex: item.originalIndex,
      edges: item.edges,
    });
    usedArea += placement.width * placement.height;
  }

  return {
    pieces,
    remaining: orderedItems.filter((item) => !placedIds.has(item.id || '')),
    usedArea,
    freeRects,
    cuts,
  };
}

// Round to a fixed cm precision so IDs/areas are stable across floating-point noise.
function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function buildOffcutId(sheetIndex: number, x: number, y: number, width: number, height: number): string {
  return `sheet${sheetIndex}_offcut_${roundTo(x, 2)}x${roundTo(y, 2)}_${roundTo(width, 2)}x${roundTo(height, 2)}`;
}

function buildOffcutsForSheet(freeRects: FreeRect[], sheet: Sheet, sheetIndex: number, options: OptimizationOptions): Offcut[] {
  const margin = Math.max(0, sheet.margin || 0);
  const minX = margin;
  const minY = margin;
  const maxX = sheet.width - margin;
  const maxY = sheet.height - margin;
  const minWidth = options.minReusableOffcutWidth ?? OPTIONS_DEFAULTS.minReusableOffcutWidth ?? 0;
  const minHeight = options.minReusableOffcutHeight ?? OPTIONS_DEFAULTS.minReusableOffcutHeight ?? 0;

  // Keep only geometrically valid, in-bounds terminal free rectangles, then drop any
  // that are fully contained within another (defensive: packSheetWithStrategy already
  // prunes contained rectangles after every placement, but this guards the final set too).
  const valid = freeRects.filter((rect) => (
    rect.width > 1e-9 && rect.height > 1e-9 &&
    rect.x >= minX - 1e-9 && rect.y >= minY - 1e-9 &&
    rect.x + rect.width <= maxX + 1e-9 && rect.y + rect.height <= maxY + 1e-9
  ));
  const deduped = pruneFreeRects(valid);
  const ordered = [...deduped].sort((a, b) => a.y - b.y || a.x - b.x || a.width - b.width || a.height - b.height);

  return ordered.map((rect) => {
    const areaM2 = roundTo((rect.width * rect.height) / 10000, 4);
    return {
      id: buildOffcutId(sheetIndex, rect.x, rect.y, rect.width, rect.height),
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      sheetIndex,
      areaM2,
      isReusable: rect.width >= minWidth && rect.height >= minHeight,
    };
  });
}

function buildSheetResult(sheet: Sheet, sheetIndex: number, defaultMaterial: MaterialType, pieces: PlacedPiece[], usedArea: number, freeRects: FreeRect[], options: OptimizationOptions, cuts: CutInstruction[]): SheetResult {
  const sheetArea = sheet.width * sheet.height;
  return {
    index: sheetIndex,
    material: (sheet.material || defaultMaterial) as MaterialType,
    width: sheet.width,
    height: sheet.height,
    pieces,
    offcuts: buildOffcutsForSheet(freeRects, sheet, sheetIndex, options),
    cuts,
    usedArea,
    wasteRate: sheetArea > 0 ? Math.round((1 - usedArea / sheetArea) * 1000) / 10 : 0,
  };
}

function simulatePlanForStrategy(
  items: ExpandedPiece[],
  sheets: Sheet[],
  strategy: PackingStrategy,
  mergedOptions: OptimizationOptions,
  defaultMaterial: MaterialType
): PlanCandidate {
  const stockSequence = getStockSequence(sheets);
    const candidateStrategies = [
      strategy,
      ...PACKING_STRATEGIES.filter((candidate) => candidate.id !== strategy.id),
    ];
  const maxSheetArea = sheets.reduce((max, sheet) => Math.max(max, sheet.width * sheet.height), 0);
  const beamWidth = 6;
  let frontier: PartialPlanCandidate[] = [{
    sheets: [],
    placedPieces: [],
    unplacedPieces: items,
    totalAreaUsed: 0,
    totalAreaAvailable: 0,
    remaining: items,
    nextPieceNumber: 1,
  }];
  const completed: PartialPlanCandidate[] = [];

  const rankPartialPlan = (plan: PartialPlanCandidate): [number, number, number, number] => {
    const remainingArea = plan.remaining.reduce((sum, piece) => sum + (piece.width * piece.height), 0);
    const lowerBoundSheets = maxSheetArea > 0 ? Math.ceil((remainingArea - 1e-9) / maxSheetArea) : Number.MAX_SAFE_INTEGER;
    return [
      plan.sheets.length + lowerBoundSheets,
      plan.remaining.length,
      -(plan.placedPieces.length),
      plan.totalAreaAvailable - plan.totalAreaUsed,
    ];
  };

  while (frontier.length > 0) {
    const nextFrontier: PartialPlanCandidate[] = [];

    for (const plan of frontier) {
      if (plan.remaining.length === 0 || (mergedOptions.singleSheetOnly && plan.sheets.length >= 1)) {
        completed.push(plan);
        continue;
      }

      const sheetIndex = plan.sheets.length;
      const sheet = getSheetForIndex(stockSequence, sheets, sheetIndex);
      let producedCandidate = false;

      for (const candidateStrategy of candidateStrategies) {
        const candidate = packSheetWithStrategy(plan.remaining, sheet, candidateStrategy, sheetIndex, plan.nextPieceNumber);
        if (candidate.pieces.length === 0) continue;

        producedCandidate = true;
        nextFrontier.push({
          sheets: [...plan.sheets, buildSheetResult(sheet, sheetIndex, defaultMaterial, candidate.pieces, candidate.usedArea, candidate.freeRects, mergedOptions, candidate.cuts)],
          placedPieces: [...plan.placedPieces, ...candidate.pieces],
          unplacedPieces: candidate.remaining,
          totalAreaUsed: plan.totalAreaUsed + candidate.usedArea,
          totalAreaAvailable: plan.totalAreaAvailable + (sheet.width * sheet.height),
          remaining: candidate.remaining,
          nextPieceNumber: plan.nextPieceNumber + candidate.pieces.length,
        });
      }

      if (!producedCandidate) {
        completed.push(plan);
      }
    }

    if (nextFrontier.length === 0) break;

    const deduped = new Map<string, PartialPlanCandidate>();
    for (const plan of nextFrontier) {
      const key = `${plan.sheets.length}|${plan.remaining.map((piece) => piece.id).join(',')}`;
      const current = deduped.get(key);
      if (!current) {
        deduped.set(key, plan);
        continue;
      }

      const better = chooseBetterPlan(current, plan, mergedOptions.optimizationPriority);
      deduped.set(key, better === current ? current : plan);
    }

    frontier = Array.from(deduped.values())
      .sort((a, b) => compareTuples(rankPartialPlan(a), rankPartialPlan(b)))
      .slice(0, beamWidth);

    if (mergedOptions.singleSheetOnly) {
      completed.push(...frontier);
      break;
    }
  }

  let best: PlanCandidate | null = null;
  for (const plan of [...completed, ...frontier]) {
    best = chooseBetterPlan(best, {
      sheets: plan.sheets,
      placedPieces: plan.placedPieces,
      unplacedPieces: plan.remaining,
      totalAreaUsed: plan.totalAreaUsed,
      totalAreaAvailable: plan.totalAreaAvailable,
    }, mergedOptions.optimizationPriority);
  }

  return best || {
    sheets: [],
    placedPieces: [],
    unplacedPieces: items,
    totalAreaUsed: 0,
    totalAreaAvailable: 0,
  };
}

// Deterministic scoring tuples per `optimizationPriority`. Lower is better in
// every position (compared left-to-right via `compareTuples`); feasibility
// (fewest unplaced pieces) always gates every policy first, since no
// optimization goal should be allowed to sacrifice placement.
//
// Waste is expressed as a 0..1 fraction of available sheet area so it can
// never outweigh a whole extra sheet when summed with a sheet count.
function planScoreTuple(plan: PlanCandidate, priority: OptimizationPriority): number[] {
  const waste = plan.totalAreaAvailable > 0
    ? (plan.totalAreaAvailable - plan.totalAreaUsed) / plan.totalAreaAvailable
    : 0;

  switch (priority) {
    case 'min_sheets':
      // Sheet count is the sole objective beyond feasibility: this policy
      // deliberately does not compare waste, so a tie in sheet count is left
      // to the caller's stable placed-count/first-seen fallback rather than
      // being resolved by which candidate happens to waste less material.
      return [plan.unplacedPieces.length, plan.sheets.length];
    case 'min_waste':
      // Sheet count still gates first: using more sheets than necessary is
      // never "less wasteful" for the same piece set. Among equal feasible
      // sheet counts, the lower waste percentage wins.
      return [plan.unplacedPieces.length, plan.sheets.length, waste, -plan.totalAreaUsed];
    case 'balanced':
      // Deterministic composite: sheets stay dominant (waste is always < 1)
      // while still tie-breaking on waste when sheet counts are equal.
      return [plan.unplacedPieces.length, plan.sheets.length + waste];
    case 'linear_guillotine':
    default:
      // Every layout produced by this packer is guillotine/through-cut valid
      // by construction (see splitFreeRect), so no additional geometric
      // preference is needed for validity. This matches the historical
      // fewest-sheets/lowest-waste ordering that the locked benchmark
      // fixtures were verified against.
      return [plan.unplacedPieces.length, plan.sheets.length, waste, -plan.totalAreaUsed];
  }
}

function chooseBetterPlan(current: PlanCandidate | null, next: PlanCandidate, priority: OptimizationPriority): PlanCandidate {
  if (!current) return next;
  const comparison = compareTuples(planScoreTuple(next, priority), planScoreTuple(current, priority));
  if (comparison !== 0) return comparison < 0 ? next : current;
  return next.placedPieces.length > current.placedPieces.length ? next : current;
}

function buildMaterialStats(sheets: SheetResult[]): MaterialStats[] {
  const byMaterial = new Map<MaterialType, { sheetsUsed: number; totalPieces: number; usedArea: number; totalArea: number }>();

  for (const sheet of sheets) {
    const current = byMaterial.get(sheet.material) || { sheetsUsed: 0, totalPieces: 0, usedArea: 0, totalArea: 0 };
    current.sheetsUsed += 1;
    current.totalPieces += sheet.pieces.length;
    current.usedArea += sheet.usedArea;
    current.totalArea += sheet.width * sheet.height;
    byMaterial.set(sheet.material, current);
  }

  return Array.from(byMaterial.entries()).map(([material, stats]) => ({
    material,
    sheetsUsed: stats.sheetsUsed,
    totalPieces: stats.totalPieces,
    usedArea: stats.usedArea,
    wasteRate: stats.totalArea > 0 ? Math.round((1 - stats.usedArea / stats.totalArea) * 1000) / 10 : 0,
  }));
}

// Defensive trim/lowercase comparison key. `Piece.material` is typed as a
// closed `MaterialType` union, but this keeps material matching robust
// against incidental whitespace/case coming from imports rather than relying
// on values always being exactly canonical.
function normalizeMaterialKey(material: string | null | undefined): string {
  return String(material || '').trim().toLowerCase();
}

// Customer-safe list of optional constraints that actually changed optimizer
// behavior for this run. Intentionally omits kerf/margin (always present) and
// any internal strategy/search terminology.
//
// `single_sheet_only` is only reported when the merged result actually stayed
// within one sheet (`sheetsUsed <= 1`). This is a safety net: the option is
// meant to be a hard global cap enforced by the optimizer (single-sheet mode,
// and the single-winning-material-group rule under `considerMaterial`), so
// this guards against ever claiming the constraint held if some future
// regression let sheetsUsed grow past 1 while the option was still on.
function buildActiveConstraints(options: OptimizationOptions, sheetsUsed: number): string[] {
  const constraints: string[] = [];
  if (options.singleSheetOnly && sheetsUsed <= 1) constraints.push('single_sheet_only');
  if (options.considerMaterial) constraints.push('material_separation');
  if (options.grainDirection) constraints.push('grain_locked');
  return constraints;
}

interface StrategySearchOutcome { plan: PlanCandidate; candidatesEvaluated: number; }

// Runs every packing strategy against one homogeneous set of items/stock and
// keeps the best plan per the active `optimizationPriority` scoring policy.
function runStrategySearch(
  items: ExpandedPiece[],
  candidateSheets: Sheet[],
  mergedOptions: OptimizationOptions,
  defaultMaterial: MaterialType
): StrategySearchOutcome {
  let bestPlan: PlanCandidate | null = null;

  for (const strategy of PACKING_STRATEGIES) {
    const candidate = simulatePlanForStrategy(items, candidateSheets, strategy, mergedOptions, defaultMaterial);
    bestPlan = chooseBetterPlan(bestPlan, candidate, mergedOptions.optimizationPriority);
  }

  return {
    plan: bestPlan || { sheets: [], placedPieces: [], unplacedPieces: items, totalAreaUsed: 0, totalAreaAvailable: 0 },
    candidatesEvaluated: PACKING_STRATEGIES.length,
  };
}

// Re-assigns sheet indexes, piece numbers, and offcut IDs so a plan produced
// in isolation (e.g. one material group) can be concatenated into a larger
// merged result without colliding with sheets/pieces/offcuts from other
// groups. IDs on the pieces themselves (`pieceId`) are already globally
// unique from `expandPieces` and are left untouched.
function renumberPlan(plan: PlanCandidate, sheetIndexOffset: number, pieceNumberOffset: number): PlanCandidate {
  const sheets = plan.sheets.map((sheet, position) => {
    const newSheetIndex = sheetIndexOffset + position;
    const pieces = sheet.pieces.map((piece) => ({
      ...piece,
      sheetIndex: newSheetIndex,
      pieceNumber: pieceNumberOffset + piece.pieceNumber,
    }));
    const offcuts = sheet.offcuts.map((offcut) => ({
      ...offcut,
      sheetIndex: newSheetIndex,
      id: buildOffcutId(newSheetIndex, offcut.x, offcut.y, offcut.width, offcut.height),
    }));
    const cuts = sheet.cuts.map((cut, position) => ({
      ...cut,
      sheetIndex: newSheetIndex,
      id: `sheet${newSheetIndex}_cut_${position}`,
    }));
    return { ...sheet, index: newSheetIndex, pieces, offcuts, cuts };
  });

  return {
    sheets,
    placedPieces: sheets.flatMap((sheet) => sheet.pieces),
    unplacedPieces: plan.unplacedPieces,
    totalAreaUsed: plan.totalAreaUsed,
    totalAreaAvailable: plan.totalAreaAvailable,
  };
}

interface EvaluatedMaterialGroup {
  materialKey: string;
  groupItems: ExpandedPiece[];
  outcome: StrategySearchOutcome;
}

// Picks the material group whose plan places the most pieces — the primary,
// non-negotiable criterion for the single-global-sheet contest — and only
// falls back to the active `optimizationPriority` scoring (via
// `chooseBetterPlan`, which already ends in a stable "keep current on exact
// tie" fallback) to break a tie between equally-placed groups.
function pickWinningMaterialGroup(
  a: EvaluatedMaterialGroup,
  b: EvaluatedMaterialGroup,
  priority: OptimizationPriority
): EvaluatedMaterialGroup {
  const placedA = a.outcome.plan.placedPieces.length;
  const placedB = b.outcome.plan.placedPieces.length;
  if (placedA !== placedB) return placedA > placedB ? a : b;

  const better = chooseBetterPlan(a.outcome.plan, b.outcome.plan, priority);
  return better === b.outcome.plan ? b : a;
}

// Global single-sheet contest across material groups: with `singleSheetOnly`
// active, the merged result must use at most ONE sheet in total, not one per
// material group. Every matched group is still evaluated independently
// in single-sheet mode against its own compatible stock (so
// `candidatesEvaluated` stays accurate), but only the group that places the
// most pieces keeps its sheet; every other matched group's pieces are marked
// unplaced with `single_sheet_material_limit` instead of silently dropped.
function buildSingleSheetGroupedResult(
  evaluatedGroups: EvaluatedMaterialGroup[],
  noStockUnplaced: ExpandedPiece[],
  priority: OptimizationPriority,
  candidatesEvaluated: number
): StrategySearchOutcome {
  if (evaluatedGroups.length === 0) {
    return {
      plan: { sheets: [], placedPieces: [], unplacedPieces: noStockUnplaced, totalAreaUsed: 0, totalAreaAvailable: 0 },
      candidatesEvaluated,
    };
  }

  let winner = evaluatedGroups[0];
  for (const candidate of evaluatedGroups.slice(1)) {
    winner = pickWinningMaterialGroup(winner, candidate, priority);
  }

  const renumbered = renumberPlan(winner.outcome.plan, 0, 0);
  const unplacedPieces: ExpandedPiece[] = [...renumbered.unplacedPieces];

  for (const group of evaluatedGroups) {
    if (group === winner) continue;
    for (const item of group.groupItems) {
      unplacedPieces.push({
        ...item,
        unplacedReasonCode: 'single_sheet_material_limit',
        unplacedReason: UNPLACED_REASON_TEXT.single_sheet_material_limit,
      });
    }
  }
  unplacedPieces.push(...noStockUnplaced);

  return {
    plan: {
      sheets: renumbered.sheets,
      placedPieces: renumbered.placedPieces,
      unplacedPieces,
      totalAreaUsed: winner.outcome.plan.totalAreaUsed,
      totalAreaAvailable: winner.outcome.plan.totalAreaAvailable,
    },
    candidatesEvaluated,
  };
}

// considerMaterial=true path: groups expanded pieces by normalized material,
// matches each group only against stock of the same material, and merges the
// per-group plans into one collision-free result. A material with no
// compatible stock at all is never attempted for packing — its pieces are
// left explicitly unplaced with a customer-safe reason instead of silently
// falling back to mismatched stock.
//
// Under `singleSheetOnly`, the merge instead runs a single-global-sheet
// contest (see `buildSingleSheetGroupedResult`) so the option remains a
// global budget rather than one sheet per material group.
function runMaterialGroupedSearch(
  items: ExpandedPiece[],
  sheets: Sheet[],
  mergedOptions: OptimizationOptions,
  defaultMaterial: MaterialType
): StrategySearchOutcome {
  const groups = new Map<string, ExpandedPiece[]>();
  for (const item of items) {
    const key = normalizeMaterialKey(item.material);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }

  const evaluatedGroups: EvaluatedMaterialGroup[] = [];
  const noStockUnplaced: ExpandedPiece[] = [];
  let candidatesEvaluated = 0;

  for (const [materialKey, groupItems] of Array.from(groups.entries())) {
    const matchingSheets = sheets.filter((sheet) => normalizeMaterialKey(sheet.material || defaultMaterial) === materialKey);

    if (matchingSheets.length === 0) {
      for (const item of groupItems) {
        noStockUnplaced.push({
          ...item,
          unplacedReasonCode: 'no_matching_stock',
          unplacedReason: UNPLACED_REASON_TEXT.no_matching_stock,
        });
      }
      continue;
    }

    const outcome = runStrategySearch(groupItems, matchingSheets, mergedOptions, defaultMaterial);
    candidatesEvaluated += outcome.candidatesEvaluated;
    evaluatedGroups.push({ materialKey, groupItems, outcome });
  }

  if (mergedOptions.singleSheetOnly) {
    return buildSingleSheetGroupedResult(evaluatedGroups, noStockUnplaced, mergedOptions.optimizationPriority, candidatesEvaluated);
  }

  let sheetOffset = 0;
  let pieceNumberOffset = 0;
  const mergedSheets: SheetResult[] = [];
  const mergedPlaced: PlacedPiece[] = [];
  const mergedUnplaced: ExpandedPiece[] = [...noStockUnplaced];
  let totalAreaUsed = 0;
  let totalAreaAvailable = 0;

  for (const group of evaluatedGroups) {
    const { plan } = group.outcome;
    const renumbered = renumberPlan(plan, sheetOffset, pieceNumberOffset);
    mergedSheets.push(...renumbered.sheets);
    mergedPlaced.push(...renumbered.placedPieces);
    mergedUnplaced.push(...renumbered.unplacedPieces);
    totalAreaUsed += plan.totalAreaUsed;
    totalAreaAvailable += plan.totalAreaAvailable;
    sheetOffset += plan.sheets.length;
    pieceNumberOffset += plan.placedPieces.length;
  }

  return {
    plan: {
      sheets: mergedSheets,
      placedPieces: mergedPlaced,
      unplacedPieces: mergedUnplaced,
      totalAreaUsed,
      totalAreaAvailable,
    },
    candidatesEvaluated,
  };
}

// ─── Main 2D Optimizer (multi-sheet) ──────────────────────────────
export function optimizeCutting2D(
  pieces: Piece[], sheets: Sheet[], options: Partial<OptimizationOptions> = {}
): OptimizationResult {
  const mergedOptions: OptimizationOptions = { ...OPTIONS_DEFAULTS, ...options };
  const defaultMat: MaterialType = mergedOptions.defaultMaterial || 'mdf';
  const allExpanded = expandPieces(pieces, defaultMat, mergedOptions.grainDirection);

  const { plan: finalPlan, candidatesEvaluated } = mergedOptions.considerMaterial
    ? runMaterialGroupedSearch(allExpanded, sheets, mergedOptions, defaultMat)
    : runStrategySearch(allExpanded, sheets, mergedOptions, defaultMat);

  const totalAvail = finalPlan.totalAreaAvailable;
  const totalUsed = finalPlan.totalAreaUsed;
  const wp = totalAvail > 0 ? Math.round((1 - totalUsed / totalAvail) * 1000) / 10 : 0;
  // Measured from the actual guillotine saw passes the packer performed
  // (see `splitFreeRect`/`CutInstruction`), never a perimeter/area estimate.
  const totalCutLengthCm = finalPlan.sheets.reduce(
    (sum, sheet) => sum + sheet.cuts.reduce((sheetSum, cut) => sheetSum + cut.lengthCm, 0),
    0
  );
  const totalM = Math.round((totalCutLengthCm / 100) * 10) / 10;

  // Material cost: one line per physical sheet actually used, priced per m²
  // from the material library unless the caller supplied an explicit
  // per-material override. This is 'measured' because it is derived from
  // the real plan (finalPlan.sheets), not a pre-optimization guess.
  const sheetCostLines: SheetCostLine[] = finalPlan.sheets.map((sheet) => ({
    areaM2: (sheet.width * sheet.height) / 10000,
    quantity: 1,
    pricing: mergedOptions.stockPricingOverrides?.[sheet.material] ?? { mode: 'per_m2', value: getMaterialDef(sheet.material).pricePerM2 },
  }));

  // Edge banding cost: derived from the pieces the packer actually placed
  // (`finalPlan.placedPieces`, one entry per placed unit), never from the
  // requested `pieces[]` multiplied by quantity — a piece left unplaced, or
  // only partially placed, must cost nothing to band for the copies that
  // never made it onto a sheet. Only the sides an artisan actually flagged
  // on the source piece are counted; no full-perimeter fallback.
  const edgeSegments: EdgeSegmentCostLine[] = [];
  for (const placed of finalPlan.placedPieces) {
    if (!placed.edges) continue;
    const presetId = placed.edges.color || 'none';
    const preset = EDGEBANDING_PRESETS.find((e) => e.id === presetId) || EDGEBANDING_PRESETS[0];
    const pricePerMeter = resolveEdgeRatePerMeter(
      placed.edges.pricePerM !== undefined
        ? { kind: 'explicit', pricePerMeter: placed.edges.pricePerM }
        : { kind: 'preset', preset: { id: preset.id, pricePerMeter: preset.pricePerM } }
    );
    if (pricePerMeter <= 0) continue;
    // Edge flags (top/bottom/left/right) refer to the piece's own labeled
    // sides, not its as-placed (possibly rotated) orientation — so this
    // always uses originalWidth/originalHeight, never the rotated width/height.
    let lengthM = 0;
    if (placed.edges.top) lengthM += placed.originalWidth / 100;
    if (placed.edges.bottom) lengthM += placed.originalWidth / 100;
    if (placed.edges.left) lengthM += placed.originalHeight / 100;
    if (placed.edges.right) lengthM += placed.originalHeight / 100;
    if (lengthM === 0) continue;
    edgeSegments.push({ lengthM, pricePerMeter });
  }

  // Built once, then handed to computeCostBreakdown *and* returned verbatim
  // as `costingInput` — so any caller that needs to re-verify `costBreakdown`
  // later (see OptimizationResult.costingInput) recomputes from this exact
  // object rather than re-deriving its own formula.
  const costBreakdownInput: CostBreakdownInput = {
    material: { sheets: sheetCostLines, basis: 'measured' },
    edge: { segments: edgeSegments, basis: 'measured' },
    labor:
      mergedOptions.laborPricing && mergedOptions.laborPricing.mode === 'per_meter'
        ? { pricing: mergedOptions.laborPricing, cutLengthM: totalM, basis: 'measured' }
        : { pricing: mergedOptions.laborPricing ?? DEFAULT_LABOR_PRICING },
  };
  const costBreakdown = computeCostBreakdown(costBreakdownInput);

  return {
    cutMode: '2d', sheetsUsed: finalPlan.sheets.length, sheets: finalPlan.sheets, placedPieces: finalPlan.placedPieces,
    offcuts: finalPlan.sheets.flatMap((sheet) => sheet.offcuts),
    unplacedPieces: finalPlan.unplacedPieces, totalAreaAvailable: totalAvail, totalAreaUsed: totalUsed,
    wastePercentage: wp, totalLinearCutMeters: totalM,
    costBreakdown,
    costingInput: costBreakdownInput,
    materialStats: buildMaterialStats(finalPlan.sheets),
    explanation: {
      chosenGoal: mergedOptions.optimizationPriority,
      activeConstraints: buildActiveConstraints(mergedOptions, finalPlan.sheets.length),
      candidatesEvaluated,
    },
  };
}

// Legacy wrapper
export function optimizeCutting(pieces: Piece[], sheet: Sheet, options?: Partial<OptimizationOptions>): OptimizationResult {
  return optimizeCutting2D(pieces, [{ ...sheet, quantity: 1 }], options);
}

export const GuillotinePacker = {
  strategies: PACKING_STRATEGIES,
  pruneFreeRects,
  chooseBetterPlan,
};
