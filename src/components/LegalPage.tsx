'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { QatlIALogo } from '@/components/QatlIALogo';
import { LocaleSwitcher, useLocale } from '@/components/LocaleProvider';
import { formatDateTime, type TranslationKey } from '@/i18n';
import {
  LEGAL_DOCS,
  LEGAL_ROUTES,
  LEGAL_UPDATED_AT,
  legalSectionKeys,
  legalVars,
  type LegalDoc,
} from '@/lib/legal';

/**
 * One legal document in the visitor's language. A section body is plain text:
 * blank lines separate paragraphs, and a paragraph whose lines all start with
 * "- " is a list, so the catalogs never carry markup.
 */
function Body({ text }: { text: string }) {
  return (
    <>
      {text.split('\n\n').map((block, i) => {
        const lines = block.split('\n');
        const isList = lines.every((line) => line.startsWith('- '));
        if (isList) {
          return (
            <ul key={i} className="list-disc ps-5 space-y-1.5">
              {lines.map((line, j) => (
                <li key={j}>{line.slice(2)}</li>
              ))}
            </ul>
          );
        }
        // A lead-in line followed by list items ("Il est interdit de :\n- …").
        const firstItem = lines.findIndex((line) => line.startsWith('- '));
        if (firstItem > 0 && lines.slice(firstItem).every((line) => line.startsWith('- '))) {
          return (
            <div key={i} className="space-y-2">
              <p>{lines.slice(0, firstItem).join(' ')}</p>
              <ul className="list-disc ps-5 space-y-1.5">
                {lines.slice(firstItem).map((line, j) => (
                  <li key={j}>{line.slice(2)}</li>
                ))}
              </ul>
            </div>
          );
        }
        return <p key={i}>{block}</p>;
      })}
    </>
  );
}

export function LegalPage({ doc }: { doc: LegalDoc }) {
  const { t, locale } = useLocale();
  const vars = legalVars();
  const updated = formatDateTime(locale, `${LEGAL_UPDATED_AT}T12:00:00Z`, { dateStyle: 'long' });

  return (
    <div className="min-h-screen bg-studio-canvas text-slate-700 dark:text-slate-200">
      <header className="border-b border-studio-border/50">
        <div className="max-w-3xl mx-auto flex items-center gap-3 px-4 sm:px-6 h-14">
          <Link href="/" className="flex items-center gap-2 me-auto" aria-label={t('nav.brandAria')}>
            <span className="text-brand-400"><QatlIALogo size="sm" /></span>
            <span className="font-display font-extrabold tracking-tight text-slate-900 dark:text-white">QatliA</span>
          </Link>
          <LocaleSwitcher />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4 rtl:-scale-x-100" aria-hidden="true" />
          {t('legal.backHome')}
        </Link>

        <h1 className="mt-6 text-3xl sm:text-4xl font-black tracking-[-0.02em] text-slate-900 dark:text-white">
          {t(`legal.${doc}.title` as TranslationKey)}
        </h1>
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">{t(`legal.${doc}.summary` as TranslationKey)}</p>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t('legal.updated', { date: updated })}</p>

        <div className="mt-10 space-y-9">
          {legalSectionKeys(doc).map((key, index) => (
            <section key={key} aria-labelledby={`${doc}-${key}`}>
              <h2 id={`${doc}-${key}`} className="text-lg font-black text-slate-900 dark:text-white">
                <span dir="ltr" className="text-amber-700 dark:text-brand-400 me-2">{index + 1}.</span>
                {t(`legal.${doc}.sections.${key}.title` as TranslationKey)}
              </h2>
              <div className="mt-3 space-y-3 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                <Body text={t(`legal.${doc}.sections.${key}.body` as TranslationKey, vars)} />
              </div>
            </section>
          ))}
        </div>

        <p className="mt-12 p-4 rounded-xl bg-studio-panel border border-studio-border text-sm text-slate-700 dark:text-slate-300">
          {t('legal.contactLine', vars)}
        </p>

        <nav aria-label={t('legal.otherDocs')} className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {LEGAL_DOCS.filter((other) => other !== doc).map((other) => (
            <Link
              key={other}
              href={LEGAL_ROUTES[other]}
              className="font-bold text-amber-700 dark:text-brand-400 hover:underline"
            >
              {t(`legal.nav.${other}` as TranslationKey)}
            </Link>
          ))}
        </nav>
      </main>
    </div>
  );
}
