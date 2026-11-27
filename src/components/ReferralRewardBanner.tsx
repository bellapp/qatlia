'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Gift, X } from 'lucide-react';
import { useLocale } from '@/components/LocaleProvider';
import { REFERRAL_PAGE_PATH, markRewardsSeen, unseenRewards, type ReferralReward } from '@/lib/referral';

/**
 * "You earned 8 credits thanks to Ahmed": shown once per new referral bonus,
 * at the parrain's next visit (docs/adr/0001: the parrain learns it in the
 * site only). Closing it, or opening the referral page, marks every bonus
 * shown as seen. Hidden in the Play Store app (data-sells). Shows nothing
 * while the feature is unavailable.
 */
export function ReferralRewardBanner() {
  const { t, n } = useLocale();
  const [rewards, setRewards] = useState<ReferralReward[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/referral')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { recentRewards?: ReferralReward[] } | null) => {
        if (cancelled || !data || !Array.isArray(data.recentRewards)) return;
        setRewards(unseenRewards(data.recentRewards, window.localStorage));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (rewards.length === 0) return null;

  const dismiss = () => {
    try {
      markRewardsSeen(rewards, window.localStorage);
    } catch {
      // Storage blocked: the banner may come back, nothing else.
    }
    setRewards([]);
  };

  const total = rewards.reduce((sum, reward) => sum + reward.credits, 0);
  const message =
    rewards.length === 1 && rewards[0].name
      ? t('referral.banner.single', { count: n(total), name: rewards[0].name })
      : t('referral.banner.several', { count: n(total) });

  return (
    <div data-sells="" role="status" className="flex items-center gap-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-800 dark:text-emerald-200">
      <Gift className="w-4 h-4 shrink-0" aria-hidden="true" />
      <p className="flex-1 font-medium">{message}</p>
      <Link href={REFERRAL_PAGE_PATH} onClick={dismiss} className="shrink-0 font-bold underline underline-offset-4">
        {t('referral.banner.see')}
      </Link>
      <button type="button" onClick={dismiss} aria-label={t('referral.banner.close')} className="shrink-0 p-1 rounded-lg hover:bg-emerald-500/15">
        <X className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
