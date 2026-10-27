'use client';

import React, { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import {
  DEFAULT_LOCALE,
  SELECTABLE_LOCALES,
  LOCALE_COOKIE_NAME,
  LOCALE_STORAGE_KEY,
  dirFor,
  formatNumber,
  isSelectableLocale,
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
    if (isSelectableLocale(stored)) return stored;
  } catch {
    // Private-mode storage access can throw; the cookie mirror still applies.
  }
  const match = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE_NAME}=([^;]*)`));
  const fromCookie = match ? decodeURIComponent(match[1]) : null;
  return isSelectableLocale(fromCookie) ? fromCookie : DEFAULT_LOCALE;
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
  // Each rendered UK flag needs its own clipPath id: the list shows several flags at once.
  const clipId = `uk-clip-${useId().replace(/:/g, '')}`;
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
        <clipPath id={clipId}>
          <rect width="60" height="30" rx="3" />
        </clipPath>
        <g clipPath={`url(#${clipId})`}>
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

type ListPosition = { top: number; minWidth: number; left?: number; right?: number };

/** Select-only combobox (WAI-ARIA pattern): a native <select> cannot show the
 *  flags inside its options, so the list is rendered by hand. Focus stays on the
 *  button; the highlighted option is exposed through aria-activedescendant.
 *  The list is portalled to <body> with fixed positioning: headers host the
 *  switcher inside overflow-x-auto rows, which would clip an absolute popup. */
export function LocaleSwitcher({ className = '' }: { className?: string }) {
  const { locale, setLocale, t, dir } = useLocale();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<ListPosition | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const button = buttonRef.current;
      if (!button) return;
      const r = button.getBoundingClientRect();
      // Align the list with the button's leading edge: left in LTR, right in RTL.
      setPosition(
        dir === 'rtl'
          ? { top: r.bottom + 4, minWidth: r.width, right: document.documentElement.clientWidth - r.right }
          : { top: r.bottom + 4, minWidth: r.width, left: r.left }
      );
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, dir]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!buttonRef.current?.contains(target) && !listRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const openList = () => {
    setActive(Math.max(0, SELECTABLE_LOCALES.indexOf(locale)));
    setOpen(true);
  };

  const choose = (next: Locale) => {
    setLocale(next);
    setOpen(false);
  };

  // Enter and Space are handled on keydown (and Space's keyup click is cancelled)
  // so the button's native click never toggles the list a second time.
  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const last = SELECTABLE_LOCALES.length - 1;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        openList();
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive((i) => Math.min(last, i + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        break;
      case 'Home':
        e.preventDefault();
        setActive(0);
        break;
      case 'End':
        e.preventDefault();
        setActive(last);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        choose(SELECTABLE_LOCALES[active]);
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  };

  return (
    <div className={`inline-flex ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        data-testid="locale-switcher"
        aria-label={t('nav.languageAria')}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? optionId(active) : undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => {
          if (e.key === ' ') e.preventDefault();
        }}
        className="flex items-center gap-2 border border-slate-300 dark:border-studio-border hover:border-slate-400 dark:hover:border-studio-border-hover rounded-lg py-1 ps-2 pe-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/50 cursor-pointer transition-colors"
      >
        <LocaleFlag locale={locale} className="w-5 h-3.5 rounded-[2px] shadow-sm shrink-0" />
        <span lang={locale}>{t(`language.${locale}`)}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-500 dark:text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {open && position && createPortal(
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          dir={dir}
          aria-label={t('nav.languageAria')}
          style={position}
          className="fixed w-max rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-studio-border shadow-lg shadow-black/10 dark:shadow-black/40 py-1 z-[100]"
        >
          {SELECTABLE_LOCALES.map((candidate, index) => {
            const selected = candidate === locale;
            return (
              <li
                key={candidate}
                id={optionId(index)}
                role="option"
                aria-selected={selected}
                data-locale={candidate}
                lang={candidate}
                // mousedown would blur the button before the click lands.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(candidate)}
                className={`flex items-center gap-2 px-2.5 py-1.5 text-xs cursor-pointer transition-colors ${
                  index === active ? 'bg-slate-100 dark:bg-white/5' : ''
                } ${selected ? 'font-bold text-brand-600 dark:text-brand-400' : 'text-slate-700 dark:text-slate-200'}`}
              >
                <LocaleFlag locale={candidate} className="w-5 h-3.5 rounded-[2px] shadow-sm shrink-0" />
                <span className="flex-1">{t(`language.${candidate}`)}</span>
                <Check className={`w-3.5 h-3.5 ${selected ? '' : 'invisible'}`} aria-hidden="true" />
              </li>
            );
          })}
        </ul>,
        document.body
      )}
    </div>
  );
}
