'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, ArrowRight, Zap } from 'lucide-react';
import { useLocale } from '@/components/LocaleProvider';

export default function CreditsSuccessPage() {
  const { t } = useLocale();
  // The demo checkout link (development only, when Stripe is unconfigured)
  // grants nothing, so it must never claim a successful recharge.
  const [isDemo, setIsDemo] = useState(false);
  useEffect(() => {
    setIsDemo(new URLSearchParams(window.location.search).get('demo') === 'true');
  }, []);

  return (
    <div className="min-h-screen bg-studio-panel text-[#E2E8F0] font-sans antialiased flex items-center justify-center p-6">
      <div className="max-w-md w-full p-8 rounded-3xl bg-studio-panel/80 border border-emerald-500/40 text-center space-y-6 shadow-2xl backdrop-blur-md">
        <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 mx-auto flex items-center justify-center shadow-lg shadow-emerald-500/20">
          <CheckCircle2 className="w-8 h-8" aria-hidden="true" />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-black text-slate-900 dark:text-white">
            {t(isDemo ? 'creditsSuccess.demoTitle' : 'creditsSuccess.title')}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {t(isDemo ? 'creditsSuccess.demoBody' : 'creditsSuccess.body')}
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-studio-panel border border-studio-border flex items-center justify-center gap-2 text-brand-400 font-bold text-sm">
          <Zap className="w-4 h-4 text-[#F5A623]" aria-hidden="true" />
          <span>{t(isDemo ? 'creditsSuccess.demoBalance' : 'creditsSuccess.balance')}</span>
        </div>

        <Link
          href="/atelier"
          className="w-full py-3.5 rounded-xl bg-[#F5A623] hover:bg-[#D97706] text-black font-extrabold text-sm flex items-center justify-center gap-2 shadow-lg shadow-orange-500/20 transition-all"
        >
          {t('creditsSuccess.back')}
          <ArrowRight className="w-4 h-4 rtl:-scale-x-100" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
