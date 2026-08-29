export type MaterialType = 'mdf' | 'aluminium' | 'verre' | 'contreplaques' | 'melamine' | 'chene' | 'stratifié' | 'medium';

export interface MaterialDef {
  type: MaterialType;
  label: string;
  color: string;        // Tailwind text class
  bgClass: string;      // Tailwind bg class
  borderClass: string;  // Tailwind border class
  pricePerM2: number;   // MAD / m²
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

export function getMaterialDef(type?: MaterialType | string | null): MaterialDef {
  return MATERIAL_LIBRARY.find(m => m.type === type) || MATERIAL_LIBRARY[0];
}

export interface EdgeBandingConfig {
  left?: boolean;
  right?: boolean;
  top?: boolean;
  bottom?: boolean;
  color?: string;
  pricePerM?: number;
}

export interface EdgeBandingPreset {
  id: string;
  label: string;
  color: string;
  pricePerM: number;   // MAD / mètre linéaire
}

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
  id?: string;
  name?: string;
  height: number;
  width: number;
  quantity: number;
  material?: MaterialType | null;
  grainDirection?: boolean;
  edges?: EdgeBandingConfig;
  preCut?: { height?: number; width?: number };
  rotatable?: boolean;
}

export interface Sheet {
  height: number;
  width: number;
  kerf: number;
  margin?: number;
  grainDirection?: boolean;
  material?: MaterialType;
}

export interface OptimizationOptions {
  kerfWidth: number;
  showLabels: boolean;
  singleSheetOnly: boolean;
  considerMaterial: boolean;
  edgeBanding: boolean;
  grainDirection: boolean;
  optimizationPriority: 'linear_guillotine' | 'min_waste' | 'min_sheets' | 'balanced';
  defaultMaterial?: MaterialType;
}

export const OPTIONS_DEFAULTS: OptimizationOptions = {
  kerfWidth: 3,
  showLabels: true,
  singleSheetOnly: false,
  considerMaterial: false,
  edgeBanding: false,
  grainDirection: false,
  optimizationPriority: 'linear_guillotine',
  defaultMaterial: 'mdf',
};

export interface PlacedPiece {
  pieceId?: string;
  pieceNumber: number;
  name?: string;
  originalHeight: number;
  originalWidth: number;
  height: number;
  width: number;
  x: number;
  y: number;
  rotated: boolean;
  sheetIndex: number;
  material?: MaterialType | null;
}

export interface Offcut {
  x: number;
  y: number;
  width: number;
  height: number;
  sheetIndex: number;
  areaM2: number;
  isReusable: boolean;
}

export interface SheetResult {
  index: number;
  material: MaterialType;
  width: number;
  height: number;
  pieces: PlacedPiece[];
  offcuts: Offcut[];
  usedArea: number;
  wasteRate: number;
}

export interface MaterialStats {
  material: MaterialType;
  sheetsUsed: number;
  totalPieces: number;
  usedArea: number;
  wasteRate: number;
}

export interface OptimizationResult {
  success?: boolean;
  sheetsUsed: number;
  sheets: SheetResult[];
  placedPieces: PlacedPiece[];
  offcuts: Offcut[];
  unplacedPieces: ExpandedPiece[];
  totalAreaAvailable: number;
  totalAreaUsed: number;
  wastePercentage: number;
  totalLinearCutMeters: number;
  moneySavedMad: number;
  materialCostMad?: number;
  edgeBandingCostMad?: number;
  totalCostMad?: number;
  materialStats?: MaterialStats[];
}

// Internal types — public for module use
export interface ExpandedPiece extends Required<Pick<Piece, 'height' | 'width' | 'quantity' | 'material'>> {
  originalIndex: number;
  id?: string;
  name?: string;
  originalHeight: number;
  originalWidth: number;
  rotatable: boolean;
  edges?: EdgeBandingConfig;
}

function expandPieces(pieces: Piece[], defaultMaterial: MaterialType, globalGrain: boolean): ExpandedPiece[] {
  const result: ExpandedPiece[] = [];
  pieces.forEach((p, i) => {
    const qty = Math.max(1, p.quantity || 1);
    for (let j = 0; j < qty; j++) {
      result.push({
        originalIndex: i,
        id: p.id ? `${p.id}_${j}` : `p${i}_${j}`,
        name: qty > 1 ? `${p.name || `Pièce ${i + 1}`} ×${qty}` : p.name || `Pièce ${i + 1}`,
        height: p.height,
        width: p.width,
        quantity: 1,
        material: (p.material || defaultMaterial) as MaterialType,
        originalHeight: p.height,
        originalWidth: p.width,
        rotatable: p.rotatable !== false && !(p.grainDirection || globalGrain),
        edges: p.edges,
      });
    }
  });
  return result;
}

// Guillotine bin-packer (placeholder — delegates to /api/optimize in production)
export class LinearGuillotinePacker {
  private sheetW: number;
  private sheetH: number;
  private kerf: number;
  private material: MaterialType;
  private levels: { y: number; x: number; rowH: number; remainingW: number }[] = [];

  constructor(sheetW: number, sheetH: number, kerf: number, material: MaterialType) {
    this.sheetW = sheetW;
    this.sheetH = sheetH;
    this.kerf = kerf;
    this.material = material;
    this.levels = [{ y: 0, x: 0, rowH: 0, remainingW: sheetW }];
  }

  tryFit(item: ExpandedPiece, sheetIndex: number, pieceNumber: number, grainLock: boolean): PlacedPiece | null {
    for (let rotation = 0; rotation <= (item.rotatable && !grainLock ? 1 : 0); rotation++) {
      const h = rotation === 0 ? item.height : item.width;
      const w = rotation === 0 ? item.width : item.height;
      if (h <= 0 || w <= 0 || h > this.sheetH || w > this.sheetW) continue;

      for (let li = 0; li < this.levels.length; li++) {
        const lv = this.levels[li];
        if (w <= lv.remainingW) {
          const ny = lv.y;
          if (ny + h > this.sheetH) continue;

          const result: PlacedPiece = {
            pieceId: item.id, pieceNumber, name: item.name,
            originalHeight: item.originalHeight, originalWidth: item.originalWidth,
            height: h, width: w, x: lv.x, y: ny, rotated: rotation === 1,
            sheetIndex, material: item.material,
          };
          lv.x += w + this.kerf;
          lv.remainingW -= (w + this.kerf);
          lv.rowH = Math.max(lv.rowH, h);
          return result;
        }
      }

      // Open a new row
      const maxRowH = this.levels.reduce((m, lv) => Math.max(m, lv.rowH), 0);
      const newY = maxRowH + this.kerf;
      if (newY + h > this.sheetH) continue;
      this.levels.push({ y: newY, x: 0, rowH: h, remainingW: this.sheetW - w - this.kerf });
      return {
        pieceId: item.id, pieceNumber, name: item.name,
        originalHeight: item.originalHeight, originalWidth: item.originalWidth,
        height: h, width: w, x: 0, y: newY, rotated: rotation === 1,
        sheetIndex, material: item.material,
      };
    }
    return null;
  }
}

export function optimizeCutting(
  pieces: Piece[],
  sheet: Sheet,
  options: Partial<OptimizationOptions> = {}
): OptimizationResult {
  const mergedOptions: OptimizationOptions = { ...OPTIONS_DEFAULTS, ...options };
  const defaultMat: MaterialType = mergedOptions.defaultMaterial || sheet.material || 'mdf';

  const expandedByMat = new Map<MaterialType, ExpandedPiece[]>();
  const allExpanded = expandPieces(pieces, defaultMat, mergedOptions.grainDirection);

  if (mergedOptions.considerMaterial) {
    for (const p of allExpanded) {
      const mat = (p.material || defaultMat) as MaterialType;
      if (!expandedByMat.has(mat)) expandedByMat.set(mat, []);
      expandedByMat.get(mat)!.push(p);
    }
  }

  const materialKeys = mergedOptions.considerMaterial
    ? Array.from(expandedByMat.keys())
    : [defaultMat];

  const allPlaced: PlacedPiece[] = [];
  const allUnplaced: ExpandedPiece[] = [];
  const sheets: SheetResult[] = [];
  let globalSheetIdx = 0;
  let totalAreaUsed = 0;
  const BS = 10000;

  for (const matKey of materialKeys) {
    const items = mergedOptions.considerMaterial ? expandedByMat.get(matKey)! : allExpanded;
    const currentMat = matKey as MaterialType;

    while (true) {
      const packer = new LinearGuillotinePacker(sheet.width, sheet.height, sheet.kerf, currentMat);
      const sheetPieces: PlacedPiece[] = [];

      for (let i = 0; i < items.length; i++) {
        const placed = packer.tryFit(items[i], globalSheetIdx, allPlaced.length + 1, mergedOptions.grainDirection);
        if (placed) {
          allPlaced.push(placed);
          sheetPieces.push(placed);
        } else {
          // Try next item
        }
      }

      if (sheetPieces.length === 0) break;

      const usedArea = sheetPieces.reduce((s, p) => s + p.height * p.width, 0);
      totalAreaUsed += usedArea;
      const sheetArea = sheet.width * sheet.height;
      const wasteRate = Math.round((1 - usedArea / sheetArea) * 1000) / 10;

      // Compute offcuts (simplified — real version in API)
      const offcuts: Offcut[] = [];

      sheets.push({
        index: globalSheetIdx,
        material: currentMat,
        width: sheet.width,
        height: sheet.height,
        pieces: sheetPieces,
        offcuts,
        usedArea,
        wasteRate,
      });

      globalSheetIdx++;

      if (mergedOptions.singleSheetOnly) {
        // Mark remaining as unplaced
        break;
      }
    }
  }

  const totalSheetArea = globalSheetIdx * sheet.width * sheet.height;
  const wastePct = totalSheetArea > 0 ? Math.round((1 - totalAreaUsed / totalSheetArea) * 1000) / 10 : 0;
  const totalLinearM = Math.round((globalSheetIdx * (sheet.width + sheet.height) / 100) * 10) / 10;
  const savedMad = Math.round((totalSheetArea - totalAreaUsed) / BS * 200);

  // Cost calculation
  const matDef = getMaterialDef(defaultMat);
  const materialCostMad = Math.round(totalSheetArea / BS * matDef.pricePerM2);
  let edgeBandingCostMad = 0;
  for (const p of pieces) {
    if (!p.edges) continue;
    const presetId = p.edges.color || 'none';
    const preset = EDGEBANDING_PRESETS.find(ep => ep.id === presetId) || EDGEBANDING_PRESETS[0];
    if (preset.pricePerM <= 0) continue;
    const peri = ((p.height + p.width) * 2) / 100; // mètres linéaires
    let edgeMeters = 0;
    if (p.edges.top) edgeMeters += p.width / 100;
    if (p.edges.bottom) edgeMeters += p.width / 100;
    if (p.edges.left) edgeMeters += p.height / 100;
    if (p.edges.right) edgeMeters += p.height / 100;
    if (edgeMeters === 0) edgeMeters = peri; // default: all edges
    edgeBandingCostMad += Math.round(edgeMeters * preset.pricePerM * (p.quantity || 1));
  }

  const materialStats: MaterialStats[] = [{
    material: defaultMat,
    sheetsUsed: globalSheetIdx,
    totalPieces: allPlaced.length,
    usedArea: totalAreaUsed,
    wasteRate: wastePct,
  }];

  return {
    sheetsUsed: globalSheetIdx,
    sheets,
    placedPieces: allPlaced,
    offcuts: [],
    unplacedPieces: allUnplaced,
    totalAreaAvailable: totalSheetArea,
    totalAreaUsed,
    wastePercentage: wastePct,
    totalLinearCutMeters: totalLinearM,
    moneySavedMad: savedMad,
    materialCostMad,
    edgeBandingCostMad,
    totalCostMad: materialCostMad + edgeBandingCostMad,
    materialStats,
  };
}

// Re-export for convenience
export { LinearGuillotinePacker as GuillotinePacker };