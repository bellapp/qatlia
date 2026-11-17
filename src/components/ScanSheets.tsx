'use client';

import { useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { useLocale } from '@/components/LocaleProvider';

export interface ScanSheetView {
  /** The thumbnail (or the image in memory); null when the sheet kept none. */
  src: string | null;
  /** Pieces read from this sheet still in the list. */
  pieceCount: number;
}

export interface ScanSheetsProps {
  sheets: ScanSheetView[];
  max: number;
  /** The sheet whose full image is on its way to the viewer, if any. */
  pendingIndex?: number | null;
  /** A read is running: nothing may be removed under it. */
  busy?: boolean;
  onOpen: (index: number) => void;
  onRemove: (index: number) => void;
}

/**
 * The cut-list sheets read for the project on screen (spec 2026-11-17), kept
 * to one short line so the pieces stay in view: the count, then a small
 * numbered thumbnail per sheet (a tap opens it, its corner button removes
 * it). Removing asks once, on a line of its own (no browser dialog). The
 * pieces a sheet gave are in its tooltip and label. Nothing is shown before
 * the first sheet.
 */
export function ScanSheets({ sheets, max, pendingIndex = null, busy = false, onOpen, onRemove }: ScanSheetsProps) {
  const { t, tn } = useLocale();
  const [confirming, setConfirming] = useState<number | null>(null);
  if (sheets.length === 0) return null;
  const full = sheets.length >= max;
  const asking = confirming !== null && confirming < sheets.length ? confirming : null;

  return (
    <div className="px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20" data-testid="scan-sheets">
      <div className="flex items-center gap-3 min-w-0">
        <div className="shrink-0 text-xs leading-tight">
          <span className="block text-emerald-700 dark:text-emerald-400 font-bold">{t('atelier.scan.sheetsTitle')}</span>
          <span className="block font-mono text-[11px] text-emerald-700/80 dark:text-emerald-300/80" dir="ltr" data-testid="scan-sheets-count">
            {sheets.length} / {max}
          </span>
        </div>

        <ul className="flex flex-1 items-center justify-end gap-3 min-w-0 pt-1">
          {sheets.map((sheet, index) => {
            const number = index + 1;
            const summary = `${t('atelier.scan.sheetLabel', { index: number })} · ${tn('atelier.scan.analyzedCount', sheet.pieceCount)}`;
            return (
              <li key={index} className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => onOpen(index)}
                  title={summary}
                  aria-label={`${t('atelier.scan.sheetOpenAria', { index: number })} (${tn('atelier.scan.analyzedCount', sheet.pieceCount)})`}
                  aria-busy={pendingIndex === index || undefined}
                  data-testid={index === 0 ? 'atelier-scan-preview' : `atelier-scan-preview-${number}`}
                  className={`relative block w-10 h-10 rounded-lg overflow-hidden border bg-studio-field shadow-sm hover:border-emerald-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 transition-colors ${
                    asking === index ? 'border-rose-400' : 'border-emerald-500/30'
                  }`}
                >
                  {sheet.src && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={sheet.src} alt="" className="w-full h-full object-cover" />
                  )}
                  <span
                    aria-hidden="true"
                    className="absolute bottom-0 start-0 min-w-4 px-1 rounded-se-md bg-slate-950/75 text-white text-[9px] font-bold leading-4 text-center"
                  >
                    {number}
                  </span>
                  {pendingIndex === index && (
                    <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center bg-slate-950/50 text-white">
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(index)}
                  disabled={busy}
                  aria-label={t('atelier.scan.removeSheetAria', { index: number })}
                  data-testid={`scan-sheet-remove-${number}`}
                  className="absolute -top-1.5 -end-1.5 w-5 h-5 flex items-center justify-center rounded-full bg-slate-700 text-white shadow ring-2 ring-white dark:ring-slate-950 hover:bg-rose-600 disabled:opacity-40 transition-colors"
                >
                  <X className="w-3 h-3" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {asking !== null && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs" role="group">
          <span className="text-rose-600 dark:text-rose-300 font-medium">{t('atelier.scan.removeSheetConfirm', { index: asking + 1 })}</span>
          <button
            type="button"
            onClick={() => {
              setConfirming(null);
              onRemove(asking);
            }}
            disabled={busy}
            className="px-2.5 py-1 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-600 dark:text-rose-300 font-bold hover:bg-rose-500/25 disabled:opacity-50"
          >
            {t('atelier.scan.removeSheetYes')}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(null)}
            className="px-2.5 py-1 rounded-lg text-slate-500 dark:text-slate-400 font-bold hover:text-slate-900 dark:hover:text-white"
          >
            {t('atelier.scan.removeSheetNo')}
          </button>
        </div>
      )}

      {full && asking === null && (
        <p className="mt-1.5 text-[11px] text-emerald-700/80 dark:text-emerald-300/80" data-testid="scan-sheets-full">
          {t('atelier.scan.sheetsFull', { max })}
        </p>
      )}
    </div>
  );
}
