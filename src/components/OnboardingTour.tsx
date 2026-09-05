'use client';

import React from 'react';
import { useLocale } from '@/components/LocaleProvider';
import type { TranslationKey } from '@/i18n';

interface TourStep {
  selector: string;
  titleKey: TranslationKey;
  descriptionKey: TranslationKey;
}

// The selectors are DOM contracts, not copy: only the popover text is localized,
// and it is resolved at click time so the tour speaks the language currently
// selected rather than the one loaded at mount.
/**
 * Placeholders driver.js substitutes in `progressText` when it renders a step.
 * The catalog writes the same two values as ordinary `{current}`/`{total}`
 * tokens, so a translator sees the app's usual syntax and the library still
 * owns the counting.
 */
const DRIVER_CURRENT_TOKEN = '{{current}}';
const DRIVER_TOTAL_TOKEN = '{{total}}';

const TOUR_STEPS: TourStep[] = [
  { selector: '#co-quick-actions', titleKey: 'tour.step1Title', descriptionKey: 'tour.step1Desc' },
  { selector: '#co-pieces-manager', titleKey: 'tour.step2Title', descriptionKey: 'tour.step2Desc' },
  { selector: '#co-optimize-btn', titleKey: 'tour.step3Title', descriptionKey: 'tour.step3Desc' },
  { selector: '#co-export-section', titleKey: 'tour.step4Title', descriptionKey: 'tour.step4Desc' },
];

export function OnboardingTour() {
  const { t, dir } = useLocale();

  const startTour = () => {
    // Inject driver.js dynamically
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/driver.js@1.3.1/dist/driver.js.iife.js';
    script.onload = () => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://cdn.jsdelivr.net/npm/driver.js@1.3.1/dist/driver.css';
      document.head.appendChild(css);

      const dwindow = window as unknown as Record<string, unknown>;
      const driverObj = (dwindow.driver as (...args: unknown[]) => { drive: () => void })({
        animate: true,
        showProgress: true,
        showButtons: ['next', 'previous', 'close'],
        // driver.js ships English button labels and an English "x of y"
        // counter. Its progress template is filled by the library itself, so
        // the catalog keeps the step numbers as placeholders and only the
        // token syntax is adapted here — the count never moves into the copy.
        nextBtnText: t('tour.next'),
        prevBtnText: t('tour.previous'),
        doneBtnText: t('tour.done'),
        progressText: t('tour.progress', { current: DRIVER_CURRENT_TOKEN, total: DRIVER_TOTAL_TOKEN }),
        steps: TOUR_STEPS.map(s => ({
          element: s.selector || undefined,
          popover: {
            title: t(s.titleKey),
            description: t(s.descriptionKey),
            side: 'bottom',
            align: dir === 'rtl' ? 'end' : 'start',
          },
        })),
        onDestroyed: () => localStorage.setItem('qatlia-tour-done', '1'),
      });
      driverObj.drive();
    };
    document.head.appendChild(script);
  };

  return (
    <button
      onClick={startTour}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-400/10 border border-brand-500/20 text-brand-400 hover:bg-brand-400/20 text-[11px] font-semibold transition-all"
      title={t('tour.buttonTitle')}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      {t('tour.button')}
    </button>
  );
}