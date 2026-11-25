'use client';

import { AlertTriangle, RefreshCw, Scissors } from 'lucide-react';
import { useLocale } from '@/components/LocaleProvider';

/**
 * The button that computes the plan, where the artisan is when the main one is
 * off the screen (src/lib/plan-inputs.ts says when): in the header on a
 * computer, at the bottom on a phone.
 */

interface PlanShortcutProps {
  onRun: () => void;
  busy: boolean;
  hasPlan: boolean;
  /** The plan on screen is older than the pieces or the settings. */
  stale: boolean;
}

function RunLabel({ busy, hasPlan }: { busy: boolean; hasPlan: boolean }) {
  const { t } = useLocale();
  const Icon = busy ? RefreshCw : Scissors;
  return (
    <>
      <Icon className={`w-4 h-4 shrink-0 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" />
      <span>{t(busy ? 'atelier.optimize.running' : hasPlan ? 'atelier.optimize.again' : 'atelier.optimize.first')}</span>
    </>
  );
}

export function PlanHeaderButton({ onRun, busy, hasPlan, stale }: PlanShortcutProps) {
  const { t } = useLocale();
  return (
    <button
      type="button"
      data-testid="plan-header-button"
      onClick={onRun}
      disabled={busy}
      title={stale ? t('atelier.optimize.stale') : undefined}
      className="hidden lg:inline-flex shrink-0 items-center gap-2 px-3.5 py-2 rounded-lg bg-brand-400 hover:bg-brand-500 text-slate-950 text-xs font-bold whitespace-nowrap transition-colors disabled:opacity-60"
    >
      <RunLabel busy={busy} hasPlan={hasPlan} />
    </button>
  );
}

export function PlanBar({ onRun, busy, hasPlan, stale }: PlanShortcutProps) {
  const { t } = useLocale();
  return (
    <div
      data-testid="plan-bar"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-studio-border bg-studio-panel px-4 pt-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))] shadow-[0_-4px_12px_rgba(15,23,42,0.12)] lg:hidden print:hidden"
    >
      {stale && (
        <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-amber-800 dark:text-amber-300">
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
          {t('atelier.optimize.stale')}
        </p>
      )}
      <button
        type="button"
        onClick={onRun}
        disabled={busy}
        className="flex min-h-12 w-full items-center justify-center gap-2.5 rounded-xl bg-brand-400 hover:bg-brand-500 text-slate-950 text-sm font-bold transition-colors disabled:opacity-60"
      >
        <RunLabel busy={busy} hasPlan={hasPlan} />
      </button>
    </div>
  );
}
