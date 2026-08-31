import Stripe from 'stripe';

/**
 * The one and only Stripe client in the codebase.
 *
 * Constructed lazily so that importing a route handler (or a test) does not
 * require a Stripe key, and so that checkout and the webhook cannot drift onto
 * different API versions or different keys.
 */
let cached: { key: string; client: Stripe } | null = null;

export function getStripe(secretKey: string): Stripe {
  if (cached && cached.key === secretKey) return cached.client;
  const client = new Stripe(secretKey, { apiVersion: '2026-07-29.dahlia' });
  cached = { key: secretKey, client };
  return client;
}
