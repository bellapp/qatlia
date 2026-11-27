'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocale } from '@/components/LocaleProvider';
import type { TranslationKey } from '@/i18n';

/**
 * The atelier's guided tour (owner, 27/11/2026: the old one never opened).
 *
 * Each step points at an element of the atelier marked `data-tour="<target>"`:
 * the marks are DOM contracts kept next to the elements in
 * src/app/(site)/atelier/page.tsx (tests/onboarding-tour.test.js checks both
 * sides). No library: the old tour loaded one from the internet, called it the
 * wrong way and failed without a word.
 */

export interface TourStep {
  target: string;
  titleKey: TranslationKey;
  descriptionKey: TranslationKey;
}

export const TOUR_STEPS: TourStep[] = [
  { target: 'photo', titleKey: 'tour.step1Title', descriptionKey: 'tour.step1Desc' },
  { target: 'pieces', titleKey: 'tour.step2Title', descriptionKey: 'tour.step2Desc' },
  { target: 'panel', titleKey: 'tour.step3Title', descriptionKey: 'tour.step3Desc' },
  { target: 'plan', titleKey: 'tour.step4Title', descriptionKey: 'tour.step4Desc' },
];

export const TOUR_DONE_KEY = 'qatlia-tour-done';

const HIGHLIGHT_PADDING = 6;
const POPOVER_WIDTH = 320;
const POPOVER_GAP = 12;
const VIEWPORT_MARGIN = 12;

function targetOf(step: TourStep): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
}

interface Box { top: number; left: number; width: number; height: number }

export function OnboardingTour() {
  const { t, dir } = useLocale();
  // The steps whose element is on screen when the tour starts.
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [index, setIndex] = useState<number | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [popoverHeight, setPopoverHeight] = useState(0);
  const popoverRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  const step = index === null ? null : steps[index] ?? null;

  const close = useCallback(() => {
    setIndex(null);
    setBox(null);
    try {
      window.localStorage.setItem(TOUR_DONE_KEY, '1');
    } catch {
      // Private mode: the tour simply is not remembered.
    }
  }, []);

  const start = () => {
    const available = TOUR_STEPS.filter((s) => targetOf(s));
    if (available.length === 0) return;
    setSteps(available);
    setIndex(0);
  };

  // Bring the step's element into view, then follow it while the page moves.
  useEffect(() => {
    if (!step) return;
    const element = targetOf(step);
    if (!element) return;
    element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = element.getBoundingClientRect();
        setBox({ top: r.top, left: r.left, width: r.width, height: r.height });
      });
    };
    measure();
    window.addEventListener('scroll', measure, { passive: true, capture: true });
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', measure, { capture: true });
      window.removeEventListener('resize', measure);
    };
  }, [step]);

  useLayoutEffect(() => {
    if (popoverRef.current) setPopoverHeight(popoverRef.current.offsetHeight);
  }, [step, box]);

  // The popover stays hidden until its element is measured, and a hidden
  // button cannot take the focus: move it once the step is placed.
  const placed = box !== null;
  useEffect(() => {
    if (placed) nextRef.current?.focus({ preventScroll: true });
  }, [index, placed]);

  useEffect(() => {
    if (!step) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, close]);

  const last = index !== null && index === steps.length - 1;

  let popoverStyle: React.CSSProperties = { visibility: 'hidden' };
  if (box) {
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const width = Math.min(POPOVER_WIDTH, viewportW - 2 * VIEWPORT_MARGIN);
    const below = box.top + box.height + HIGHLIGHT_PADDING + POPOVER_GAP;
    const above = box.top - HIGHLIGHT_PADDING - POPOVER_GAP - popoverHeight;
    // Under the element when it fits, else over it, else pinned to the bottom of the screen.
    const top = below + popoverHeight <= viewportH - VIEWPORT_MARGIN
      ? below
      : above >= VIEWPORT_MARGIN
        ? above
        : viewportH - VIEWPORT_MARGIN - popoverHeight;
    const centered = box.left + box.width / 2 - width / 2;
    const left = Math.max(VIEWPORT_MARGIN, Math.min(centered, viewportW - VIEWPORT_MARGIN - width));
    popoverStyle = { top, left, width };
  }

  return (
    <>
      <button
        type="button"
        onClick={start}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-400/10 border border-brand-500/20 text-brand-400 hover:bg-brand-400/20 text-[11px] font-semibold transition-all"
        title={t('tour.buttonTitle')}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        {t('tour.button')}
      </button>

      {/* In a portal: the sticky header is blurred, and a blurred ancestor
          would pin these fixed layers to the header instead of the screen. */}
      {step && index !== null && createPortal(
        <div data-testid="onboarding-tour" dir={dir} className="print:hidden">
          {/* Catches clicks around the element: the tour is read, not clicked through. */}
          <div className="fixed inset-0 z-[70]" onClick={close} aria-hidden="true" />
          {box && (
            <div
              aria-hidden="true"
              className="fixed z-[71] rounded-xl ring-2 ring-brand-400 pointer-events-none transition-all duration-200"
              style={{
                top: box.top - HIGHLIGHT_PADDING,
                left: box.left - HIGHLIGHT_PADDING,
                width: box.width + 2 * HIGHLIGHT_PADDING,
                height: box.height + 2 * HIGHLIGHT_PADDING,
                boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.6)',
              }}
            />
          )}
          <div
            ref={popoverRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="onboarding-tour-title"
            aria-describedby="onboarding-tour-desc"
            className="fixed z-[72] rounded-xl bg-white dark:bg-studio-panel border border-studio-border shadow-2xl p-4"
            style={popoverStyle}
          >
            <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
              {t('tour.progress', { current: index + 1, total: steps.length })}
            </p>
            <h2 id="onboarding-tour-title" className="mt-1 text-sm font-black text-slate-900 dark:text-white">
              {t(step.titleKey)}
            </h2>
            <p id="onboarding-tour-desc" className="mt-1.5 text-xs leading-relaxed text-slate-700 dark:text-slate-200">
              {t(step.descriptionKey)}
            </p>
            <div className="mt-4 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={close}
                className="px-2 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 dark:hover:text-white"
              >
                {t('tour.close')}
              </button>
              <div className="flex items-center gap-2">
                {index > 0 && (
                  <button
                    type="button"
                    onClick={() => setIndex(index - 1)}
                    className="px-3 py-1.5 rounded-lg border border-studio-border text-xs font-bold text-slate-700 dark:text-slate-200 hover:border-brand-500/50"
                  >
                    {t('tour.previous')}
                  </button>
                )}
                <button
                  ref={nextRef}
                  type="button"
                  onClick={() => (last ? close() : setIndex(index + 1))}
                  className="px-3 py-1.5 rounded-lg bg-brand-400 hover:bg-brand-500 text-slate-950 text-xs font-bold"
                >
                  {t(last ? 'tour.done' : 'tour.next')}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
