export type MaterialType = 'mdf' | 'aluminium' | 'verre' | 'contreplaques';

export interface Piece {
  id?: string;
  name?: string;
  width: number; // en cm
  height: number; // en cm
  quantity: number;
  material?: MaterialType | null;
  rotatable?: boolean;
}

export interface Sheet {
  width: number; // ex: 280 cm (longueur)
  height: number; // ex: 207 cm (largeur)
  kerf: number; // épaisseur trait de scie en cm (ex: 0.3 cm = 3mm)
  margin?: number; // marge périphérique en cm (ex: 1.0 cm)
  grainDirection?: boolean; // si vrai, aucune rotation autorisée
  material?: MaterialType;
}

export interface OptimizationOptions {
  kerfWidth: number; // mm (défaut: 3, min: 0, max: 10)
  showLabels: boolean; // Étiquettes sur les panneaux
  singleSheetOnly: boolean; // N'utiliser qu'un panneau du stock (F11)
  considerMaterial: boolean; // Groupement par matériau (F12)
  edgeBanding: boolean; // Chants
  grainDirection: boolean; // Orientation du fil (ON par défaut)
  optimizationPriority: 'min_waste' | 'min_sheets' | 'balanced';
  defaultMaterial?: MaterialType;
}

export const OPTIONS_DEFAULTS: OptimizationOptions = {
  kerfWidth: 3,
  showLabels: true,
  singleSheetOnly: false,
  considerMaterial: false,
  edgeBanding: false,
  grainDirection: true,
  optimizationPriority: 'min_waste',
  defaultMaterial: 'mdf',
};

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlacedPiece {
  pieceId?: string;
  name: string;
  sheetIndex: number;
  material?: MaterialType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotated: boolean;
  pieceNumber: number;
}

export interface PlacedSheet {
  index: number;
  material: MaterialType;
  width: number;
  height: number;
  pieces: PlacedPiece[];
  wasteRate: number; // en %
  usedArea: number; // en cm²
}

export interface MaterialStat {
  material: MaterialType;
  sheetsUsed: number;
  wasteRate: number; // en %
  usedArea: number; // en m²
  totalPieces: number;
}

export interface OptimizationResult {
  sheetsUsed: number;
  placedPieces: PlacedPiece[];
  unplacedPieces: Piece[];
  singleSheetWarning?: string;
  wastePercentage: number;
  totalAreaUsed: number;
  totalAreaAvailable: number;
  cutLines: Array<{ sheetIndex: number; x1: number; y1: number; x2: number; y2: number; type: 'vertical' | 'horizontal' }>;
  sheets: PlacedSheet[];
  materialStats?: MaterialStat[];
}

interface ExpandedPiece {
  piece: Piece;
  id: string;
  name: string;
  width: number;
  height: number;
  material: MaterialType;
  rotatable: boolean;
}

function expandPieces(pieces: Piece[], defaultMaterial: MaterialType): ExpandedPiece[] {
  const result: ExpandedPiece[] = [];
  let index = 1;
  for (const p of pieces) {
    const qty = Math.max(1, p.quantity || 1);
    for (let i = 0; i < qty; i++) {
      result.push({
        piece: p,
        id: p.id || `p_${index}`,
        name: p.name || `Pièce ${index}`,
        width: p.width,
        height: p.height,
        material: p.material || defaultMaterial,
        rotatable: p.rotatable !== false,
      });
      index++;
    }
  }
  return result;
}

/**
 * Moteur 2D Guillotine MAXRECTS avec détection et fusion de chutes
 */
class GuillotinePacker {
  private sheetW: number;
  private sheetH: number;
  private kerf: number;
  private material: MaterialType;
  private freeRects: Rect[] = [];
  public placed: PlacedPiece[] = [];

  constructor(sheetW: number, sheetH: number, kerf: number, material: MaterialType) {
    this.sheetW = sheetW;
    this.sheetH = sheetH;
    this.kerf = kerf;
    this.material = material;
    this.freeRects = [{ x: 0, y: 0, width: sheetW, height: sheetH }];
  }

  public tryFit(
    item: ExpandedPiece,
    sheetIndex: number,
    pieceNumber: number,
    grainDirection: boolean
  ): PlacedPiece | null {
    const canRotate = item.rotatable && !grainDirection;

    let bestRectIndex = -1;
    let bestRotated = false;
    let bestShortSideFit = Number.POSITIVE_INFINITY;
    let bestAreaFit = Number.POSITIVE_INFINITY;

    for (let i = 0; i < this.freeRects.length; i++) {
      const r = this.freeRects[i];

      // Test sans rotation
      if (r.width >= item.width && r.height >= item.height) {
        const leftoverW = r.width - item.width;
        const leftoverH = r.height - item.height;
        const shortSide = Math.min(leftoverW, leftoverH);
        const areaFit = r.width * r.height - item.width * item.height;

        if (shortSide < bestShortSideFit || (shortSide === bestShortSideFit && areaFit < bestAreaFit)) {
          bestShortSideFit = shortSide;
          bestAreaFit = areaFit;
          bestRectIndex = i;
          bestRotated = false;
        }
      }

      // Test avec rotation (si permise)
      if (canRotate) {
        if (r.width >= item.height && r.height >= item.width) {
          const leftoverW = r.width - item.height;
          const leftoverH = r.height - item.width;
          const shortSide = Math.min(leftoverW, leftoverH);
          const areaFit = r.width * r.height - item.height * item.width;

          if (shortSide < bestShortSideFit || (shortSide === bestShortSideFit && areaFit < bestAreaFit)) {
            bestShortSideFit = shortSide;
            bestAreaFit = areaFit;
            bestRectIndex = i;
            bestRotated = true;
          }
        }
      }
    }

    if (bestRectIndex === -1) return null;

    const targetRect = this.freeRects[bestRectIndex];
    this.freeRects.splice(bestRectIndex, 1);

    const placedW = bestRotated ? item.height : item.width;
    const placedH = bestRotated ? item.width : item.height;

    const placedPiece: PlacedPiece = {
      pieceId: item.id,
      name: item.name,
      sheetIndex,
      material: item.material,
      x: targetRect.x,
      y: targetRect.y,
      width: placedW,
      height: placedH,
      rotated: bestRotated,
      pieceNumber,
    };

    this.placed.push(placedPiece);

    // Guillotine Cut
    const rightW = targetRect.width - (placedW + this.kerf);
    const bottomH = targetRect.height - (placedH + this.kerf);

    if (placedW <= placedH) {
      if (rightW > 0.1) {
        this.freeRects.push({
          x: targetRect.x + placedW + this.kerf,
          y: targetRect.y,
          width: rightW,
          height: placedH,
        });
      }
      if (bottomH > 0.1) {
        this.freeRects.push({
          x: targetRect.x,
          y: targetRect.y + placedH + this.kerf,
          width: targetRect.width,
          height: bottomH,
        });
      }
    } else {
      if (rightW > 0.1) {
        this.freeRects.push({
          x: targetRect.x + placedW + this.kerf,
          y: targetRect.y,
          width: rightW,
          height: targetRect.height,
        });
      }
      if (bottomH > 0.1) {
        this.freeRects.push({
          x: targetRect.x,
          y: targetRect.y + placedH + this.kerf,
          width: placedW,
          height: bottomH,
        });
      }
    }

    this.mergeFreeRectangles();
    return placedPiece;
  }

  private mergeFreeRectangles() {
    for (let i = 0; i < this.freeRects.length; i++) {
      for (let j = i + 1; j < this.freeRects.length; j++) {
        const r1 = this.freeRects[i];
        const r2 = this.freeRects[j];

        if (Math.abs(r1.y - r2.y) < 0.01 && Math.abs(r1.height - r2.height) < 0.01) {
          if (Math.abs(r1.x + r1.width + this.kerf - r2.x) < 0.01) {
            r1.width += r2.width + this.kerf;
            this.freeRects.splice(j, 1);
            j--;
          } else if (Math.abs(r2.x + r2.width + this.kerf - r1.x) < 0.01) {
            r1.x = r2.x;
            r1.width += r2.width + this.kerf;
            this.freeRects.splice(j, 1);
            j--;
          }
        } else if (Math.abs(r1.x - r2.x) < 0.01 && Math.abs(r1.width - r2.width) < 0.01) {
          if (Math.abs(r1.y + r1.height + this.kerf - r2.y) < 0.01) {
            r1.height += r2.height + this.kerf;
            this.freeRects.splice(j, 1);
            j--;
          } else if (Math.abs(r2.y + r2.height + this.kerf - r1.y) < 0.01) {
            r1.y = r2.y;
            r1.height += r2.height + this.kerf;
            this.freeRects.splice(j, 1);
            j--;
          }
        }
      }
    }
  }
}

/**
 * Optimisation Guillotine complète avec options avancées (F10, F11, F12)
 */
export function optimizeCutting(
  pieces: Piece[],
  sheet: Sheet,
  options: Partial<OptimizationOptions> = {}
): OptimizationResult {
  const mergedOptions: OptimizationOptions = {
    ...OPTIONS_DEFAULTS,
    ...options,
    kerfWidth: options.kerfWidth !== undefined ? Math.max(0, Math.min(10, options.kerfWidth)) : (sheet.kerf ? sheet.kerf * 10 : 3),
    grainDirection: options.grainDirection !== undefined ? options.grainDirection : (sheet.grainDirection ?? true),
  };

  const kerfCm = mergedOptions.kerfWidth / 10; // conversion mm -> cm
  const margin = sheet.margin || 0;
  const defaultMat: MaterialType = mergedOptions.defaultMaterial || sheet.material || 'mdf';

  const effectiveW = Math.max(10, sheet.width - margin * 2);
  const effectiveH = Math.max(10, sheet.height - margin * 2);

  const expanded = expandPieces(pieces, defaultMat);

  // Groupement par matériau si F12 activé
  const materialGroups: Partial<Record<MaterialType, ExpandedPiece[]>> = mergedOptions.considerMaterial
    ? expanded.reduce((acc, p) => {
        const mat = p.material || defaultMat;
        if (!acc[mat]) acc[mat] = [];
        acc[mat]!.push(p);
        return acc;
      }, {} as Partial<Record<MaterialType, ExpandedPiece[]>>)
    : { [defaultMat]: expanded };

  const allPlaced: PlacedPiece[] = [];
  const unplacedPieces: Piece[] = [];
  const placedSheets: PlacedSheet[] = [];
  let globalPieceIndex = 1;
  let globalSheetIndex = 0;

  for (const [matKey, groupPieces] of Object.entries(materialGroups)) {
    const currentMat = matKey as MaterialType;

    // Tri d'optimisation
    groupPieces.sort((a, b) => {
      const maxA = Math.max(a.width, a.height);
      const maxB = Math.max(b.width, b.height);
      const areaA = a.width * a.height;
      const areaB = b.width * b.height;
      if (maxB !== maxA) return maxB - maxA;
      return areaB - areaA;
    });

    const groupPackers: { packer: GuillotinePacker; sheetIndex: number }[] = [];

    for (const item of groupPieces) {
      let fitted = false;

      // Essayer de placer sur une feuille existante de ce groupe
      for (const { packer, sheetIndex } of groupPackers) {
        const placed = packer.tryFit(item, sheetIndex, globalPieceIndex, mergedOptions.grainDirection);
        if (placed) {
          allPlaced.push({
            ...placed,
            x: placed.x + margin,
            y: placed.y + margin,
          });
          globalPieceIndex++;
          fitted = true;
          break;
        }
      }

      // Si non placé
      if (!fitted) {
        // F11 : Mode 1 feuille uniquement
        if (mergedOptions.singleSheetOnly && groupPackers.length >= 1) {
          unplacedPieces.push(item.piece);
          continue;
        }

        // Création d'une nouvelle feuille
        const newPacker = new GuillotinePacker(effectiveW, effectiveH, kerfCm, currentMat);
        const assignedSheetIdx = globalSheetIndex++;
        groupPackers.push({ packer: newPacker, sheetIndex: assignedSheetIdx });

        const placed = newPacker.tryFit(item, assignedSheetIdx, globalPieceIndex, mergedOptions.grainDirection);
        if (placed) {
          allPlaced.push({
            ...placed,
            x: placed.x + margin,
            y: placed.y + margin,
          });
          globalPieceIndex++;
        } else {
          unplacedPieces.push(item.piece);
        }
      }
    }

    // Calcul stats pour chaque feuille du groupe
    for (const { sheetIndex } of groupPackers) {
      const sheetPieces = allPlaced.filter((p) => p.sheetIndex === sheetIndex);
      const usedArea = sheetPieces.reduce((sum, p) => sum + p.width * p.height, 0);
      const totalArea = sheet.width * sheet.height;
      const wasteRate = Math.max(0, Math.round(((totalArea - usedArea) / totalArea) * 1000) / 10);

      placedSheets.push({
        index: sheetIndex,
        material: currentMat,
        width: sheet.width,
        height: sheet.height,
        pieces: sheetPieces,
        wasteRate,
        usedArea,
      });
    }
  }

  // Tri des feuilles par index
  placedSheets.sort((a, b) => a.index - b.index);

  const sheetsCount = Math.max(1, placedSheets.length);
  const totalAvailable = sheet.width * sheet.height * sheetsCount;
  const totalUsed = allPlaced.reduce((sum, p) => sum + p.width * p.height, 0);
  const waste = Math.max(0, Math.round(((totalAvailable - totalUsed) / totalAvailable) * 1000) / 10);

  // Avertissement Mode 1 feuille (F11)
  let singleSheetWarning: string | undefined;
  if (mergedOptions.singleSheetOnly && unplacedPieces.length > 0) {
    singleSheetWarning = `Mode "1 feuille" activé — ${unplacedPieces.length} pièce${
      unplacedPieces.length > 1 ? 's' : ''
    } n'ont pas pu être placées. Désactivez ce mode pour utiliser plusieurs feuilles.`;
  }

  // Statistiques enrichies par matériau (F12)
  const materialStats: MaterialStat[] = Object.entries(materialGroups).map(([matKey]) => {
    const mat = matKey as MaterialType;
    const matSheets = placedSheets.filter((s) => s.material === mat);
    const matPieces = allPlaced.filter((p) => p.material === mat);
    const matUsedArea = matPieces.reduce((sum, p) => sum + p.width * p.height, 0);
    const matTotalArea = matSheets.length * sheet.width * sheet.height;
    const matWaste = matTotalArea > 0
      ? Math.max(0, Math.round(((matTotalArea - matUsedArea) / matTotalArea) * 1000) / 10)
      : 0;

    return {
      material: mat,
      sheetsUsed: matSheets.length,
      wasteRate: matWaste,
      usedArea: Math.round((matUsedArea / 10000) * 100) / 100, // en m²
      totalPieces: matPieces.length,
    };
  });

  return {
    sheetsUsed: sheetsCount,
    placedPieces: allPlaced,
    unplacedPieces,
    singleSheetWarning,
    wastePercentage: waste,
    totalAreaUsed: Math.round(totalUsed * 10) / 10,
    totalAreaAvailable: totalAvailable,
    cutLines: [],
    sheets: placedSheets,
    materialStats: mergedOptions.considerMaterial ? materialStats : undefined,
  };
}
