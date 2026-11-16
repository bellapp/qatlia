/**
 * Starting a new job in the atelier empties the piece list. A plan is saved
 * with its pieces when it is optimized, so the list of the plan on screen can
 * be dropped without a question; a list changed since, or never optimized,
 * exists only on screen.
 */

/**
 * True when dropping `pieces` would lose work: the list is not empty and is
 * not the one kept elsewhere (`kept`: the pieces of the saved plan, or the
 * example list the atelier opens with; null when there is neither).
 *
 * Lists are compared by content, not by identity: editing a piece and putting
 * the value back gives a new array that is still the saved one.
 */
export function piecesOnlyOnScreen(pieces: readonly unknown[], kept: readonly unknown[] | null): boolean {
  if (pieces.length === 0) return false;
  if (!kept) return true;
  return JSON.stringify(pieces) !== JSON.stringify(kept);
}
