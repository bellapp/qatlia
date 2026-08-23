export type MaterialType = 'mdf' | 'aluminium' | 'verre' | 'contreplaques';

export interface Piece {
  id?: string;
  name?: string;
  width: number; // en cm ou mm
  height: number;
  quantity: number;
  material?: MaterialType | null;
  rotatable?: boolean;
}

export interface Sheet {
  width: number;
  height: number;
  kerf: number;
  margin?: number;
  grainDirection?: boolean;
  material?: MaterialType;
}

export interface OptimizationOptions {
  kerfWidth: number; // mm
  showLabels: boolean;
  singleSheetOnly: boolean;
  considerMaterial: boolean;
  edgeBanding: boolean;
  grainDirection: boolean;
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
  wasteRate: number;
  usedArea: number;
}

export interface MaterialStat {
  material: MaterialType;
  sheetsUsed: number;
  wasteRate: number;
  usedArea: number;
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
 * Guillotine Packer Multi-Heuristiques (ShortSideFit + LongSideFit + BestAreaFit + Guillotine Split optimal)
 */
class GuillotinePacker {
  private sheetW: number;
  private sheetH: number;
  private kerf: number;
  private material: MaterialType;
  public freeRects: Rect[] = [];
  public placed: PlacedPiece[] = [];

  constructor(sheetW: number, sheetH: number, kerf: number, material: MaterialType) {
    this.sheetW = sheetW;
    this.sheetH = sheetH;
    this.kerf = kerf;
    this.material = material;
    this.freeRects = [{ x: 0, y: 0, width: sheetW, height: sheetH }];
  }

  public clone(): GuillotinePacker {
    const copy = new GuillotinePacker(this.sheetW, this.sheetH, this.kerf, this.material);
    copy.freeRects = this.freeRects.map((r) => ({ ...r }));
    copy.placed = this.placed.map((p) => ({ ...p }));
    return copy;
  }

  public tryFit(
    item: ExpandedPiece,
    sheetIndex: number,
    pieceNumber: number,
    grainDirection: boolean,
    splitRule: 'shorter_axis' | 'longer_axis' | 'guillotine_strip' = 'shorter_axis'
  ): PlacedPiece | null {
    const canRotate = item.rotatable && !grainDirection;

    let bestRectIndex = -1;
    let bestRotated = false;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let i = 0; i < this.freeRects.length; i++) {
      const r = this.freeRects[i];

      // Test sans rotation
      if (r.width >= item.width && r.height >= item.height) {
        const leftoverW = r.width - item.width;
        const leftoverH = r.height - item.height;
        const score = Math.min(leftoverW, leftoverH) * 10000 + Math.max(leftoverW, leftoverH);

        if (score < bestScore) {
          bestScore = score;
          bestRectIndex = i;
          bestRotated = false;
        }
      }

      // Test avec rotation (si permise)
      if (canRotate) {
        if (r.width >= item.height && r.height >= item.width) {
          const leftoverW = r.width - item.height;
          const leftoverH = r.height - item.width;
          const score = Math.min(leftoverW, leftoverH) * 10000 + Math.max(leftoverW, leftoverH);

          if (score < bestScore) {
            bestScore = score;
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

    const splitShorter = splitRule === 'shorter_axis' ? (placedW <= placedH) : (placedW >= placedH);

    if (splitShorter) {
      if (rightW > 0.05) {
        this.freeRects.push({
          x: targetRect.x + placedW + this.kerf,
          y: targetRect.y,
          width: rightW,
          height: placedH,
        });
      }
      if (bottomH > 0.05) {
        this.freeRects.push({
          x: targetRect.x,
          y: targetRect.y + placedH + this.kerf,
          width: targetRect.width,
          height: bottomH,
        });
      }
    } else {
      if (rightW > 0.05) {
        this.freeRects.push({
          x: targetRect.x + placedW + this.kerf,
          y: targetRect.y,
          width: rightW,
          height: targetRect.height,
        });
      }
      if (bottomH > 0.05) {
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
 * Optimisation Multi-Pass (Test de plusieurs stratégies de tri & guillotine split pour égaler OptiCoupe)
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

  const kerfCm = mergedOptions.kerfWidth / 10;
  const margin = sheet.margin || 0;
  const defaultMat: MaterialType = mergedOptions.defaultMaterial || sheet.material || 'mdf';

  const effectiveW = Math.max(10, sheet.width - margin * 2);
  const effectiveH = Math.max(10, sheet.height - margin * 2);

  const expanded = expandPieces(pieces, defaultMat);

  const materialGroups: Partial<Record<MaterialType, ExpandedPiece[]>> = mergedOptions.considerMaterial
    ? expanded.reduce((acc, p) => {
        const mat = p.material || defaultMat;
        if (!acc[mat]) acc[mat] = [];
        acc[mat]!.push(p);
        return acc;
      }, {} as Partial<Record<MaterialType, ExpandedPiece[]>>)
    : { [defaultMat]: expanded };

  // Définition des stratégies de tri
  const sortStrategies: Array<(a: ExpandedPiece, b: ExpandedPiece) => number> = [
    // Stratégie 1: Largeur max puis longueur (Strips)
    (a, b) => {
      const maxA = Math.max(a.width, a.height);
      const maxB = Math.max(b.width, b.height);
      if (maxB !== maxA) return maxB - maxA;
      return (b.width * b.height) - (a.width * a.height);
    },
    // Stratégie 2: Surface décroissante (BAF)
    (a, b) => (b.width * b.height) - (a.width * a.height),
    // Stratégie 3: Longueur pure (Longest Side First)
    (a, b) => Math.max(b.width, b.height) - Math.max(a.width, a.height),
    // Stratégie 4: Rapport d'aspect / Strip alignment
    (a, b) => {
      if (b.height !== a.height) return b.height - a.height;
      return b.width - a.width;
    }
  ];

  const splitRules: Array<'shorter_axis' | 'longer_axis'> = ['shorter_axis', 'longer_axis'];

  let bestResult: OptimizationResult | null = null;
  let minSheets = Number.POSITIVE_INFINITY;
  let minWaste = Number.POSITIVE_INFINITY;

  // Multi-pass simulation pour trouver la meilleure découpe
  for (const sortFn of sortStrategies) {
    for (const splitRule of splitRules) {
      const allPlaced: PlacedPiece[] = [];
      const unplacedPieces: Piece[] = [];
      const placedSheets: PlacedSheet[] = [];
      let globalPieceIndex = 1;
      let globalSheetIndex = 0;

      for (const [matKey, groupPieces] of Object.entries(materialGroups)) {
        const currentMat = matKey as MaterialType;
        const sortedPieces = [...groupPieces].sort(sortFn);
        const groupPackers: { packer: GuillotinePacker; sheetIndex: number }[] = [];

        for (const item of sortedPieces) {
          let fitted = false;

          for (const { packer, sheetIndex } of groupPackers) {
            const placed = packer.tryFit(item, sheetIndex, globalPieceIndex, mergedOptions.grainDirection, splitRule);
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

          if (!fitted) {
            if (mergedOptions.singleSheetOnly && groupPackers.length >= 1) {
              unplacedPieces.push(item.piece);
              continue;
            }

            const newPacker = new GuillotinePacker(effectiveW, effectiveH, kerfCm, currentMat);
            const assignedSheetIdx = globalSheetIndex++;
            groupPackers.push({ packer: newPacker, sheetIndex: assignedSheetIdx });

            const placed = newPacker.tryFit(item, assignedSheetIdx, globalPieceIndex, mergedOptions.grainDirection, splitRule);
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

      const currentSheetsUsed = placedSheets.length;
      const totalAvailable = sheet.width * sheet.height * currentSheetsUsed;
      const totalUsed = allPlaced.reduce((sum, p) => sum + p.width * p.height, 0);
      const currentWaste = Math.max(0, Math.round(((totalAvailable - totalUsed) / totalAvailable) * 1000) / 10);

      // Si c'est le meilleur résultat trouvé
      if (
        bestResult === null ||
        unplacedPieces.length < bestResult.unplacedPieces.length ||
        (unplacedPieces.length === bestResult.unplacedPieces.length && currentSheetsUsed < minSheets) ||
        (currentSheetsUsed === minSheets && currentWaste < minWaste)
      ) {
        minSheets = currentSheetsUsed;
        minWaste = currentWaste;

        let singleSheetWarning: string | undefined;
        if (mergedOptions.singleSheetOnly && unplacedPieces.length > 0) {
          singleSheetWarning = `Mode "1 feuille" activé — ${unplacedPieces.length} pièce${
            unplacedPieces.length > 1 ? 's' : ''
          } n'ont pas pu être placées.`;
        }

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
            usedArea: Math.round((matUsedArea / 10000) * 100) / 100,
            totalPieces: matPieces.length,
          };
        });

        bestResult = {
          sheetsUsed: currentSheetsUsed,
          placedPieces: allPlaced,
          unplacedPieces,
          singleSheetWarning,
          wastePercentage: currentWaste,
          totalAreaUsed: Math.round(totalUsed * 10) / 10,
          totalAreaAvailable: totalAvailable,
          cutLines: [],
          sheets: placedSheets,
          materialStats: mergedOptions.considerMaterial ? materialStats : undefined,
        };
      }
    }
  }

  return bestResult!;
}
