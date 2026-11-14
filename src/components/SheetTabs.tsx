'use client';

import React, { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLocale } from '@/components/LocaleProvider';

/** Room kept between the active chip and the edge of the row it scrolls in. */
const SCROLL_PAD_PX = 8;

interface SheetTabsProps {
  /** Waste rate of each sheet (or bar) of the result, 0-100, in plan order. */
  wasteRates: number[];
  activeIndex: number;
  onSelect: (index: number) => void;
  /** 1D results cut bars, not panels: the chips are named after them. */
  mode: '1d' | '2d';
}

/**
 * Yield of one sheet, rounded like the "Rendement" figure of the stats so the
 * chips and the headline read the same way (100 minus the waste rate).
 */
export function sheetYield(wasteRate: number | undefined): number {
  const waste = Number.isFinite(wasteRate) ? Number(wasteRate) : 0;
  return Math.max(0, Math.min(100, Math.round(100 - waste)));
}

/**
 * The tabs over the cutting plan: one chip per sheet, with its number and its
 * yield as a bar and a figure. One row at every width — the chips scroll
 * sideways and the arrows step through them — so the plan keeps its height on
 * a phone. The chip carries only the number below `sm` and "Panneau N" above;
 * its accessible name is always the full label.
 */
export function SheetTabs({ wasteRates, activeIndex, onSelect, mode }: SheetTabsProps) {
  const { t } = useLocale();
  const rowRef = useRef<HTMLDivElement>(null);
  const count = wasteRates.length;
  const labelKey = mode === '1d' ? 'atelier.plan.barTab' : 'atelier.plan.sheetTab';

  // Bring the active chip into the row. Measured with rects rather than
  // offsetLeft/scrollLeft so it holds in RTL, and the row is scrolled on its
  // own: scrollIntoView would also scroll the page when a new result arrives
  // with the plan off-screen.
  useEffect(() => {
    const row = rowRef.current;
    const chip = row?.querySelector<HTMLElement>(`[data-sheet-tab="${activeIndex}"]`);
    if (!row || !chip) return;
    const rowBox = row.getBoundingClientRect();
    const chipBox = chip.getBoundingClientRect();
    if (chipBox.left < rowBox.left + SCROLL_PAD_PX) {
      row.scrollBy({ left: chipBox.left - rowBox.left - SCROLL_PAD_PX, behavior: 'smooth' });
    } else if (chipBox.right > rowBox.right - SCROLL_PAD_PX) {
      row.scrollBy({ left: chipBox.right - rowBox.right + SCROLL_PAD_PX, behavior: 'smooth' });
    }
  }, [activeIndex, count]);

  const arrowClass =
    'shrink-0 w-7 h-9 flex items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 hover:bg-studio-field hover:text-slate-900 dark:hover:text-white transition-colors disabled:opacity-30 disabled:pointer-events-none';

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      {count > 1 && (
        <button
          type="button"
          data-testid="sheet-tab-prev"
          onClick={() => onSelect(activeIndex - 1)}
          disabled={activeIndex <= 0}
          aria-label={t('atelier.plan.prevSheet')}
          title={t('atelier.plan.prevSheet')}
          className={arrowClass}
        >
          <ChevronLeft className="w-4 h-4 rtl:rotate-180" aria-hidden="true" />
        </button>
      )}

      <div
        ref={rowRef}
        data-testid="sheet-tabs"
        className="flex min-w-0 flex-1 items-center gap-1 sm:gap-1.5 overflow-x-auto overscroll-x-contain py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {wasteRates.map((wasteRate, i) => {
          const usage = sheetYield(wasteRate);
          const active = i === activeIndex;
          const label = t(labelKey, { index: i + 1 });
          return (
            <button
              key={i}
              type="button"
              data-sheet-tab={i}
              onClick={() => onSelect(i)}
              aria-label={label}
              aria-current={active ? 'true' : undefined}
              title={`${label} · ${t('atelier.metrics.efficiency')}`}
              className={`shrink-0 whitespace-nowrap min-w-[44px] flex flex-col items-stretch gap-1 rounded-lg border px-2 py-1 text-start transition-colors ${
                active
                  ? 'bg-brand-400 border-brand-400 text-slate-950'
                  : 'bg-studio-panel border-studio-border text-slate-700 dark:text-slate-200 hover:border-brand-400/60'
              }`}
            >
              <span className="text-[11px] font-bold leading-none" aria-hidden="true">
                <span className="sm:hidden" dir="ltr">{i + 1}</span>
                <span className="hidden sm:inline">{label}</span>
              </span>
              <span className="flex items-center gap-1" aria-hidden="true">
                {/* Drawn in SVG units, not as a CSS width: the bar is the yield
                    out of 100, the same figure printed next to it. */}
                <svg viewBox="0 0 100 4" preserveAspectRatio="none" className="h-1 w-5 sm:w-8 shrink-0 rounded-full overflow-hidden">
                  <rect x="0" y="0" width="100" height="4" className={active ? 'fill-slate-950/15' : 'fill-studio-border'} />
                  <rect x="0" y="0" width={usage} height="4" className={active ? 'fill-slate-950/70' : 'fill-brand-400'} />
                </svg>
                <span dir="ltr" className={`font-mono text-[9px] font-bold tabular-nums leading-none ${active ? 'text-slate-950/80' : 'text-slate-500 dark:text-slate-400'}`}>
                  {usage}%
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {count > 1 && (
        <button
          type="button"
          data-testid="sheet-tab-next"
          onClick={() => onSelect(activeIndex + 1)}
          disabled={activeIndex >= count - 1}
          aria-label={t('atelier.plan.nextSheet')}
          title={t('atelier.plan.nextSheet')}
          className={arrowClass}
        >
          <ChevronRight className="w-4 h-4 rtl:rotate-180" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
