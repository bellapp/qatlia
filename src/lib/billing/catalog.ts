/**
 * Single source of truth for what QatlIA sells and at what price.
 *
 * QatlIA settles in Moroccan dirham. Every displayed price, every Stripe line
 * item and every credit grant is derived from this table, so the customer can
 * never be shown one currency/amount and charged another.
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
  /** Credits granted per successful payment (per month for recurring packs). */
  credits: number;
  /**
   * The allowance as shown on screen. It is always `String(credits)`: the plan
   * the customer reads about must be the plan the ledger enforces.
   */
  displayCredits: string;
  priceMAD: number;
  monthly: boolean;
  badge: string;
  highlight: boolean;
  /** Recurring packs only: how the monthly grant behaves, stated on the card. */
  renewalNote?: string;
}

export const CREDIT_PACKS: Record<PackId, CreditPack> = {
  starter: {
    id: 'starter',
    name: 'Pack Découverte',
    description: 'Idéal pour tester ou pour 1 petit chantier',
    credits: 10,
    displayCredits: '10',
    priceMAD: 10,
    monthly: false,
    badge: '10 DH',
    highlight: false,
  },
  standard: {
    id: 'standard',
    name: 'Pack Artisan',
    description: 'Le choix populaire des menuisiers actifs',
    credits: 50,
    displayCredits: '50',
    priceMAD: 40,
    monthly: false,
    badge: 'Populaire (40 DH)',
    highlight: true,
  },
  pro: {
    id: 'pro',
    name: 'Pack Atelier Pro',
    description: 'Pour les ateliers à fort volume de débit',
    credits: 100,
    displayCredits: '100',
    priceMAD: 70,
    monthly: false,
    badge: 'Économique (70 DH)',
    highlight: false,
  },
  atelier_max: {
    id: 'atelier_max',
    // Previously sold as "Abonnement Mensuel — Illimité". It never was: the
    // implementation grants a finite 1000 credits a month through the same
    // atomic consume_credit path as the one-off packs, and the 1001st analysis
    // is refused. The plan is now named and priced for what it actually is.
    name: 'Abonnement Atelier Max',
    description: '1000 analyses photo IA par mois, pour les ateliers à très fort volume',
    credits: 1000,
    displayCredits: '1000',
    priceMAD: 99,
    monthly: true,
    badge: '99 DH / mois',
    highlight: false,
    renewalNote: '1000 crédits ajoutés à votre solde chaque mois',
  },
};

export const PACK_IDS: readonly PackId[] = ['starter', 'standard', 'pro', 'atelier_max'];

/**
 * Pack ids that are no longer sold but still appear in the Stripe metadata of
 * subscriptions and payments created before the rename. Refusing them would
 * stop crediting customers who are still being charged.
 */
const RETIRED_PACK_IDS: Record<string, PackId> = {
  unlimited: 'atelier_max',
};

export function isPackId(value: unknown): value is PackId {
  return typeof value === 'string' && (PACK_IDS as readonly string[]).includes(value);
}

/**
 * Resolve any pack id ever written into Stripe metadata to a currently sold
 * pack, or null if it names nothing. Use this when reading a webhook payload;
 * use `isPackId` when validating what a customer may buy today.
 */
export function normalizePackId(value: unknown): PackId | null {
  if (typeof value !== 'string') return null;
  if (isPackId(value)) return value;
  return RETIRED_PACK_IDS[value] ?? null;
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

/** Customer-facing MAD formatting ("10 DH", "99,50 DH"). */
export function formatMAD(amount: number): string {
  const value = Number.isInteger(amount) ? String(amount) : amount.toFixed(2).replace('.', ',');
  return `${value} DH`;
}
