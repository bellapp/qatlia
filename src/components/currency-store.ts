'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_CURRENCY, isAppCurrency, type AppCurrency } from '@/lib/currency';

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
    // A server that cannot answer must not leave prices on "…": the home
    // market's currency is shown (a euro account then pays as it is told at
    // checkout, where the server decides again).
    void fetchCurrency().then((answer) => {
      if (cancelled) return;
      if (answer) publish(answer);
      else if (current === null) publish(DEFAULT_CURRENCY);
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
