/**
 * Sorting the back office tables that are already loaded (spec 2026-11-25):
 * a click on a header sorts, a second one reverses.
 *
 * Pure module: safe to import from a client component or a plain Node test.
 */

export type SortValue = string | number | null;
export type SortDir = 'asc' | 'desc';

const COLLATOR = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });

/** Orders two cell values; an empty value (null, NaN, '') always goes last, whichever the direction. */
export function compareSortValues(a: SortValue, b: SortValue, dir: SortDir): number {
  const emptyA = a === null || a === '' || (typeof a === 'number' && Number.isNaN(a));
  const emptyB = b === null || b === '' || (typeof b === 'number' && Number.isNaN(b));
  if (emptyA || emptyB) return emptyA === emptyB ? 0 : emptyA ? 1 : -1;
  const order = typeof a === 'number' && typeof b === 'number' ? a - b : COLLATOR.compare(String(a), String(b));
  return dir === 'asc' ? order : -order;
}

/** The rows sorted on column `col`, stable: equal values keep their order. */
export function sortRows<T extends { sort: SortValue[] }>(rows: readonly T[], col: number, dir: SortDir): T[] {
  return rows
    .map((row, position) => ({ row, position }))
    .sort((a, b) => compareSortValues(a.row.sort[col] ?? null, b.row.sort[col] ?? null, dir) || a.position - b.position)
    .map(({ row }) => row);
}
