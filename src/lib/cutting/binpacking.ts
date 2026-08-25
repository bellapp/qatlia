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
  width: number; // ex: 278 cm ou 2780 mm
  height: number; // ex: 208 cm ou 2080 mm
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
  grainDirection: false,
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

export interface OffcutWaste {
  x: number;
  y: number;
  width: number;
  height: number;
  sheetIndex: number;
  areaM2: number;
  isReusable: boolean; // chutes exploitables (ex: > 30x30 cm)
}

export interface PlacedSheet {
  index: number;
  material: MaterialType;
  width: number;
  height: number;
  pieces: PlacedPiece[];
  offcuts: OffcutWaste[];
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
  offcuts: OffcutWaste[];
  singleSheetWarning?: string;
  wastePercentage: number;
  totalAreaUsed: number;
  totalAreaAvailable: number;
  moneySavedMad: number;
  totalLinearCutMeters: number;
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
        width: Number(p.width),
        height: Number(p.height),
        material: p.material || defaultMaterial,
        rotatable: p.rotatable !== false,
      });
      index++;
    }
  }
  return result;
}

/**
 * Guillotine Strip Packer avec découpage en bandes/colonnes continues et calcul exact des chutes résiduelles
 */
class IndustrialGuillotinePacker {
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
    cutAxis: 'vertical_strips' | 'horizontal_strips' = 'vertical_strips'
  ): PlacedPiece | null {
    const canRotate = item.rotatable && !grainDirection;

    let bestRectIndex = -1;
    let bestRotated = false;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let i = 0; i < this.freeRects.length; i++) {
      const r = this.freeRects[i];

      const fitsNormal = r.width >= item.width && r.height >= item.height;
      const fitsRotated = canRotate && r.width >= item.height && r.height >= item.width;

      if (fitsNormal) {
        // En découpe industrielle (bandes verticales), aligner sur la dimension de bande
        const stripWaste = cutAxis === 'vertical_strips' ? (r.width - item.width) : (r.height - item.height);
        const score = stripWaste * 1000 + (r.x + r.y);

        if (score < bestScore) {
          bestScore = score;
          bestRectIndex = i;
          bestRotated = false;
        }
      }

      if (fitsRotated) {
        const stripWaste = cutAxis === 'vertical_strips' ? (r.width - item.height) : (r.height - item.width);
        const score = stripWaste * 1000 + (r.x + r.y);

        if (score < bestScore) {
          bestScore = score;
          bestRectIndex = i;
          bestRotated = true;
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

    // Découpe Guillotine Industrielle (Bandes continues traversantes)
    const rightW = targetRect.width - (placedW + this.kerf);
    const bottomH = targetRect.height - (placedH + this.kerf);

    if (cutAxis === 'vertical_strips') {
      // 1ère coupe de passe traversante verticale : crée la bande de colonne
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
    } else {
      // 1ère coupe de passe traversante horizontale
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
 * Moteur d'optimisation QatlIA Pro
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
    grainDirection: options.grainDirection !== undefined ? options.grainDirection : (sheet.grainDirection ?? false),
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

  // Stratégies de tri pour alignement en colonnes / bandes de coupe identiques
  const sortStrategies: Array<(a: ExpandedPiece, b: ExpandedPiece) => number> = [
    // 1. Tri par largeur commune, puis par longueur décroissante (colonnes parfaites)
    (a, b) => {
      const wA = Math.min(a.width, a.height);
      const wB = Math.min(b.width, b.height);
      if (Math.abs(wB - wA) > 0.5) return wB - wA;
      return (b.width * b.height) - (a.width * a.height);
    },
    // 2. Surface pure décroissante
    (a, b) => (b.width * b.height) - (a.width * a.height),
    // 3. Plus grande dimension en premier
    (a, b) => {
      const maxA = Math.max(a.width, a.height);
      const maxB = Math.max(b.width, b.height);
      if (maxB !== maxA) return maxB - maxA;
      return (b.width * b.height) - (a.width * a.height);
    },
  ];

  const cutAxes: Array<'vertical_strips' | 'horizontal_strips'> = ['vertical_strips', 'horizontal_strips'];

  let bestResult: OptimizationResult | null = null;
  let minUnplaced = Number.POSITIVE_INFINITY;
  let minSheets = Number.POSITIVE_INFINITY;
  let minWaste = Number.POSITIVE_INFINITY;

  for (const sortFn of sortStrategies) {
    for (const cutAxis of cutAxes) {
      const allPlaced: PlacedPiece[] = [];
      const unplacedPieces: Piece[] = [];
      const placedSheets: PlacedSheet[] = [];
      const allOffcuts: OffcutWaste[] = [];
      let globalPieceIndex = 1;
      let globalSheetIndex = 0;

      for (const [matKey, groupPieces] of Object.entries(materialGroups)) {
        const currentMat = matKey as MaterialType;
        const sortedPieces = [...groupPieces].sort(sortFn);
        const groupPackers: { packer: IndustrialGuillotinePacker; sheetIndex: number }[] = [];

        for (const item of sortedPieces) {
          let fitted = false;

          for (const { packer, sheetIndex } of groupPackers) {
            const placed = packer.tryFit(item, sheetIndex, globalPieceIndex, mergedOptions.grainDirection, cutAxis);
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

            const newPacker = new IndustrialGuillotinePacker(effectiveW, effectiveH, kerfCm, currentMat);
            const assignedSheetIdx = globalSheetIndex++;

            const placed = newPacker.tryFit(item, assignedSheetIdx, globalPieceIndex, mergedOptions.grainDirection, cutAxis);
            if (placed) {
              groupPackers.push({ packer: newPacker, sheetIndex: assignedSheetIdx });
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

        for (const { sheetIndex, packer } of groupPackers) {
          const sheetPieces = allPlaced.filter((p) => p.sheetIndex === sheetIndex);
          if (sheetPieces.length === 0) continue;

          // Calcul des chutes résiduelles réelles (offcuts)
          const sheetOffcuts: OffcutWaste[] = packer.freeRects
            .filter((r) => r.width >= 5 && r.height >= 5) // ignorer poussière < 5cm
            .map((r) => {
              const area = (r.width * r.height) / 10000;
              return {
                x: r.x + margin,
                y: r.y + margin,
                width: Math.round(r.width * 10) / 10,
                height: Math.round(r.height * 10) / 10,
                sheetIndex,
                areaM2: Math.round(area * 1000) / 1000,
                isReusable: r.width >= 30 && r.height >= 30, // chute réutilisable si > 30x30 cm
              };
            });

          allOffcuts.push(...sheetOffcuts);

          const usedArea = sheetPieces.reduce((sum, p) => sum + p.width * p.height, 0);
          const totalArea = sheet.width * sheet.height;
          const wasteRate = Math.max(0, Math.round(((totalArea - usedArea) / totalArea) * 1000) / 10);

          placedSheets.push({
            index: sheetIndex,
            material: currentMat,
            width: sheet.width,
            height: sheet.height,
            pieces: sheetPieces,
            offcuts: sheetOffcuts,
            wasteRate,
            usedArea,
          });
        }
      }

      placedSheets.forEach((s, idx) => {
        const oldIdx = s.index;
        s.index = idx;
        allPlaced.filter((p) => p.sheetIndex === oldIdx).forEach((p) => (p.sheetIndex = idx));
        allOffcuts.filter((o) => o.sheetIndex === oldIdx).forEach((o) => (o.sheetIndex = idx));
      });

      const currentSheetsUsed = placedSheets.length;
      const totalAvailable = sheet.width * sheet.height * currentSheetsUsed;
      const totalUsed = allPlaced.reduce((sum, p) => sum + p.width * p.height, 0);
      const currentWaste = totalAvailable > 0 ? Math.max(0, Math.round(((totalAvailable - totalUsed) / totalAvailable) * 1000) / 10) : 0;

      const linearCutMeters = allPlaced.reduce((sum, p) => sum + (p.width + p.height) / 100, 0) * 1.1;
      const baselineSheets = Math.ceil(totalUsed / (sheet.width * sheet.height * 0.65 || 1));
      const sheetsSaved = Math.max(0, baselineSheets - currentSheetsUsed);
      const moneySavedMad = sheetsSaved * 450 + (allPlaced.length * 5);

      if (
        bestResult === null ||
        unplacedPieces.length < minUnplaced ||
        (unplacedPieces.length === minUnplaced && currentSheetsUsed < minSheets) ||
        (unplacedPieces.length === minUnplaced && currentSheetsUsed === minSheets && currentWaste < minWaste)
      ) {
        minUnplaced = unplacedPieces.length;
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
          offcuts: allOffcuts,
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
