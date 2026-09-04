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
      {/* Navigation — wraps to two tidy rows on narrow screens instead of
          clipping: nothing is ever cut off-canvas. */}
      <header className="sticky top-0 z-50 border-b border-studio-border/50 bg-studio-canvas/70 backdrop-blur-2xl">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-x-2 gap-y-1.5 px-3 sm:px-10 py-2.5 sm:py-0 sm:h-16">
          <Link href="/" className="flex items-center gap-2 shrink-0 mr-auto" aria-label={t('nav.brandAria')}>
            <div className="text-brand-400"><QatlIALogo size="md" /></div>
            <span className="font-display font-extrabold text-lg tracking-tight text-slate-900 dark:text-white">QatlIA</span>
          </Link>
          <Link href="/auth/login" className="text-xs sm:text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white transition-colors whitespace-nowrap">
            {t('nav.login')}
          </Link>
          <LocaleSwitcher />
          <ThemeToggle className="hidden sm:inline-flex" />
          <Link
            href="/atelier"
            className="ml-auto sm:ml-0 px-3.5 sm:px-5 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-400 text-slate-950 font-black text-xs sm:text-sm transition-all shadow-lg shadow-brand-500/20 active:scale-95 whitespace-nowrap shrink-0"
          >
            <span className="sm:hidden">{t('nav.tryFreeShort')}</span>
            <span className="hidden sm:inline">{t('nav.tryFree')}</span>
          </Link>
        </div>
      </header>

      <section className="relative pt-24 pb-20 sm:pt-32 sm:pb-28 px-6 sm:px-10">
        <div className="absolute inset-0 bg-[radial-gradient(800px_circle_at_50%_-100px,rgba(245,166,35,0.08),transparent_70%)] pointer-events-none" />
        <div className="max-w-4xl mx-auto text-center relative">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-500/10 border border-brand-500/20 text-brand-400 text-xs font-semibold mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
            {t('hero.badge')}
          </div>

          {/* MIX: tighter tracking + a blueprint rule under the highlight line */}
          <h1 className="text-4xl sm:text-5xl lg:text-7xl font-black tracking-[-0.03em] text-slate-900 dark:text-white leading-[1.02]">
            {t('hero.titleLead')}
            <br />
            <span className="text-brand-400 underline decoration-brand-500/40 decoration-[3px] underline-offset-8">{t('hero.titleHighlight')}</span>
          </h1>

          <p className="mt-6 text-base sm:text-lg text-slate-600 dark:text-slate-400 max-w-2xl mx-auto leading-relaxed">
            {t('hero.subtitle')}
          </p>

          {/* Slogan 1: gain in two beats, second beat highlighted in brand color */}
          <p className="mt-7 text-lg sm:text-2xl font-black tracking-tight text-slate-800 dark:text-slate-200">
            {t('hero.taglineGain')}{' '}
            <span className="text-brand-500 dark:text-brand-400">{t('hero.taglineSave')}</span>
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

      {/* Slogan 2 band: three action beats, oversized typographic treatment.
          Only the final word carries the brand color — works identically for
          FR / EN / AR without relying on sentence punctuation. */}
      {/* MIX: deep-navy band, saw-tooth top edge (industrial cue), white type */}
      <section className="relative bg-[#0F172A] dark:bg-[#060B14] py-12 px-6 sm:px-10 overflow-hidden">
        {/* Saw-tooth divider along the top — echoes the saw-blade logo */}
        <svg aria-hidden="true" className="absolute top-0 left-0 w-full h-2 text-[#0F172A] dark:text-[#060B14]" preserveAspectRatio="none" viewBox="0 0 120 8">
          <path d="M0 8 L6 0 L12 8 Z" fill="currentColor" />
          {Array.from({ length: 9 }, (_, i) => (
            <path key={i} d={`M${(i + 1) * 12} 8 L${(i + 1) * 12 + 6} 0 L${(i + 1) * 12 + 12} 8 Z`} fill="currentColor" transform={`translate(0,0)`} />
          ))}
        </svg>
        {(() => {
          const slogan = t('hero.actionSlogan');
          const words = slogan.split(' ');
          const last = words.pop() ?? '';
          return (
            <p className="max-w-5xl mx-auto text-center text-2xl sm:text-4xl lg:text-5xl font-black tracking-tight text-white leading-tight pt-2">
              {words.join(' ')}{' '}
              <span className="text-brand-400">{last}</span>
            </p>
          );
        })()}
      </section>

      <section className="max-w-5xl mx-auto px-6 sm:px-10 pt-14 pb-20">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {STATS.map((stat) => (
            <div key={stat} className="relative p-4 pt-5 rounded-2xl bg-studio-panel/50 border border-studio-border/70 text-center overflow-hidden">
              {/* MIX: amber top rule — technical measurement cue */}
              <span aria-hidden="true" className="absolute top-0 left-1/2 -translate-x-1/2 w-10 h-0.5 bg-brand-500/70 rounded-full" />
              {/* Non-numeric wording by design: the only figure left here is the
                  credit grant, which the sign-up flow really applies. Measured
                  optimizer numbers live in docs/optimizer-benchmark.md, which is
                  not a web route, so no link is offered rather than a broken one. */}
              <p className="text-base sm:text-lg font-black text-slate-900 dark:text-white tracking-tight font-mono">
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
          <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-brand-400 mb-3 font-mono">{t('features.eyebrow')}</p>
          <h2 className="text-3xl sm:text-4xl font-black tracking-[-0.02em] text-slate-900 dark:text-white">{t('features.title')}</h2>
          {/* MIX: blueprint rule */}
          <div aria-hidden="true" className="mx-auto mt-4 flex items-center justify-center gap-1.5">
            <span className="h-px w-10 bg-studio-border" />
            <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
            <span className="h-px w-10 bg-studio-border" />
          </div>
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
          <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-brand-400 mb-3 font-mono">{t('steps.eyebrow')}</p>
          <h2 className="text-3xl sm:text-4xl font-black tracking-[-0.02em] text-slate-900 dark:text-white">{t('steps.title')}</h2>
          <div aria-hidden="true" className="mx-auto mt-4 flex items-center justify-center gap-1.5">
            <span className="h-px w-10 bg-studio-border" />
            <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
            <span className="h-px w-10 bg-studio-border" />
          </div>
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
        <div className="p-10 sm:p-14 rounded-3xl bg-[#0F172A] dark:bg-[#0B1424] border border-[#1E3A5F] relative overflow-hidden shadow-2xl shadow-brand-500/10">
          <div className="absolute inset-0 bg-[radial-gradient(400px_circle_at_50%_50%,rgba(245,166,35,0.10),transparent_70%)] pointer-events-none" />
          <div className="relative space-y-5">
            <h2 className="text-2xl sm:text-3xl font-black tracking-[-0.02em] text-white">{t('finalCta.title')}</h2>
            <p className="text-slate-300 text-sm max-w-lg mx-auto">
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
