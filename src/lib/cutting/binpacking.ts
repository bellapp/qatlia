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

export interface FreeRect {
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

export interface CutLine {
  sheetIndex: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  type: 'vertical' | 'horizontal';
}

export interface OptimizationResult {
  sheetsUsed: number;
  placedPieces: PlacedPiece[];
  wastePercentage: number;
  totalAreaUsed: number;
  totalAreaAvailable: number;
  cutLines: CutLine[];
  sheets: { index: number; width: number; height: number; pieces: PlacedPiece[] }[];
}

function expandPieces(pieces: Piece[]): { piece: Piece; id: string; name: string; width: number; height: number; rotatable: boolean }[] {
  const result: { piece: Piece; id: string; name: string; width: number; height: number; rotatable: boolean }[] = [];
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

function fitPiece(
  item: { piece: Piece; id: string; name: string; width: number; height: number; rotatable: boolean },
  freeRects: FreeRect[],
  sheet: Sheet,
  sheetIndex: number,
  pieceNumber: number
): PlacedPiece | null {
  const kerf = sheet.kerf || 0;
  const canRotate = item.rotatable && !sheet.grainDirection;

  let bestRectIndex = -1;
  let bestRotated = false;
  let bestAreaFit = Number.POSITIVE_INFINITY;
  let bestShortSideFit = Number.POSITIVE_INFINITY;

  for (let i = 0; i < freeRects.length; i++) {
    const r = freeRects[i];

    // Orientation normale
    if (r.width >= item.width && r.height >= item.height) {
      const areaFit = r.width * r.height - item.width * item.height;
      const shortSideFit = Math.min(r.width - item.width, r.height - item.height);
      if (areaFit < bestAreaFit || (areaFit === bestAreaFit && shortSideFit < bestShortSideFit)) {
        bestAreaFit = areaFit;
        bestShortSideFit = shortSideFit;
        bestRectIndex = i;
        bestRotated = false;
      }
    }

    // Orientation tournée
    if (canRotate) {
      if (r.width >= item.height && r.height >= item.width) {
        const areaFit = r.width * r.height - item.height * item.width;
        const shortSideFit = Math.min(r.width - item.height, r.height - item.width);
        if (areaFit < bestAreaFit || (areaFit === bestAreaFit && shortSideFit < bestShortSideFit)) {
          bestAreaFit = areaFit;
          bestShortSideFit = shortSideFit;
          bestRectIndex = i;
          bestRotated = true;
        }
      }
    }
  }

  if (bestRectIndex === -1) return null;

  const targetRect = freeRects[bestRectIndex];
  freeRects.splice(bestRectIndex, 1);

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

  // Guillotine split : 2 nouveaux rectangles
  // Espace restant horizontal & vertical
  const rightW = targetRect.width - (placedW + kerf);
  const bottomH = targetRect.height - (placedH + kerf);

  if (rightW > 0.5) {
    freeRects.push({
      x: targetRect.x + placedW + kerf,
      y: targetRect.y,
      width: rightW,
      height: targetRect.height,
    });
  }

  if (bottomH > 0.5) {
    freeRects.push({
      x: targetRect.x,
      y: targetRect.y + placedH + kerf,
      width: placedW + (rightW <= 0.5 ? rightW : 0),
      height: bottomH,
    });
  }

  return placedPiece;
}

export function optimizeCutting(pieces: Piece[], sheet: Sheet): OptimizationResult {
  const margin = sheet.margin || 0;
  const effectiveSheetWidth = Math.max(10, sheet.width - margin * 2);
  const effectiveSheetHeight = Math.max(10, sheet.height - margin * 2);

  const expanded = expandPieces(pieces);
  // Tri par plus grande dimension puis surface
  expanded.sort((a, b) => {
    const areaA = a.width * a.height;
    const areaB = b.width * b.height;
    return areaB - areaA;
  });

  const sheets: FreeRect[][] = [];
  const placed: PlacedPiece[] = [];
  let pieceNum = 1;

  for (const item of expanded) {
    let fitted = false;
    for (let si = 0; si < sheets.length; si++) {
      const res = fitPiece(item, sheets[si], sheet, si, pieceNum);
      if (res) {
        placed.push({
          ...res,
          x: res.x + margin,
          y: res.y + margin,
        });
        pieceNum++;
        fitted = true;
        break;
      }
    }

    if (!fitted) {
      const newSheetIndex = sheets.length;
      const newSheet: FreeRect[] = [
        { x: 0, y: 0, width: effectiveSheetWidth, height: effectiveSheetHeight },
      ];
      sheets.push(newSheet);
      const res = fitPiece(item, newSheet, sheet, newSheetIndex, pieceNum);
      if (res) {
        placed.push({
          ...res,
          x: res.x + margin,
          y: res.y + margin,
        });
        pieceNum++;
      }
    }
  }

  const sheetsCount = Math.max(1, sheets.length);
  const totalAvailable = sheet.width * sheet.height * sheetsCount;
  const totalUsed = placed.reduce((sum, p) => sum + p.width * p.height, 0);
  const waste = Math.max(0, Math.round(((totalAvailable - totalUsed) / totalAvailable) * 1000) / 10);

  const groupedSheets = Array.from({ length: sheetsCount }, (_, i) => ({
    index: i,
    width: sheet.width,
    height: sheet.height,
    pieces: placed.filter((p) => p.sheetIndex === i),
  }));

  return {
    sheetsUsed: sheetsCount,
    placedPieces: placed,
    wastePercentage: waste,
    totalAreaUsed: Math.round(totalUsed * 10) / 10,
    totalAreaAvailable: totalAvailable,
    cutLines: [],
    sheets: groupedSheets,
  };
}
