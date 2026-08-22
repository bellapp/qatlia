export interface Piece {
  id?: string;
  name?: string;
  width: number; // en cm
  height: number; // en cm
  quantity: number;
  material?: string;
  rotatable?: boolean;
}

export interface Sheet {
  width: number; // ex: 280 cm (longueur)
  height: number; // ex: 207 cm (largeur)
  kerf: number; // épaisseur trait de scie (ex: 0.4 cm = 4mm)
  margin?: number; // marge périphérique (ex: 1.0 cm)
  grainDirection?: boolean; // si vrai, aucune rotation autorisée
}

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
  x: number;
  y: number;
  width: number;
  height: number;
  rotated: boolean;
  pieceNumber: number;
}

export interface OptimizationResult {
  sheetsUsed: number;
  placedPieces: PlacedPiece[];
  wastePercentage: number;
  totalAreaUsed: number;
  totalAreaAvailable: number;
  cutLines: Array<{ sheetIndex: number; x1: number; y1: number; x2: number; y2: number; type: 'vertical' | 'horizontal' }>;
  sheets: { index: number; width: number; height: number; pieces: PlacedPiece[] }[];
}

interface ExpandedPiece {
  piece: Piece;
  id: string;
  name: string;
  width: number;
  height: number;
  rotatable: boolean;
}

function expandPieces(pieces: Piece[]): ExpandedPiece[] {
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
        rotatable: p.rotatable !== false,
      });
      index++;
    }
  }
  return result;
}

/**
 * Moteur 2D Guillotine MAXRECTS avec détection et fusion de chutes
 * Optimisation maximale du taux de remplissage pour panneaux (MDF, Bois, Alu, Verre)
 */
class GuillotinePacker {
  private sheetW: number;
  private sheetH: number;
  private kerf: number;
  private freeRects: Rect[] = [];
  public placed: PlacedPiece[] = [];

  constructor(sheetW: number, sheetH: number, kerf: number) {
    this.sheetW = sheetW;
    this.sheetH = sheetH;
    this.kerf = kerf;
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
      x: targetRect.x,
      y: targetRect.y,
      width: placedW,
      height: placedH,
      rotated: bestRotated,
      pieceNumber,
    };

    this.placed.push(placedPiece);

    // Guillotine Cut : découpage optimal de l'espace restant
    const rightW = targetRect.width - (placedW + this.kerf);
    const bottomH = targetRect.height - (placedH + this.kerf);

    // Heuristique de découpe : couper le long du bord le plus long (Shorter Axis Split)
    if (placedW <= placedH) {
      // Split horizontal en premier
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
      // Split vertical en premier
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

  // Fusion des rectangles libres adjacents pour maximiser les grands espaces de coupe
  private mergeFreeRectangles() {
    for (let i = 0; i < this.freeRects.length; i++) {
      for (let j = i + 1; j < this.freeRects.length; j++) {
        const r1 = this.freeRects[i];
        const r2 = this.freeRects[j];

        // Fusion horizontale si même Y et même hauteur
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
        }
        // Fusion verticale si même X et même largeur
        else if (Math.abs(r1.x - r2.x) < 0.01 && Math.abs(r1.width - r2.width) < 0.01) {
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

export function optimizeCutting(pieces: Piece[], sheet: Sheet): OptimizationResult {
  const margin = sheet.margin || 0;
  const kerf = sheet.kerf || 0.4;
  const grainDirection = sheet.grainDirection ?? true;

  const effectiveW = Math.max(10, sheet.width - margin * 2);
  const effectiveH = Math.max(10, sheet.height - margin * 2);

  const expanded = expandPieces(pieces);

  // Tri d'optimisation multi-stratégie :
  // 1. Surface décroissante
  // 2. Plus grande dimension en premier pour bloquer les découpes primaires
  expanded.sort((a, b) => {
    const maxA = Math.max(a.width, a.height);
    const maxB = Math.max(b.width, b.height);
    const areaA = a.width * a.height;
    const areaB = b.width * b.height;

    if (maxB !== maxA) return maxB - maxA;
    return areaB - areaA;
  });

  const packers: GuillotinePacker[] = [];
  const allPlaced: PlacedPiece[] = [];
  let pieceIndex = 1;

  for (const item of expanded) {
    let fitted = false;

    // Essayer de remplir les feuilles existantes au maximum (Best Fit)
    for (let i = 0; i < packers.length; i++) {
      const placed = packers[i].tryFit(item, i, pieceIndex, grainDirection);
      if (placed) {
        allPlaced.push({
          ...placed,
          x: placed.x + margin,
          y: placed.y + margin,
        });
        pieceIndex++;
        fitted = true;
        break;
      }
    }

    // Si aucune feuille existante ne peut accueillir la pièce, en créer une nouvelle
    if (!fitted) {
      const newPacker = new GuillotinePacker(effectiveW, effectiveH, kerf);
      const newSheetIndex = packers.length;
      packers.push(newPacker);

      const placed = newPacker.tryFit(item, newSheetIndex, pieceIndex, grainDirection);
      if (placed) {
        allPlaced.push({
          ...placed,
          x: placed.x + margin,
          y: placed.y + margin,
        });
        pieceIndex++;
      }
    }
  }

  const sheetsCount = Math.max(1, packers.length);
  const totalAvailable = sheet.width * sheet.height * sheetsCount;
  const totalUsed = allPlaced.reduce((sum, p) => sum + p.width * p.height, 0);
  const waste = Math.max(0, Math.round(((totalAvailable - totalUsed) / totalAvailable) * 1000) / 10);

  const groupedSheets = Array.from({ length: sheetsCount }, (_, i) => ({
    index: i,
    width: sheet.width,
    height: sheet.height,
    pieces: allPlaced.filter((p) => p.sheetIndex === i),
  }));

  return {
    sheetsUsed: sheetsCount,
    placedPieces: allPlaced,
    wastePercentage: waste,
    totalAreaUsed: Math.round(totalUsed * 10) / 10,
    totalAreaAvailable: totalAvailable,
    cutLines: [],
    sheets: groupedSheets,
  };
}
