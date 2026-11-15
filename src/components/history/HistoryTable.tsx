'use client';

import { ArrowRight, FileDown, Loader2 } from 'lucide-react';
import { useLocale } from '@/components/LocaleProvider';
import { HistoryName } from '@/components/history/HistoryName';
import {
  SHORT_DATE_OPTIONS,
  ScanThumb,
  UNKNOWN,
  useRowFigures,
  type HistoryListProps,
} from '@/components/history/history-list';
import { formatDateTime } from '@/i18n';
import { materialLabelKey } from '@/i18n/domain';
import type { HistoryRow } from '@/lib/projects/history-row';

type RowProps = Omit<HistoryListProps, 'rows'> & { row: HistoryRow };

const TH = 'px-2 lg:px-3 py-2.5 text-start text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 whitespace-nowrap';
const TD = 'px-2 lg:px-3 py-2 align-middle whitespace-nowrap';
/** Material and panel size give way first, below 1024px. */
const WIDE_ONLY = 'hidden lg:table-cell';

/**
 * The history as a table. From 640px it is a real nine-column `<table>`; below,
 * nine columns cannot fit a phone, so the same rows become a compact list of
 * two lines per project. Both are rendered and CSS shows one of them.
 */
export function HistoryTable({ rows, ...actions }: HistoryListProps) {
  const { t } = useLocale();
  return (
    <>
      <div className="hidden sm:block overflow-x-auto rounded-2xl border border-studio-border bg-studio-panel/70">
        <table data-testid="history-table" className="hidden sm:table w-full text-xs">
          <thead className="border-b border-studio-border">
            <tr>
              <th scope="col" data-col="preview" className={`${TH} w-10`}><span className="sr-only">{t('historyPage.columns.preview')}</span></th>
              <th scope="col" data-col="name" className={TH}>{t('historyPage.columns.name')}</th>
              <th scope="col" data-col="date" className={TH}>{t('historyPage.columns.date')}</th>
              <th scope="col" data-col="material" className={`${TH} ${WIDE_ONLY}`}>{t('historyPage.columns.material')}</th>
              <th scope="col" data-col="panel" className={`${TH} ${WIDE_ONLY}`}>{t('historyPage.stats.panel')}</th>
              <th scope="col" data-col="pieces" className={TH}>{t('historyPage.stats.pieces')}</th>
              <th scope="col" data-col="sheets" className={TH}>{t('historyPage.stats.sheets')}</th>
              <th scope="col" data-col="waste" className={TH}>{t('historyPage.stats.waste')}</th>
              <th scope="col" data-col="actions" className={TH}><span className="sr-only">{t('historyPage.columns.actions')}</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-studio-border">
            {rows.map((row) => <TableRow key={row.id} row={row} {...actions} />)}
          </tbody>
        </table>
      </div>
      <ul data-testid="history-compact" className="sm:hidden space-y-2">
        {rows.map((row) => <CompactRow key={row.id} row={row} {...actions} />)}
      </ul>
    </>
  );
}

function TableRow({ row, onOpen, onRename, onDownloadPdf, onViewScan, pdfPendingIds, scanPendingId }: RowProps) {
  const { t, locale } = useLocale();
  const pdfBusy = pdfPendingIds?.has(row.id) ?? false;
  const figures = useRowFigures(row);
  return (
    <tr data-testid="history-row" className="hover:bg-studio-field/40 transition-colors">
      <td data-col="preview" className={`${TD} w-10`}>
        <ScanThumb row={row} size="row" onViewScan={onViewScan} busy={scanPendingId === row.id} testId="history-scan" />
      </td>
      {/* `max-w-0 w-full`: the name takes what the other columns leave and is
          truncated there, instead of widening the table; `min-w-28` keeps it
          readable at 640px. */}
      <td data-col="name" className="px-2 lg:px-3 py-2 align-middle max-w-0 w-full min-w-28">
        <HistoryName name={row.name} onRename={(name) => onRename(row.id, name)} size="row" />
      </td>
      <td data-col="date" className={`${TD} font-mono text-slate-600 dark:text-slate-400`}>
        {formatDateTime(locale, row.createdAt, SHORT_DATE_OPTIONS)}
      </td>
      <td data-col="material" className={`${TD} ${WIDE_ONLY} text-slate-700 dark:text-slate-300`}>
        {t(materialLabelKey(row.material))}
      </td>
      <td data-col="panel" className={`${TD} ${WIDE_ONLY} font-mono text-slate-700 dark:text-slate-300`}>
        <span dir="ltr">{figures.panel}</span>
      </td>
      <td data-col="pieces" className={`${TD} font-mono font-bold text-brand-600 dark:text-brand-400`}>{figures.pieces ?? UNKNOWN}</td>
      <td data-col="sheets" className={`${TD} font-mono font-bold text-slate-700 dark:text-slate-300`}>
        {figures.sheets === null ? UNKNOWN : figures.sheets}
      </td>
      {figures.waste === null ? (
        <td data-col="waste" className={`${TD} font-mono font-bold text-emerald-600 dark:text-emerald-400`}>{UNKNOWN}</td>
      ) : (
        <td data-col="waste" className={`${TD} font-mono font-bold text-emerald-600 dark:text-emerald-400`}><span dir="ltr">{figures.waste}%</span></td>
      )}
      <td data-col="actions" className={TD}>
        <div className="flex items-center justify-end gap-1.5">
          {row.hasPlan && (
            <button
              type="button"
              onClick={() => onDownloadPdf(row.id)}
              disabled={pdfBusy}
              aria-busy={pdfBusy || undefined}
              aria-label={t('historyPage.pdfAria', { name: row.name })}
              data-testid="history-pdf"
              className="min-h-10 min-w-10 disabled:opacity-60 disabled:cursor-wait inline-flex items-center justify-center gap-1 px-2 lg:px-2.5 rounded-xl bg-studio-field hover:bg-studio-border font-bold text-slate-700 dark:text-slate-300 hover:text-brand-600 dark:hover:text-brand-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 transition-colors"
            >
              {pdfBusy
                ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                : <FileDown className="w-4 h-4" aria-hidden="true" />}
              <span className="hidden lg:inline">{t('historyPage.pdfLabel')}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => onOpen(row.id)}
            aria-label={t('historyPage.openAria', { name: row.name })}
            data-testid="history-open"
            className="min-h-10 min-w-10 inline-flex items-center justify-center gap-1 px-2 md:px-3 rounded-xl bg-brand-400 hover:bg-brand-500 text-slate-950 font-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 transition-all"
          >
            <span className="hidden md:inline">{t('historyPage.open')}</span>
            <ArrowRight className="w-4 h-4 rtl:-scale-x-100" aria-hidden="true" />
          </button>
        </div>
      </td>
    </tr>
  );
}

/**
 * One project on a phone. Line 1: thumbnail, name, open. Line 2: date, pieces,
 * sheets, waste. Its controls carry `-compact` test ids, since the table row
 * of the same project is in the page too (hidden).
 */
function CompactRow({ row, onOpen, onRename, onViewScan, scanPendingId }: RowProps) {
  const { t, tn, locale } = useLocale();
  const figures = useRowFigures(row);
  return (
    <li data-testid="history-compact-row" className="min-w-0 p-3 rounded-xl bg-studio-panel/70 border border-studio-border space-y-1.5">
      <div className="flex items-center gap-2.5 min-w-0">
        <ScanThumb row={row} size="row" onViewScan={onViewScan} busy={scanPendingId === row.id} testId="history-scan-compact" />
        <div className="flex-1 min-w-0">
          <HistoryName name={row.name} onRename={(name) => onRename(row.id, name)} size="row" />
        </div>
        <button
          type="button"
          onClick={() => onOpen(row.id)}
          aria-label={t('historyPage.openAria', { name: row.name })}
          data-testid="history-open-compact"
          className="w-10 h-10 shrink-0 inline-flex items-center justify-center rounded-xl bg-brand-400 hover:bg-brand-500 text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 transition-all"
        >
          <ArrowRight className="w-4 h-4 rtl:-scale-x-100" aria-hidden="true" />
        </button>
      </div>
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] font-mono text-slate-600 dark:text-slate-400">
        <span>{formatDateTime(locale, row.createdAt, SHORT_DATE_OPTIONS)}</span>
        <span aria-hidden="true">·</span>
        <span data-col="pieces">
          {figures.pieces ?? (<><span className="sr-only">{t('historyPage.stats.pieces')} </span>{UNKNOWN}</>)}
        </span>
        <span aria-hidden="true">·</span>
        <span data-col="sheets">
          {figures.sheets === null
            ? (<><span className="sr-only">{t('historyPage.stats.sheets')} </span>{UNKNOWN}</>)
            : tn('historyPage.sheetsUsed', figures.sheets)}
        </span>
        <span aria-hidden="true">·</span>
        <span data-col="waste">
          <span className="sr-only">{t('historyPage.stats.waste')} </span>
          {figures.waste === null ? UNKNOWN : <span dir="ltr">{figures.waste}%</span>}
        </span>
      </p>
    </li>
  );
}
