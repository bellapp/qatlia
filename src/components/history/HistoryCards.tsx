'use client';

import { ArrowRight, Calendar, FileDown, Loader2 } from 'lucide-react';
import { useLocale } from '@/components/LocaleProvider';
import { HistoryName } from '@/components/history/HistoryName';
import { ScanThumb, UNKNOWN, useRowFigures, type HistoryListProps } from '@/components/history/history-list';
import { formatDateTime } from '@/i18n';
import { materialBadgeKey } from '@/i18n/domain';
import type { HistoryRow } from '@/lib/projects/history-row';

/**
 * Card badge tone per material. Only the three materials that have ever had
 * their own colour are listed; everything else keeps the default tone, and the
 * label itself comes from `materialBadgeKey`.
 */
const MATERIAL_BADGE_TONES: Record<string, string> = {
  aluminium: 'bg-slate-500/20 text-slate-700 dark:text-slate-300 border-slate-500/30',
  verre: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
  contreplaques: 'bg-brand-600/10 text-brand-400 border-brand-500/20',
};

const DEFAULT_BADGE_TONE = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';

const CARD_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

/** The history as cards: one column on a phone, two from 768px. */
export function HistoryCards({ rows, onOpen, onRename, onDownloadPdf, onViewScan, pdfPendingIds }: HistoryListProps) {
  return (
    <div data-testid="history-cards" className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {rows.map((row) => (
        <HistoryCard
          key={row.id}
          row={row}
          onOpen={onOpen}
          onRename={onRename}
          onDownloadPdf={onDownloadPdf}
          onViewScan={onViewScan}
          pdfBusy={pdfPendingIds?.has(row.id) ?? false}
        />
      ))}
    </div>
  );
}

function HistoryCard({
  row,
  onOpen,
  onRename,
  onDownloadPdf,
  onViewScan,
  pdfBusy,
}: Omit<HistoryListProps, 'rows' | 'pdfPendingIds'> & { row: HistoryRow; pdfBusy: boolean }) {
  const { t, tn, locale } = useLocale();
  const figures = useRowFigures(row);
  const material = row.material?.toLowerCase();
  const tone = (material && MATERIAL_BADGE_TONES[material]) || DEFAULT_BADGE_TONE;

  return (
    <article
      data-testid="history-card"
      className="min-w-0 p-4 sm:p-5 rounded-2xl bg-studio-panel/70 border border-studio-border hover:border-brand-400/40 transition-all flex flex-col justify-between gap-4 group"
    >
      <div className="space-y-3 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-mono text-slate-600 dark:text-slate-400 flex items-center gap-1 min-w-0">
            <Calendar className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{formatDateTime(locale, row.createdAt, CARD_DATE_OPTIONS)}</span>
          </span>
          <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded border ${tone}`}>
            {t(materialBadgeKey(material))}
          </span>
        </div>
        <div className="flex items-center gap-3 min-w-0">
          <ScanThumb row={row} size="card" onViewScan={onViewScan} testId="history-scan" />
          <div className="flex-1 min-w-0">
            <HistoryName name={row.name} onRename={(name) => onRename(row.id, name)} size="card" />
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-2 pt-3 border-t border-studio-border text-xs font-mono">
          <div className="min-w-0 p-2 rounded-lg bg-studio-canvas">
            <dt className="text-[10px] text-slate-500 dark:text-slate-400">{t('historyPage.stats.panel')}</dt>
            <dd data-col="panel" dir="ltr" className="font-bold text-slate-900 dark:text-white break-words text-start">{figures.panel}</dd>
          </div>
          <div className="min-w-0 p-2 rounded-lg bg-studio-canvas">
            <dt className="text-[10px] text-slate-500 dark:text-slate-400">{t('historyPage.stats.pieces')}</dt>
            <dd data-col="pieces" className="font-bold text-brand-500 dark:text-brand-400 truncate">{figures.pieces ?? UNKNOWN}</dd>
          </div>
          <div className="min-w-0 p-2 rounded-lg bg-studio-canvas">
            <dt className="text-[10px] text-slate-500 dark:text-slate-400">{t('historyPage.stats.waste')}</dt>
            {figures.waste === null ? (
              <dd data-col="waste" className="font-bold text-emerald-600 dark:text-emerald-400">{UNKNOWN}</dd>
            ) : (
              <dd data-col="waste" className="font-bold text-emerald-600 dark:text-emerald-400"><span dir="ltr">{figures.waste}%</span></dd>
            )}
          </div>
        </dl>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span data-col="sheets" className="me-auto text-[11px] font-mono font-bold text-slate-600 dark:text-slate-400">
          {figures.sheets === null
            ? `${t('historyPage.stats.sheets')} ${UNKNOWN}`
            : tn('historyPage.sheetsUsed', figures.sheets)}
        </span>
        {row.hasPlan && (
          <button
            type="button"
            onClick={() => onDownloadPdf(row.id)}
            disabled={pdfBusy}
            aria-busy={pdfBusy || undefined}
            aria-label={t('historyPage.pdfAria', { name: row.name })}
            data-testid="history-pdf"
            className="min-h-10 disabled:opacity-60 disabled:cursor-wait inline-flex items-center justify-center gap-1.5 px-3 rounded-xl bg-studio-field hover:bg-studio-border text-xs font-bold text-slate-700 dark:text-slate-300 hover:text-brand-600 dark:hover:text-brand-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 transition-colors"
          >
            {pdfBusy
              ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              : <FileDown className="w-4 h-4" aria-hidden="true" />}
            {t('historyPage.pdfLabel')}
          </button>
        )}
        <button
          type="button"
          onClick={() => onOpen(row.id)}
          aria-label={t('historyPage.openAria', { name: row.name })}
          data-testid="history-open"
          className="min-h-10 w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 rounded-xl bg-brand-400 hover:bg-brand-500 text-slate-950 font-black text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 transition-all group-hover:shadow-lg group-hover:shadow-brand-500/20"
        >
          {t('historyPage.open')}
          <ArrowRight className="w-4 h-4 rtl:-scale-x-100" aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}
