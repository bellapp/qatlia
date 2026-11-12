/**
 * Edge banding read from a scanned cut list.
 *
 * Moroccan cut lists mark the chants in their own column: `|` is one edge
 * along the length (the first dimension, our height), `||` two, `—` one along
 * the width, `=` two, `□` all four. The vision model only reports how many
 * edges run along each dimension (0, 1 or 2). Which side gets them is decided
 * here, because a single stroke never says left or right: one edge along the
 * height goes on the left, one along the width on the top (user decision,
 * 2026-11-12). The artisan can still move it with the edge picker.
 *
 * Anything that is not a clean 0, 1 or 2 counts as no edge. An unreadable
 * mark must never turn into banding the artisan did not ask for.
 *
 * Pure module: no React, no network.
 */

export interface ScannedEdges {
  left?: boolean;
  right?: boolean;
  top?: boolean;
  bottom?: boolean;
}

/** 0, 1 or 2 from a number or a numeric string; anything else is 0. */
export function readEdgeCount(value: unknown): 0 | 1 | 2 {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\s*[0-2]\s*$/.test(value) ? Number(value) : NaN;
  return n === 1 || n === 2 ? n : 0;
}

/**
 * The sides to band for a scanned piece, or undefined when it has none, so
 * a piece without edges keeps the exact shape it had before edges were read.
 */
export function edgesFromCounts(alongHeight: unknown, alongWidth: unknown): ScannedEdges | undefined {
  const height = readEdgeCount(alongHeight);
  const width = readEdgeCount(alongWidth);
  if (height === 0 && width === 0) return undefined;
  return {
    left: height >= 1,
    right: height === 2,
    top: width >= 1,
    bottom: width === 2,
  };
}
