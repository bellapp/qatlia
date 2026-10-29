const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');
const { stubModule } = require('./helpers/stub-module');

// Creem (Merchant of Record) payments:
//   * the webhook only grants for a verified signature over the raw body;
//   * the pack comes from the signed product id, the credits from the catalog;
//   * a subscription's first period arrives as subscription.paid AND
//     checkout.completed for one transaction, and must credit exactly once.
//
// The fixtures are real test-mode payloads captured with `creem listen`.

const UUID = '11111111-2222-4333-8444-555555555555';
const SECRET = 'whsec_test_secret';

const fixture = (name) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'creem', `${name}.json`), 'utf8'));

const ONE_TIME = fixture('checkout-completed-onetime');
const SUB_PAID = fixture('subscription-paid-first-period');
const SUB_CHECKOUT = fixture('checkout-completed-subscription');

// The products of the test store the fixtures were captured from.
const PRODUCTS = {
  starter: 'prod_3GauWfIWgKNQEdIsdf2Zbs',
  standard: 'prod_3IDcgmGhEszxRz7Gl4lmTT',
  pro: 'prod_6nrhVHrH4FA3Z40GkyszID',
  atelier_max: 'prod_592WDHbLmTPSI7Gb0J2VVc',
};

const CONFIGURED = {
  CREEM_API_KEY: 'creem_test_realkey',
  CREEM_WEBHOOK_SECRET: SECRET,
  CREEM_PRODUCT_STARTER: PRODUCTS.starter,
  CREEM_PRODUCT_STANDARD: PRODUCTS.standard,
  CREEM_PRODUCT_PRO: PRODUCTS.pro,
  CREEM_PRODUCT_ATELIER_MAX: PRODUCTS.atelier_max,
  NEXT_PUBLIC_APP_URL: 'https://qatlia.example',
  NEXT_PUBLIC_SUPABASE_URL: 'https://real.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'sbsvc_real',
};

const sign = (raw, secret = SECRET) => crypto.createHmac('sha256', secret).update(raw).digest('hex');

// ---------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------

test('a Creem signature verifies only for the exact raw body and secret', () => {
  const { verifyCreemSignature } = loadTsModule('src/lib/billing/creem.ts');
  const raw = JSON.stringify(ONE_TIME);

  assert.equal(verifyCreemSignature(raw, sign(raw), SECRET), true);
  assert.equal(verifyCreemSignature(`${raw} `, sign(raw), SECRET), false, 'a tampered body must not verify');
  assert.equal(verifyCreemSignature(raw, sign(raw, 'whsec_other'), SECRET), false, 'another secret must not verify');
  assert.equal(verifyCreemSignature(raw, 'not-hex', SECRET), false);
  assert.equal(verifyCreemSignature(raw, null, SECRET), false);
});

test('a paid one-time checkout grants the catalog credits keyed by its transaction', () => {
  const { resolveCreemGrant } = loadTsModule('src/lib/billing/creem.ts');

  const resolved = resolveCreemGrant(ONE_TIME, PRODUCTS);

  assert.equal(resolved.ok, true);
  assert.equal(resolved.grant.userId, UUID);
  assert.equal(resolved.grant.packId, 'starter');
  assert.equal(resolved.grant.credits, 10);
  assert.equal(resolved.grant.idempotencyKey, `creem:${ONE_TIME.object.order.transaction}`);
});

test('both events of a new subscription resolve to the same grant key', () => {
  const { resolveCreemGrant } = loadTsModule('src/lib/billing/creem.ts');

  const fromSubscription = resolveCreemGrant(SUB_PAID, PRODUCTS);
  const fromCheckout = resolveCreemGrant(SUB_CHECKOUT, PRODUCTS);

  assert.equal(fromSubscription.ok, true);
  assert.equal(fromSubscription.grant.packId, 'atelier_max');
  assert.equal(fromSubscription.grant.credits, 1000);
  assert.equal(fromCheckout.ok, true);
  // One transaction, one key: add_credits' unique index turns the second
  // delivery into a no-op instead of a second month of credits.
  assert.equal(fromCheckout.grant.idempotencyKey, fromSubscription.grant.idempotencyKey);
  assert.equal(fromSubscription.grant.idempotencyKey, `creem:${SUB_PAID.object.last_transaction_id}`);
});

test('a renewal is keyed by its own transaction, so it credits again', () => {
  const { resolveCreemGrant } = loadTsModule('src/lib/billing/creem.ts');
  const renewal = structuredClone(SUB_PAID);
  renewal.id = 'evt_renewal';
  renewal.object.last_transaction_id = 'tran_next_month';
  renewal.object.last_transaction = { ...renewal.object.last_transaction, id: 'tran_next_month' };

  const first = resolveCreemGrant(SUB_PAID, PRODUCTS);
  const second = resolveCreemGrant(renewal, PRODUCTS);

  assert.equal(second.ok, true);
  assert.equal(second.grant.credits, 1000);
  assert.notEqual(second.grant.idempotencyKey, first.grant.idempotencyKey);
});

test('metadata can neither inflate the credits nor relabel the product bought', () => {
  const { resolveCreemGrant } = loadTsModule('src/lib/billing/creem.ts');

  const inflated = structuredClone(ONE_TIME);
  inflated.object.metadata.credits = '999999';
  const resolvedInflated = resolveCreemGrant(inflated, PRODUCTS);
  assert.equal(resolvedInflated.ok, true);
  assert.equal(resolvedInflated.grant.credits, 10, 'credits come from the catalog, not metadata');

  const relabelled = structuredClone(ONE_TIME);
  relabelled.object.metadata.packId = 'atelier_max';
  const resolvedRelabelled = resolveCreemGrant(relabelled, PRODUCTS);
  assert.equal(resolvedRelabelled.ok, false);
  assert.equal(resolvedRelabelled.reason, 'PACK_MISMATCH');
  assert.equal(resolvedRelabelled.retryable, true);
});

test('a paid event that cannot be credited is retryable; events that are not ours are not', () => {
  const { resolveCreemGrant } = loadTsModule('src/lib/billing/creem.ts');

  const unknownProduct = structuredClone(ONE_TIME);
  unknownProduct.object.product.id = 'prod_someone_else';
  unknownProduct.object.order.product = 'prod_someone_else';
  assert.deepEqual(resolveCreemGrant(unknownProduct, PRODUCTS), { ok: false, reason: 'UNKNOWN_PRODUCT', retryable: true });

  const anonymous = structuredClone(ONE_TIME);
  anonymous.object.metadata.userId = 'anonymous';
  assert.deepEqual(resolveCreemGrant(anonymous, PRODUCTS), { ok: false, reason: 'INVALID_USER', retryable: true });

  const unpaid = structuredClone(ONE_TIME);
  unpaid.object.order.status = 'pending';
  assert.equal(resolveCreemGrant(unpaid, PRODUCTS).retryable, false);

  const other = resolveCreemGrant({ id: 'evt_x', eventType: 'subscription.canceled', object: {} }, PRODUCTS);
  assert.equal(other.ok, false);
  assert.equal(other.retryable, false);
  assert.match(other.reason, /UNHANDLED_EVENT/);
});

test('the Creem checkout body bills the session user and lets Creem own the success query string', () => {
  const { buildCreemCheckoutBody } = loadTsModule('src/lib/billing/creem.ts');
  const { CREDIT_PACKS } = loadTsModule('src/lib/billing/catalog.ts');

  const body = buildCreemCheckoutBody({
    pack: CREDIT_PACKS.pro,
    productId: PRODUCTS.pro,
    userId: UUID,
    userEmail: ' artisan@example.com ',
    origin: 'https://qatlia.example/some/path',
    requestId: 'req_1',
  });

  assert.equal(body.product_id, PRODUCTS.pro);
  assert.equal(body.success_url, 'https://qatlia.example/credits/success');
  assert.deepEqual(body.metadata, { userId: UUID, packId: 'pro', credits: '100' });
  assert.deepEqual(body.customer, { email: 'artisan@example.com' });
  assert.throws(() => buildCreemCheckoutBody({ pack: CREDIT_PACKS.pro, productId: PRODUCTS.pro, userId: 'anonymous', origin: 'https://qatlia.example', requestId: 'r' }), /INVALID_USER_ID/);
});

test('Creem is configured only with a real key and a product for every pack, on the host its key names', () => {
  const { getCreemConfig, getCardProvider, allowDemoCheckout } = loadTsModule('src/lib/billing/config.ts');

  const test_ = getCreemConfig(CONFIGURED);
  assert.equal(test_.apiBase, 'https://test-api.creem.io');
  assert.deepEqual(test_.products, PRODUCTS);

  assert.equal(getCreemConfig({ ...CONFIGURED, CREEM_API_KEY: 'creem_live_realkey' }).apiBase, 'https://api.creem.io');
  assert.equal(getCreemConfig({ ...CONFIGURED, CREEM_API_KEY: 'creem_test_your_creem_api_key' }), null, 'the template placeholder is not a key');
  assert.equal(getCreemConfig({ ...CONFIGURED, CREEM_API_KEY: 'sk_test_abc' }), null);
  assert.equal(getCreemConfig({ ...CONFIGURED, CREEM_PRODUCT_PRO: undefined }), null, 'a missing pack product disables Creem');

  assert.equal(getCardProvider({ ...CONFIGURED, STRIPE_SECRET_KEY: 'sk_test_real' }), 'creem');
  assert.equal(getCardProvider({ STRIPE_SECRET_KEY: 'sk_test_real' }), 'stripe');
  assert.equal(getCardProvider({}), null);
  assert.equal(allowDemoCheckout({ ...CONFIGURED, NODE_ENV: 'development' }), false, 'no fake success link once Creem is live');
});

test('every pack advertises the USD price its Creem product charges', () => {
  const { CREDIT_PACKS, PACK_IDS } = loadTsModule('src/lib/billing/catalog.ts');

  for (const id of PACK_IDS) {
    assert.ok(CREDIT_PACKS[id].priceUSD > 0, `${id} needs a USD price`);
  }
  // Creem amounts are in cents; the captured products are the test store's.
  assert.equal(ONE_TIME.object.product.price, Math.round(CREDIT_PACKS.starter.priceUSD * 100));
  assert.equal(SUB_PAID.object.product.price, Math.round(CREDIT_PACKS.atelier_max.priceUSD * 100));
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const state = { user: null, rpcCalls: [], rpcResult: null, fetchCalls: [], fetchResult: null };

function resetState() {
  state.user = null;
  state.rpcCalls = [];
  state.rpcResult = () => ({ data: { success: true, duplicate: false }, error: null });
  state.fetchCalls = [];
  state.fetchResult = () =>
    new Response(JSON.stringify({ id: 'ch_1', checkout_url: 'https://creem.io/test/checkout/prod/ch_1' }), { status: 200 });
}

stubModule('@/lib/supabase/server', {
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: state.user }, error: null }) } }),
});
stubModule('@supabase/supabase-js', {
  createClient: () => ({
    rpc: (name, args) => {
      state.rpcCalls.push({ name, args });
      return Promise.resolve(state.rpcResult(name, args));
    },
  }),
});

const ENV_KEYS = [...Object.keys(CONFIGURED), 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'NODE_ENV'];

async function withEnv(overrides, fn) {
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const savedFetch = global.fetch;
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, overrides);
  global.fetch = async (url, init) => {
    state.fetchCalls.push({ url: String(url), init });
    return state.fetchResult();
  };
  try {
    return await fn();
  } finally {
    global.fetch = savedFetch;
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

const webhookRequest = (event, signature) => {
  const raw = JSON.stringify(event);
  return new Request('https://qatlia.example/api/credits/creem-webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(signature === null ? {} : { 'creem-signature': signature ?? sign(raw) }) },
    body: raw,
  });
};

test('checkout sends the session user to Creem with the pack product, ignoring a client userId', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.com' };

  await withEnv(CONFIGURED, async () => {
    const { POST } = loadTsModule('src/app/api/credits/checkout/route.ts');
    const res = await POST(
      new Request('https://qatlia.example/api/credits/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packId: 'standard', userId: '99999999-2222-4333-8444-555555555555' }),
      })
    );
    const data = await res.json();

    assert.equal(res.status, 200);
    assert.equal(data.url, 'https://creem.io/test/checkout/prod/ch_1');
    assert.equal(state.fetchCalls.length, 1);

    const call = state.fetchCalls[0];
    assert.equal(call.url, 'https://test-api.creem.io/v1/checkouts', 'a test key must call the test API');
    assert.equal(call.init.headers['x-api-key'], 'creem_test_realkey');
    const body = JSON.parse(call.init.body);
    assert.equal(body.product_id, PRODUCTS.standard);
    assert.equal(body.metadata.userId, UUID);
    assert.equal(body.success_url, 'https://qatlia.example/credits/success');
  });
});

test('checkout refuses an unauthenticated buyer before calling Creem', async () => {
  resetState();
  await withEnv(CONFIGURED, async () => {
    const { POST } = loadTsModule('src/app/api/credits/checkout/route.ts');
    const res = await POST(
      new Request('https://qatlia.example/api/credits/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packId: 'starter' }),
      })
    );

    assert.equal(res.status, 401);
    assert.equal(state.fetchCalls.length, 0);
  });
});

test('a Creem API failure surfaces as a stable error with no checkout url', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.com' };
  state.fetchResult = () => new Response(JSON.stringify({ error: 'boom' }), { status: 400 });

  await withEnv(CONFIGURED, async () => {
    const { POST } = loadTsModule('src/app/api/credits/checkout/route.ts');
    const res = await POST(
      new Request('https://qatlia.example/api/credits/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packId: 'starter' }),
      })
    );
    const data = await res.json();

    assert.equal(res.status, 502);
    assert.equal(data.error, 'CHECKOUT_FAILED');
    assert.equal(data.url, undefined);
  });
});

test('the checkout route tells the page which card provider is live', async () => {
  resetState();
  for (const [env, expected] of [
    [CONFIGURED, 'creem'],
    [{ STRIPE_SECRET_KEY: 'sk_test_real' }, 'stripe'],
    [{}, null],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    await withEnv(env, async () => {
      const { GET } = loadTsModule('src/app/api/credits/checkout/route.ts');
      const data = await (await GET()).json();
      assert.equal(data.provider, expected);
    });
  }
});

test('the Creem webhook rejects a missing or forged signature without touching the ledger', async () => {
  resetState();
  await withEnv(CONFIGURED, async () => {
    const { POST } = loadTsModule('src/app/api/credits/creem-webhook/route.ts');

    assert.equal((await POST(webhookRequest(ONE_TIME, null))).status, 400);
    assert.equal((await POST(webhookRequest(ONE_TIME, sign('{}')))).status, 400);
    assert.equal(state.rpcCalls.length, 0);
  });
});

test('a verified one-time Creem purchase grants its credits through add_credits', async () => {
  resetState();
  await withEnv(CONFIGURED, async () => {
    const { POST } = loadTsModule('src/app/api/credits/creem-webhook/route.ts');
    const res = await POST(webhookRequest(ONE_TIME));

    assert.equal(res.status, 200);
    assert.equal(state.rpcCalls.length, 1);
    const call = state.rpcCalls[0];
    assert.equal(call.name, 'add_credits');
    assert.equal(call.args.p_user_id, UUID);
    assert.equal(call.args.p_credits, 10);
    assert.equal(call.args.p_pack_id, 'starter');
    assert.equal(call.args.p_stripe_payment_id, `creem:${ONE_TIME.object.order.transaction}`);
  });
});

test('a new subscription delivered as two events is offered to the ledger under one key', async () => {
  resetState();
  // The real unique index answers the second insert as a duplicate.
  const seen = new Set();
  state.rpcResult = (name, args) => {
    const duplicate = seen.has(args.p_stripe_payment_id);
    seen.add(args.p_stripe_payment_id);
    return { data: { success: true, duplicate }, error: null };
  };

  await withEnv(CONFIGURED, async () => {
    const { POST } = loadTsModule('src/app/api/credits/creem-webhook/route.ts');
    const first = await (await POST(webhookRequest(SUB_PAID))).json();
    const second = await (await POST(webhookRequest(SUB_CHECKOUT))).json();

    assert.equal(state.rpcCalls.length, 2);
    assert.equal(state.rpcCalls[0].args.p_stripe_payment_id, state.rpcCalls[1].args.p_stripe_payment_id);
    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true, 'the first month is credited once');
  });
});

test('a paid Creem event for an unknown product fails delivery so Creem retries', async () => {
  resetState();
  const event = structuredClone(ONE_TIME);
  event.object.product.id = 'prod_someone_else';
  event.object.order.product = 'prod_someone_else';

  await withEnv(CONFIGURED, async () => {
    const { POST } = loadTsModule('src/app/api/credits/creem-webhook/route.ts');
    const res = await POST(webhookRequest(event));

    assert.equal(res.status, 500);
    assert.equal(state.rpcCalls.length, 0);
  });
});

test('an unrelated Creem event is acknowledged so it is never retried', async () => {
  resetState();
  await withEnv(CONFIGURED, async () => {
    const { POST } = loadTsModule('src/app/api/credits/creem-webhook/route.ts');
    const res = await POST(webhookRequest({ id: 'evt_c', eventType: 'subscription.canceled', object: { id: 'sub_1' } }));
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.granted, false);
    assert.equal(state.rpcCalls.length, 0);
  });
});
