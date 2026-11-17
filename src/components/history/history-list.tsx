'use client';

import { FileImage, Loader2 } from 'lucide-react';
import { useLocale } from '@/components/LocaleProvider';
import type { HistoryRow } from '@/lib/projects/history-row';
import type { DisplayUnit } from '@/lib/units';

/** What the cards and the table both receive from the history page. */
export interface HistoryListProps {
  rows: HistoryRow[];
  onOpen: (id: string) => void;
  /** Resolves false on any failure (refused, offline, error), never true. */
  onRename: (id: string, name: string) => Promise<boolean>;
  onDownloadPdf: (id: string) => void;
  onViewScan: (id: string) => void;
  /** Rows whose PDF is being built: their button is busy until it is done. */
  pdfPendingIds?: ReadonlySet<string>;
  /** The row whose full scan image is being fetched: its thumbnail is busy. */
  scanPendingId?: string | null;
}

/**
 * The stored panel dimensions are canonical domain values (see src/lib/units.ts),
 * so the list states them in the canonical unit whatever display unit the
 * artisan was working in when the plan was saved. Being geometry, they are not
 * routed through the locale number formatter either: a panel reads the same in
 * every language.
 */
const CANONICAL_UNIT: DisplayUnit = 'cm';

/** What the list prints for a figure the saved project does not know. */
export const UNKNOWN = '—';

export const SHORT_DATE_OPTIONS: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };

const WASTE_FORMAT: Intl.NumberFormatOptions = { maximumFractionDigits: 1 };

export interface RowFigures {
  panel: string;
  /** "67 pcs", or null when no piece was kept (an old project). */
  pieces: string | null;
  sheets: number | null;
  /** The waste figure without its sign (the views add `%` in JSX), or null. */
  waste: string | null;
}

/** The figures of a row, formatted for the active locale; null stays null. */
export function useRowFigures(row: HistoryRow): RowFigures {
  const { t, n } = useLocale();
  return {
    panel: t('historyPage.sheetSize', { height: row.sheetHeight, width: row.sheetWidth, unit: CANONICAL_UNIT }),
    pieces: row.pieceCount > 0 ? t('historyPage.piecesValue', { count: n(row.pieceCount) }) : null,
    sheets: row.sheetsUsed,
    waste: row.wastePercentage === null ? null : n(row.wastePercentage, WASTE_FORMAT),
  };
}

/**
 * The scan thumbnail, as a button that shows the scan. A project that kept its
 * full image but no thumbnail gets the same button, drawn as the neutral tile.
 * A project with neither gets no button: in the table the tile keeps the
 * column aligned, in a card nothing is drawn. While the full image's link is fetched
 * the button is busy but stays enabled, so it keeps the focus the viewer gives
 * back on closing (a second tap is ignored by the page).
 */
export function ScanThumb({
  row,
  size,
  onViewScan,
  busy = false,
  testId,
}: {
  row: HistoryRow;
  size: 'card' | 'row';
  onViewScan: (id: string) => void;
  busy?: boolean;
  testId: string;
}) {
  const { t, tn } = useLocale();
  const box = size === 'card' ? 'w-14 h-14' : 'w-10 h-10';
  if (!row.scanThumb && !row.hasFullScan) {
    if (size === 'card') return null;
    return (
      <span aria-hidden="true" className={`${box} shrink-0 rounded-lg bg-studio-field/70 border border-studio-border flex items-center justify-center text-slate-400 dark:text-slate-500`}>
        <FileImage className="w-4 h-4" />
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onViewScan(row.id)}
      aria-label={t('scanViewer.openAria', { name: row.name })}
      aria-busy={busy || undefined}
      data-testid={testId}
      className={`${box} relative shrink-0 block rounded-lg overflow-hidden border border-studio-border shadow-sm hover:border-brand-400/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 transition-colors`}
    >
      {row.scanThumb ? (
        <img src={row.scanThumb} alt="" className="w-full h-full object-cover" loading="lazy" />
      ) : (
        <span aria-hidden="true" className="w-full h-full flex items-center justify-center bg-studio-field/70 text-slate-500 dark:text-slate-400">
          <FileImage className="w-4 h-4" />
        </span>
      )}
      {row.scanCount > 1 && (
        // A project read from several sheets says how many.
        <span
          className="absolute bottom-0.5 end-0.5 min-w-4 px-1 rounded bg-slate-950/75 text-white text-[9px] font-bold leading-4 text-center"
          data-testid="history-scan-count"
        >
          <span aria-hidden="true">{row.scanCount}</span>
          <span className="sr-only">{tn('historyPage.scanSheetsBadge', row.scanCount)}</span>
        </span>
      )}
      {busy && (
        <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center bg-slate-950/50 text-white">
          <Loader2 className="w-4 h-4 animate-spin" />
        </span>
      )}
    </button>
  );
}
