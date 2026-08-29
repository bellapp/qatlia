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
  preCut?: { height?: number; width?: number }; rotatable?: boolean;
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
}
export const OPTIONS_DEFAULTS: OptimizationOptions = {
  kerfWidth: 3, showLabels: true, singleSheetOnly: false, considerMaterial: false,
  edgeBanding: false, grainDirection: false, optimizationPriority: 'linear_guillotine', defaultMaterial: 'mdf',
};

export interface PlacedPiece {
  pieceId?: string; pieceNumber: number; name?: string;
  originalHeight: number; originalWidth: number; height: number; width: number;
  x: number; y: number; rotated: boolean; sheetIndex: number; material?: MaterialType | null;
}
export interface Offcut { x: number; y: number; width: number; height: number; sheetIndex: number; areaM2: number; isReusable: boolean; }
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
  rotatable: boolean; edges?: EdgeBandingConfig;
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
      });
    }
  });
  return result;
}

// ─── 1D Linear Bar Optimization ───────────────────────────────────
export interface BarResult {
  barIndex: number; length: number; pieces: { name: string; length: number; x: number }[];
  usedLength: number; wasteRate: number;
}

function optimize1D(pieces: Piece[], stockLength: number, kerf: number): BarResult[] {
  const items: { name: string; length: number }[] = [];
  pieces.forEach(p => {
    for (let j = 0; j < Math.max(1, p.quantity || 1); j++) {
      items.push({ name: p.name || `Barre ${items.length + 1}`, length: Math.max(p.width, p.height) });
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
    })),
    offcuts: [{ x: b.usedLength, y: 0, width: stockLength - b.usedLength, height: 1, sheetIndex: i, areaM2: 0, isReusable: (stockLength - b.usedLength) > 1 }],
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
class LinearGuillotinePacker {
  private levels: { y: number; x: number; rowH: number; remainingW: number }[] = [];
  constructor(private sheetW: number, private sheetH: number, private kerf: number, private material: MaterialType) {
    this.levels = [{ y: 0, x: 0, rowH: 0, remainingW: sheetW }];
  }
  tryFit(item: ExpandedPiece, sheetIndex: number, pieceNumber: number, grainLock: boolean): PlacedPiece | null {
    for (let r = 0; r <= (item.rotatable && !grainLock ? 1 : 0); r++) {
      const h = r === 0 ? item.height : item.width, w = r === 0 ? item.width : item.height;
      if (h <= 0 || w <= 0 || h > this.sheetH || w > this.sheetW) continue;
      for (const lv of this.levels) {
        if (w <= lv.remainingW) {
          if (lv.y + h > this.sheetH) continue;
          const placed: PlacedPiece = {
            pieceId: item.id, pieceNumber, name: item.name,
            originalHeight: item.originalHeight, originalWidth: item.originalWidth,
            height: h, width: w, x: lv.x, y: lv.y, rotated: r === 1,
            sheetIndex, material: item.material,
          };
          lv.x += w + this.kerf; lv.remainingW -= (w + this.kerf); lv.rowH = Math.max(lv.rowH, h);
          return placed;
        }
      }
      const maxH = Math.max(0, ...this.levels.map(l => l.rowH));
      const ny = maxH + this.kerf;
      if (ny + h > this.sheetH) continue;
      this.levels.push({ y: ny, x: 0, rowH: h, remainingW: this.sheetW - w - this.kerf });
      return {
        pieceId: item.id, pieceNumber, name: item.name,
        originalHeight: item.originalHeight, originalWidth: item.originalWidth,
        height: h, width: w, x: 0, y: ny, rotated: r === 1, sheetIndex, material: item.material,
      };
    }
    return null;
  }
}

// ─── Main 2D Optimizer (multi-sheet) ──────────────────────────────
export function optimizeCutting2D(
  pieces: Piece[], sheets: Sheet[], options: Partial<OptimizationOptions> = {}
): OptimizationResult {
  const mergedOptions: OptimizationOptions = { ...OPTIONS_DEFAULTS, ...options };
  const defaultMat: MaterialType = mergedOptions.defaultMaterial || 'mdf';
  const allExpanded = expandPieces(pieces, defaultMat, mergedOptions.grainDirection);

  const placedPieces: PlacedPiece[] = [], allSheets: SheetResult[] = [];
  let globalIdx = 0, totalUsed = 0;

  for (let si = 0; si < sheets.length; si++) {
    const sh = sheets[si];
    const sheetQty = Math.max(1, sh.quantity || 1);
    for (let qi = 0; qi < sheetQty; qi++) {
      const packer = new LinearGuillotinePacker(sh.width, sh.height, sh.kerf, (sh.material || defaultMat) as MaterialType);
      const sheetPcs: PlacedPiece[] = [];
      for (const item of allExpanded) {
        if (placedPieces.find(pp => pp.pieceId === item.id)) continue;
        const placed = packer.tryFit(item, globalIdx, placedPieces.length + sheetPcs.length + 1, mergedOptions.grainDirection);
        if (placed) { placedPieces.push(placed); sheetPcs.push(placed); }
      }
      if (sheetPcs.length === 0 && qi > 0) break;
      const usedArea = sheetPcs.reduce((s, p) => s + p.height * p.width, 0);
      totalUsed += usedArea;
      const shArea = sh.width * sh.height;
      allSheets.push({
        index: globalIdx, material: (sh.material || defaultMat) as MaterialType,
        width: sh.width, height: sh.height, pieces: sheetPcs, offcuts: [], usedArea,
        wasteRate: shArea > 0 ? Math.round((1 - usedArea / shArea) * 1000) / 10 : 0,
      });
      globalIdx++;
      if (mergedOptions.singleSheetOnly) break;
    }
    if (mergedOptions.singleSheetOnly && globalIdx > 0) break;
  }

  const totalAvail = allSheets.reduce((s, sh) => s + sh.width * sh.height, 0);
  const wp = totalAvail > 0 ? Math.round((1 - totalUsed / totalAvail) * 1000) / 10 : 0;
  const totalM = globalIdx > 0 ? Math.round(globalIdx * (sheets[0].width + sheets[0].height) / 100 * 10) / 10 : 0;
  const saved = Math.round((totalAvail - totalUsed) / 10000 * 200);

  const mats = sheets.length > 0 ? getMaterialDef(sheets[0].material || defaultMat) : getMaterialDef(defaultMat);
  const matCost = Math.round(totalAvail / 10000 * mats.pricePerM2);
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
    cutMode: '2d', sheetsUsed: globalIdx, sheets: allSheets, placedPieces, offcuts: [],
    unplacedPieces: [], totalAreaAvailable: totalAvail, totalAreaUsed: totalUsed,
    wastePercentage: wp, totalLinearCutMeters: totalM, moneySavedMad: saved,
    materialCostMad: matCost, edgeBandingCostMad: edgeCost, totalCostMad: matCost + edgeCost,
    materialStats: [{ material: defaultMat, sheetsUsed: globalIdx, totalPieces: placedPieces.length, usedArea: totalUsed, wasteRate: wp }],
  };
}

// Legacy wrapper
export function optimizeCutting(pieces: Piece[], sheet: Sheet, options?: Partial<OptimizationOptions>): OptimizationResult {
  return optimizeCutting2D(pieces, [{ ...sheet, quantity: 1 }], options);
}

export { LinearGuillotinePacker as GuillotinePacker };