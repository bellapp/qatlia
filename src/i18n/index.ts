import { fr, type Catalog } from './messages/fr';
import { en } from './messages/en';
import { ar } from './messages/ar';

export type { Catalog };

export type Locale = 'fr' | 'en' | 'ar';
export type Direction = 'ltr' | 'rtl';

export const LOCALES: readonly Locale[] = ['fr', 'en', 'ar'];
export const DEFAULT_LOCALE: Locale = 'fr';
export const RTL_LOCALES: readonly Locale[] = ['ar'];

/** Same name for both, so the early-init script and the provider agree. */
export const LOCALE_STORAGE_KEY = 'qatlia-locale';
export const LOCALE_COOKIE_NAME = 'qatlia-locale';

export const LOCALE_LABELS: Record<Locale, string> = { fr: 'FR', en: 'EN', ar: 'AR' };

/**
 * `catalogs` is deliberately mutable-typed rather than `as const`: French sets
 * the shape via `Catalog`, and `en`/`ar` are annotated with it, so key parity is
 * checked by tsc (missing keys and excess keys both fail to compile).
 */
export const catalogs: Record<Locale, Catalog> = { fr, en, ar };

/** Dotted paths to every leaf string in the catalog, e.g. `stats.waste.label`. */
export type TranslationKey = LeafPaths<Catalog>;

type LeafPaths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${LeafPaths<T[K]>}`;
}[keyof T & string];

export type TranslationVars = Record<string, string | number>;

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

export function dirFor(locale: Locale): Direction {
  return RTL_LOCALES.includes(locale) ? 'rtl' : 'ltr';
}

function lookup(catalog: Catalog, key: string): string | null {
  let node: unknown = catalog;
  for (const segment of key.split('.')) {
    if (typeof node !== 'object' || node === null) return null;
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === 'string' ? node : null;
}

/** Replaces `{name}` with the supplied value; unsupplied tokens are left as-is. */
function interpolate(template: string, vars?: TranslationVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
  );
}

/**
 * Resolves a dotted key. A key that is somehow absent from the active locale
 * falls back to the French value rather than leaking the raw key into the UI;
 * returning the key is only the last resort for a key that exists nowhere.
 */
export function translate(locale: Locale, key: string, vars?: TranslationVars): string {
  const template = lookup(catalogs[locale] ?? catalogs[DEFAULT_LOCALE], key)
    ?? lookup(catalogs[DEFAULT_LOCALE], key)
    ?? key;
  return interpolate(template, vars);
}

/**
 * Runs before the body paints so the document direction and language are right
 * on the first frame, including for a returning Arabic visitor. It reads only
 * the persisted preference and only accepts the three allowed codes, so nothing
 * from storage or cookies can reach the DOM unvalidated.
 */
export const localeInitScript = `(function(){try{var a=${JSON.stringify(LOCALES)};var k=${JSON.stringify(
  LOCALE_STORAGE_KEY
)};var l=null;try{l=window.localStorage.getItem(k);}catch(e){}
if(a.indexOf(l)<0){var m=document.cookie.match(new RegExp('(?:^|; )'+k+'=([^;]*)'));l=m?decodeURIComponent(m[1]):null;}
if(a.indexOf(l)<0){l=${JSON.stringify(DEFAULT_LOCALE)};}
var d=document.documentElement;d.lang=l;d.dir=(l==='ar')?'rtl':'ltr';}catch(e){}})();`;
