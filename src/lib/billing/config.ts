/**
 * Fail-safe reads of the billing-related environment.
 *
 * Every helper takes the environment explicitly (defaulting to `process.env`)
 * so the behaviour can be asserted without mutating the ambient process, and so
 * "configured" always means "a real, non-placeholder value is present".
 */

import { PACK_IDS, PackId } from './catalog';

export type Env = Record<string, string | undefined>;

const PLACEHOLDER_MARKERS = ['placeholder', 'your_', 'your-', 'xxx', 'changeme', 'todo'];

/** A value is a placeholder when it is missing, blank, or a template default. */
export function isPlaceholder(value: string | undefined | null): boolean {
  if (typeof value !== 'string') return true;
  const trimmed = value.trim();
  if (trimmed === '') return true;
  const lowered = trimmed.toLowerCase();
  return PLACEHOLDER_MARKERS.some((marker) => lowered.includes(marker));
}

export function isProductionEnv(env: Env = process.env): boolean {
  return env.NODE_ENV === 'production';
}

/** True only when a real Stripe secret key is present. */
export function isStripeConfigured(env: Env = process.env): boolean {
  const key = env.STRIPE_SECRET_KEY;
  return !isPlaceholder(key) && /^sk_/.test((key as string).trim());
}

/**
 * The demo checkout link grants nothing but *looks* like a successful purchase,
 * so it is only ever acceptable outside production and only while no card
 * provider is genuinely configured. Production with a placeholder key must
 * fail closed.
 */
export function allowDemoCheckout(env: Env = process.env): boolean {
  return !isProductionEnv(env) && !isStripeConfigured(env) && !isCreemConfigured(env);
}

/**
 * The Creem product sold for each pack. Test and live mode are separate Creem
 * stores with different product ids, so they come from the environment rather
 * than from the catalog.
 */
const CREEM_PRODUCT_ENV: Record<PackId, string> = {
  starter: 'CREEM_PRODUCT_STARTER',
  standard: 'CREEM_PRODUCT_STANDARD',
  pro: 'CREEM_PRODUCT_PRO',
  atelier_max: 'CREEM_PRODUCT_ATELIER_MAX',
};

export interface CreemConfig {
  apiKey: string;
  /** Chosen from the key prefix, so a test key can never reach the live API. */
  apiBase: string;
  products: Record<PackId, string>;
}

/**
 * The full Creem configuration, or null unless a real key *and* a product for
 * every pack are present. A half-configured store must not sell some packs and
 * strand the buyer of another.
 */
export function getCreemConfig(env: Env = process.env): CreemConfig | null {
  const key = env.CREEM_API_KEY;
  if (isPlaceholder(key)) return null;
  const apiKey = (key as string).trim();
  const mode = /^creem_(test|live)_/.exec(apiKey)?.[1];
  if (!mode) return null;

  const products = {} as Record<PackId, string>;
  for (const packId of PACK_IDS) {
    const productId = env[CREEM_PRODUCT_ENV[packId]];
    if (isPlaceholder(productId) || !/^prod_/.test((productId as string).trim())) return null;
    products[packId] = (productId as string).trim();
  }

  return {
    apiKey,
    apiBase: mode === 'test' ? 'https://test-api.creem.io' : 'https://api.creem.io',
    products,
  };
}

export function isCreemConfigured(env: Env = process.env): boolean {
  return getCreemConfig(env) !== null;
}

/** The Creem webhook signing secret, or null when it is absent/placeholder. */
export function getCreemWebhookSecret(env: Env = process.env): string | null {
  const secret = env.CREEM_WEBHOOK_SECRET;
  return isPlaceholder(secret) ? null : (secret as string).trim();
}

export type CardProvider = 'creem' | 'stripe';

/**
 * Which provider takes card payments. Creem wins when both are configured: it
 * is the one that can pay out to a Moroccan seller.
 */
export function getCardProvider(env: Env = process.env): CardProvider | null {
  if (isCreemConfigured(env)) return 'creem';
  if (isStripeConfigured(env)) return 'stripe';
  return null;
}

/** The verified webhook secret, or null when it is absent/placeholder. */
export function getWebhookSecret(env: Env = process.env): string | null {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  return isPlaceholder(secret) ? null : (secret as string).trim();
}

/** True only when a real Supabase URL *and* service-role key are both present. */
export function isSupabaseAdminConfigured(env: Env = process.env): boolean {
  return !isPlaceholder(env.NEXT_PUBLIC_SUPABASE_URL) && !isPlaceholder(env.SUPABASE_SERVICE_ROLE_KEY);
}

export function getSupabaseAdminConfig(env: Env = process.env): { url: string; serviceRoleKey: string } | null {
  if (!isSupabaseAdminConfigured(env)) return null;
  return {
    url: (env.NEXT_PUBLIC_SUPABASE_URL as string).trim(),
    serviceRoleKey: (env.SUPABASE_SERVICE_ROLE_KEY as string).trim(),
  };
}
