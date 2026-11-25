/**
 * The « Liste des pièces » sheet of the PDF (a customer's request,
 * 2026-11-25): the artisan's own lines, with how many sides of each measure
 * take a chant. Handed to the client, who checks the sizes, and to the worker
 * at the edge-banding machine.
 *
 * Built from the pieces the plan placed, as the price of the chants is: a
 * piece the plan turned is still the same line, with its own sizes and sides.
 * Sizes in centimetres. Pure module.
 */

export interface ListedPiece {
  width: number;
  height: number;
  rotated: boolean;
  /** The piece's own size. Missing on an older save: `rotated` gives it back. */
  originalWidth?: number;
  originalHeight?: number;
  /** The artisan's line this piece comes from; missing on an older save. */
  originalIndex?: number;
  /** The name as typed, without the plan's "×6". */
  baseName?: string;
  edges?: { top?: boolean; right?: boolean; bottom?: boolean; left?: boolean } | null;
}

export interface PieceListRow {
  number: number;
  name: string;
  height: number;
  width: number;
  quantity: number;
  /** Sides along the height that take a chant (left, right): 0, 1 or 2 strokes under it. */
  edgesHeight: number;
  /** Sides along the width (top, bottom). */
  edgesWidth: number;
}

export interface PieceList {
  rows: PieceListRow[];
  quantity: number;
  edgeMetres: number;
}

const count = (...sides: (boolean | undefined)[]): number => sides.filter((side) => side === true).length;

export function buildPieceList(pieces: readonly ListedPiece[]): PieceList {
  const lines = new Map<string, { order: number; row: PieceListRow }>();

  for (const piece of pieces) {
    const height = piece.originalHeight ?? (piece.rotated ? piece.width : piece.height);
    const width = piece.originalWidth ?? (piece.rotated ? piece.height : piece.width);
    const edgesHeight = count(piece.edges?.left, piece.edges?.right);
    const edgesWidth = count(piece.edges?.top, piece.edges?.bottom);
    const key = [piece.originalIndex ?? '', height.toFixed(3), width.toFixed(3), edgesHeight, edgesWidth].join('|');

    const line = lines.get(key);
    if (line) {
      line.row.quantity += 1;
      continue;
    }
    lines.set(key, {
      order: piece.originalIndex ?? Number.MAX_SAFE_INTEGER,
      row: { number: 0, name: piece.baseName?.trim() ?? '', height, width, quantity: 1, edgesHeight, edgesWidth },
    });
  }

  // Array.sort is stable: without a line number, the plan's own order stays.
  const rows = Array.from(lines.values())
    .sort((a, b) => a.order - b.order)
    .map(({ row }, index) => ({ ...row, number: index + 1 }));

  return {
    rows,
    quantity: rows.reduce((sum, row) => sum + row.quantity, 0),
    edgeMetres: rows.reduce((sum, row) => sum + ((row.height * row.edgesHeight + row.width * row.edgesWidth) * row.quantity) / 100, 0),
  };
}
