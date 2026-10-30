/**
 * Single source of truth for what QatlIA sells and at what price.
 *
 * QatlIA settles in Moroccan dirham, except international card payments
 * through Creem, which settle in US dollars (`priceUSD`). Every displayed price,
 * every Stripe line item and every credit grant is derived from this table, so
 * the customer can never be shown one currency/amount and charged another.
 *
 * Pure module: no Stripe SDK, no env vars, no network. Safe to import from a
 * client component, a route handler or a plain Node test.
 */

export type PackId = 'starter' | 'standard' | 'pro' | 'atelier_max';

/** ISO-4217 code as shown to the customer. */
export const BILLING_CURRENCY = 'MAD' as const;

/** Stripe requires the lowercase code. */
export const STRIPE_CURRENCY = 'mad' as const;

/** MAD is a two-decimal currency, so Stripe's minor unit is the centime. */
export const STRIPE_MINOR_UNITS_PER_MAD = 100;

export interface CreditPack {
  id: PackId;
  name: string;
  description: string;
  /** Credits granted per successful payment. One credit is one complete analysis. */
  credits: number;
  /**
   * The allowance as shown on screen. It is always `String(credits)`: the plan
   * the customer reads about must be the plan the ledger enforces.
   */
  displayCredits: string;
  priceMAD: number;
  /**
   * What an international card payment through Creem charges, in US dollars.
   * Creem bills the price stored on its own product, so this must equal that
   * product's price: it is what the card button shows before the redirect.
   */
  priceUSD: number;
  badge: string;
  highlight: boolean;
};

// Pricing v3 (user decision 2026-10-30): four one-off packs from 50 DH, no
// subscription. The cheapest pack used to be 20 DH, where Creem's fixed
// $0.40 per payment took ~17% of the sale; from 50 DH it takes ~12%, falling
// to ~5% on the largest pack. `atelier_max` keeps its id (and its
// CREEM_PRODUCT_ATELIER_MAX env var) but is now a one-off pack like the others.
export const CREDIT_PACKS: Record<PackId, CreditPack> = {
  starter: {
    id: 'starter',
    name: 'Pack Découverte',
    description: 'Idéal pour tester ou pour quelques chantiers',
    credits: 30,
    displayCredits: '30',
    priceMAD: 50,
    priceUSD: 4.99,
    badge: '50 DH',
    highlight: false,
  },
  standard: {
    id: 'standard',
    name: 'Pack Artisan',
    description: 'Le choix populaire des menuisiers actifs',
    credits: 80,
    displayCredits: '80',
    priceMAD: 100,
    priceUSD: 9.99,
    badge: 'Populaire (100 DH)',
    highlight: true,
  },
  pro: {
    id: 'pro',
    name: 'Pack Atelier Pro',
    description: 'Pour les ateliers à fort volume de débit',
    credits: 200,
    displayCredits: '200',
    priceMAD: 200,
    priceUSD: 19.99,
    badge: 'Économique (200 DH)',
    highlight: false,
  },
  atelier_max: {
    id: 'atelier_max',
    name: 'Pack Atelier Max',
    description: 'Le meilleur prix par analyse, pour les ateliers à très fort volume',
    credits: 400,
    displayCredits: '400',
    priceMAD: 300,
    priceUSD: 29.99,
    badge: 'Meilleur prix (300 DH)',
    highlight: false,
  },
};

export const PACK_IDS: readonly PackId[] = ['starter', 'standard', 'pro', 'atelier_max'];

export function isPackId(value: unknown): value is PackId {
  return typeof value === 'string' && (PACK_IDS as readonly string[]).includes(value);
}

/**
 * Resolve a pack id read from webhook metadata to a currently sold pack, or
 * null if it names nothing. The retired subscription id `unlimited` no longer
 * resolves: no subscription was ever sold under it, and mapping it to today's
 * 400-credit `atelier_max` pack would over-credit any stray replay.
 */
export function normalizePackId(value: unknown): PackId | null {
  if (typeof value !== 'string') return null;
  if (isPackId(value)) return value;
  return null;
}

export function getPack(id: PackId): CreditPack {
  return CREDIT_PACKS[id];
}

/**
 * Convert a displayed MAD price into the integer minor-unit amount Stripe bills.
 * Throws rather than silently emitting a zero/NaN amount, which Stripe would
 * either reject or — worse — accept as a free charge.
 */
export function toStripeMinorUnits(priceMAD: number): number {
  if (!Number.isFinite(priceMAD) || priceMAD <= 0) {
    throw new Error(`INVALID_PRICE: ${String(priceMAD)}`);
  }
  return Math.round(priceMAD * STRIPE_MINOR_UNITS_PER_MAD);
}

/** International card payments (Creem) settle in US dollars. */
export const CARD_CURRENCY = 'USD' as const;

/** Customer-facing USD formatting ("$4.99"). */
export function formatUSD(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/** Customer-facing MAD formatting ("10 DH", "99,50 DH"). */
export function formatMAD(amount: number): string {
  const value = Number.isInteger(amount) ? String(amount) : amount.toFixed(2).replace('.', ',');
  return `${value} DH`;
}
