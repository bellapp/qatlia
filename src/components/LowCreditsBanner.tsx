'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { X, Zap } from 'lucide-react';
import { useLocale } from '@/components/LocaleProvider';
import type { CreditLevel } from '@/lib/billing/policy';
import { readDismissed, writeDismissed } from '@/lib/low-credits-dismissal';

const browserStorage = () => window.localStorage;

interface LowCreditsBannerProps {
  balance: number | null;
  level: CreditLevel;
  /** A low message may be closed; the empty one never is. */
  dismissible?: boolean;
}

/**
 * Says credits are running out, with the way to buy more. At zero it does not
 * say the artisan is blocked: a paid job stays free to re-run for a day.
 */
export function LowCreditsBanner({ balance, level, dismissible = false }: LowCreditsBannerProps) {
  const { t, tn } = useLocale();
  // The balance is never known on the first render, so what the storage holds
  // cannot make the server's markup and the browser's differ.
  const [dismissed, setDismissed] = useState(() => readDismissed(browserStorage));

  // Enough credits again, or none left: the next low message shows again.
  useEffect(() => {
    if (level !== 'ok' && level !== 'empty') return;
    writeDismissed(browserStorage, false);
    setDismissed(false);
  }, [level]);

  if (balance === null || (level !== 'low' && level !== 'empty')) return null;
  const closable = dismissible && level === 'low';
  if (closable && dismissed) return null;

  return (
    <div
      role="status"
      data-testid="low-credits"
      className={`flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 rounded-xl border ${
        level === 'empty' ? 'bg-rose-500/10 border-rose-500/40' : 'bg-brand-400/10 border-brand-500/40'
      }`}
    >
      <Zap
        className={`w-4 h-4 shrink-0 ${level === 'empty' ? 'text-rose-600 dark:text-rose-400' : 'text-brand-600 dark:text-brand-400'}`}
        aria-hidden="true"
      />
      <p className="flex-1 min-w-0 text-sm font-bold text-slate-900 dark:text-white">
        {level === 'empty' ? t('lowCredits.empty') : tn('lowCredits.left', balance)}
      </p>
      {/* Hidden in the Play Store app, which sells nothing. */}
      <Link
        href="/credits"
        data-sells=""
        className="shrink-0 px-3 sm:px-4 py-2 rounded-lg bg-brand-400 hover:bg-brand-500 text-slate-950 text-xs font-black transition-colors"
      >
        {t('account.buyCredits')}
      </Link>
      {closable && (
        <button
          type="button"
          aria-label={t('common.close')}
          onClick={() => {
            writeDismissed(browserStorage, true);
            setDismissed(true);
          }}
          className="shrink-0 p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
