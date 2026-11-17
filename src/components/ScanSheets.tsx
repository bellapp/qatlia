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
 * The cut-list sheets read for the project on screen (spec 2026-11-17): one
 * row per sheet with its thumbnail, how many pieces it gave, and a remove
 * button that asks once, in place (no browser dialog). Nothing is shown before
 * the first sheet.
 */
export function ScanSheets({ sheets, max, pendingIndex = null, busy = false, onOpen, onRemove }: ScanSheetsProps) {
  const { t, tn } = useLocale();
  const [confirming, setConfirming] = useState<number | null>(null);
  if (sheets.length === 0) return null;
  const full = sheets.length >= max;

  return (
    <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 space-y-2" data-testid="scan-sheets">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-emerald-700 dark:text-emerald-400 font-bold">{t('atelier.scan.sheetsTitle')}</span>
        <span className="font-mono text-[11px] text-emerald-700/80 dark:text-emerald-300/80" dir="ltr" data-testid="scan-sheets-count">
          {sheets.length} / {max}
        </span>
      </div>

      <ul className="space-y-2">
        {sheets.map((sheet, index) => {
          const number = index + 1;
          const asking = confirming === index;
          return (
            <li key={index} className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => onOpen(index)}
                aria-label={t('atelier.scan.sheetOpenAria', { index: number })}
                aria-busy={pendingIndex === index || undefined}
                data-testid={index === 0 ? 'atelier-scan-preview' : `atelier-scan-preview-${number}`}
                className="relative w-12 h-12 shrink-0 rounded-lg overflow-hidden border border-emerald-500/30 bg-studio-field shadow-sm hover:border-emerald-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 transition-colors"
              >
                {sheet.src && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={sheet.src} alt="" className="w-full h-full object-cover" />
                )}
                {pendingIndex === index && (
                  <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center bg-slate-950/50 text-white">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  </span>
                )}
              </button>

              {asking ? (
                <div className="flex flex-1 flex-wrap items-center gap-2 min-w-0 text-xs" role="group">
                  <span className="text-rose-600 dark:text-rose-300 font-medium">{t('atelier.scan.removeSheetConfirm', { index: number })}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirming(null);
                      onRemove(index);
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
              ) : (
                <>
                  <div className="flex-1 min-w-0 text-xs">
                    <span className="text-emerald-700 dark:text-emerald-400 font-bold block">{t('atelier.scan.sheetLabel', { index: number })}</span>
                    <span className="text-[11px] text-emerald-700/80 dark:text-emerald-300/70 font-mono">{tn('atelier.scan.analyzedCount', sheet.pieceCount)}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfirming(index)}
                    disabled={busy}
                    aria-label={t('atelier.scan.removeSheetAria', { index: number })}
                    data-testid={`scan-sheet-remove-${number}`}
                    className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 hover:bg-rose-500/10 disabled:opacity-40 transition-colors"
                  >
                    <X className="w-4 h-4" aria-hidden="true" />
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>

      {full && (
        <p className="text-[11px] text-emerald-700/80 dark:text-emerald-300/80" data-testid="scan-sheets-full">
          {t('atelier.scan.sheetsFull', { max })}
        </p>
      )}
    </div>
  );
}
