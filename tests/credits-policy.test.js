const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

// P0 Task 5 — billing/credit policy.
//
// Two credibility gaps are covered here:
//   1. packs were *displayed* in MAD but *charged* in EUR (`priceEUR * 100`, currency 'eur');
//   2. customer copy said "1 credit per successful photo analysis, exports are free" while the
//      atelier debited a credit on PDF export.
//
// The catalog + policy modules under src/lib/billing are the single source of truth for both,
// and are pure (no Stripe SDK, no env, no network) so they can be asserted directly.

const PROJECT_ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8');

const UUID = '11111111-2222-4333-8444-555555555555';
const OTHER_UUID = '99999999-8888-4777-8666-555555555555';

// Prices the customer sees on /credits. Charged minor units must equal these * 100.
const EXPECTED_PACKS = {
  starter: { credits: 10, priceMAD: 10, monthly: false },
  standard: { credits: 50, priceMAD: 40, monthly: false },
  pro: { credits: 100, priceMAD: 70, monthly: false },
  atelier_max: { credits: 1000, priceMAD: 99, monthly: true },
};

const MONTHLY_PACK_ID = 'atelier_max';

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

test('catalog prices and credit counts match the advertised packs exactly', () => {
  const { CREDIT_PACKS, PACK_IDS } = loadTsModule('src/lib/billing/catalog.ts');

  assert.deepEqual([...PACK_IDS].sort(), ['atelier_max', 'pro', 'standard', 'starter']);

  for (const [id, expected] of Object.entries(EXPECTED_PACKS)) {
    const pack = CREDIT_PACKS[id];
    assert.ok(pack, `pack ${id} must exist in the catalog`);
    assert.equal(pack.priceMAD, expected.priceMAD, `${id} price must be ${expected.priceMAD} MAD`);
    assert.equal(pack.monthly, expected.monthly, `${id} monthly flag`);
    if (expected.credits !== undefined) {
      assert.equal(pack.credits, expected.credits, `${id} must grant ${expected.credits} credits`);
    }
  }
});

test('the catalog declares MAD and Stripe\'s lowercase currency code', () => {
  const { BILLING_CURRENCY, STRIPE_CURRENCY } = loadTsModule('src/lib/billing/catalog.ts');

  assert.equal(BILLING_CURRENCY, 'MAD');
  assert.equal(STRIPE_CURRENCY, 'mad', 'Stripe currency codes must be lowercase ISO-4217');
});

test('every pack converts to a strictly positive integer amount of Stripe minor units', () => {
  const { CREDIT_PACKS, PACK_IDS, toStripeMinorUnits } = loadTsModule('src/lib/billing/catalog.ts');

  for (const id of PACK_IDS) {
    const amount = toStripeMinorUnits(CREDIT_PACKS[id].priceMAD);
    assert.equal(amount, CREDIT_PACKS[id].priceMAD * 100, `${id} minor units must be priceMAD * 100`);
    assert.ok(Number.isInteger(amount), `${id} minor units must be an integer`);
    assert.ok(amount > 0, `${id} minor units must be > 0`);
  }
});

test('toStripeMinorUnits refuses non-finite or non-positive prices instead of sending 0 to Stripe', () => {
  const { toStripeMinorUnits } = loadTsModule('src/lib/billing/catalog.ts');

  assert.throws(() => toStripeMinorUnits(0));
  assert.throws(() => toStripeMinorUnits(-1));
  assert.throws(() => toStripeMinorUnits(Number.NaN));
  assert.throws(() => toStripeMinorUnits(Number.POSITIVE_INFINITY));
});

test('the catalog carries no EUR price and no unused Stripe price IDs', () => {
  const { CREDIT_PACKS, PACK_IDS } = loadTsModule('src/lib/billing/catalog.ts');

  for (const id of PACK_IDS) {
    const keys = Object.keys(CREDIT_PACKS[id]);
    assert.ok(!keys.includes('priceEUR'), `${id} must not expose priceEUR`);
    assert.ok(!keys.includes('stripePriceId'), `${id} must not expose an unused Stripe price ID`);
  }
  const source = read('src/lib/billing/catalog.ts');
  assert.ok(!/priceEUR/.test(source), 'catalog source must not mention priceEUR');
  assert.ok(!/STRIPE_PRICE_/.test(source), 'catalog source must not read unused STRIPE_PRICE_* env vars');
});

// ---------------------------------------------------------------------------
// Honest plan naming
// ---------------------------------------------------------------------------

// The monthly plan was named "Abonnement Mensuel" and advertised "Illimité",
// while the implementation granted a finite 1000 credits a month and cut the
// customer off at 1001. The plan is now named and described for what it is.

const deaccent = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '');

test('no pack advertises an unlimited credit allowance anywhere in the catalog', () => {
  const { CREDIT_PACKS, PACK_IDS } = loadTsModule('src/lib/billing/catalog.ts');

  for (const id of PACK_IDS) {
    const pack = CREDIT_PACKS[id];
    for (const [field, value] of Object.entries(pack)) {
      if (typeof value !== 'string') continue;
      assert.ok(
        !/illimit|unlimited/i.test(deaccent(value)),
        `${id}.${field} claims an unlimited allowance but the plan is capped: ${JSON.stringify(value)}`
      );
    }
  }

  // Comments are allowed to record *why* the claim was retired; only the code
  // that can reach a customer's screen is scanned.
  const code = read('src/lib/billing/catalog.ts')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  assert.ok(!/Illimit/i.test(deaccent(code)), 'the catalog source must not carry the retired unlimited claim');
});

test('every pack displays exactly the number of credits it grants', () => {
  const { CREDIT_PACKS, PACK_IDS } = loadTsModule('src/lib/billing/catalog.ts');

  for (const id of PACK_IDS) {
    const pack = CREDIT_PACKS[id];
    assert.equal(
      pack.displayCredits,
      String(pack.credits),
      `${id} shows "${pack.displayCredits}" but grants ${pack.credits} credits`
    );
  }
});

test('the monthly plan is named honestly and grants 1000 credits per month', () => {
  const { CREDIT_PACKS, PACK_IDS } = loadTsModule('src/lib/billing/catalog.ts');

  const monthly = PACK_IDS.map((id) => CREDIT_PACKS[id]).filter((pack) => pack.monthly);
  assert.equal(monthly.length, 1, 'there is exactly one recurring plan');

  const plan = monthly[0];
  assert.equal(plan.id, MONTHLY_PACK_ID);
  assert.match(plan.name, /Atelier Max/, 'the plan must be sold under its honest name');
  assert.equal(plan.credits, 1000);
  assert.match(plan.badge, /99 DH/);
});

test('the monthly copy says credits are added each month, never reset', () => {
  const { CREDIT_PACKS } = loadTsModule('src/lib/billing/catalog.ts');
  const plan = CREDIT_PACKS[MONTHLY_PACK_ID];

  const copy = deaccent(`${plan.description} ${plan.renewalNote || ''}`).toLowerCase();

  assert.match(copy, /ajout/, 'the renewal must be described as credits being added to the balance');
  assert.ok(
    !/(remis a zero|reinitialis|remise a zero|reset)/.test(copy),
    'a monthly grant tops the balance up; it must never be described as a reset'
  );
  assert.match(copy, /mois/, 'the cadence must be stated');
});

test('the retired "unlimited" id is gone from the catalog but still resolves for existing subscriptions', () => {
  const { PACK_IDS, isPackId, normalizePackId } = loadTsModule('src/lib/billing/catalog.ts');

  assert.ok(!PACK_IDS.includes('unlimited'), 'the dishonest id must not be sellable any more');
  assert.equal(isPackId('unlimited'), false, 'checkout must refuse the retired id');

  // Subscriptions created before the rename carry packId=unlimited in their
  // Stripe metadata; refusing them would stop crediting paying customers.
  assert.equal(normalizePackId('unlimited'), MONTHLY_PACK_ID);
  assert.equal(normalizePackId(MONTHLY_PACK_ID), MONTHLY_PACK_ID);
  assert.equal(normalizePackId('starter'), 'starter');
  assert.equal(normalizePackId('nonexistent'), null);
  assert.equal(normalizePackId(null), null);
  assert.equal(normalizePackId(42), null);
});

test('the credits page states the monthly renewal without an unlimited claim', () => {
  const source = read('src/app/credits/page.tsx');

  assert.ok(/renewalNote/.test(source), 'the monthly renewal note must actually be rendered');
  // "exports gratuits et illimités" is a true statement about free features and
  // is allowed; a *credit allowance* of "Illimité" is not.
  assert.ok(
    !/displayCredits[\s\S]{0,80}Illimit/i.test(source),
    'the credit allowance shown on the card must be the real number'
  );
});

test('isPackId narrows only to known pack ids', () => {
  const { isPackId } = loadTsModule('src/lib/billing/catalog.ts');

  assert.equal(isPackId('starter'), true);
  assert.equal(isPackId('atelier_max'), true);
  assert.equal(isPackId('free'), false);
  assert.equal(isPackId(null), false);
  assert.equal(isPackId(undefined), false);
  assert.equal(isPackId(1), false);
});

// ---------------------------------------------------------------------------
// Credit policy
// ---------------------------------------------------------------------------

test('only a successful Vision analysis costs a credit; every export path is free', () => {
  const { CREDIT_POLICY, creditCostFor, isFreeAction, FREE_ACTIONS, CHARGED_ACTIONS, VISION_CREDIT_COST } =
    loadTsModule('src/lib/billing/policy.ts');

  assert.equal(VISION_CREDIT_COST, 1);
  assert.equal(creditCostFor('vision'), 1);
  assert.equal(isFreeAction('vision'), false);

  for (const action of ['optimize', 'pdf', 'dxf', 'json', 'png', 'quotation']) {
    assert.equal(creditCostFor(action), 0, `${action} must cost 0 credits`);
    assert.equal(isFreeAction(action), true, `${action} must be free`);
    assert.equal(CREDIT_POLICY[action], 0);
  }

  assert.deepEqual([...CHARGED_ACTIONS], ['vision'], 'vision is the only charged action');
  assert.deepEqual(
    [...FREE_ACTIONS].sort(),
    ['dxf', 'json', 'optimize', 'pdf', 'png', 'quotation'],
    'the free-action list must enumerate every non-vision action'
  );
});

test('an unknown action is rejected rather than defaulting to free or to a charge', () => {
  const { creditCostFor, isFreeAction } = loadTsModule('src/lib/billing/policy.ts');

  assert.throws(() => creditCostFor('teleport'), /UNKNOWN_ACTION/);
  assert.throws(() => isFreeAction('teleport'), /UNKNOWN_ACTION/);
});

// ---------------------------------------------------------------------------
// Checkout parameter construction (pure)
// ---------------------------------------------------------------------------

test('displayed MAD price equals the charged Stripe amount and currency for every pack', () => {
  const { CREDIT_PACKS, PACK_IDS } = loadTsModule('src/lib/billing/catalog.ts');
  const { buildCheckoutParams } = loadTsModule('src/lib/billing/checkout-params.ts');

  for (const id of PACK_IDS) {
    const pack = CREDIT_PACKS[id];
    const params = buildCheckoutParams({
      pack,
      userId: UUID,
      userEmail: 'artisan@example.ma',
      origin: 'https://qatlia.example',
    });
    const lineItem = params.line_items[0];

    assert.equal(lineItem.price_data.currency, 'mad', `${id} must be charged in MAD`);
    assert.equal(
      lineItem.price_data.unit_amount,
      pack.priceMAD * 100,
      `${id} charged amount must equal the ${pack.priceMAD} MAD shown to the customer`
    );
    assert.equal(lineItem.quantity, 1);
  }
});

test('the monthly pack is a recurring subscription and mirrors its grant metadata', () => {
  const { CREDIT_PACKS } = loadTsModule('src/lib/billing/catalog.ts');
  const { buildCheckoutParams } = loadTsModule('src/lib/billing/checkout-params.ts');

  const params = buildCheckoutParams({
    pack: CREDIT_PACKS.atelier_max,
    userId: UUID,
    userEmail: 'artisan@example.ma',
    origin: 'https://qatlia.example',
  });

  assert.equal(params.mode, 'subscription');
  assert.deepEqual(params.line_items[0].price_data.recurring, { interval: 'month' });
  assert.ok(params.subscription_data, 'subscription metadata must be mirrored onto the subscription');
  assert.deepEqual(
    params.subscription_data.metadata,
    params.metadata,
    'invoice-driven grants read subscription metadata, so it must match the session metadata'
  );
});

test('one-off packs are payment mode with no recurring price and no subscription metadata', () => {
  const { CREDIT_PACKS } = loadTsModule('src/lib/billing/catalog.ts');
  const { buildCheckoutParams } = loadTsModule('src/lib/billing/checkout-params.ts');

  const params = buildCheckoutParams({ pack: CREDIT_PACKS.standard, userId: UUID, origin: 'https://qatlia.example' });

  assert.equal(params.mode, 'payment');
  assert.equal(params.line_items[0].price_data.recurring, undefined);
  assert.equal(params.subscription_data, undefined);
});

test('checkout metadata carries the authenticated user, email, pack and credits', () => {
  const { CREDIT_PACKS } = loadTsModule('src/lib/billing/catalog.ts');
  const { buildCheckoutParams } = loadTsModule('src/lib/billing/checkout-params.ts');

  const params = buildCheckoutParams({
    pack: CREDIT_PACKS.pro,
    userId: UUID,
    userEmail: 'artisan@example.ma',
    origin: 'https://qatlia.example/',
  });

  assert.equal(params.metadata.userId, UUID);
  assert.equal(params.metadata.userEmail, 'artisan@example.ma');
  assert.equal(params.metadata.packId, 'pro');
  assert.equal(params.metadata.credits, String(CREDIT_PACKS.pro.credits));
  assert.equal(params.client_reference_id, UUID);
  assert.equal(params.customer_email, 'artisan@example.ma');
  assert.ok(params.metadata.userId !== 'anonymous', 'anonymous grants must be impossible to construct');
});

test('checkout URLs are built from the resolved origin without a trailing double slash', () => {
  const { CREDIT_PACKS } = loadTsModule('src/lib/billing/catalog.ts');
  const { buildCheckoutParams } = loadTsModule('src/lib/billing/checkout-params.ts');

  const params = buildCheckoutParams({ pack: CREDIT_PACKS.starter, userId: UUID, origin: 'https://qatlia.example/' });

  assert.equal(params.success_url, 'https://qatlia.example/credits/success?session_id={CHECKOUT_SESSION_ID}&pack=starter');
  assert.equal(params.cancel_url, 'https://qatlia.example/credits');
});

test('buildCheckoutParams refuses an anonymous or non-UUID user and a hostile origin', () => {
  const { CREDIT_PACKS } = loadTsModule('src/lib/billing/catalog.ts');
  const { buildCheckoutParams } = loadTsModule('src/lib/billing/checkout-params.ts');

  const pack = CREDIT_PACKS.starter;
  assert.throws(() => buildCheckoutParams({ pack, userId: '', origin: 'https://q.example' }), /INVALID_USER_ID/);
  assert.throws(() => buildCheckoutParams({ pack, userId: 'anonymous', origin: 'https://q.example' }), /INVALID_USER_ID/);
  assert.throws(() => buildCheckoutParams({ pack, userId: UUID, origin: 'javascript:alert(1)' }), /INVALID_ORIGIN/);
  assert.throws(() => buildCheckoutParams({ pack, userId: UUID, origin: '' }), /INVALID_ORIGIN/);
});

test('resolveSafeOrigin accepts only http(s) origins and prefers the configured app URL', () => {
  const { resolveSafeOrigin } = loadTsModule('src/lib/billing/checkout-params.ts');

  assert.equal(resolveSafeOrigin('https://qatlia.ma/', 'https://evil.example'), 'https://qatlia.ma');
  assert.equal(resolveSafeOrigin(undefined, 'http://localhost:3002'), 'http://localhost:3002');
  assert.equal(resolveSafeOrigin('not a url', 'https://qatlia.ma'), 'https://qatlia.ma');
  assert.equal(resolveSafeOrigin('javascript:alert(1)', null), null);
  assert.equal(resolveSafeOrigin(null, null), null);
});

// `Origin` is attacker-chosen: anyone can POST to /api/credits/checkout with
// `Origin: https://evil.example` and get a Stripe session whose success_url
// points there, so the customer lands on an attacker page that looks like the
// paid confirmation. In production the redirect target must come from
// configuration only.
test('production resolves the checkout origin from configuration and ignores the request Origin', () => {
  const { resolveCheckoutOrigin } = loadTsModule('src/lib/billing/checkout-params.ts');

  assert.equal(
    resolveCheckoutOrigin({ configured: 'https://qatlia.ma', requestOrigin: 'https://evil.example', production: true }),
    'https://qatlia.ma'
  );
  assert.equal(
    resolveCheckoutOrigin({ configured: undefined, requestOrigin: 'https://evil.example', production: true }),
    null,
    'an unconfigured production deployment must fail closed, not borrow the caller\'s Origin'
  );
  assert.equal(
    resolveCheckoutOrigin({ configured: 'javascript:alert(1)', requestOrigin: 'https://qatlia.ma', production: true }),
    null,
    'an invalid configured URL must not silently fall back to the request Origin in production'
  );
});

test('outside production the request Origin remains an acceptable fallback', () => {
  const { resolveCheckoutOrigin } = loadTsModule('src/lib/billing/checkout-params.ts');

  assert.equal(
    resolveCheckoutOrigin({ configured: undefined, requestOrigin: 'http://localhost:3001', production: false }),
    'http://localhost:3001'
  );
  assert.equal(
    resolveCheckoutOrigin({ configured: 'https://qatlia.ma', requestOrigin: 'http://localhost:3001', production: false }),
    'https://qatlia.ma',
    'configuration still wins when it is present'
  );
  assert.equal(
    resolveCheckoutOrigin({ configured: 'not a url', requestOrigin: 'javascript:alert(1)', production: false }),
    null
  );
});

// ---------------------------------------------------------------------------
// Stripe configuration fail-safe
// ---------------------------------------------------------------------------

test('placeholder Stripe configuration is treated as unconfigured', () => {
  const { isStripeConfigured } = loadTsModule('src/lib/billing/config.ts');

  assert.equal(isStripeConfigured({}), false);
  assert.equal(isStripeConfigured({ STRIPE_SECRET_KEY: '' }), false);
  assert.equal(isStripeConfigured({ STRIPE_SECRET_KEY: 'sk_test_placeholder' }), false);
  assert.equal(isStripeConfigured({ STRIPE_SECRET_KEY: 'sk_test_your_stripe_secret_key' }), false);
  assert.equal(isStripeConfigured({ STRIPE_SECRET_KEY: 'sk_live_realkeyvalue' }), true);
});

test('a fake demo success URL is never allowed in production', () => {
  const { allowDemoCheckout } = loadTsModule('src/lib/billing/config.ts');

  assert.equal(allowDemoCheckout({ NODE_ENV: 'development' }), true);
  assert.equal(allowDemoCheckout({ NODE_ENV: 'production' }), false);
  assert.equal(
    allowDemoCheckout({ NODE_ENV: 'production', STRIPE_SECRET_KEY: 'sk_test_placeholder' }),
    false,
    'production must fail closed rather than hand out a fake paid-credits link'
  );
  assert.equal(allowDemoCheckout({ NODE_ENV: 'development', STRIPE_SECRET_KEY: 'sk_live_real' }), false);
});

test('webhook secret and Supabase admin config detect placeholders', () => {
  const { getWebhookSecret, isSupabaseAdminConfigured } = loadTsModule('src/lib/billing/config.ts');

  assert.equal(getWebhookSecret({}), null);
  assert.equal(getWebhookSecret({ STRIPE_WEBHOOK_SECRET: 'whsec_your_stripe_webhook_secret_here' }), null);
  assert.equal(getWebhookSecret({ STRIPE_WEBHOOK_SECRET: 'whsec_real' }), 'whsec_real');

  assert.equal(isSupabaseAdminConfigured({}), false);
  assert.equal(
    isSupabaseAdminConfigured({
      NEXT_PUBLIC_SUPABASE_URL: 'https://demo-placeholder.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    }),
    false
  );
  assert.equal(
    isSupabaseAdminConfigured({
      NEXT_PUBLIC_SUPABASE_URL: 'https://real.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'your_supabase_service_role_key_here',
    }),
    false
  );
  assert.equal(
    isSupabaseAdminConfigured({
      NEXT_PUBLIC_SUPABASE_URL: 'https://real.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'sbsvc_real',
    }),
    true
  );
});

// ---------------------------------------------------------------------------
// Webhook grant resolution (pure)
// ---------------------------------------------------------------------------

function paidSession(metadata, overrides = {}) {
  return {
    id: 'cs_test_123',
    type: 'checkout.session.completed',
    data: {
      object: { id: 'cs_test_123', mode: 'payment', payment_status: 'paid', metadata, ...overrides },
    },
  };
}

test('a paid one-off checkout session grants the catalog credit count for its pack', () => {
  const { resolveGrant } = loadTsModule('src/lib/billing/grant.ts');

  const resolved = resolveGrant(paidSession({ userId: UUID, packId: 'standard', credits: '50' }));

  assert.equal(resolved.ok, true);
  assert.equal(resolved.grant.userId, UUID);
  assert.equal(resolved.grant.packId, 'standard');
  assert.equal(resolved.grant.credits, 50);
});

test('tampered metadata cannot inflate the granted credit count', () => {
  const { resolveGrant } = loadTsModule('src/lib/billing/grant.ts');

  const resolved = resolveGrant(paidSession({ userId: UUID, packId: 'starter', credits: '999999' }));

  assert.equal(resolved.ok, true);
  assert.equal(resolved.grant.credits, 10, 'credits must come from the server-side catalog, not from metadata');
});

test('a grant is refused without a valid UUID user id', () => {
  const { resolveGrant } = loadTsModule('src/lib/billing/grant.ts');

  assert.equal(resolveGrant(paidSession({ packId: 'starter' })).ok, false);
  assert.equal(resolveGrant(paidSession({ userId: 'anonymous', packId: 'starter' })).ok, false);
  assert.equal(resolveGrant(paidSession({ userId: '', packId: 'starter' })).ok, false);
  assert.equal(resolveGrant(paidSession({ userId: 'not-a-uuid', packId: 'starter' })).ok, false);
  assert.equal(resolveGrant(paidSession({ userId: UUID, packId: 'nonexistent' })).ok, false);
});

test('isUuid accepts a canonical v4 uuid and rejects near-misses', () => {
  const { isUuid } = loadTsModule('src/lib/billing/grant.ts');

  assert.equal(isUuid(UUID), true);
  assert.equal(isUuid(UUID.toUpperCase()), true);
  assert.equal(isUuid(`${UUID} `), false);
  assert.equal(isUuid(`${UUID}extra`), false);
  assert.equal(isUuid('anonymous'), false);
  assert.equal(isUuid(null), false);
  assert.equal(isUuid(123), false);
});

test('an unpaid checkout session grants nothing', () => {
  const { resolveGrant } = loadTsModule('src/lib/billing/grant.ts');

  const resolved = resolveGrant(paidSession({ userId: UUID, packId: 'pro' }, { payment_status: 'unpaid' }));

  assert.equal(resolved.ok, false);
});

test('a subscription checkout session defers to the invoice so the first month is not granted twice', () => {
  const { resolveGrant } = loadTsModule('src/lib/billing/grant.ts');

  const resolved = resolveGrant(paidSession({ userId: UUID, packId: MONTHLY_PACK_ID }, { mode: 'subscription' }));

  assert.equal(resolved.ok, false);
  assert.match(resolved.reason, /INVOICE/);
  assert.equal(resolved.retryable, false, 'this is a deliberate skip, not a delivery to retry');
});

// The Stripe client is pinned to apiVersion '2026-07-29.dahlia' (see
// src/lib/billing/stripe-client.ts). Dahlia moved the subscription metadata
// that the monthly grant depends on from `invoice.subscription_details` to
// `invoice.parent.subscription_details`, so reading only the old location made
// every renewal resolve to "no grant" — a paying subscriber silently receiving
// nothing.
function dahliaInvoice(metadata, overrides = {}) {
  return {
    id: 'evt_dahlia',
    type: 'invoice.payment_succeeded',
    data: {
      object: {
        id: 'in_test_dahlia',
        status: 'paid',
        parent: { type: 'subscription_details', subscription_details: { metadata } },
        ...overrides,
      },
    },
  };
}

test('a Dahlia invoice grants credits from invoice.parent.subscription_details.metadata', () => {
  const { CREDIT_PACKS } = loadTsModule('src/lib/billing/catalog.ts');
  const { resolveGrant } = loadTsModule('src/lib/billing/grant.ts');

  const resolved = resolveGrant(dahliaInvoice({ userId: UUID, packId: MONTHLY_PACK_ID }));

  assert.equal(resolved.ok, true, resolved.reason);
  assert.equal(resolved.grant.userId, UUID);
  assert.equal(resolved.grant.packId, MONTHLY_PACK_ID);
  assert.equal(resolved.grant.credits, CREDIT_PACKS[MONTHLY_PACK_ID].credits);
  assert.equal(resolved.grant.source, 'invoice');
  assert.ok(resolved.grant.idempotencyKey.includes('in_test_dahlia'));
});

test('a Dahlia invoice still honours a subscription sold under the retired "unlimited" pack id', () => {
  const { CREDIT_PACKS } = loadTsModule('src/lib/billing/catalog.ts');
  const { resolveGrant } = loadTsModule('src/lib/billing/grant.ts');

  const resolved = resolveGrant(dahliaInvoice({ userId: UUID, packId: 'unlimited' }));

  assert.equal(resolved.ok, true, 'renaming the plan must not strand existing subscribers');
  assert.equal(resolved.grant.packId, MONTHLY_PACK_ID, 'the legacy id is normalised to the current pack');
  assert.equal(resolved.grant.credits, CREDIT_PACKS[MONTHLY_PACK_ID].credits);
});

test('a pre-Dahlia invoice shape is still accepted as a fallback', () => {
  const { CREDIT_PACKS } = loadTsModule('src/lib/billing/catalog.ts');
  const { resolveGrant } = loadTsModule('src/lib/billing/grant.ts');

  const resolved = resolveGrant({
    id: 'evt_1',
    type: 'invoice.payment_succeeded',
    data: {
      object: {
        id: 'in_test_9',
        status: 'paid',
        subscription_details: { metadata: { userId: UUID, packId: MONTHLY_PACK_ID } },
      },
    },
  });

  assert.equal(resolved.ok, true);
  assert.equal(resolved.grant.userId, UUID);
  assert.equal(resolved.grant.credits, CREDIT_PACKS[MONTHLY_PACK_ID].credits);
});

test('the Dahlia location wins over a stale legacy one on the same invoice', () => {
  const { resolveGrant } = loadTsModule('src/lib/billing/grant.ts');

  const resolved = resolveGrant(
    dahliaInvoice(
      { userId: UUID, packId: 'pro' },
      { subscription_details: { metadata: { userId: OTHER_UUID, packId: 'starter' } } }
    )
  );

  assert.equal(resolved.ok, true);
  assert.equal(resolved.grant.userId, UUID, 'the current API shape is authoritative');
  assert.equal(resolved.grant.packId, 'pro');
});

// ---------------------------------------------------------------------------
// Retryability — a paid event we cannot act on must not be silently swallowed
// ---------------------------------------------------------------------------

test('a paid invoice whose grant metadata is missing is retryable, not a silent no-grant', () => {
  const { resolveGrant } = loadTsModule('src/lib/billing/grant.ts');

  for (const metadata of [{}, { packId: MONTHLY_PACK_ID }, { userId: UUID }, { userId: 'anonymous', packId: 'pro' }]) {
    const resolved = resolveGrant(dahliaInvoice(metadata));

    assert.equal(resolved.ok, false);
    assert.equal(
      resolved.retryable,
      true,
      `a paid invoice with metadata ${JSON.stringify(metadata)} is money taken with no credit granted — it must be retried and surfaced`
    );
  }
});

test('a paid checkout session with unusable metadata is retryable', () => {
  const { resolveGrant } = loadTsModule('src/lib/billing/grant.ts');

  for (const metadata of [{}, { userId: 'anonymous', packId: 'pro' }, { userId: UUID, packId: 'nonexistent' }]) {
    const resolved = resolveGrant(paidSession(metadata));

    assert.equal(resolved.ok, false);
    assert.equal(resolved.retryable, true, `paid session with ${JSON.stringify(metadata)} must not resolve silently`);
  }
});

test('events we deliberately do not credit are never marked retryable', () => {
  const { resolveGrant } = loadTsModule('src/lib/billing/grant.ts');

  const ignored = [
    resolveGrant({ id: 'evt_x', type: 'customer.created', data: { object: {} } }),
    resolveGrant({ id: 'evt_y', type: 'charge.refunded', data: { object: { id: 'ch_1' } } }),
    resolveGrant(paidSession({ userId: UUID, packId: 'pro' }, { payment_status: 'unpaid' })),
    resolveGrant(dahliaInvoice({ userId: UUID, packId: MONTHLY_PACK_ID }, { status: 'draft' })),
    resolveGrant(paidSession({ userId: UUID, packId: MONTHLY_PACK_ID }, { mode: 'subscription' })),
  ];

  for (const resolved of ignored) {
    assert.equal(resolved.ok, false);
    assert.equal(resolved.retryable, false, `"${resolved.reason}" must be acknowledged, not retried forever`);
  }
});

test('the idempotency key is stable per payment object and distinct across payments', () => {
  const { resolveGrant } = loadTsModule('src/lib/billing/grant.ts');

  const first = resolveGrant(paidSession({ userId: UUID, packId: 'starter' }));
  const again = resolveGrant(paidSession({ userId: UUID, packId: 'starter' }));
  const other = resolveGrant(paidSession({ userId: OTHER_UUID, packId: 'starter' }, { id: 'cs_test_456' }));

  assert.equal(first.grant.idempotencyKey, again.grant.idempotencyKey, 'a redelivered event must reuse the same key');
  assert.notEqual(first.grant.idempotencyKey, other.grant.idempotencyKey);
  assert.ok(first.grant.idempotencyKey.length > 0);
  assert.ok(!/\d{13}/.test(first.grant.idempotencyKey), 'the key must not embed a timestamp');
});

test('unhandled Stripe events resolve to no grant instead of throwing', () => {
  const { resolveGrant } = loadTsModule('src/lib/billing/grant.ts');

  const resolved = resolveGrant({ id: 'evt_x', type: 'customer.created', data: { object: {} } });

  assert.equal(resolved.ok, false);
  assert.match(resolved.reason, /UNHANDLED_EVENT/);
});

// ---------------------------------------------------------------------------
// Source contracts — copy and wiring the runtime tests cannot reach
// ---------------------------------------------------------------------------

test('the credits page makes no unsupported CMI/CashPlus payment claim', () => {
  const source = read('src/app/credits/page.tsx');

  assert.ok(!/CMI/.test(source), 'CMI is not an implemented payment method');
  assert.ok(!/CashPlus/i.test(source), 'CashPlus is not an implemented payment method');
});

test('the credits page reads the shared catalog and never hardcodes a credit balance', () => {
  const source = read('src/app/credits/page.tsx');

  assert.ok(/@\/lib\/billing\/catalog/.test(source), 'pack prices must come from the shared catalog');
  assert.ok(!/Solde actuel\s*:\s*5/.test(source), 'the balance must be the real user balance, not a hardcoded 5');
});

test('no client code calls /api/credits/consume: exports are free', () => {
  for (const file of ['src/app/atelier/page.tsx', 'src/app/credits/page.tsx', 'src/app/account/page.tsx']) {
    assert.ok(!/api\/credits\/consume/.test(read(file)), `${file} must not debit credits`);
  }
});

test('the atelier does not fabricate local credit transactions', () => {
  const source = read('src/app/atelier/page.tsx');

  assert.ok(!/qatlia_credit_tx_v1/.test(source), 'the client must not invent credit ledger entries');
});

test('the Vision route never fabricates a balance or a confidence score', () => {
  const source = read('src/app/api/vision/route.ts');

  assert.ok(!/creditsRemaining:\s*\d/.test(source), 'the returned balance must be read from the database');
  assert.ok(!/confidence/.test(source), 'a fabricated confidence score must not be advertised');
});

test('checkout never trusts a client-supplied user id', () => {
  const source = read('src/app/api/credits/checkout/route.ts');

  assert.ok(!/userId:\s*z\./.test(source), 'userId must not be accepted in the request body');
  assert.ok(/auth\.getUser\(\)/.test(source), 'the user must be resolved server-side from the session');
});

test('exactly one Stripe client is constructed in the codebase', () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(PROJECT_ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(entry.name)) files.push(rel);
    }
  };
  walk('src');

  const constructing = files.filter((file) => /new Stripe\(/.test(read(file)));

  assert.deepEqual(constructing, ['src/lib/billing/stripe-client.ts'], 'Stripe must be instantiated in one place');
});

test('.env.example documents MAD and drops the unused Stripe price IDs', () => {
  const source = read('.env.example');

  assert.ok(!/STRIPE_PRICE_/.test(source), 'unused STRIPE_PRICE_* variables must be removed');
  assert.ok(/MAD/.test(source), 'the .env template must document the MAD settlement currency');
});

test('no server secret is referenced from a client component', () => {
  const clientFiles = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(PROJECT_ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(entry.name)) clientFiles.push(rel);
    }
  };
  walk('src/app');
  walk('src/components');

  for (const file of clientFiles) {
    const source = read(file);
    if (!/^['"]use client['"]/m.test(source)) continue;
    assert.ok(!/SERVICE_ROLE/.test(source), `${file} must not reference the service role key`);
    assert.ok(!/STRIPE_SECRET_KEY/.test(source), `${file} must not reference the Stripe secret key`);
    assert.ok(!/STRIPE_WEBHOOK_SECRET/.test(source), `${file} must not reference the webhook secret`);
    assert.ok(!/OPENROUTER_API_KEY|OPENAI_API_KEY/.test(source), `${file} must not reference an AI provider key`);
  }
});

// ---------------------------------------------------------------------------
// Database policy migration
// ---------------------------------------------------------------------------

test('migration 005 defines an atomic, locked, non-resetting consume_credit', () => {
  const sql = read('supabase/migrations/005_credit_policy.sql');

  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.consume_credit/);
  assert.match(sql, /FOR UPDATE/, 'the profile row must be locked before the balance is read');
  assert.match(sql, /SECURITY DEFINER/);
  assert.match(sql, /SET search_path/, 'SECURITY DEFINER functions must pin search_path');
  assert.ok(
    !/SET credits\s*=\s*5/i.test(sql),
    'consuming a credit must never reset the balance to the signup default'
  );
});

test('migration 005 makes add_credits idempotent on a unique stripe_payment_id', () => {
  const sql = read('supabase/migrations/005_credit_policy.sql');

  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.add_credits\(\s*p_user_id[^)]*p_credits[^)]*p_stripe_payment_id[^)]*p_pack_id/s);
  assert.match(sql, /CREATE UNIQUE INDEX[\s\S]*stripe_payment_id/);
  assert.match(sql, /ON CONFLICT[\s\S]*DO NOTHING/);
});

test('migration 005 reconciles credit_transactions columns and revokes anon execution', () => {
  const sql = read('supabase/migrations/005_credit_policy.sql');

  for (const column of ['type', 'balance_after', 'description', 'reason', 'stripe_payment_id']) {
    assert.ok(
      new RegExp(`ADD COLUMN IF NOT EXISTS\\s+${column}\\b`, 'i').test(sql),
      `credit_transactions.${column} must be reconciled defensively`
    );
  }
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.consume_credit\([^)]*\) FROM PUBLIC, anon, authenticated/i,
    'anon must not be able to execute the credit functions'
  );
});

test('ensure_profile creates a profile without ever rewriting an existing balance', () => {
  const sql = read('supabase/migrations/005_credit_policy.sql');

  const fn = sql.slice(sql.indexOf('FUNCTION public.ensure_profile'));
  const body = fn.slice(0, fn.indexOf('$$;') + 3);

  assert.match(body, /ON CONFLICT \(id\) DO UPDATE/);
  assert.ok(!/DO UPDATE SET[\s\S]*credits/i.test(body), 'ensure_profile must never overwrite credits');
});

test('FULL_DATABASE_SETUP mirrors the credit policy functions', () => {
  const sql = read('supabase/migrations/FULL_DATABASE_SETUP.sql');

  assert.match(sql, /FUNCTION public\.consume_credit/);
  assert.match(sql, /FUNCTION public\.add_credits/);
  assert.match(sql, /FUNCTION public\.ensure_profile/);
  assert.match(sql, /CREATE UNIQUE INDEX[\s\S]*stripe_payment_id/);
});
