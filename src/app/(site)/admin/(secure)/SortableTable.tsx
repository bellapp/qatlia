'use client';

/**
 * A back office table whose rows are all loaded: a click on a header sorts on
 * that column, a second click reverses it. The cells are rendered by the
 * server page; only the plain `sort` values travel to decide the order.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { sortRows, type SortDir, type SortValue } from '@/lib/admin/sort';
import { th, td } from './ui';

export interface SortableColumn {
  label: string;
  align?: 'end';
  /** False for a column that makes no sense to sort (a note, a key). */
  sortable?: boolean;
  /** Direction of a first click: 'desc' suits dates and counts. */
  firstDir?: SortDir;
}

export interface SortableRow {
  key: string;
  cells: ReactNode[];
  sort: SortValue[];
}

export function SortableTable({
  columns,
  rows,
  initial,
  empty,
  minWidth = 640,
  stickyHead = false,
}: {
  columns: SortableColumn[];
  rows: SortableRow[];
  initial?: { col: number; dir: SortDir };
  empty: ReactNode;
  minWidth?: number;
  stickyHead?: boolean;
}) {
  const [state, setState] = useState<{ col: number; dir: SortDir } | null>(initial ?? null);
  const sorted = useMemo(() => (state ? sortRows(rows, state.col, state.dir) : rows), [rows, state]);

  const onHeader = (col: number) => {
    setState((current) =>
      current && current.col === col
        ? { col, dir: current.dir === 'asc' ? 'desc' : 'asc' }
        : { col, dir: columns[col]?.firstDir ?? 'desc' }
    );
  };

  return (
    <table className="w-full" style={{ minWidth }}>
      <thead className={stickyHead ? 'sticky top-0 bg-[#0B1220]' : undefined}>
        <tr>
          {columns.map((column, index) => {
            const active = state?.col === index;
            const align = column.align === 'end' ? 'text-end' : '';
            if (column.sortable === false) {
              return (
                <th key={column.label} className={`${th} ${align}`}>
                  {column.label}
                </th>
              );
            }
            return (
              <th key={column.label} className={`${th} ${align}`} aria-sort={active ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <button
                  type="button"
                  onClick={() => onHeader(index)}
                  className={`inline-flex items-center gap-1 uppercase tracking-widest hover:text-slate-200 ${active ? 'text-amber-400' : ''}`}
                >
                  {column.label}
                  <span aria-hidden="true">{active ? (state.dir === 'asc' ? '↑' : '↓') : '↕'}</span>
                </button>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody className="divide-y divide-white/5">
        {sorted.length === 0 ? (
          <tr>
            <td colSpan={columns.length} className="py-6 text-center text-xs text-slate-500">
              {empty}
            </td>
          </tr>
        ) : (
          sorted.map((row) => (
            <tr key={row.key}>
              {row.cells.map((cell, index) => (
                <td key={index} className={`${td} ${columns[index]?.align === 'end' ? 'text-end tabular-nums' : ''}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
