'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { ArrowLeft, ArrowRight, KeyRound, LogOut, Receipt, Shield, Zap } from 'lucide-react';
import { AccountMenu } from '@/components/AccountMenu';
import { QatlIALogo } from '@/components/QatlIALogo';
import { LocaleSwitcher, useLocale } from '@/components/LocaleProvider';
import { authErrorKey } from '@/components/AuthModal';
import { formatDateTime } from '@/i18n';

interface Tx {
  id: string;
  type?: string;
  amount: number;
  balance_after?: number;
  description?: string;
  created_at: string;
}

/** Kept in one place: the input constraint and the copy shown when it is not met. */
const MIN_PASSWORD_LENGTH = 6;

const LEDGER_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
};

export default function AccountPage() {
  const router = useRouter();
  const { t, n, locale } = useLocale();
  const [email, setEmail] = useState<string | null>(null);
  // null until the real balance is read from the profile.
  const [credits, setCredits] = useState<number | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwdMsg, setPwdMsg] = useState<string | null>(null);
  const [pwdErr, setPwdErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [txs, setTxs] = useState<Tx[]>([]);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push('/auth/login?redirect=/account');
        return;
      }
      setEmail(user.email || null);
      try { const { data: p } = await supabase.from('profiles').select('credits').eq('id', user.id).single(); if (p && typeof p.credits === 'number') setCredits(p.credits); } catch {/* balance stays unknown rather than being invented */}

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

  const handlePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdErr(null);
    setPwdMsg(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setPwdErr(t('accountPage.errors.tooShort', { min: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (password !== confirm) {
      setPwdErr(t('accountPage.errors.mismatch'));
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) {
      // Supabase answers in English: the failure is mapped to the artisan's own
      // language, and an unrecognised one degrades to the generic copy.
      setPwdErr(t(authErrorKey(error, 'accountPage.errors.generic'), { min: MIN_PASSWORD_LENGTH }));
      return;
    }
    setPassword('');
    setConfirm('');
    setPwdMsg(t('accountPage.passwordUpdated'));
  };

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/atelier');
    router.refresh();
  };

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
            <Link
              href="/credits"
              aria-label={`${t('atelier.header.creditsAria')}: ${credits === null ? '—' : n(credits)}`}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand-500/10 border border-brand-500/25 text-brand-400 hover:bg-brand-500/15 text-xs font-semibold transition-all"
            >
              <Zap className="w-3.5 h-3.5 fill-brand-400 text-brand-400" aria-hidden="true" />
              <span dir="ltr" className="font-mono font-bold">{credits === null ? '—' : n(credits)}</span>
            </Link>
            {email && <AccountMenu email={email} />}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-8 py-8 space-y-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-400/80">{t('accountPage.eyebrow')}</p>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white mt-1">{t('accountPage.title')}</h1>
          {/* An address is a Latin identifier whatever the page direction is. */}
          <p dir="ltr" className="text-sm text-slate-600 dark:text-slate-400 mt-1 text-start">{email}</p>
        </div>

        <section id="credits" className="p-5 rounded-2xl bg-studio-panel/70 border border-studio-border space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Receipt className="w-4 h-4 text-brand-400" aria-hidden="true" />
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">{t('account.creditsUsage')}</h2>
            </div>
            <Link href="/credits" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-400 hover:text-brand-400">
              {t('accountPage.topUp')}
              <ArrowRight className="w-3 h-3 rtl:-scale-x-100" aria-hidden="true" />
            </Link>
          </div>
          <div className="flex items-end gap-3">
            <p dir="ltr" className="text-3xl font-black font-mono text-slate-900 dark:text-white">{credits === null ? '—' : n(credits)}</p>
            <p className="text-xs text-slate-600 dark:text-slate-400 pb-1">{t('accountPage.creditsRemaining')}</p>
          </div>
          {txs.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('accountPage.noMovements')}</p>
          ) : (
            <ul aria-label={t('accountPage.ledgerAria')} className="divide-y divide-slate-800">
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
                  <span dir="ltr" className={`font-mono font-bold ${tx.amount < 0 ? 'text-rose-300' : 'text-emerald-400'}`}>
                    {tx.amount > 0 ? `+${n(tx.amount)}` : n(tx.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section id="password" className="p-5 rounded-2xl bg-studio-panel/70 border border-studio-border space-y-4">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-brand-400" aria-hidden="true" />
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">{t('account.changePassword')}</h2>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5" aria-hidden="true" />
            {t('accountPage.googleNote')}
          </p>
          <form onSubmit={handlePassword} className="grid sm:grid-cols-2 gap-3">
            <input
              type="password"
              minLength={MIN_PASSWORD_LENGTH}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('accountPage.newPassword')}
              aria-label={t('accountPage.newPassword')}
              className="px-3 py-2.5 rounded-xl bg-studio-field border border-studio-border text-sm outline-none focus:border-brand-500/50"
            />
            <input
              type="password"
              minLength={MIN_PASSWORD_LENGTH}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={t('accountPage.confirmPassword')}
              aria-label={t('accountPage.confirmPasswordAria')}
              className="px-3 py-2.5 rounded-xl bg-studio-field border border-studio-border text-sm outline-none focus:border-brand-500/50"
            />
            <button
              type="submit"
              disabled={saving}
              aria-busy={saving}
              className="sm:col-span-2 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-400 text-slate-950 font-black text-xs disabled:opacity-50"
            >
              {saving ? t('accountPage.saving') : t('accountPage.submit')}
            </button>
          </form>
          {pwdErr && <p role="alert" className="text-xs text-rose-300">{pwdErr}</p>}
          {pwdMsg && <p role="status" className="text-xs text-emerald-400">{pwdMsg}</p>}
        </section>

        <button
          type="button"
          onClick={handleLogout}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-rose-500/30 text-rose-300 text-xs font-semibold hover:bg-rose-500/10"
        >
          <LogOut className="w-4 h-4 rtl:-scale-x-100" aria-hidden="true" />
          {t('account.logout')}
        </button>
      </main>
    </div>
  );
}
