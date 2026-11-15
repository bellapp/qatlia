/**
 * The export catalogs (cut-plan PDF, quotation) write every money label with
 * the ISO code "MAD", never translated. For a euro or dollar account the same
 * labels carry that account's code instead: this rewrites a catalog, strings
 * and label functions alike, so the catalogs keep one wording per language.
 */

import type { AppCurrency } from '@/lib/currency';

const CODE = /\bMAD\b/g;

/** "in dirhams" written out in an Arabic label (the PDF summary title). */
const AR_IN_DIRHAMS = 'بالدرهم';
const AR_IN_CURRENCY: Record<AppCurrency, string> = { MAD: AR_IN_DIRHAMS, EUR: 'باليورو', USD: 'بالدولار' };

function relabel<T>(value: T, code: AppCurrency): T {
  if (typeof value === 'string') return value.replace(CODE, code).replace(AR_IN_DIRHAMS, AR_IN_CURRENCY[code]) as T;
  if (typeof value === 'function') {
    const fn = value as unknown as (...args: unknown[]) => unknown;
    return ((...args: unknown[]) => relabel(fn(...args), code)) as unknown as T;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) out[key] = relabel(inner, code);
    return out as T;
  }
  return value;
}

/** The catalog with its "MAD" labels in the account currency (unchanged for MAD). */
export function withCurrencyCode<T>(catalog: T, code: AppCurrency | null | undefined): T {
  return !code || code === 'MAD' ? catalog : relabel(catalog, code);
}

/** "1 234,50 EUR": the export money format, in the account currency. */
export function formatExportMoney(value: number, code: AppCurrency): string {
  return `${value.toFixed(2).replace('.', ',')} ${code}`;
}
