/**
 * Creem (Merchant of Record) checkout and webhook rules, kept pure.
 *
 * No env, no network: the checkout route resolves the buyer and the Creem
 * configuration, the webhook route verifies the raw body, and both hand plain
 * data to the functions below so the exact behaviour can be asserted in a
 * Node test against payloads captured from Creem's test mode.
 *
 * Rules encoded here:
 *   * the pack is resolved from the *signed* product id through the configured
 *     product map, and the credit count from the catalog — never from metadata;
 *   * metadata only names the buyer (a canonical UUID) and cross-checks the pack;
 *   * every grant is keyed on Creem's transaction id. A new subscription emits
 *     both `subscription.paid` (`last_transaction_id`) and `checkout.completed`
 *     (`order.transaction`) for the *same* first-period transaction, so both
 *     events map to one key and the unique index in add_credits absorbs the
 *     second. Either event alone is enough, so losing one cannot leave a paying
 *     subscriber without credits;
 *   * a paid event we recognise but cannot act on is `retryable`, exactly as
 *     for Stripe (see grant.ts).
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { CREDIT_PACKS, CreditPack, PackId, normalizePackId } from './catalog';
import { GrantResolution, isUuid } from './grant';
import { resolveSafeOrigin } from './checkout-params';

export interface CreemCheckoutMetadata {
  userId: string;
  packId: string;
  credits: string;
}

export interface CreemCheckoutBody {
  product_id: string;
  request_id: string;
  success_url: string;
  customer?: { email: string };
  metadata: CreemCheckoutMetadata;
}

export interface CreemCheckoutInput {
  pack: CreditPack;
  productId: string;
  userId: string;
  userEmail?: string | null;
  origin: string;
  /** A unique reference for this attempt, echoed back by Creem. */
  requestId: string;
}

export function buildCreemCheckoutBody({
  pack,
  productId,
  userId,
  userEmail,
  origin,
  requestId,
}: CreemCheckoutInput): CreemCheckoutBody {
  if (!isUuid(userId)) {
    throw new Error('INVALID_USER_ID');
  }

  const safeOrigin = resolveSafeOrigin(origin);
  if (!safeOrigin) {
    throw new Error('INVALID_ORIGIN');
  }

  const email = typeof userEmail === 'string' && userEmail.trim() !== '' ? userEmail.trim() : '';

  const body: CreemCheckoutBody = {
    product_id: productId,
    request_id: requestId,
    // No query string of our own: Creem appends `?checkout_id=…&order_id=…`
    // to this URL on its redirect.
    success_url: `${safeOrigin}/credits/success`,
    metadata: { userId, packId: pack.id, credits: String(pack.credits) },
  };
  if (email) body.customer = { email };
  return body;
}

/**
 * Check the `creem-signature` header: the hex HMAC-SHA256 of the *raw* request
 * body under the webhook secret. Re-serialising a parsed body would not
 * reproduce the bytes Creem signed.
 */
export function verifyCreemSignature(rawBody: string, signature: string | null | undefined, secret: string): boolean {
  if (typeof signature !== 'string' || !/^[0-9a-f]{64}$/i.test(signature.trim())) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const received = Buffer.from(signature.trim(), 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

interface CreemEventLike {
  id?: string;
  eventType?: string;
  object?: Record<string, unknown>;
}

type Metadata = Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function readId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  const id = asRecord(value)?.id;
  return typeof id === 'string' && id.trim() !== '' ? id.trim() : null;
}

function firstMetadata(...candidates: unknown[]): Metadata {
  for (const candidate of candidates) {
    const record = asRecord(candidate);
    if (record && Object.keys(record).length > 0) return record;
  }
  return {};
}

function packForProduct(productId: string | null, products: Record<PackId, string>): PackId | null {
  if (!productId) return null;
  const match = (Object.keys(products) as PackId[]).find((packId) => products[packId] === productId);
  return match ?? null;
}

function buildGrant(
  metadata: Metadata,
  productId: string | null,
  transactionId: string | null,
  products: Record<PackId, string>,
  source: 'creem_checkout' | 'creem_subscription'
): GrantResolution {
  const userId = metadata.userId;
  if (!isUuid(userId)) {
    return { ok: false, reason: 'INVALID_USER', retryable: true };
  }

  // The signed product decides what was bought; a product outside the map is
  // either a misconfigured environment or a sale this app did not create.
  const packId = packForProduct(productId, products);
  if (!packId) {
    return { ok: false, reason: 'UNKNOWN_PRODUCT', retryable: true };
  }

  if (metadata.packId !== undefined && normalizePackId(metadata.packId) !== packId) {
    return { ok: false, reason: 'PACK_MISMATCH', retryable: true };
  }

  if (!transactionId) {
    return { ok: false, reason: 'MISSING_PAYMENT_ID', retryable: true };
  }

  return {
    ok: true,
    grant: {
      userId: userId as string,
      packId,
      credits: CREDIT_PACKS[packId].credits,
      idempotencyKey: `creem:${transactionId}`,
      source,
    },
  };
}

export function resolveCreemGrant(event: CreemEventLike, products: Record<PackId, string>): GrantResolution {
  const object = asRecord(event?.object) || {};

  if (event?.eventType === 'checkout.completed') {
    const order = asRecord(object.order);
    if (!order || order.status !== 'paid') {
      return { ok: false, reason: 'ORDER_NOT_PAID', retryable: false };
    }
    const transactionId = readId(order.transaction);
    // A subscription's first payment is also credited by subscription.paid
    // under the same transaction id, so its checkout carries no extra duty.
    if (!transactionId && order.type === 'recurring') {
      return { ok: false, reason: 'SUBSCRIPTION_GRANTED_VIA_SUBSCRIPTION_PAID', retryable: false };
    }
    return buildGrant(
      firstMetadata(object.metadata, asRecord(object.subscription)?.metadata),
      readId(object.product) ?? readId(order.product),
      transactionId,
      products,
      'creem_checkout'
    );
  }

  if (event?.eventType === 'subscription.paid') {
    return buildGrant(
      firstMetadata(object.metadata),
      readId(object.product),
      readId(object.last_transaction_id) ?? readId(object.last_transaction),
      products,
      'creem_subscription'
    );
  }

  return { ok: false, reason: `UNHANDLED_EVENT:${String(event?.eventType)}`, retryable: false };
}
