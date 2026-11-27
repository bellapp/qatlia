'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, Copy, Gift, MessageCircle, Users } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { AccountMenu } from '@/components/AccountMenu';
import { QatlIALogo } from '@/components/QatlIALogo';
import { LocaleSwitcher, useLocale } from '@/components/LocaleProvider';
import { REFERRAL_BONUS_PERCENT } from '@/lib/billing/policy';
import { REFERRAL_PAGE_PATH, whatsappShareHref } from '@/lib/referral';

interface Referee {
  name: string | null;
  purchased: boolean;
  earned: number;
  joinedAt: string;
}

interface Overview {
  code: string;
  link: string;
  hasReferrer: boolean;
  welcomePending: boolean;
  referees: Referee[];
  refereeCount: number;
  totalEarned: number;
}

type Load = { status: 'loading' } | { status: 'ok'; overview: Overview } | { status: 'unavailable' };

function CopyButton({ value, label, copiedLabel }: { value: string; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard refused: the value stays on screen to copy by hand.
        }
      }}
      className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-studio-field border border-studio-border text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-studio-border transition-colors"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
      <span aria-live="polite">{copied ? copiedLabel : label}</span>
    </button>
  );
}

/**
 * The parrain's page (docs/adr/0001): the code and the link to share, what
 * the filleuls earned them, and each filleul as a first name or a masked
 * email. Hidden in the Play Store app (src/lib/store-app.ts).
 */
export default function ReferralPage() {
  const router = useRouter();
  const { t, n } = useLocale();
  const [email, setEmail] = useState<string | null>(null);
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  useEffect(() => {
    async function run() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push(`/auth/login?redirect=${encodeURIComponent(REFERRAL_PAGE_PATH)}`);
        return;
      }
      setEmail(user.email || null);
      try {
        const res = await fetch('/api/referral');
        if (!res.ok) throw new Error(String(res.status));
        setLoad({ status: 'ok', overview: (await res.json()) as Overview });
      } catch {
        setLoad({ status: 'unavailable' });
      }
    }
    run();
  }, [router]);

  const percent = REFERRAL_BONUS_PERCENT;

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
        <div className="space-y-2">
          <h1 className="text-2xl font-black text-slate-900 dark:text-white">{t('referral.page.title')}</h1>
          <p className="text-sm text-slate-700 dark:text-slate-300 max-w-prose">
            {t('referral.page.intro', { percent })} {t('referral.page.introFriend', { percent })}
          </p>
        </div>

        {load.status === 'unavailable' && (
          <p role="status" className="p-4 rounded-2xl bg-studio-panel/70 border border-studio-border text-sm text-slate-600 dark:text-slate-400">
            {t('referral.page.unavailable')}
          </p>
        )}

        {load.status === 'ok' && (
          <>
            <section className="p-5 rounded-2xl bg-studio-panel/70 border border-studio-border space-y-4">
              <a
                href={whatsappShareHref(t('referral.page.shareMessage', { percent, link: load.overview.link }))}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-black transition-colors"
              >
                <MessageCircle className="w-4 h-4" aria-hidden="true" />
                {t('referral.page.shareWhatsapp')}
              </a>

              <div className="grid gap-3 sm:grid-cols-[auto,1fr]">
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">{t('referral.page.codeLabel')}</p>
                  <div className="flex items-center gap-2">
                    <p dir="ltr" className="px-3 py-1.5 rounded-xl bg-brand-400/10 border border-brand-500/25 font-mono text-xl font-black tracking-[0.2em] text-slate-900 dark:text-white">
                      {load.overview.code}
                    </p>
                    <CopyButton value={load.overview.code} label={t('referral.page.copy')} copiedLabel={t('referral.page.copied')} />
                  </div>
                </div>
                <div className="space-y-1 min-w-0">
                  <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">{t('referral.page.linkLabel')}</p>
                  <div className="flex items-center gap-2">
                    <p dir="ltr" className="flex-1 min-w-0 truncate px-3 py-2 rounded-xl bg-studio-field border border-studio-border font-mono text-xs text-slate-800 dark:text-slate-200">
                      {load.overview.link}
                    </p>
                    <CopyButton value={load.overview.link} label={t('referral.page.copy')} copiedLabel={t('referral.page.copied')} />
                  </div>
                </div>
              </div>
            </section>

            {load.overview.welcomePending && (
              <p className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-800 dark:text-emerald-200">
                <Gift className="w-4 h-4 shrink-0" aria-hidden="true" />
                {t('referral.page.ownWelcome', { percent })}
              </p>
            )}

            <section className="grid grid-cols-3 gap-3">
              {[
                { label: t('referral.page.statsSignedUp'), value: load.overview.refereeCount },
                { label: t('referral.page.statsPurchased'), value: load.overview.referees.filter((r) => r.purchased).length },
                { label: t('referral.page.statsEarned'), value: load.overview.totalEarned },
              ].map((stat) => (
                <div key={stat.label} className="p-4 rounded-2xl bg-studio-panel/70 border border-studio-border">
                  <p dir="ltr" className="text-2xl font-black font-mono text-slate-900 dark:text-white">{n(stat.value)}</p>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">{stat.label}</p>
                </div>
              ))}
            </section>

            <section className="p-5 rounded-2xl bg-studio-panel/70 border border-studio-border space-y-3">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-brand-400" aria-hidden="true" />
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">{t('referral.page.listTitle')}</h2>
              </div>
              {load.overview.referees.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">{t('referral.page.empty')}</p>
              ) : (
                <ul aria-label={t('referral.page.listTitle')} className="divide-y divide-studio-border">
                  {load.overview.referees.map((referee, index) => (
                    <li key={`${referee.joinedAt}-${index}`} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                      <div>
                        <p className="text-slate-800 dark:text-slate-200 font-medium">{referee.name ?? t('referral.page.unknownName')}</p>
                        <p className={referee.purchased ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}>
                          {referee.purchased ? t('referral.page.statusPurchased') : t('referral.page.statusSignedUp')}
                        </p>
                      </div>
                      {referee.earned > 0 && (
                        <span dir="ltr" className="font-mono font-bold text-emerald-600 dark:text-emerald-400">+{n(referee.earned)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
