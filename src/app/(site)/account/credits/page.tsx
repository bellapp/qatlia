'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Receipt, Zap } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { AccountMenu } from '@/components/AccountMenu';
import { LowCreditsBanner } from '@/components/LowCreditsBanner';
import { useCreditLevel } from '@/components/useCreditLevel';
import { QatlIALogo } from '@/components/QatlIALogo';
import { LocaleSwitcher, useLocale } from '@/components/LocaleProvider';
import { formatDateTime } from '@/i18n';

interface Tx {
  id: string;
  type?: string;
  amount: number;
  balance_after?: number;
  description?: string;
  created_at: string;
}

const LEDGER_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
};

/** Balance and movements, kept apart from the account settings (/account). */
export default function AccountCreditsPage() {
  const router = useRouter();
  const { t, n, locale } = useLocale();
  const [email, setEmail] = useState<string | null>(null);
  // null until the real balance is read from the profile.
  const [credits, setCredits] = useState<number | null>(null);
  const creditLevel = useCreditLevel(credits);
  // null until the ledger answers: an empty list must not flash "no movement".
  const [txs, setTxs] = useState<Tx[] | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push('/auth/login?redirect=/account/credits');
        return;
      }
      setEmail(user.email || null);
      try {
        const { data: p } = await supabase.from('profiles').select('credits').eq('id', user.id).single();
        if (p && typeof p.credits === 'number') setCredits(p.credits);
      } catch {
        /* balance stays unknown rather than being invented */
      }

      // The server ledger is the only source of movements. The former
      // localStorage fallback replayed client-invented "Export PDF" debits that
      // never existed in the database.
      try {
        const res = await fetch('/api/credits/history');
        const data = await res.json();
        setTxs(Array.isArray(data.transactions) ? data.transactions : []);
      } catch {
        setTxs([]);
      }
    }
    load();
  }, [router]);

  return (
    <div className="min-h-screen bg-studio-canvas text-slate-900 dark:text-slate-100 font-sans antialiased">
      <header className="sticky top-0 z-40 border-b border-studio-border/70 bg-studio-canvas/70 backdrop-blur-2xl backdrop-saturate-150">
        <div className="max-w-4xl mx-auto flex items-center justify-between px-4 sm:px-8 h-16">
          <div className="flex items-center gap-3">
            <Link href="/atelier" className="flex items-center gap-2 px-3 py-2 rounded-xl bg-studio-panel border border-studio-border text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-studio-field transition-all">
              <ArrowLeft className="w-4 h-4 rtl:-scale-x-100" aria-hidden="true" />
              {t('historyPage.backToAtelier')}
            </Link>
            <div className="text-brand-400">
              <QatlIALogo size="sm" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LocaleSwitcher />
            {email && <AccountMenu email={email} />}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-8 py-8 space-y-6">
        <h1 className="text-2xl font-black text-slate-900 dark:text-white">{t('account.creditsUsage')}</h1>

        <LowCreditsBanner balance={credits} level={creditLevel} />

        <section className="p-5 rounded-2xl bg-studio-panel/70 border border-studio-border flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-end gap-3">
            <p dir="ltr" className="text-4xl font-black font-mono text-slate-900 dark:text-white">{credits === null ? '—' : n(credits)}</p>
            <p className="text-xs text-slate-600 dark:text-slate-400 pb-1.5">{t('accountPage.creditsRemaining')}</p>
          </div>
          {/* Hidden in the Play Store app, which sells nothing. */}
          <Link
            href="/credits"
            data-sells=""
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-brand-400 hover:bg-brand-500 text-slate-950 text-sm font-black transition-colors"
          >
            <Zap className="w-4 h-4 fill-slate-950" aria-hidden="true" />
            {t('account.buyCredits')}
          </Link>
        </section>

        <section className="p-5 rounded-2xl bg-studio-panel/70 border border-studio-border space-y-3">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-brand-400" aria-hidden="true" />
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">{t('accountPage.ledgerAria')}</h2>
          </div>
          {txs === null ? null : txs.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('accountPage.noMovements')}</p>
          ) : (
            <ul aria-label={t('accountPage.ledgerAria')} className="divide-y divide-studio-border">
              {txs.map((tx) => (
                <li key={tx.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                  <div>
                    {/* The description saved in the ledger is the artisan's own
                        record, so it is shown verbatim; only the fallback for a
                        row saved without one is localized. */}
                    <p className="text-slate-800 dark:text-slate-200 font-medium">{tx.description || t(tx.amount < 0 ? 'accountPage.txDebit' : 'accountPage.txCredit')}</p>
                    <p className="text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                      {formatDateTime(locale, tx.created_at, LEDGER_DATE_OPTIONS)}
                    </p>
                  </div>
                  <span dir="ltr" className={`font-mono font-bold ${tx.amount < 0 ? 'text-rose-500 dark:text-rose-300' : 'text-emerald-600 dark:text-emerald-400'}`}>
                    {tx.amount > 0 ? `+${n(tx.amount)}` : n(tx.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
