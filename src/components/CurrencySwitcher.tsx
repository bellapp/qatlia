'use client';

import { useEffect, useState } from 'react';
import { Coins } from 'lucide-react';
import { APP_CURRENCIES, isAppCurrency, type AppCurrency } from '@/lib/currency';
import { useLocale } from '@/components/LocaleProvider';

/*
 * The account currency on the client. The server decides it (the account's,
 * else the visitor's country); every mounted hook shares one answer, and a
 * change made from a switcher reaches them all.
 */

let current: AppCurrency | null = null;
let inflight: Promise<AppCurrency | null> | null = null;
const listeners = new Set<(currency: AppCurrency) => void>();

function publish(currency: AppCurrency) {
  current = currency;
  listeners.forEach((listener) => listener(currency));
}

function fetchCurrency(): Promise<AppCurrency | null> {
  if (!inflight) {
    inflight = fetch('/api/currency', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => (isAppCurrency(data?.currency) ? data.currency : null))
      .catch(() => null)
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** The currency prices are shown in; null until the server has answered. */
export function useCurrency(): {
  currency: AppCurrency | null;
  setCurrency: (next: AppCurrency) => Promise<boolean>;
} {
  const [currency, setLocal] = useState<AppCurrency | null>(current);

  useEffect(() => {
    listeners.add(setLocal);
    let cancelled = false;
    // Asked again on every page: signing in may have changed the answer.
    void fetchCurrency().then((answer) => {
      if (!cancelled && answer) publish(answer);
    });
    return () => {
      cancelled = true;
      listeners.delete(setLocal);
    };
  }, []);

  const setCurrency = async (next: AppCurrency) => {
    try {
      const res = await fetch('/api/currency', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currency: next }),
      });
      if (!res.ok) return false;
      publish(next);
      return true;
    } catch {
      return false;
    }
  };

  return { currency, setCurrency };
}

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
        className="bg-transparent outline-none cursor-pointer disabled:cursor-wait"
      >
        {currency === null && <option value="">…</option>}
        {APP_CURRENCIES.map((code) => (
          <option key={code} value={code}>
            {t(`currency.names.${code}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
