'use client';

import React, { useEffect, useId, useState } from 'react';
import { Gift } from 'lucide-react';
import { useLocale } from '@/components/LocaleProvider';
import { REFERRAL_BONUS_PERCENT } from '@/lib/billing/policy';
import {
  REFERRAL_METADATA_KEY,
  clearReferralCookie,
  normalizeReferralCode,
  readReferralCookie,
  referralCookie,
} from '@/lib/referral';

const secure = () => typeof window !== 'undefined' && window.location.protocol === 'https:';

/** The code kept in this browser, for the email sign-up's user_metadata. Empty when none. */
export function referralSignupMetadata(): Record<string, string> {
  try {
    const code = readReferralCookie(document.cookie);
    return code ? { [REFERRAL_METADATA_KEY]: code } : {};
  } catch {
    return {};
  }
}

/**
 * On the sign-up form: the friend's code a referral link left (shown, not
 * asked again), or a folded "I have a code" field. A valid code goes straight
 * into the referral cookie, so the Google button and the email form both
 * carry it; the server attaches the account once it exists. Hidden in the
 * Play Store app (data-sells), like everything about paying.
 */
export function ReferralCodeField() {
  const { t } = useLocale();
  const inputId = useId();
  const [kept, setKept] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');

  useEffect(() => {
    setKept(readReferralCookie(document.cookie));
  }, []);

  const onChange = (next: string) => {
    setValue(next);
    const code = normalizeReferralCode(next);
    try {
      if (code) document.cookie = referralCookie(code, secure());
      else if (next.trim() === '') document.cookie = clearReferralCookie(secure());
    } catch {
      // Cookies blocked: the code cannot be carried, the sign-up goes on.
    }
    setKept(code);
  };

  const valid = normalizeReferralCode(value) !== null;

  if (kept && !open) {
    return (
      <div data-sells="" className="flex items-center justify-between gap-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs">
        <p className="flex items-center gap-2 text-emerald-800 dark:text-emerald-200">
          <Gift className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>
            {t('referral.signup.kept', { percent: REFERRAL_BONUS_PERCENT })}{' '}
            <span dir="ltr" className="font-mono font-bold">{kept}</span>
          </span>
        </p>
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setValue(kept);
          }}
          className="shrink-0 underline underline-offset-4 text-emerald-800 dark:text-emerald-200"
        >
          {t('referral.signup.change')}
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        data-sells=""
        onClick={() => setOpen(true)}
        className="w-full text-center text-xs text-slate-600 dark:text-slate-400 underline underline-offset-4"
      >
        {t('referral.signup.haveCode')}
      </button>
    );
  }

  return (
    <div data-sells="" className="space-y-1">
      <label htmlFor={inputId} className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
        {t('referral.signup.label')}
      </label>
      <div className="relative">
        <Gift className="w-4 h-4 text-slate-500 dark:text-slate-400 absolute start-3 top-3" aria-hidden="true" />
        <input
          id={inputId}
          type="text"
          dir="ltr"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={12}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="K7F4QM"
          aria-invalid={value.trim() !== '' && !valid}
          className="w-full bg-studio-field border border-studio-border rounded-xl ps-9 pe-3 py-2.5 text-sm font-mono uppercase text-slate-900 dark:text-white placeholder-slate-600 focus:border-brand-500/50 outline-none"
        />
      </div>
      <p className="text-[11px] text-slate-600 dark:text-slate-400">
        {value.trim() !== '' && !valid ? t('referral.signup.invalid') : t('referral.signup.hint', { percent: REFERRAL_BONUS_PERCENT })}
      </p>
    </div>
  );
}
