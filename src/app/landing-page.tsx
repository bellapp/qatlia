'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowRight, Scissors, Camera, TrendingUp, FileText, Layers, Languages, Check, X } from 'lucide-react';
import { QatlIALogo } from '@/components/QatlIALogo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LocaleSwitcher, useLocale } from '@/components/LocaleProvider';
import { LOCALES } from '@/i18n';
import { BILLING_CURRENCY, CREDIT_PACKS } from '@/lib/billing/catalog';

/** Vision analyses granted on sign-up; optimization and exports stay free. */
const FREE_VISION_CREDITS = 5;

/**
 * Every figure printed on this page is read from the code that enforces it:
 * the sign-up grant above, the billing catalog below, and the list of shipped
 * locales. Nothing here is a marketing round number.
 */
const ARTISAN_PACK = CREDIT_PACKS.standard;
const PRO_PACK = CREDIT_PACKS.pro;
const MAX_PACK = CREDIT_PACKS.atelier_max;

const STATS = ['waste', 'surface', 'time', 'credits'] as const;

/** The navy band's four figures — value from code, label from the catalog. */
const HERO_STATS = [
  { key: 'credits', value: String(FREE_VISION_CREDITS) },
  { key: 'free', value: `0 ${BILLING_CURRENCY}` },
  { key: 'max', value: MAX_PACK.displayCredits },
  { key: 'langs', value: String(LOCALES.length) },
] as const;

/** Six things the product really does, in a 3×2 grid, icons all amber. */
const FEATURES = [
  { key: 'scan', icon: Camera },
  { key: 'guillotine', icon: Scissors },
  { key: 'report', icon: FileText },
  { key: 'edges', icon: Layers },
  { key: 'waste', icon: TrendingUp },
  { key: 'langs', icon: Languages },
] as const;

const STEPS = [
  { key: 'one', number: '1' },
  { key: 'two', number: '2' },
  { key: 'three', number: '3' },
] as const;

/** Eyebrow + heading + blueprint rule, shared by every section header. */
function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="text-center mb-12">
      <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-brand-500 dark:text-brand-400 mb-3 font-mono">{eyebrow}</p>
      <h2 className="text-3xl sm:text-4xl font-black tracking-[-0.02em] text-slate-900 dark:text-white">{title}</h2>
      <div aria-hidden="true" className="mx-auto mt-4 flex items-center justify-center gap-1.5">
        <span className="h-px w-10 bg-studio-border" />
        <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />
        <span className="h-px w-10 bg-studio-border" />
      </div>
    </div>
  );
}

/** One line of a pricing card: amber check for what is included, grey cross for what is not. */
function PlanLine({ children, included = true }: { children: React.ReactNode; included?: boolean }) {
  return (
    <li className={`flex items-center gap-3 ${included ? 'text-slate-800 dark:text-slate-200' : 'text-slate-400 dark:text-slate-500'}`}>
      {included ? (
        <Check className="w-4 h-4 shrink-0 text-brand-500 dark:text-brand-400" aria-hidden="true" />
      ) : (
        <X className="w-4 h-4 shrink-0" aria-hidden="true" />
      )}
      {children}
    </li>
  );
}

export default function LandingPage() {
  const { t } = useLocale();

  return (
    <div className="min-h-screen bg-studio-canvas text-slate-900 dark:text-slate-100 font-body antialiased overflow-x-hidden">
      {/* Navigation — wraps to two tidy rows on narrow screens instead of
          clipping: nothing is ever cut off-canvas. The anchor nav only appears
          from `md` up, so the mobile two-row layout is untouched. */}
      <header className="sticky top-0 z-50 border-b border-studio-border/50 bg-studio-canvas/70 backdrop-blur-2xl">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-x-2 gap-y-1.5 px-3 sm:px-10 py-2.5 sm:py-0 sm:h-16">
          <Link href="/" className="flex items-center gap-2 shrink-0 mr-auto md:mr-4" aria-label={t('nav.brandAria')}>
            <div className="text-brand-400"><QatlIALogo size="md" /></div>
            <span className="font-display font-extrabold text-lg tracking-tight text-slate-900 dark:text-white">QatlIA</span>
          </Link>
          {/* Only the two sections that exist get an anchor — no dead FAQ link. */}
          <nav className="hidden md:flex items-center gap-6 md:mr-auto">
            <a href="#fonctionnalites" className="text-sm font-medium text-slate-600 hover:text-brand-500 dark:text-slate-300 dark:hover:text-brand-400 transition-colors">
              {t('nav.features')}
            </a>
            <a href="#tarifs" className="text-sm font-medium text-slate-600 hover:text-brand-500 dark:text-slate-300 dark:hover:text-brand-400 transition-colors">
              {t('nav.pricing')}
            </a>
          </nav>
          <Link href="/auth/login" className="text-xs sm:text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white transition-colors whitespace-nowrap">
            {t('nav.login')}
          </Link>
          <LocaleSwitcher />
          <ThemeToggle className="hidden sm:inline-flex" />
          <Link
            href="/atelier"
            className="ml-auto sm:ml-0 px-3.5 sm:px-5 py-2.5 rounded-xl bg-brand-400 hover:bg-brand-500 text-slate-950 font-black text-xs sm:text-sm transition-all shadow-lg shadow-brand-500/20 active:scale-95 whitespace-nowrap shrink-0"
          >
            <span className="sm:hidden">{t('nav.tryFreeShort')}</span>
            <span className="hidden sm:inline">{t('nav.tryFree')}</span>
          </Link>
        </div>
      </header>

      <section className="relative pt-24 pb-20 sm:pt-32 sm:pb-28 px-6 sm:px-10">
        <div className="absolute inset-0 bg-[radial-gradient(800px_circle_at_50%_-100px,rgba(245,166,35,0.08),transparent_70%)] pointer-events-none" />
        <div className="max-w-4xl mx-auto text-center relative">
          <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#FEF3E2] dark:bg-brand-400/10 border border-brand-500/30 text-amber-700 dark:text-brand-400 text-xs font-bold mb-6">
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
              className="group px-8 py-4 rounded-2xl bg-brand-400 hover:bg-brand-500 text-slate-950 font-black text-base transition-all shadow-xl shadow-brand-500/25 active:scale-[0.98] flex items-center gap-2.5"
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

          {/* Product screenshot (real app capture) in a framed instrument window,
              like the Stitch mix hero: soft amber glow + fine border + browser dot. */}
          <div className="relative mt-14 max-w-3xl mx-auto">
            <div aria-hidden="true" className="absolute -inset-6 bg-[radial-gradient(400px_circle_at_50%_30%,rgba(245,166,35,0.14),transparent_70%)] pointer-events-none" />
            <div className="relative rounded-2xl border border-studio-border bg-white shadow-2xl shadow-slate-900/10 overflow-hidden">
              {/* window chrome bar */}
              <div className="flex items-center gap-1.5 px-4 py-2.5 bg-studio-field/70 border-b border-studio-border">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-400/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
                <span className="ms-3 text-[10px] font-mono text-slate-500" dir="ltr">qatlia.ma — atelier</span>
              </div>
              <img
                src="/hero-atelier.webp"
                alt={t('hero.screenshotAlt')}
                width={810}
                height={770}
                className="w-full h-auto block"
                loading="eager"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Slogan 2 band: three action beats, oversized typographic treatment.
          Only the final word carries the brand color — works identically for
          FR / EN / AR without relying on sentence punctuation.
          Under it, the Stitch stats row: four figures, every one of them read
          from code (sign-up grant, billing catalog, shipped locales). */}
      {/* MIX: deep-navy band, saw-tooth top edge (industrial cue), white type */}
      <section className="relative bg-[#0F172A] dark:bg-[#060B14] py-12 px-6 sm:px-10 overflow-hidden">
        {/* Saw-tooth divider along the top — echoes the saw-blade logo. The
            triangles carry the color of the section *above* (the hero canvas),
            otherwise they vanish into the band they sit in. */}
        <svg aria-hidden="true" className="absolute top-0 left-0 w-full h-2 text-white dark:text-[#060B14]" preserveAspectRatio="none" viewBox="0 0 120 8">
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

        <div className="max-w-4xl mx-auto mt-10 grid grid-cols-2 sm:grid-cols-4 gap-y-8 sm:divide-x sm:divide-dashed sm:divide-white/10 rtl:sm:divide-x-reverse">
          {HERO_STATS.map((stat) => (
            <div key={stat.key} className="text-center px-4">
              <p className="font-mono text-[28px] sm:text-[32px] leading-none font-bold text-brand-400" dir="ltr">
                {stat.value}
              </p>
              <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.15em] text-slate-400 leading-tight">
                {t(`hero.stats.${stat.key}`)}
              </p>
            </div>
          ))}
        </div>
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

      {/* Features — 6 cards, 3×2 on desktop, on the alternate surface that gives
          the page its Stitch rhythm (white → navy → #F8FAFC → white). */}
      <section id="fonctionnalites" className="bg-[#F8FAFC] dark:bg-[#0B1424] border-y border-studio-border/60 px-6 sm:px-10 py-20 sm:py-24">
        <div className="max-w-6xl mx-auto">
          <SectionHeading eyebrow={t('features.eyebrow')} title={t('features.title')} />

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((feat) => (
              <div key={feat.key} className="group p-8 rounded-2xl bg-white dark:bg-studio-panel border border-studio-border hover:border-brand-400 transition-colors shadow-sm space-y-4">
                <span className="shrink-0 w-12 h-12 rounded-xl bg-brand-300 dark:bg-brand-400/10 border border-brand-500/20 text-brand-500 dark:text-brand-400 flex items-center justify-center">
                  <feat.icon className="w-6 h-6" />
                </span>
                <h3 className="font-bold text-slate-900 dark:text-white text-xl tracking-[-0.01em]">{t(`features.${feat.key}.title`)}</h3>
                <p className="text-base text-slate-600 dark:text-slate-400 leading-relaxed">{t(`features.${feat.key}.desc`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-4xl mx-auto px-6 sm:px-10 py-20 sm:py-24">
        <SectionHeading eyebrow={t('steps.eyebrow')} title={t('steps.title')} />

        <div className="grid sm:grid-cols-3 gap-6">
          {STEPS.map((item) => (
            <div key={item.key} className="relative p-6 rounded-2xl bg-studio-panel/50 border border-studio-border/70 text-center space-y-3">
              <span className="inline-flex w-10 h-10 rounded-xl bg-brand-400 text-slate-950 font-black text-lg items-center justify-center">
                {item.number}
              </span>
              <h3 className="font-black text-slate-900 dark:text-white">{t(`steps.${item.key}.title`)}</h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">{t(`steps.${item.key}.desc`)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing — Stitch card anatomy, QatlIA figures. Prices and allowances are
          read from src/lib/billing/catalog.ts so a card can never quote an amount
          the checkout does not charge. No "priority exports" tier: every export
          is free on every plan. */}
      <section id="tarifs" className="bg-[#F8FAFC] dark:bg-[#0B1424] border-y border-studio-border/60 px-6 sm:px-10 py-20 sm:py-24">
        <div className="max-w-5xl mx-auto">
          <SectionHeading eyebrow={t('pricing.eyebrow')} title={t('pricing.title')} />

          <div className="grid md:grid-cols-2 gap-6 sm:gap-8 max-w-4xl mx-auto">
            {/* Free plan */}
            <div className="flex flex-col p-8 sm:p-10 rounded-2xl bg-white dark:bg-studio-panel border border-studio-border shadow-sm">
              <h3 className="text-2xl font-black tracking-[-0.01em] text-slate-900 dark:text-white">{t('pricing.freeName')}</h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{t('pricing.freeDesc')}</p>
              <p className="mt-8 font-mono text-[40px] leading-none font-bold text-slate-900 dark:text-white" dir="ltr">
                0 <span className="text-xl text-slate-500 dark:text-slate-400">{BILLING_CURRENCY}</span>
              </p>
              <ul className="mt-8 mb-10 space-y-4 flex-grow text-sm">
                <PlanLine>{t('pricing.freeOptimize')}</PlanLine>
                <PlanLine>{t('pricing.freeExports')}</PlanLine>
                <PlanLine included={false}>{t('pricing.freeNoScan')}</PlanLine>
              </ul>
              <Link
                href="/auth/login"
                className="mt-auto w-full text-center py-3 rounded-xl border border-studio-border hover:border-studio-border-hover text-slate-800 dark:text-slate-200 font-bold text-sm transition-colors"
              >
                {t('pricing.freeCta')}
              </Link>
            </div>

            {/* Artisan pack — the catalog's highlighted pack */}
            <div className="relative flex flex-col p-8 sm:p-10 rounded-2xl bg-white dark:bg-studio-panel border-2 border-brand-400 shadow-xl shadow-brand-500/10">
              <span className="absolute -top-3 end-8 px-3 py-1 rounded-full bg-brand-400 text-slate-950 font-mono text-[10px] font-bold uppercase tracking-[0.12em]">
                {t('pricing.popular')}
              </span>
              <h3 className="text-2xl font-black tracking-[-0.01em] text-slate-900 dark:text-white">{t('billing.packs.standard.name')}</h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{t('billing.packs.standard.description')}</p>
              <p className="mt-8 font-mono text-[40px] leading-none font-bold text-slate-900 dark:text-white" dir="ltr">
                {ARTISAN_PACK.priceMAD} <span className="text-xl text-slate-500 dark:text-slate-400">{BILLING_CURRENCY}</span>
              </p>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                {t('pricing.packSuffix', { count: ARTISAN_PACK.displayCredits })}
              </p>
              <ul className="mt-8 mb-10 space-y-4 flex-grow text-sm">
                <PlanLine>{t('pricing.packAllFree')}</PlanLine>
                <PlanLine>{t('pricing.packScan')}</PlanLine>
              </ul>
              <Link
                href="/credits"
                className="mt-auto w-full text-center py-3 rounded-xl bg-brand-400 hover:bg-brand-500 text-slate-950 font-black text-sm transition-colors shadow-lg shadow-brand-500/20"
              >
                {t('pricing.packCta')}
              </Link>
            </div>
          </div>

          <p className="mt-8 text-center text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            {t('pricing.more', {
              proName: t('billing.packs.pro.name'),
              proPrice: PRO_PACK.priceMAD,
              proCredits: PRO_PACK.displayCredits,
              maxName: t('billing.packs.atelierMax.name'),
              maxPrice: MAX_PACK.priceMAD,
              maxCredits: MAX_PACK.displayCredits,
            })}{' '}
            <Link href="/credits" className="font-bold text-brand-500 dark:text-brand-400 hover:underline">
              {t('pricing.moreLink')}
            </Link>
          </p>
        </div>
      </section>

      {/* CTA Footer */}
      <section className="max-w-3xl mx-auto px-6 sm:px-10 py-20 text-center">
        <div className="p-10 sm:p-14 rounded-3xl bg-[#0F172A] dark:bg-[#0B1424] border border-[#1E3A5F] relative overflow-hidden shadow-2xl shadow-brand-500/10">
          <div className="absolute inset-0 bg-[radial-gradient(400px_circle_at_50%_50%,rgba(245,166,35,0.10),transparent_70%)] pointer-events-none" />
          <div className="relative space-y-5">
            <h2 className="text-2xl sm:text-3xl font-black tracking-[-0.02em] text-white">{t('finalCta.title')}</h2>
            <p className="text-slate-300 text-sm max-w-lg mx-auto">
              {t('finalCta.body', { count: FREE_VISION_CREDITS })}
            </p>
            <Link
              href="/atelier"
              className="inline-flex items-center gap-2.5 px-8 py-4 rounded-2xl bg-brand-400 hover:bg-brand-500 text-slate-950 font-black text-base transition-all shadow-xl shadow-brand-500/25 active:scale-[0.98]"
            >
              <Scissors className="w-5 h-5" />
              {t('finalCta.button')}
              <ArrowRight className="w-4 h-4 rtl:rotate-180" />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer — Stitch layout (brand left, links right, dashed top rule) on the
          real navy ground. Only routes that exist are linked: there is no terms
          or privacy page yet, so neither is invented here. */}
      <footer className="bg-[#0F172A] dark:bg-[#060B14] border-t border-dashed border-white/15 px-6 sm:px-10 py-10">
        <div className="max-w-6xl mx-auto flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div className="text-center md:text-start">
            <div className="flex items-center justify-center md:justify-start gap-2 text-sm mb-2">
              <span className="text-brand-400"><QatlIALogo size="sm" /></span>
              <span className="font-black text-white tracking-tight">{t('footer.brand')}</span>
            </div>
            <p className="text-[11px] text-slate-400 max-w-md leading-relaxed">{t('footer.tagline')}</p>
          </div>

          <nav className="flex flex-wrap items-center justify-center md:justify-end gap-x-6 gap-y-3">
            <a href="#fonctionnalites" className="font-mono text-[11px] uppercase tracking-[0.12em] text-slate-400 hover:text-brand-400 transition-colors">
              {t('nav.features')}
            </a>
            <a href="#tarifs" className="font-mono text-[11px] uppercase tracking-[0.12em] text-slate-400 hover:text-brand-400 transition-colors">
              {t('nav.pricing')}
            </a>
            <Link href="/credits" className="font-mono text-[11px] uppercase tracking-[0.12em] text-slate-400 hover:text-brand-400 transition-colors">
              {t('footer.links.credits')}
            </Link>
            <Link href="/auth/login" className="font-mono text-[11px] uppercase tracking-[0.12em] text-slate-400 hover:text-brand-400 transition-colors">
              {t('nav.login')}
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
