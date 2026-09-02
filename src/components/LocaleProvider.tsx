'use client';

import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_COOKIE_NAME,
  LOCALE_STORAGE_KEY,
  dirFor,
  formatNumber,
  isLocale,
  translate,
  translatePlural,
  type Direction,
  type Locale,
  type PluralTranslationKey,
  type TranslationKey,
  type TranslationVars,
} from '@/i18n';

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, vars?: TranslationVars) => string;
  /** Plural-aware lookup: picks `<key>.one` or `<key>.many` for `count`. */
  tn: (key: PluralTranslationKey, count: number, vars?: TranslationVars) => string;
  /** Locale-aware figure formatting for amounts and counts (never for cm/mm geometry). */
  n: (value: number, options?: Intl.NumberFormatOptions) => string;
  dir: Direction;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: (key, vars) => translate(DEFAULT_LOCALE, key, vars),
  tn: (key, count, vars) => translatePlural(DEFAULT_LOCALE, key, count, vars),
  n: (value, options) => formatNumber(DEFAULT_LOCALE, value, options),
  dir: dirFor(DEFAULT_LOCALE),
});

export function useLocale() {
  return useContext(LocaleContext);
}

// Applying the preference in a layout effect keeps it off the painted frame
// after hydration; on the server there is nothing to apply.
const useApplyEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function readPersistedLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // Private-mode storage access can throw; the cookie mirror still applies.
  }
  const match = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE_NAME}=([^;]*)`));
  const fromCookie = match ? decodeURIComponent(match[1]) : null;
  return isLocale(fromCookie) ? fromCookie : DEFAULT_LOCALE;
}

function persistLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Ignore: the cookie below is the fallback carrier of the preference.
  }
  document.cookie = `${LOCALE_COOKIE_NAME}=${locale}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
}

function applyDocumentLocale(locale: Locale): void {
  const root = document.documentElement;
  root.lang = locale;
  root.dir = dirFor(locale);
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  // The server renders the default locale, so the first client render must too;
  // the stored preference is adopted immediately after hydration.
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useApplyEffect(() => {
    const persisted = readPersistedLocale();
    setLocaleState(persisted);
    applyDocumentLocale(persisted);
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    persistLocale(next);
    applyDocumentLocale(next);
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key: TranslationKey, vars?: TranslationVars) => translate(locale, key, vars),
      tn: (key: PluralTranslationKey, count: number, vars?: TranslationVars) =>
        translatePlural(locale, key, count, vars),
      n: (value: number, options?: Intl.NumberFormatOptions) => formatNumber(locale, value, options),
      dir: dirFor(locale),
    }),
    [locale, setLocale]
  );

  // The provider is always mounted: no subtree ever renders outside the context.
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/** Inline SVG country flags — emoji flags render as letter pairs (FR/GB/MA)
 *  on Windows Chrome, so real vector flags are the only cross-platform option. */
function LocaleFlag({ locale, className = '' }: { locale: Locale; className?: string }) {
  if (locale === 'fr') {
    return (
      <svg viewBox="0 0 3 2" className={className} aria-hidden="true">
        <rect width="1" height="2" fill="#0055A4" />
        <rect x="1" width="1" height="2" fill="#FFFFFF" />
        <rect x="2" width="1" height="2" fill="#EF4135" />
      </svg>
    );
  }
  if (locale === 'en') {
    return (
      <svg viewBox="0 0 60 30" className={className} aria-hidden="true">
        <clipPath id="uk-clip">
          <rect width="60" height="30" rx="3" />
        </clipPath>
        <g clipPath="url(#uk-clip)">
          <rect width="60" height="30" fill="#012169" />
          <path d="M0,0 60,30 M60,0 0,30" stroke="#FFFFFF" strokeWidth="6" />
          <path d="M0,0 60,30 M60,0 0,30" stroke="#C8102E" strokeWidth="3.6" />
          <path d="M30,0 V30 M0,15 H60" stroke="#FFFFFF" strokeWidth="10" />
          <path d="M30,0 V30 M0,15 H60" stroke="#C8102E" strokeWidth="6" />
        </g>
      </svg>
    );
  }
  // Morocco: red field with green pentagram
  return (
    <svg viewBox="0 0 60 42" className={className} aria-hidden="true">
      <rect width="60" height="42" rx="4" fill="#C1272D" />
      <path
        d="M30 12 L32.35 20.45 L26 15.55 L34 15.55 L27.65 20.45 Z"
        fill="none"
        stroke="#006233"
        strokeWidth="1.6"
        strokeLinejoin="miter"
      />
      <path
        d="M30 12 L33.6 24.4 L23.4 17.2 L36.6 17.2 L26.4 24.4 Z"
        fill="none"
        stroke="#006233"
        strokeWidth="1.6"
        strokeLinejoin="miter"
        strokeDasharray="0"
      />
    </svg>
  );
}

export function LocaleSwitcher({ className = '' }: { className?: string }) {
  const { locale, setLocale, t } = useLocale();
  return (
    <div role="group" aria-label={t('nav.languageAria')} className={`relative inline-flex items-center ${className}`}>
      <LocaleFlag locale={locale} className="w-5 h-3.5 rounded-[2px] pointer-events-none absolute start-2 z-10 shadow-sm" />
      <select
        aria-label={t('nav.languageAria')}
        value={locale}
        onChange={(event) => {
          const next = isLocale(event.target.value) ? event.target.value : DEFAULT_LOCALE;
          setLocale(next);
        }}
        style={{ colorScheme: 'light dark' }}
        className="appearance-none bg-transparent border border-slate-300 dark:border-studio-border hover:border-slate-400 dark:hover:border-studio-border-hover rounded-lg py-1 ps-9 pe-6 text-xs font-bold text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/50 cursor-pointer transition-colors [&>option]:bg-white [&>option]:text-slate-900 dark:[&>option]:bg-slate-900 dark:[&>option]:text-slate-100"
      >
        {LOCALES.map((candidate) => (
          <option key={candidate} value={candidate} lang={candidate}>
            {t(`language.${candidate}`)}
          </option>
        ))}
      </select>
      {/* Chevron (native select arrow is hidden by appearance-none) */}
      <svg
        className="w-3 h-3 text-slate-500 dark:text-slate-400 pointer-events-none absolute end-2"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clipRule="evenodd" />
      </svg>
    </div>
  );
}
