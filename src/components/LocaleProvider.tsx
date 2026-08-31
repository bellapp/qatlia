'use client';

import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Globe } from 'lucide-react';
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_COOKIE_NAME,
  LOCALE_LABELS,
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

export function LocaleSwitcher({ className = '' }: { className?: string }) {
  const { locale, setLocale, t } = useLocale();
  return (
    <div role="group" aria-label={t('nav.languageAria')} className={`flex items-center gap-0.5 ${className}`}>
      <Globe className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 me-1" aria-hidden="true" />
      {LOCALES.map((candidate) => (
        <button
          key={candidate}
          type="button"
          lang={candidate}
          aria-pressed={locale === candidate}
          title={t('nav.languageOptionAria', { language: t(`language.${candidate}`) })}
          onClick={() => setLocale(candidate)}
          className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-all ${
            locale === candidate
              ? 'bg-brand-500 text-slate-950'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          {LOCALE_LABELS[candidate]}
        </button>
      ))}
    </div>
  );
}
