'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { creditLevel, type CreditLevel } from '@/lib/billing/policy';
import { readStartBalance } from '@/lib/billing/start-balance';

const USUAL_TONE = {
  box: 'bg-brand-400/10 border-brand-500/25 text-brand-400 hover:bg-brand-500/15 hover:border-brand-500/40',
  icon: 'fill-brand-400 text-brand-400',
  dot: 'bg-brand-400',
};

/** The balance badge's colours: tinted as usual, filled once credits run low. */
export const CREDIT_BADGE_TONES: Record<CreditLevel, { box: string; icon: string; dot: string }> = {
  unknown: USUAL_TONE,
  ok: USUAL_TONE,
  low: {
    box: 'bg-brand-400 border-brand-500 text-slate-950 hover:bg-brand-500',
    icon: 'fill-slate-950 text-slate-950',
    dot: 'bg-slate-950',
  },
  empty: {
    box: 'bg-rose-600 border-rose-700 text-white hover:bg-rose-700',
    icon: 'fill-white text-white',
    dot: 'bg-white',
  },
};

/** How close to running out the signed-in artisan is; `balance` null: not known (yet). */
export function useCreditLevel(balance: number | null): CreditLevel {
  // undefined while it is being read, null when it cannot be.
  const [start, setStart] = useState<number | null | undefined>(undefined);
  const known = balance !== null;

  useEffect(() => {
    if (!known) return;
    let cancelled = false;
    readStartBalance(createClient())
      .catch(() => null)
      .then((value) => {
        if (!cancelled) setStart(value);
      });
    return () => {
      cancelled = true;
    };
  }, [known]);

  return creditLevel(balance, start);
}
