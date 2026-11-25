/**
 * Where the chants (edge banding) of a placed piece are drawn on the plan:
 * blue dashes just inside the piece, along the sides to band (owner request,
 * 2026-11-25). One place for the atelier's plan, the PDF and the WhatsApp
 * picture, so the three can never disagree on a side.
 *
 * The flags are the piece's own sides (see PlacedPiece.edges). A piece the
 * plan turned, or one swapped for its grain, turns its chants with it.
 *
 * Everything is in centimetres on the panel. Pure module.
 */

export interface PlacedEdges {
  x: number;
  y: number;
  width: number;
  height: number;
  rotated: boolean;
  /** The piece's own size. Missing on an older save: `rotated` then decides alone. */
  originalWidth?: number;
  originalHeight?: number;
  edges?: { top?: boolean; right?: boolean; bottom?: boolean; left?: boolean } | null;
}

export interface EdgeSides {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

export interface EdgeLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export const EDGE_COLOR = '#1D4ED8';
/** Under the dashes, so the blue reads on a colored piece, a blue one included. */
export const EDGE_HALO = '#FFFFFF';
export const EDGE_STROKE_CM = 0.7;
export const EDGE_HALO_CM = 1.2;
export const EDGE_DASH_CM: readonly [number, number] = [2.4, 1.6];

/** How far inside the piece the line runs; less in a narrow strip. */
const INSET_CM = 1;
/** The PDF's pieces have a thick black border: the line keeps clear of it. */
export const EDGE_INSET_PDF_CM = 1.5;
const INSET_SHARE = 0.12;
const SAME_CM = 0.01;

/**
 * Whether the piece lies on its side. The sizes say it better than `rotated`:
 * a piece with a horizontal grain is swapped before packing, with no flag.
 * A square says nothing, so the flag decides.
 */
function isTurned(piece: PlacedEdges): boolean {
  const { originalWidth: w, originalHeight: h } = piece;
  if (typeof w !== 'number' || typeof h !== 'number' || Math.abs(w - h) < SAME_CM) return piece.rotated;
  return Math.abs(piece.width - h) < SAME_CM && Math.abs(piece.height - w) < SAME_CM;
}

/** The sides to band as they lie on the plan. A turned piece is a quarter turn clockwise. */
export function edgeSidesOnPlan(piece: PlacedEdges): EdgeSides {
  const own = {
    top: piece.edges?.top === true,
    right: piece.edges?.right === true,
    bottom: piece.edges?.bottom === true,
    left: piece.edges?.left === true,
  };
  if (!isTurned(piece)) return own;
  return { top: own.left, right: own.top, bottom: own.right, left: own.bottom };
}

/** One line per side to band, inside the piece. */
export function edgeLines(piece: PlacedEdges, insetCm: number = INSET_CM): EdgeLine[] {
  const sides = edgeSidesOnPlan(piece);
  const inset = Math.min(insetCm, Math.min(piece.width, piece.height) * INSET_SHARE);
  const left = piece.x + inset;
  const right = piece.x + piece.width - inset;
  const top = piece.y + inset;
  const bottom = piece.y + piece.height - inset;
  const lines: EdgeLine[] = [];
  if (sides.top) lines.push({ x1: left, y1: top, x2: right, y2: top });
  if (sides.right) lines.push({ x1: right, y1: top, x2: right, y2: bottom });
  if (sides.bottom) lines.push({ x1: left, y1: bottom, x2: right, y2: bottom });
  if (sides.left) lines.push({ x1: left, y1: top, x2: left, y2: bottom });
  return lines;
}

/** At least one chant to draw: the legend shows. */
export function hasEdgeLines(pieces: readonly PlacedEdges[]): boolean {
  return pieces.some((piece) => edgeLines(piece).length > 0);
}
