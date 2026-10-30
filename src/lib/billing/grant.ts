/**
 * Pure resolution of "which user gets how many credits" from a Stripe event.
 *
 * Rules encoded here:
 *   * the credit count comes from the server-side catalog, never from webhook
 *     metadata (metadata is attacker-influenceable if a session is ever created
 *     outside this app);
 *   * a grant requires a canonical UUID user id — "anonymous" grants are refused;
 *   * only one-off payments are sold. A *subscription* checkout session is not
 *     something this app creates, so it grants nothing, and invoices (which
 *     only subscriptions produce) are not handled;
 *   * the idempotency key is derived from the payment object id only, so a
 *     redelivered event maps to the same key and the DB unique index absorbs it;
 *   * a *paid* event we recognise but cannot act on is `retryable`: the customer
 *     has been charged and has received nothing, which is a bug to surface, not
 *     a state to acknowledge with 200.
 */

import { CREDIT_PACKS, normalizePackId } from './catalog';

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): boolean {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export interface CreditGrant {
  userId: string;
  packId: string;
  credits: number;
  /** Stable key stored in credit_transactions.stripe_payment_id (unique index). */
  idempotencyKey: string;
  source: 'checkout_session' | 'creem_checkout';
}

export type GrantResolution =
  | { ok: true; grant: CreditGrant }
  | {
      ok: false;
      reason: string;
      /**
       * True when the event represents a *completed payment* that we recognised
       * but could not turn into a grant. The caller must fail the delivery so
       * Stripe retries and the failure is visible, because the alternative is a
       * customer who paid and was silently given nothing.
       *
       * False for events we deliberately do not credit (other event types,
       * unpaid sessions, subscription sessions this app never creates).
       * Failing those would make Stripe retry them forever.
       */
      retryable: boolean;
    };

type Metadata = Record<string, unknown> | null | undefined;

interface StripeEventLike {
  id?: string;
  type?: string;
  data?: { object?: Record<string, unknown> };
}

function readMetadata(...candidates: Metadata[]): Record<string, unknown> {
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object' && Object.keys(candidate).length > 0) {
      return candidate as Record<string, unknown>;
    }
  }
  return {};
}

function buildGrant(
  metadata: Record<string, unknown>,
  paymentId: unknown,
  source: CreditGrant['source'],
  keyPrefix: string
): GrantResolution {
  const userId = metadata.userId;
  if (!isUuid(userId)) {
    return { ok: false, reason: 'INVALID_USER', retryable: true };
  }

  const packId = normalizePackId(metadata.packId);
  if (!packId) {
    return { ok: false, reason: 'UNKNOWN_PACK', retryable: true };
  }

  if (typeof paymentId !== 'string' || paymentId.trim() === '') {
    return { ok: false, reason: 'MISSING_PAYMENT_ID', retryable: true };
  }

  return {
    ok: true,
    grant: {
      userId: userId as string,
      packId,
      // Authoritative: metadata cannot inflate the granted amount.
      credits: CREDIT_PACKS[packId].credits,
      idempotencyKey: `${keyPrefix}:${paymentId.trim()}`,
      source,
    },
  };
}

export function resolveGrant(event: StripeEventLike): GrantResolution {
  const object = (event?.data?.object || {}) as Record<string, unknown>;

  if (event?.type === 'checkout.session.completed') {
    if (object.mode === 'subscription') {
      return { ok: false, reason: 'SUBSCRIPTION_NOT_SOLD', retryable: false };
    }
    if (object.payment_status !== 'paid') {
      return { ok: false, reason: 'SESSION_NOT_PAID', retryable: false };
    }
    return buildGrant(readMetadata(object.metadata as Metadata), object.id, 'checkout_session', 'cs');
  }

  return { ok: false, reason: `UNHANDLED_EVENT:${String(event?.type)}`, retryable: false };
}
