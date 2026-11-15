/**
 * The account currency (user decision, 2026-11-15): each customer works in one
 * currency for every service, assigned automatically from where they are —
 * dirham in Morocco, euro in Europe, dollar elsewhere — and changeable by them.
 *
 * Pure module: no env, no network, no Next import. Safe from a client
 * component, a route handler or a plain Node test.
 */

export type AppCurrency = 'MAD' | 'EUR' | 'USD';

export const APP_CURRENCIES: readonly AppCurrency[] = ['MAD', 'EUR', 'USD'];

/** Before any country is known (local dev, unknown IP), the home market's. */
export const DEFAULT_CURRENCY: AppCurrency = 'MAD';

/** A visitor without an account keeps a currency they picked by hand here. */
export const CURRENCY_COOKIE_NAME = 'qatlia-currency';

export function isAppCurrency(value: unknown): value is AppCurrency {
  return typeof value === 'string' && (APP_CURRENCIES as readonly string[]).includes(value);
}

/**
 * Countries priced in euros: the euro area (Bulgaria since 2026-01-01) with
 * the territories and microstates that use the euro, plus the rest of the
 * EU/EEA, Switzerland and the United Kingdom, where a euro price reads more
 * naturally than a dollar one.
 */
const EURO_COUNTRIES = new Set([
  // Euro area
  'AT', 'BE', 'BG', 'HR', 'CY', 'EE', 'FI', 'FR', 'DE', 'GR', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PT', 'SK', 'SI', 'ES',
  // Euro users outside the euro area, and French overseas departments
  'AD', 'MC', 'SM', 'VA', 'ME', 'XK', 'GF', 'GP', 'MQ', 'RE', 'YT', 'PM', 'BL', 'MF',
  // Rest of the EU / EEA, Switzerland, United Kingdom
  'CZ', 'DK', 'HU', 'PL', 'RO', 'SE', 'IS', 'LI', 'NO', 'CH', 'GB',
]);

/**
 * The currency for a country, from its ISO 3166-1 alpha-2 code (as Vercel
 * sends it in `x-vercel-ip-country`). An unknown country gets the default.
 */
export function currencyForCountry(country: string | null | undefined): AppCurrency {
  const code = typeof country === 'string' ? country.trim().toUpperCase() : '';
  if (!/^[A-Z]{2}$/.test(code)) return DEFAULT_CURRENCY;
  if (code === 'MA') return 'MAD';
  if (EURO_COUNTRIES.has(code)) return 'EUR';
  return 'USD';
}

/**
 * Which currency applies: the one saved on the account, else the one picked by
 * hand before signing in, else the one of the visitor's country.
 */
export function resolveCurrency(input: {
  saved?: unknown;
  cookie?: unknown;
  country?: string | null;
}): AppCurrency {
  if (isAppCurrency(input.saved)) return input.saved;
  if (isAppCurrency(input.cookie)) return input.cookie;
  return currencyForCountry(input.country);
}

/**
 * The currency a card is charged in. Creem charges in dollars or euros only:
 * euros when the account is in euros and the euro products exist, dollars
 * otherwise (a dirham account included — the dirham is paid by transfer).
 */
export function cardCurrencyFor(currency: AppCurrency, euroProductsAvailable: boolean): 'USD' | 'EUR' {
  return currency === 'EUR' && euroProductsAvailable ? 'EUR' : 'USD';
}

/**
 * Dirhams per unit of each currency, fixed (user decision 2026-11-15): the
 * workshop's catalog prices are dirham figures, shown converted to a euro or
 * dollar account as a starting point the artisan replaces with their own
 * supplier's prices. Never used for money QatliA charges.
 */
export const CATALOG_MAD_PER_UNIT: Record<AppCurrency, number> = { MAD: 1, EUR: 10.8, USD: 10 };

/** A dirham catalog price in an account currency, to the cent. */
export function catalogPriceIn(priceMad: number, currency: AppCurrency | null | undefined): number {
  const rate = CATALOG_MAD_PER_UNIT[isAppCurrency(currency) ? currency : DEFAULT_CURRENCY];
  return Math.round((priceMad / rate) * 100) / 100;
}

/** Bank transfer and cash go to a Moroccan account, in dirhams only. */
export function offersManualPayment(currency: AppCurrency): boolean {
  return currency === 'MAD';
}
