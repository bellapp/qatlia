'use client';

import { useState } from 'react';
import { Coins } from 'lucide-react';
import { APP_CURRENCIES, isAppCurrency } from '@/lib/currency';
import { useLocale } from '@/components/LocaleProvider';
import { useCurrency } from '@/components/currency-store';

export { useCurrency };

const OPTION_CLASS = 'bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100';

/** MAD / EUR / USD picker, saved on the account (or the browser before sign-in). */
export function CurrencySwitcher({ className = '' }: { className?: string }) {
  const { t } = useLocale();
  const { currency, setCurrency } = useCurrency();
  const [saving, setSaving] = useState(false);

  return (
    <label
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-studio-border bg-studio-panel/60 text-xs font-bold text-slate-700 dark:text-slate-200 ${className}`}
    >
      <Coins className="w-3.5 h-3.5 text-[#F5A623]" aria-hidden="true" />
      <span className="sr-only">{t('currency.label')}</span>
      <select
        data-testid="currency-switcher"
        value={currency ?? ''}
        disabled={currency === null || saving}
        onChange={async (e) => {
          const next = e.target.value;
          if (!isAppCurrency(next) || next === currency) return;
          setSaving(true);
          await setCurrency(next);
          setSaving(false);
        }}
        translate="no"
        // The open list is drawn by the browser: in dark mode it must be told
        // so, and each option gets its own colours, or it inherits the light
        // label text on the white native list (unreadable).
        className="bg-transparent outline-none cursor-pointer disabled:cursor-wait dark:[color-scheme:dark]"
      >
        {currency === null && <option value="" className={OPTION_CLASS}>…</option>}
        {APP_CURRENCIES.map((code) => (
          <option key={code} value={code} className={OPTION_CLASS}>
            {t(`currency.names.${code}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
