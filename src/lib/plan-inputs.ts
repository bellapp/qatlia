/**
 * Whether the plan on screen is still the plan of the pieces on screen, and
 * when the second button that computes it shows (owner request, 2026-11-25).
 * Pure module.
 */

import type { OptimizationOptions, Piece, Sheet } from '@/lib/cutting/binpacking';

export interface PlanInputs {
  pieces: readonly Piece[];
  sheets: readonly Sheet[];
  options: OptimizationOptions;
  cutMode: '2d' | '1d';
}

/** Two 32-bit halves: enough to tell two job states apart, short enough to keep in a draft. */
function digest(text: string): string {
  let a = 0xdeadbeef;
  let b = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 2654435761);
    b = Math.imul(b ^ code, 1597334677);
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  return (b >>> 0).toString(36) + (a >>> 0).toString(36);
}

/**
 * What a plan is computed from. Left out: what is only shown (ids, colors,
 * panel names, labels) and the prices, which are applied to the plan on screen
 * without a new run. The order of the rows does not count.
 */
export function planInputsKey({ pieces, sheets, options, cutMode }: PlanInputs): string {
  const pieceKeys = pieces.map((p) => {
    const e = p.edges ?? {};
    return JSON.stringify([
      p.name ?? '', p.height, p.width, p.quantity, p.material ?? '', p.rotatable !== false, !!p.grainDirection,
      p.grain ?? 'none', !!e.left, !!e.right, !!e.top, !!e.bottom, p.preCut?.height ?? 0, p.preCut?.width ?? 0,
    ]);
  });
  const sheetKeys = sheets.map((s) => [
    s.height, s.width, s.margin ?? 0, s.material ?? '', s.quantity ?? 1, !!s.hasGrain, s.hasGrain ? s.grainOrientation ?? '' : '',
  ]);
  const optionKey = [
    options.kerfWidth, !!options.singleSheetOnly, !!options.considerMaterial, !!options.edgeBanding, !!options.grainDirection,
    options.optimizationPriority, options.minReusableOffcutWidth ?? null, options.minReusableOffcutHeight ?? null,
    options.laborPricing ?? null,
  ];
  return digest(JSON.stringify([pieceKeys.sort(), sheetKeys, optionKey, cutMode]));
}

export interface PlanShortcutState {
  hasPieces: boolean;
  /** The list is still the example the atelier opens with. */
  sampleOnly: boolean;
  hasPlan: boolean;
  /** The plan on screen is not the plan of the pieces on screen. */
  stale: boolean;
  /** The main button is on the screen. */
  mainVisible: boolean;
  /** A cut list is being read. */
  reading: boolean;
  /** A field has the focus: on a phone the keyboard is open. */
  typing: boolean;
}

/** Where the second button shows: the header (computer) and the bar at the bottom (phone). */
export function planShortcut(state: PlanShortcutState): { header: boolean; bar: boolean } {
  const header = state.hasPieces && !state.mainVisible && !state.reading;
  // The bar sits over the page: only when there is something to compute.
  const useful = state.hasPlan ? state.stale : !state.sampleOnly;
  return { header, bar: header && useful && !state.typing };
}
