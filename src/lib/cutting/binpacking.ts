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
  optimizationPriority: 'min_waste' | 'min_sheets' | 'linear_guillotine' | 'balanced';
  defaultMaterial?: MaterialType;
}

export const OPTIONS_DEFAULTS: OptimizationOptions = {
  kerfWidth: 3,
  showLabels: true,
  singleSheetOnly: false,
  considerMaterial: false,
  edgeBanding: false,
  grainDirection: true,
  optimizationPriority: 'linear_guillotine',
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
  linearCutsCount?: number;
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
  moneySavedMad: number; // Économie estimée en MAD par rapport à une coupe non-optimisée
  totalLinearCutMeters: number; // Linéaire total de passe de scie
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
 * Guillotine Strip Packer : Conçu spécialement pour l'opérateur de scie (Découpes linéaires traversantes de bout en bout)
 */
class LinearGuillotinePacker {
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

  public tryFit(
    item: ExpandedPiece,
    sheetIndex: number,
    pieceNumber: number,
    grainDirection: boolean,
    cutOrientation: 'horizontal_strip' | 'vertical_strip' = 'horizontal_strip'
  ): PlacedPiece | null {
    const canRotate = item.rotatable && !grainDirection;

    let bestRectIndex = -1;
    let bestRotated = false;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let i = 0; i < this.freeRects.length; i++) {
      const r = this.freeRects[i];

      // 1. Essai sans rotation
      if (r.width >= item.width && r.height >= item.height) {
        // En coupe linéaire, on privilégie l'alignement parfait sur la bande
        const stripWaste = cutOrientation === 'horizontal_strip' ? Math.abs(r.height - item.height) : Math.abs(r.width - item.width);
        const score = stripWaste * 1000 + (r.x + r.y);

        if (score < bestScore) {
          bestScore = score;
          bestRectIndex = i;
          bestRotated = false;
        }
      }

      // 2. Essai avec rotation si permise
      if (canRotate) {
        if (r.width >= item.height && r.height >= item.width) {
          const stripWaste = cutOrientation === 'horizontal_strip' ? Math.abs(r.height - item.width) : Math.abs(r.width - item.height);
          const score = stripWaste * 1000 + (r.x + r.y);

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

    // Coupe Guillotine Linéaire Traversante (Passe de scie de bout en bout)
    const rightW = targetRect.width - (placedW + this.kerf);
    const bottomH = targetRect.height - (placedH + this.kerf);

    if (cutOrientation === 'horizontal_strip') {
      // Coupe horizontale principale traversante
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
      // Coupe verticale principale traversante
      if (bottomH > 0.05) {
        this.freeRects.push({
          x: targetRect.x,
          y: targetRect.y + placedH + this.kerf,
          width: placedW,
          height: bottomH,
        });
      }
      if (rightW > 0.05) {
        this.freeRects.push({
          x: targetRect.x + placedW + this.kerf,
          y: targetRect.y,
          width: rightW,
          height: targetRect.height,
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
 * Moteur d'optimisation QatlIA (Efficacité Scieur + Minimum Chutes)
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

  // Stratégies de tri pour bandes linéaires de coupe
  const sortStrategies: Array<(a: ExpandedPiece, b: ExpandedPiece) => number> = [
    // 1. Hauteur commune (Bande de coupe parfaite)
    (a, b) => {
      if (b.height !== a.height) return b.height - a.height;
      return b.width - a.width;
    },
    // 2. Longueur commune
    (a, b) => {
      if (b.width !== a.width) return b.width - a.width;
      return b.height - a.height;
    },
    // 3. Grande dimension d'abord
    (a, b) => {
      const maxA = Math.max(a.width, a.height);
      const maxB = Math.max(b.width, b.height);
      if (maxB !== maxA) return maxB - maxA;
      return (b.width * b.height) - (a.width * a.height);
    },
  ];

  const orientations: Array<'horizontal_strip' | 'vertical_strip'> = ['horizontal_strip', 'vertical_strip'];

  let bestResult: OptimizationResult | null = null;
  let minSheets = Number.POSITIVE_INFINITY;
  let minWaste = Number.POSITIVE_INFINITY;

  for (const sortFn of sortStrategies) {
    for (const orient of orientations) {
      const allPlaced: PlacedPiece[] = [];
      const unplacedPieces: Piece[] = [];
      const placedSheets: PlacedSheet[] = [];
      let globalPieceIndex = 1;
      let globalSheetIndex = 0;

      for (const [matKey, groupPieces] of Object.entries(materialGroups)) {
        const currentMat = matKey as MaterialType;
        const sortedPieces = [...groupPieces].sort(sortFn);
        const groupPackers: { packer: LinearGuillotinePacker; sheetIndex: number }[] = [];

        for (const item of sortedPieces) {
          let fitted = false;

          for (const { packer, sheetIndex } of groupPackers) {
            const placed = packer.tryFit(item, sheetIndex, globalPieceIndex, mergedOptions.grainDirection, orient);
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

            const newPacker = new LinearGuillotinePacker(effectiveW, effectiveH, kerfCm, currentMat);
            const assignedSheetIdx = globalSheetIndex++;
            groupPackers.push({ packer: newPacker, sheetIndex: assignedSheetIdx });

            const placed = newPacker.tryFit(item, assignedSheetIdx, globalPieceIndex, mergedOptions.grainDirection, orient);
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

      // Calcul du linéaire de passe de coupe pour l'opérateur (en mètres)
      const linearCutMeters = allPlaced.reduce((sum, p) => sum + (p.width + p.height) / 100, 0) * 1.1;

      // Économie en MAD : calculée sur la base d'un panneau moyen à 450 MAD économisé
      const baselineSheets = Math.ceil(totalUsed / (sheet.width * sheet.height * 0.65)); // méthode artisanale sans algo (65% rendement)
      const sheetsSaved = Math.max(0, baselineSheets - currentSheetsUsed);
      const moneySavedMad = sheetsSaved * 450 + (allPlaced.length * 5); // 450 MAD/panneau + temps de coupe

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
          moneySavedMad,
          totalLinearCutMeters: Math.round(linearCutMeters * 10) / 10,
          sheets: placedSheets,
          materialStats: mergedOptions.considerMaterial ? materialStats : undefined,
        };
      }
    }
  }

  return bestResult!;
}
