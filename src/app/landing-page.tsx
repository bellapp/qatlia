'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowRight, Scissors, Camera, TrendingUp, FileText } from 'lucide-react';
import { QatlIALogo } from '@/components/QatlIALogo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LocaleSwitcher, useLocale } from '@/components/LocaleProvider';

/** Vision analyses granted on sign-up; optimization and exports stay free. */
const FREE_VISION_CREDITS = 5;

const STATS = ['waste', 'surface', 'time', 'credits'] as const;

const FEATURES = [
  { key: 'scan', icon: Camera, color: 'text-sky-400 bg-sky-500/10 border-sky-500/20' },
  { key: 'guillotine', icon: Scissors, color: 'text-brand-400 bg-brand-500/10 border-brand-500/20' },
  { key: 'report', icon: FileText, color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
  { key: 'waste', icon: TrendingUp, color: 'text-purple-400 bg-purple-500/10 border-purple-500/20' },
] as const;

const STEPS = [
  { key: 'one', number: '1' },
  { key: 'two', number: '2' },
  { key: 'three', number: '3' },
] as const;

export default function LandingPage() {
  const { t } = useLocale();

  return (
    <div className="min-h-screen bg-studio-canvas text-slate-900 dark:text-slate-100 font-sans antialiased overflow-x-hidden">
      {/* Navigation */}
      <header className="sticky top-0 z-50 border-b border-studio-border/50 bg-studio-canvas/70 backdrop-blur-2xl">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 sm:px-10 h-16">
          <Link href="/" className="flex items-center gap-3" aria-label={t('nav.brandAria')}>
            <div className="text-brand-400"><QatlIALogo size="md" /></div>
            <span className="font-display font-extrabold text-lg tracking-tight text-slate-900 dark:text-white">QatlIA</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/auth/login" className="text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white transition-colors">
              {t('nav.login')}
            </Link>
            <LocaleSwitcher />
            <ThemeToggle />
            <Link
              href="/atelier"
              className="px-5 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-400 text-slate-950 font-black text-sm transition-all shadow-lg shadow-brand-500/20 active:scale-95"
            >
              {t('nav.tryFree')}
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative pt-24 pb-20 sm:pt-32 sm:pb-28 px-6 sm:px-10">
        <div className="absolute inset-0 bg-[radial-gradient(800px_circle_at_50%_-100px,rgba(245,166,35,0.08),transparent_70%)] pointer-events-none" />
        <div className="max-w-4xl mx-auto text-center relative">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-500/10 border border-brand-500/20 text-brand-400 text-xs font-semibold mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
            {t('hero.badge')}
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight text-slate-900 dark:text-white leading-[1.05]">
            {t('hero.titleLead')}
            <br />
            <span className="text-brand-400">{t('hero.titleHighlight')}</span>
          </h1>

          <p className="mt-6 text-base sm:text-lg text-slate-600 dark:text-slate-400 max-w-2xl mx-auto leading-relaxed">
            {t('hero.subtitle')}
          </p>

          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/atelier"
              className="group px-8 py-4 rounded-2xl bg-brand-500 hover:bg-brand-400 text-slate-950 font-black text-base transition-all shadow-xl shadow-brand-500/25 active:scale-[0.98] flex items-center gap-2.5"
            >
              <Scissors className="w-5 h-5" />
              {t('hero.ctaPrimary')}
              <ArrowRight className="w-4 h-4 rtl:rotate-180 ltr:group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5 transition-transform" />
            </Link>
            <Link
              href="/auth/login"
              className="px-8 py-4 rounded-2xl border border-studio-border hover:border-studio-border-hover text-slate-700 dark:text-slate-300 font-bold text-base transition-all"
            >
              {t('hero.ctaSecondary')}
            </Link>
          </div>

          <p className="mt-4 text-[11px] text-slate-600">
            {t('hero.note', { count: FREE_VISION_CREDITS })}
          </p>
        </div>
      </section>

      {/* Stats */}
      <section className="max-w-5xl mx-auto px-6 sm:px-10 pb-20">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {STATS.map((stat) => (
            <div key={stat} className="p-4 rounded-2xl bg-studio-panel/50 border border-studio-border/70 text-center">
              {/* Non-numeric wording by design: the only figure left here is the
                  credit grant, which the sign-up flow really applies. Measured
                  optimizer numbers live in docs/optimizer-benchmark.md, which is
                  not a web route, so no link is offered rather than a broken one. */}
              <p className="text-base sm:text-lg font-black text-slate-900 dark:text-white tracking-tight">
                {t(`stats.${stat}.title`, { count: FREE_VISION_CREDITS })}
              </p>
              <p className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 leading-tight">
                {t(`stats.${stat}.label`)}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 pb-24">
        <div className="text-center mb-12">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-400/80 mb-3">{t('features.eyebrow')}</p>
          <h2 className="text-3xl font-black text-slate-900 dark:text-white">{t('features.title')}</h2>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {FEATURES.map((feat) => (
            <div key={feat.key} className="group p-5 rounded-2xl bg-studio-panel/50 border border-studio-border/70 hover:border-brand-500/30 transition-all space-y-3">
              <span className={`shrink-0 w-10 h-10 rounded-xl ${feat.color} flex items-center justify-center border`}>
                <feat.icon className="w-5 h-5" />
              </span>
              <h3 className="font-black text-slate-900 dark:text-white text-sm">{t(`features.${feat.key}.title`)}</h3>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">{t(`features.${feat.key}.desc`)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-4xl mx-auto px-6 sm:px-10 pb-24">
        <div className="text-center mb-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-400/80 mb-3">{t('steps.eyebrow')}</p>
          <h2 className="text-3xl font-black text-slate-900 dark:text-white">{t('steps.title')}</h2>
        </div>

        <div className="grid sm:grid-cols-3 gap-6">
          {STEPS.map((item) => (
            <div key={item.key} className="relative p-6 rounded-2xl bg-studio-panel/50 border border-studio-border/70 text-center space-y-3">
              <span className="inline-flex w-10 h-10 rounded-xl bg-brand-500 text-slate-950 font-black text-lg items-center justify-center">
                {item.number}
              </span>
              <h3 className="font-black text-slate-900 dark:text-white">{t(`steps.${item.key}.title`)}</h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">{t(`steps.${item.key}.desc`)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA Footer */}
      <section className="max-w-3xl mx-auto px-6 sm:px-10 pb-20 text-center">
        <div className="p-10 sm:p-14 rounded-3xl bg-studio-panel/60 border border-studio-border/80 relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(400px_circle_at_50%_50%,rgba(245,166,35,0.06),transparent_70%)] pointer-events-none" />
          <div className="relative space-y-5">
            <h2 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white">{t('finalCta.title')}</h2>
            <p className="text-slate-600 dark:text-slate-400 text-sm max-w-lg mx-auto">
              {t('finalCta.body', { count: FREE_VISION_CREDITS })}
            </p>
            <Link
              href="/atelier"
              className="inline-flex items-center gap-2.5 px-8 py-4 rounded-2xl bg-brand-500 hover:bg-brand-400 text-slate-950 font-black text-base transition-all shadow-xl shadow-brand-500/25 active:scale-[0.98]"
            >
              <Scissors className="w-5 h-5" />
              {t('finalCta.button')}
              <ArrowRight className="w-4 h-4 rtl:rotate-180" />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-studio-border/60 px-6 sm:px-10 py-8 text-center">
        <div className="flex items-center justify-center gap-2 text-xs text-slate-600 mb-2">
          <QatlIALogo size="sm" />
          <span className="font-bold text-slate-500 dark:text-slate-400">{t('footer.brand')}</span>
        </div>
        <p className="text-[10px] text-slate-600">{t('footer.tagline')}</p>
      </footer>
    </div>
  );
}
