'use client';

import React, { useEffect, useId, useState } from 'react';
import { Gift } from 'lucide-react';
import { useLocale } from '@/components/LocaleProvider';
import { REFERRAL_BONUS_PERCENT } from '@/lib/billing/policy';
import { ATTACH_ERRORS, normalizeReferralCode, type AttachError } from '@/lib/referral';
import type { TranslationKey } from '@/i18n';

type State =
  | { status: 'hidden' }
  | { status: 'open' }
  | { status: 'welcome' };

/**
 * On the purchase page: "Did a friend give you their code?" while the account
 * can still be attached (no parrain yet, nothing bought), and the promise of
 * the welcome bonus once it is. Shows nothing otherwise, or while the feature
 * is unavailable. Hidden in the Play Store app (data-sells), which sells
 * nothing anyway.
 */
export function ReferralPurchaseCode() {
  const { t } = useLocale();
  const inputId = useId();
  const [state, setState] = useState<State>({ status: 'hidden' });
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/referral')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { hasReferrer?: boolean; hasPurchased?: boolean; welcomePending?: boolean } | null) => {
        if (cancelled || !data) return;
        if (data.welcomePending) setState({ status: 'welcome' });
        else if (!data.hasReferrer && !data.hasPurchased) setState({ status: 'open' });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === 'hidden') return null;

  const percent = REFERRAL_BONUS_PERCENT;

  if (state.status === 'welcome') {
    return (
      <p data-sells="" role="status" className="flex items-center justify-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs font-semibold text-emerald-800 dark:text-emerald-200">
        <Gift className="w-4 h-4 shrink-0" aria-hidden="true" />
        {t('referral.purchase.attached', { percent })}
      </p>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const code = normalizeReferralCode(value);
    if (!code) {
      setError('referral.purchase.errors.INVALID_CODE');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/referral/attach', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null;
      if (res.ok && data?.success) {
        setState({ status: 'welcome' });
        return;
      }
      const known = data?.error && (ATTACH_ERRORS as readonly string[]).includes(data.error) && data.error !== 'PROFILE_NOT_FOUND';
      setError(known ? (`referral.purchase.errors.${data!.error as Exclude<AttachError, 'PROFILE_NOT_FOUND'>}` as TranslationKey) : 'referral.purchase.errors.generic');
    } catch {
      setError('referral.purchase.errors.generic');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form data-sells="" onSubmit={submit} className="max-w-md mx-auto p-4 rounded-2xl bg-studio-canvas/60 border border-studio-border space-y-2">
      <label htmlFor={inputId} className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200">
        <Gift className="w-4 h-4 text-brand-400" aria-hidden="true" />
        {t('referral.purchase.title')}
      </label>
      <div className="flex gap-2">
        <input
          id={inputId}
          type="text"
          dir="ltr"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={12}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="K7F4QM"
          aria-label={t('referral.purchase.label')}
          aria-invalid={error !== null}
          className="flex-1 min-w-0 bg-studio-field border border-studio-border rounded-xl px-3 py-2.5 text-sm font-mono uppercase text-slate-900 dark:text-white placeholder-slate-600 focus:border-brand-500/50 outline-none"
        />
        <button
          type="submit"
          disabled={busy || value.trim() === ''}
          aria-busy={busy}
          className="shrink-0 px-4 py-2.5 rounded-xl bg-brand-400 hover:bg-brand-500 text-slate-950 text-sm font-black disabled:opacity-50"
        >
          {busy ? t('referral.purchase.applying') : t('referral.purchase.apply')}
        </button>
      </div>
      <p role={error ? 'alert' : undefined} className={`text-[11px] ${error ? 'text-rose-600 dark:text-rose-300' : 'text-slate-600 dark:text-slate-400'}`}>
        {error ? t(error) : t('referral.signup.hint', { percent })}
      </p>
    </form>
  );
}
