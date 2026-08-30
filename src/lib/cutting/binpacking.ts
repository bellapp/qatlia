export type MaterialType = 'mdf' | 'aluminium' | 'verre' | 'contreplaques' | 'melamine' | 'chene' | 'stratifié' | 'medium';
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
export interface OptimizationOptions {
  kerfWidth: number; showLabels: boolean; singleSheetOnly: boolean;
  considerMaterial: boolean; edgeBanding: boolean; grainDirection: boolean;
  optimizationPriority: 'linear_guillotine' | 'min_waste' | 'min_sheets' | 'balanced';
  defaultMaterial?: MaterialType;
  /** Minimum offcut width in cm below which a remnant is not classified as reusable. */
  minReusableOffcutWidth?: number;
  /** Minimum offcut height in cm below which a remnant is not classified as reusable. */
  minReusableOffcutHeight?: number;
}
export const OPTIONS_DEFAULTS: OptimizationOptions = {
  kerfWidth: 3, showLabels: true, singleSheetOnly: false, considerMaterial: false,
  edgeBanding: false, grainDirection: false, optimizationPriority: 'linear_guillotine', defaultMaterial: 'mdf',
  minReusableOffcutWidth: 15, minReusableOffcutHeight: 15,
};

export interface PlacedPiece {
  pieceId?: string; pieceNumber: number; name?: string;
  originalHeight: number; originalWidth: number; height: number; width: number;
  x: number; y: number; rotated: boolean; sheetIndex: number; material?: MaterialType | null; color?: string;
}
export interface Offcut { id: string; x: number; y: number; width: number; height: number; sheetIndex: number; areaM2: number; isReusable: boolean; }
export interface SheetResult { index: number; material: MaterialType; width: number; height: number; pieces: PlacedPiece[]; offcuts: Offcut[]; usedArea: number; wasteRate: number; }
export interface MaterialStats { material: MaterialType; sheetsUsed: number; totalPieces: number; usedArea: number; wasteRate: number; }

export interface OptimizationResult {
  success?: boolean; cutMode?: CutMode;
  sheetsUsed: number; sheets: SheetResult[];
  placedPieces: PlacedPiece[]; offcuts: Offcut[]; unplacedPieces: ExpandedPiece[];
  totalAreaAvailable: number; totalAreaUsed: number; wastePercentage: number;
  totalLinearCutMeters: number; moneySavedMad: number;
  materialCostMad?: number; edgeBandingCostMad?: number; totalCostMad?: number;
  materialStats?: MaterialStats[];
}

export interface ExpandedPiece extends Required<Pick<Piece, 'height' | 'width' | 'quantity' | 'material'>> {
  originalIndex: number; id?: string; name?: string; originalHeight: number; originalWidth: number;
  rotatable: boolean; edges?: EdgeBandingConfig; color?: string;
}

function expandPieces(pieces: Piece[], defaultMaterial: MaterialType, globalGrain: boolean): ExpandedPiece[] {
  const result: ExpandedPiece[] = [];
  pieces.forEach((p, i) => {
    const qty = Math.max(1, p.quantity || 1);
    for (let j = 0; j < qty; j++) {
      result.push({
        originalIndex: i, id: p.id ? `${p.id}_${j}` : `p${i}_${j}`,
        name: qty > 1 ? `${p.name || `Pièce ${i + 1}`} ×${qty}` : p.name || `Pièce ${i + 1}`,
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
  barIndex: number; length: number; pieces: { name: string; length: number; x: number; color?: string }[];
  usedLength: number; wasteRate: number;
}

function optimize1D(pieces: Piece[], stockLength: number, kerf: number): BarResult[] {
  const items: { name: string; length: number; color?: string }[] = [];
  pieces.forEach(p => {
    for (let j = 0; j < Math.max(1, p.quantity || 1); j++) {
      items.push({ name: p.name || `Barre ${items.length + 1}`, length: Math.max(p.width, p.height), color: p.color });
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
      pieceNumber: j + 1, name: p.name,
      originalHeight: 1, originalWidth: p.length,
      height: 1, width: p.length, x: p.x, y: 0, rotated: false,
      sheetIndex: i, material: 'mdf' as MaterialType,
      color: p.color,
    })),
    offcuts: [{ id: `sheet${i}_offcut_bar`, x: b.usedLength, y: 0, width: stockLength - b.usedLength, height: 1, sheetIndex: i, areaM2: 0, isReusable: (stockLength - b.usedLength) > 1 }],
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
    moneySavedMad: Math.round(totalAvail * 0.18),
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

function splitFreeRect(rect: FreeRect, width: number, height: number, kerf: number, axis: StripAxis): FreeRect[] {
  const rightWidth = rect.width - width - kerf;
  const bottomHeight = rect.height - height - kerf;
  const next: FreeRect[] = [];

  if (axis === 'rows') {
    if (rightWidth > 1e-9 && height > 1e-9) {
      next.push({ x: rect.x + width + kerf, y: rect.y, width: rightWidth, height });
    }
    if (bottomHeight > 1e-9) {
      next.push({ x: rect.x, y: rect.y + height + kerf, width: rect.width, height: bottomHeight });
    }
  } else {
    if (rightWidth > 1e-9) {
      next.push({ x: rect.x + width + kerf, y: rect.y, width: rightWidth, height: rect.height });
    }
    if (bottomHeight > 1e-9 && width > 1e-9) {
      next.push({ x: rect.x, y: rect.y + height + kerf, width, height: bottomHeight });
    }
  }

  return next;
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
  let usedArea = 0;

  for (const item of orderedItems) {
    const placement = tryPlaceOnSheet(item, sheet, strategy, freeRects);
    if (!placement) continue;

    const targetRect = freeRects[placement.freeRectIndex];
    freeRects = freeRects.filter((_, index) => index !== placement.freeRectIndex);
    freeRects.push(...splitFreeRect(targetRect, placement.width, placement.height, kerf, strategy.axis));
    freeRects = sortFreeRects(pruneFreeRects(freeRects), strategy.axis);

    placedIds.add(item.id || '');
    pieces.push({
      pieceId: item.id,
      pieceNumber: nextPieceNumber + pieces.length,
      name: item.name,
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
    });
    usedArea += placement.width * placement.height;
  }

  return {
    pieces,
    remaining: orderedItems.filter((item) => !placedIds.has(item.id || '')),
    usedArea,
    freeRects,
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

function buildSheetResult(sheet: Sheet, sheetIndex: number, defaultMaterial: MaterialType, pieces: PlacedPiece[], usedArea: number, freeRects: FreeRect[], options: OptimizationOptions): SheetResult {
  const sheetArea = sheet.width * sheet.height;
  return {
    index: sheetIndex,
    material: (sheet.material || defaultMaterial) as MaterialType,
    width: sheet.width,
    height: sheet.height,
    pieces,
    offcuts: buildOffcutsForSheet(freeRects, sheet, sheetIndex, options),
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
          sheets: [...plan.sheets, buildSheetResult(sheet, sheetIndex, defaultMaterial, candidate.pieces, candidate.usedArea, candidate.freeRects, mergedOptions)],
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

      const better = chooseBetterPlan(current, plan);
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
    });
  }

  return best || {
    sheets: [],
    placedPieces: [],
    unplacedPieces: items,
    totalAreaUsed: 0,
    totalAreaAvailable: 0,
  };
}

function chooseBetterPlan(current: PlanCandidate | null, next: PlanCandidate): PlanCandidate {
  if (!current) return next;
  if (next.unplacedPieces.length !== current.unplacedPieces.length) {
    return next.unplacedPieces.length < current.unplacedPieces.length ? next : current;
  }
  if (next.sheets.length !== current.sheets.length) {
    return next.sheets.length < current.sheets.length ? next : current;
  }
  const currentWaste = current.totalAreaAvailable - current.totalAreaUsed;
  const nextWaste = next.totalAreaAvailable - next.totalAreaUsed;
  if (Math.abs(nextWaste - currentWaste) > 1e-9) {
    return nextWaste < currentWaste ? next : current;
  }
  if (Math.abs(next.totalAreaUsed - current.totalAreaUsed) > 1e-9) {
    return next.totalAreaUsed > current.totalAreaUsed ? next : current;
  }
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

// ─── Main 2D Optimizer (multi-sheet) ──────────────────────────────
export function optimizeCutting2D(
  pieces: Piece[], sheets: Sheet[], options: Partial<OptimizationOptions> = {}
): OptimizationResult {
  const mergedOptions: OptimizationOptions = { ...OPTIONS_DEFAULTS, ...options };
  const defaultMat: MaterialType = mergedOptions.defaultMaterial || 'mdf';
  const allExpanded = expandPieces(pieces, defaultMat, mergedOptions.grainDirection);
  let bestPlan: PlanCandidate | null = null;

  for (const strategy of PACKING_STRATEGIES) {
    const candidate = simulatePlanForStrategy(allExpanded, sheets, strategy, mergedOptions, defaultMat);
    bestPlan = chooseBetterPlan(bestPlan, candidate);
  }

  const finalPlan = bestPlan || {
    sheets: [],
    placedPieces: [],
    unplacedPieces: allExpanded,
    totalAreaUsed: 0,
    totalAreaAvailable: 0,
  };
  const totalAvail = finalPlan.totalAreaAvailable;
  const totalUsed = finalPlan.totalAreaUsed;
  const wp = totalAvail > 0 ? Math.round((1 - totalUsed / totalAvail) * 1000) / 10 : 0;
  const totalM = finalPlan.sheets.length > 0 ? Math.round(finalPlan.sheets.reduce((sum, sheet) => sum + ((sheet.width + sheet.height) / 100), 0) * 10) / 10 : 0;
  const saved = Math.round(Math.max(0, totalAvail - totalUsed) / 10000 * 200);

  const matCost = Math.round(finalPlan.sheets.reduce((sum, sheet) => {
    const material = getMaterialDef(sheet.material);
    return sum + ((sheet.width * sheet.height) / 10000 * material.pricePerM2);
  }, 0));
  let edgeCost = 0;
  for (const p of pieces) {
    if (!p.edges) continue;
    const preset = EDGEBANDING_PRESETS.find(e => e.id === (p.edges!.color || 'none')) || EDGEBANDING_PRESETS[0];
    if (preset.pricePerM <= 0) continue;
    let m = 0; if (p.edges.top) m += p.width / 100; if (p.edges.bottom) m += p.width / 100;
    if (p.edges.left) m += p.height / 100; if (p.edges.right) m += p.height / 100;
    if (m === 0) m = (p.height + p.width) * 2 / 100;
    edgeCost += Math.round(m * preset.pricePerM * (p.quantity || 1));
  }

  return {
    cutMode: '2d', sheetsUsed: finalPlan.sheets.length, sheets: finalPlan.sheets, placedPieces: finalPlan.placedPieces,
    offcuts: finalPlan.sheets.flatMap((sheet) => sheet.offcuts),
    unplacedPieces: finalPlan.unplacedPieces, totalAreaAvailable: totalAvail, totalAreaUsed: totalUsed,
    wastePercentage: wp, totalLinearCutMeters: totalM, moneySavedMad: saved,
    materialCostMad: matCost, edgeBandingCostMad: edgeCost, totalCostMad: matCost + edgeCost,
    materialStats: buildMaterialStats(finalPlan.sheets),
  };
}

// Legacy wrapper
export function optimizeCutting(pieces: Piece[], sheet: Sheet, options?: Partial<OptimizationOptions>): OptimizationResult {
  return optimizeCutting2D(pieces, [{ ...sheet, quantity: 1 }], options);
}

export const GuillotinePacker = {
  strategies: PACKING_STRATEGIES,
  pruneFreeRects,
};
