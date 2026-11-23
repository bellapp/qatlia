/** How many credit movements the account page shows before "Voir tout". */
export const LEDGER_PREVIEW_COUNT = 5;

/**
 * The movements to render: the latest few until the artisan expands the list,
 * so a long history does not push the sections below it out of sight.
 * Rows arrive newest first from /api/credits/history.
 */
export function ledgerPreview<T>(rows: readonly T[], expanded: boolean): { shown: T[]; hidden: number } {
  if (expanded || rows.length <= LEDGER_PREVIEW_COUNT) return { shown: [...rows], hidden: 0 };
  return { shown: rows.slice(0, LEDGER_PREVIEW_COUNT), hidden: rows.length - LEDGER_PREVIEW_COUNT };
}
