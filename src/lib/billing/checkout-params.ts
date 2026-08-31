/**
 * Pure construction of the Stripe Checkout session parameters.
 *
 * Kept free of the Stripe SDK and of `process.env` so the exact amount,
 * currency, URLs and metadata that will be sent to Stripe can be asserted in a
 * plain Node test. The route handler only resolves the authenticated user and
 * the safe origin, then hands both to this function.
 */

import { CreditPack, STRIPE_CURRENCY, toStripeMinorUnits } from './catalog';
import { isUuid } from './grant';

export interface CheckoutMetadata {
  userId: string;
  userEmail: string;
  packId: string;
  credits: string;
}

export interface CheckoutParams {
  mode: 'payment' | 'subscription';
  payment_method_types: ['card'];
  line_items: Array<{
    price_data: {
      currency: typeof STRIPE_CURRENCY;
      product_data: { name: string; description: string };
      unit_amount: number;
      recurring?: { interval: 'month' };
    };
    quantity: number;
  }>;
  success_url: string;
  cancel_url: string;
  metadata: CheckoutMetadata;
  client_reference_id: string;
  customer_email?: string;
  subscription_data?: { metadata: CheckoutMetadata };
}

export interface CheckoutInput {
  pack: CreditPack;
  userId: string;
  userEmail?: string | null;
  origin: string;
}

/**
 * Normalize an origin to `scheme://host[:port]`, accepting only http(s).
 * The configured app URL wins; the request's own `Origin` header is the
 * fallback. Returns null when neither is usable, so the caller can fail closed
 * instead of redirecting a paying customer to an attacker-controlled URL.
 */
export function resolveSafeOrigin(
  configured: string | undefined | null,
  requestOrigin?: string | undefined | null
): string | null {
  for (const candidate of [configured, requestOrigin]) {
    if (typeof candidate !== 'string' || candidate.trim() === '') continue;
    try {
      const url = new URL(candidate.trim());
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      if (!url.host) continue;
      return url.origin;
    } catch {
      continue;
    }
  }
  return null;
}

export interface CheckoutOriginInput {
  /** NEXT_PUBLIC_APP_URL, or whatever configures the deployment's own URL. */
  configured: string | undefined | null;
  /** The `Origin` header of the incoming request — attacker-chosen. */
  requestOrigin: string | undefined | null;
  production: boolean;
}

/**
 * Decide which origin the Stripe success/cancel URLs may point at.
 *
 * `Origin` is whatever the caller typed: a request with
 * `Origin: https://evil.example` would otherwise produce a real Stripe session
 * whose success_url sends the paying customer to an attacker's page dressed up
 * as the confirmation. So in production the redirect target comes from
 * configuration alone, and a missing or unusable NEXT_PUBLIC_APP_URL fails
 * closed rather than falling back.
 *
 * Outside production the fallback is kept, because `next dev` is routinely
 * reached on whatever port is free and configuring it is friction with no
 * attacker to speak of.
 */
export function resolveCheckoutOrigin({ configured, requestOrigin, production }: CheckoutOriginInput): string | null {
  const fromConfiguration = resolveSafeOrigin(configured, null);
  if (production) return fromConfiguration;
  return fromConfiguration || resolveSafeOrigin(requestOrigin, null);
}

export function buildCheckoutParams({ pack, userId, userEmail, origin }: CheckoutInput): CheckoutParams {
  if (!isUuid(userId)) {
    throw new Error('INVALID_USER_ID');
  }

  const safeOrigin = resolveSafeOrigin(origin);
  if (!safeOrigin) {
    throw new Error('INVALID_ORIGIN');
  }

  const email = typeof userEmail === 'string' && userEmail.trim() !== '' ? userEmail.trim() : '';

  // Mirrored verbatim onto the subscription so that recurring invoices resolve
  // the same grant as the initial checkout session.
  const metadata: CheckoutMetadata = {
    userId,
    userEmail: email,
    packId: pack.id,
    credits: String(pack.credits),
  };

  const params: CheckoutParams = {
    mode: pack.monthly ? 'subscription' : 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: STRIPE_CURRENCY,
          product_data: {
            name: `QatlIA — ${pack.name}`,
            description: pack.monthly
              ? `${pack.displayCredits} analyses photo IA par mois`
              : `${pack.displayCredits} analyses photo IA`,
          },
          unit_amount: toStripeMinorUnits(pack.priceMAD),
          ...(pack.monthly ? { recurring: { interval: 'month' as const } } : {}),
        },
        quantity: 1,
      },
    ],
    success_url: `${safeOrigin}/credits/success?session_id={CHECKOUT_SESSION_ID}&pack=${pack.id}`,
    cancel_url: `${safeOrigin}/credits`,
    metadata,
    client_reference_id: userId,
  };

  if (email) params.customer_email = email;
  if (pack.monthly) params.subscription_data = { metadata };

  return params;
}
