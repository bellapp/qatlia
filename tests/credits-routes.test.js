const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');
const { stubModule } = require('./helpers/stub-module');

// Route-level enforcement of the P0 Task 5 credit policy:
//   * checkout resolves the buyer from the server session, never from the request body;
//   * the webhook only grants credits for a verified, non-anonymous, idempotent payment;
//   * Vision charges exactly one credit, and only after a valid, successfully parsed analysis.

const UUID = '11111111-2222-4333-8444-555555555555';

// Mutable state shared with the stubbed modules; each test resets it.
const state = {
  user: null,
  admin: {
    rpcCalls: [],
    rpcResult: () => ({ data: null, error: null }),
    fromCalls: [],
  },
  // Every upstream call the routes make. The Vision preflight is only worth
  // anything if it refuses *before* the paid model call, so most Vision
  // assertions are about this array staying empty.
  fetchCalls: [],
  stripe: {
    sessions: [],
    createResult: { id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' },
    constructEvent: () => {
      throw new Error('no webhook stub configured');
    },
  },
};

// `ensure_profile` returns the caller's current balance, and the Vision
// preflight refuses to reach the model without one, so the default stub answers
// it with a healthy balance. Tests that care about the balance override it.
const HEALTHY_BALANCE = 5;
const defaultRpcResult = (name) => {
  if (name === 'ensure_profile') return { data: HEALTHY_BALANCE, error: null };
  if (name === 'add_credits') return { data: { success: true, duplicate: false }, error: null };
  return { data: null, error: null };
};

function resetState() {
  state.user = null;
  state.admin.rpcCalls = [];
  state.admin.rpcResult = defaultRpcResult;
  state.admin.fromCalls = [];
  state.fetchCalls = [];
  state.stripe.sessions = [];
  state.stripe.createResult = { id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' };
}

/** RPC calls of one name — most assertions care about debits specifically. */
const rpcCallsNamed = (name) => state.admin.rpcCalls.filter((call) => call.name === name);

function adminClientStub() {
  const table = (name) => {
    const recorder = { table: name, ops: [] };
    state.admin.fromCalls.push(recorder);
    const chain = {
      insert: (...args) => {
        recorder.ops.push(['insert', args]);
        return Promise.resolve({ data: null, error: null });
      },
      upsert: (...args) => {
        recorder.ops.push(['upsert', args]);
        return Promise.resolve({ data: null, error: null });
      },
      update: (...args) => {
        recorder.ops.push(['update', args]);
        return chain;
      },
      select: (...args) => {
        recorder.ops.push(['select', args]);
        return chain;
      },
      eq: () => chain,
      single: () => Promise.resolve({ data: null, error: null }),
      then: (resolve) => Promise.resolve({ data: null, error: null }).then(resolve),
    };
    return chain;
  };
  return {
    from: table,
    rpc: (name, args) => {
      state.admin.rpcCalls.push({ name, args });
      return Promise.resolve(state.admin.rpcResult(name, args));
    },
  };
}

stubModule('@/lib/supabase/server', {
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
  }),
});
stubModule('@supabase/supabase-js', { createClient: () => adminClientStub() });
stubModule('@/lib/billing/stripe-client', {
  getStripe: () => ({
    checkout: {
      sessions: {
        create: async (params) => {
          state.stripe.sessions.push(params);
          return state.stripe.createResult;
        },
      },
    },
    webhooks: { constructEvent: (...args) => state.stripe.constructEvent(...args) },
  }),
});

const ENV_KEYS = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'OPENROUTER_API_KEY',
  'OPENROUTER_MODEL',
  'OPENAI_API_KEY',
  'NODE_ENV',
];

function withEnv(overrides, fn) {
  const saved = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) process.env[key] = value;
  }
  const restore = () => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  };
  const result = fn();
  return result && typeof result.then === 'function' ? result.finally(restore) : (restore(), result);
}

const CONFIGURED = {
  STRIPE_SECRET_KEY: 'sk_test_realkey',
  STRIPE_WEBHOOK_SECRET: 'whsec_real',
  NEXT_PUBLIC_APP_URL: 'https://qatlia.example',
  NEXT_PUBLIC_SUPABASE_URL: 'https://real.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'sbsvc_real',
};

function jsonRequest(url, body, headers = {}) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// /api/credits/checkout
// ---------------------------------------------------------------------------

test('checkout refuses an unauthenticated buyer and creates no Stripe session', async () => {
  resetState();
  await withEnv(CONFIGURED, async () => {
    const { POST } = loadTsModule('src/app/api/credits/checkout/route.ts');
    const res = await POST(jsonRequest('https://qatlia.example/api/credits/checkout', { packId: 'starter' }));

    assert.equal(res.status, 401);
    assert.equal(state.stripe.sessions.length, 0);
  });
});

test('checkout ignores a client-supplied userId and bills the session user in MAD', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  await withEnv(CONFIGURED, async () => {
    const { POST } = loadTsModule('src/app/api/credits/checkout/route.ts');
    const res = await POST(
      jsonRequest('https://qatlia.example/api/credits/checkout', {
        packId: 'standard',
        userId: '00000000-0000-4000-8000-000000000000',
        userEmail: 'attacker@example.com',
      })
    );
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.url, state.stripe.createResult.url);
    assert.equal(state.stripe.sessions.length, 1);

    const params = state.stripe.sessions[0];
    assert.equal(params.metadata.userId, UUID, 'the session user must win over the request body');
    assert.equal(params.metadata.userEmail, 'artisan@example.ma');
    assert.equal(params.line_items[0].price_data.currency, 'mad');
    assert.equal(params.line_items[0].price_data.unit_amount, 4000);
  });
});

test('checkout rejects an unknown pack id', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  await withEnv(CONFIGURED, async () => {
    const { POST } = loadTsModule('src/app/api/credits/checkout/route.ts');
    const res = await POST(jsonRequest('https://qatlia.example/api/credits/checkout', { packId: 'free' }));

    assert.equal(res.status, 400);
    assert.equal(state.stripe.sessions.length, 0);
  });
});

test('checkout in production with placeholder Stripe config fails safely with no fake success URL', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  await withEnv({ ...CONFIGURED, NODE_ENV: 'production', STRIPE_SECRET_KEY: 'sk_test_placeholder' }, async () => {
    const { POST } = loadTsModule('src/app/api/credits/checkout/route.ts');
    const res = await POST(jsonRequest('https://qatlia.example/api/credits/checkout', { packId: 'starter' }));
    const body = await res.json();

    assert.equal(res.status, 503);
    assert.equal(body.url, undefined, 'production must never hand out a demo credit-grant link');
    assert.equal(state.stripe.sessions.length, 0);
  });
});

test('outside production checkout falls back to a validated request origin', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  await withEnv({ ...CONFIGURED, NEXT_PUBLIC_APP_URL: 'javascript:alert(1)' }, async () => {
    const { POST } = loadTsModule('src/app/api/credits/checkout/route.ts');
    await POST(
      jsonRequest('https://qatlia.example/api/credits/checkout', { packId: 'starter' }, { origin: 'https://qatlia.example' })
    );

    const params = state.stripe.sessions[0];
    assert.ok(params.success_url.startsWith('https://qatlia.example/'), 'success URL must use a validated origin');
    assert.ok(!params.success_url.includes('javascript:'));
  });
});

test('production builds the redirect from NEXT_PUBLIC_APP_URL and ignores a hostile Origin header', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  await withEnv({ ...CONFIGURED, NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: 'https://qatlia.ma' }, async () => {
    const { POST } = loadTsModule('src/app/api/credits/checkout/route.ts');
    const res = await POST(
      jsonRequest(
        'https://qatlia.example/api/credits/checkout',
        { packId: 'starter' },
        { origin: 'https://evil.example' }
      )
    );

    assert.equal(res.status, 200);
    const params = state.stripe.sessions[0];
    assert.ok(params.success_url.startsWith('https://qatlia.ma/'), 'the configured app URL is the only redirect target');
    assert.ok(params.cancel_url.startsWith('https://qatlia.ma/'));
    assert.ok(!params.success_url.includes('evil.example'), 'a paying customer must never be redirected to the caller\'s Origin');
  });
});

test('production without a usable NEXT_PUBLIC_APP_URL refuses to create a session', async () => {
  for (const appUrl of [undefined, 'javascript:alert(1)', 'not a url']) {
    resetState();
    state.user = { id: UUID, email: 'artisan@example.ma' };
    // eslint-disable-next-line no-await-in-loop
    await withEnv({ ...CONFIGURED, NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: appUrl }, async () => {
      const { POST } = loadTsModule('src/app/api/credits/checkout/route.ts');
      const res = await POST(
        jsonRequest(
          'https://qatlia.example/api/credits/checkout',
          { packId: 'starter' },
          { origin: 'https://evil.example' }
        )
      );
      const body = await res.json();

      assert.equal(res.status, 503, `NEXT_PUBLIC_APP_URL=${String(appUrl)} must fail closed`);
      assert.equal(body.url, undefined);
      assert.equal(state.stripe.sessions.length, 0, 'no Stripe session may be created against an unvalidated origin');
    });
  }
});

// ---------------------------------------------------------------------------
// /api/credits/webhook
// ---------------------------------------------------------------------------

test('the webhook rejects a request whose signature does not verify', async () => {
  resetState();
  state.stripe.constructEvent = () => {
    throw new Error('No signatures found matching the expected signature');
  };
  await withEnv(CONFIGURED, async () => {
    const { POST } = loadTsModule('src/app/api/credits/webhook/route.ts');
    const res = await POST(jsonRequest('https://qatlia.example/api/credits/webhook', {}, { 'stripe-signature': 'bad' }));

    assert.equal(res.status, 400);
    assert.equal(state.admin.rpcCalls.length, 0);
  });
});

test('the webhook rejects a request with no signature header', async () => {
  resetState();
  await withEnv(CONFIGURED, async () => {
    const { POST } = loadTsModule('src/app/api/credits/webhook/route.ts');
    const res = await POST(jsonRequest('https://qatlia.example/api/credits/webhook', {}));

    assert.equal(res.status, 400);
    assert.equal(state.admin.rpcCalls.length, 0);
  });
});

test('a verified paid checkout session grants credits through the idempotent RPC', async () => {
  resetState();
  state.stripe.constructEvent = () => ({
    id: 'evt_1',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_abc',
        mode: 'payment',
        payment_status: 'paid',
        metadata: { userId: UUID, packId: 'pro', credits: '100' },
      },
    },
  });
  state.admin.rpcResult = () => ({ data: { success: true, balance: 100, duplicate: false }, error: null });

  await withEnv(CONFIGURED, async () => {
    const { POST } = loadTsModule('src/app/api/credits/webhook/route.ts');
    const res = await POST(jsonRequest('https://qatlia.example/api/credits/webhook', {}, { 'stripe-signature': 'ok' }));

    assert.equal(res.status, 200);
    assert.equal(state.admin.rpcCalls.length, 1);

    const call = state.admin.rpcCalls[0];
    assert.equal(call.name, 'add_credits');
    assert.equal(call.args.p_user_id, UUID);
    assert.equal(call.args.p_credits, 100);
    assert.equal(call.args.p_pack_id, 'pro');
    assert.ok(call.args.p_stripe_payment_id.includes('cs_test_abc'), 'the RPC must be keyed by a stable payment id');
  });
});

test('a paid session whose metadata cannot identify the buyer fails loudly instead of a silent 200', async () => {
  resetState();
  state.stripe.constructEvent = () => ({
    id: 'evt_2',
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_x', mode: 'payment', payment_status: 'paid', metadata: { userId: 'anonymous', packId: 'pro' } } },
  });

  await withEnv(CONFIGURED, async () => {
    const { POST } = loadTsModule('src/app/api/credits/webhook/route.ts');
    const res = await POST(jsonRequest('https://qatlia.example/api/credits/webhook', {}, { 'stripe-signature': 'ok' }));
    const body = await res.json();

    // The customer has been charged. Answering 200 granted:false would bury
    // that: Stripe stops retrying and nothing is ever alerted on.
    assert.equal(res.status, 500, 'money taken with no credit granted must be a failed delivery');
    assert.equal(body.granted, undefined);
    assert.match(body.error, /GRANT/);
    assert.equal(state.admin.rpcCalls.length, 0);
  });
});

test('a paid Dahlia subscription invoice with unusable metadata is retried, not acknowledged', async () => {
  resetState();
  state.stripe.constructEvent = () => ({
    id: 'evt_2b',
    type: 'invoice.payment_succeeded',
    data: {
      object: {
        id: 'in_x',
        status: 'paid',
        parent: { type: 'subscription_details', subscription_details: { metadata: {} } },
      },
    },
  });

  await withEnv(CONFIGURED, async () => {
    const { POST } = loadTsModule('src/app/api/credits/webhook/route.ts');
    const res = await POST(jsonRequest('https://qatlia.example/api/credits/webhook', {}, { 'stripe-signature': 'ok' }));

    assert.equal(res.status, 500);
    assert.equal(state.admin.rpcCalls.length, 0);
  });
});

test('a paid Dahlia subscription invoice grants the monthly credits exactly once', async () => {
  resetState();
  state.stripe.constructEvent = () => ({
    id: 'evt_2c',
    type: 'invoice.payment_succeeded',
    data: {
      object: {
        id: 'in_dahlia_1',
        status: 'paid',
        parent: {
          type: 'subscription_details',
          subscription_details: { metadata: { userId: UUID, packId: 'atelier_max' } },
        },
      },
    },
  });
  state.admin.rpcResult = () => ({ data: { success: true, balance: 1000 }, error: null });

  await withEnv(CONFIGURED, async () => {
    const { POST } = loadTsModule('src/app/api/credits/webhook/route.ts');
    const res = await POST(jsonRequest('https://qatlia.example/api/credits/webhook', {}, { 'stripe-signature': 'ok' }));

    assert.equal(res.status, 200);
    assert.equal(state.admin.rpcCalls.length, 1);

    const call = state.admin.rpcCalls[0];
    assert.equal(call.name, 'add_credits');
    assert.equal(call.args.p_user_id, UUID);
    assert.equal(call.args.p_credits, 1000, 'the renewal tops the balance up by the catalog amount');
    assert.equal(call.args.p_pack_id, 'atelier_max');
    assert.ok(call.args.p_stripe_payment_id.includes('in_dahlia_1'));
  });
});

test('an unrelated Stripe event is acknowledged so it is never retried', async () => {
  for (const type of ['customer.created', 'charge.refunded', 'invoice.payment_failed']) {
    resetState();
    state.stripe.constructEvent = () => ({ id: 'evt_ignored', type, data: { object: { id: 'obj_1' } } });

    // eslint-disable-next-line no-await-in-loop
    await withEnv(CONFIGURED, async () => {
      const { POST } = loadTsModule('src/app/api/credits/webhook/route.ts');
      const res = await POST(jsonRequest('https://qatlia.example/api/credits/webhook', {}, { 'stripe-signature': 'ok' }));
      const body = await res.json();

      assert.equal(res.status, 200, `${type} is not ours to credit and must not be retried forever`);
      assert.equal(body.granted, false);
      assert.equal(state.admin.rpcCalls.length, 0);
    });
  }
});

test('an unpaid session and a subscription session are acknowledged without a grant', async () => {
  const events = [
    { id: 'evt_u1', type: 'checkout.session.completed', data: { object: { id: 'cs_u', mode: 'payment', payment_status: 'unpaid', metadata: { userId: UUID, packId: 'pro' } } } },
    { id: 'evt_u2', type: 'checkout.session.completed', data: { object: { id: 'cs_s', mode: 'subscription', payment_status: 'paid', metadata: { userId: UUID, packId: 'atelier_max' } } } },
  ];

  for (const event of events) {
    resetState();
    state.stripe.constructEvent = () => event;

    // eslint-disable-next-line no-await-in-loop
    await withEnv(CONFIGURED, async () => {
      const { POST } = loadTsModule('src/app/api/credits/webhook/route.ts');
      const res = await POST(jsonRequest('https://qatlia.example/api/credits/webhook', {}, { 'stripe-signature': 'ok' }));
      const body = await res.json();

      assert.equal(res.status, 200);
      assert.equal(body.granted, false);
      assert.equal(state.admin.rpcCalls.length, 0);
    });
  }
});

test('a failing grant RPC returns 500 so Stripe retries the delivery', async () => {
  resetState();
  state.stripe.constructEvent = () => ({
    id: 'evt_3',
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_y', mode: 'payment', payment_status: 'paid', metadata: { userId: UUID, packId: 'starter' } } },
  });
  state.admin.rpcResult = () => ({ data: null, error: { message: 'connection reset' } });

  await withEnv(CONFIGURED, async () => {
    const { POST } = loadTsModule('src/app/api/credits/webhook/route.ts');
    const res = await POST(jsonRequest('https://qatlia.example/api/credits/webhook', {}, { 'stripe-signature': 'ok' }));

    assert.equal(res.status, 500);
  });
});

// ---------------------------------------------------------------------------
// /api/vision
// ---------------------------------------------------------------------------

const IMAGE = `data:image/png;base64,${'a'.repeat(64)}`;

function visionRequest(body = { imageBase64: IMAGE }) {
  return jsonRequest('https://qatlia.example/api/vision', body);
}

function stubFetch(impl) {
  const original = globalThis.fetch;
  globalThis.fetch = (...args) => {
    state.fetchCalls.push(args);
    return impl(...args);
  };
  return () => {
    globalThis.fetch = original;
  };
}

/** A stub for the cases where reaching the model is itself the failure. */
const neverCalled = async () => {
  throw new Error('the upstream model must not be called');
};

function upstreamOk(pieces) {
  return async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ pieces }) } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
}

test('Vision requires an authenticated user', async () => {
  resetState();
  await withEnv({ ...CONFIGURED, OPENROUTER_API_KEY: 'or_real' }, async () => {
    const { POST } = loadTsModule('src/app/api/vision/route.ts');
    const res = await POST(visionRequest());

    assert.equal(res.status, 401);
    assert.equal(state.admin.rpcCalls.length, 0);
  });
});

test('invalid Vision input costs no credit', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  await withEnv({ ...CONFIGURED, OPENROUTER_API_KEY: 'or_real' }, async () => {
    const { POST } = loadTsModule('src/app/api/vision/route.ts');
    const res = await POST(visionRequest({ imageBase64: 'x' }));

    assert.equal(res.status, 400);
    assert.equal(state.admin.rpcCalls.length, 0);
  });
});

test('an upstream Vision failure costs no credit', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  const restore = stubFetch(async () => new Response('upstream exploded', { status: 500 }));
  try {
    await withEnv({ ...CONFIGURED, OPENROUTER_API_KEY: 'or_real' }, async () => {
      const { POST } = loadTsModule('src/app/api/vision/route.ts');
      const res = await POST(visionRequest());

      assert.equal(res.status, 502);
      assert.equal(rpcCallsNamed('consume_credit').length, 0, 'a failed analysis is never debited');
      assert.equal(
        rpcCallsNamed('ensure_profile').length,
        1,
        'the balance was still checked once, before the model was called'
      );
    });
  } finally {
    restore();
  }
});

test('an unparsable Vision answer costs no credit', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  const restore = stubFetch(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: 'je ne sais pas' } }] }), { status: 200 })
  );
  try {
    await withEnv({ ...CONFIGURED, OPENROUTER_API_KEY: 'or_real' }, async () => {
      const { POST } = loadTsModule('src/app/api/vision/route.ts');
      const res = await POST(visionRequest());

      assert.equal(res.status, 422);
      assert.equal(rpcCallsNamed('consume_credit').length, 0, 'an unreadable answer is never debited');
      assert.equal(rpcCallsNamed('ensure_profile').length, 1);
    });
  } finally {
    restore();
  }
});

test('demo mode returns sample pieces without charging and without a fabricated balance', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  await withEnv({ ...CONFIGURED, OPENROUTER_API_KEY: undefined, OPENAI_API_KEY: undefined }, async () => {
    const { POST } = loadTsModule('src/app/api/vision/route.ts');
    const res = await POST(visionRequest());
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.demo, true);
    assert.equal(body.creditsCharged, 0);
    assert.equal(body.confidence, undefined, 'no fabricated confidence score');
    assert.equal(state.admin.rpcCalls.length, 0, 'demo mode must not debit');
  });
});

test('a successful Vision analysis consumes exactly one credit and returns the real balance', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  state.admin.rpcResult = (name) =>
    name === 'consume_credit'
      ? { data: { success: true, balance: 7 }, error: null }
      : defaultRpcResult(name);

  const restore = stubFetch(upstreamOk([{ name: 'Panneau', height: 230, width: 120, quantity: 2 }]));
  try {
    await withEnv({ ...CONFIGURED, OPENROUTER_API_KEY: 'or_real' }, async () => {
      const { POST } = loadTsModule('src/app/api/vision/route.ts');
      const res = await POST(visionRequest());
      const body = await res.json();

      assert.equal(res.status, 200);
      assert.equal(body.pieces.length, 1);
      assert.equal(body.creditsCharged, 1);
      assert.equal(body.creditsRemaining, 7, 'the balance must come from the atomic RPC');

      const consumes = state.admin.rpcCalls.filter((call) => call.name === 'consume_credit');
      assert.equal(consumes.length, 1, 'exactly one atomic debit per successful analysis');
      assert.equal(consumes[0].args.p_user_id, UUID);
      assert.equal(consumes[0].args.p_amount, 1);
    });
  } finally {
    restore();
  }
});

test('a balance emptied after the preflight still withholds the Vision result', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  state.admin.rpcResult = (name) =>
    name === 'consume_credit'
      ? { data: { success: false, balance: 0, error: 'INSUFFICIENT_CREDITS' }, error: null }
      : defaultRpcResult(name);

  const restore = stubFetch(upstreamOk([{ name: 'Panneau', height: 230, width: 120, quantity: 2 }]));
  try {
    await withEnv({ ...CONFIGURED, OPENROUTER_API_KEY: 'or_real' }, async () => {
      const { POST } = loadTsModule('src/app/api/vision/route.ts');
      const res = await POST(visionRequest());
      const body = await res.json();

      assert.equal(res.status, 402);
      assert.equal(body.error, 'INSUFFICIENT_CREDITS');
      assert.equal(body.pieces, undefined, 'an unpaid analysis result must not be returned');
      assert.equal(body.creditsRemaining, 0);
    });
  } finally {
    restore();
  }
});

// --- Vision preflight: everything that must be settled before the paid call ---

test('in production a real AI key with no reachable credit ledger fails closed before the model call', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  const restore = stubFetch(neverCalled);
  try {
    await withEnv(
      { ...CONFIGURED, NODE_ENV: 'production', OPENROUTER_API_KEY: 'or_real', SUPABASE_SERVICE_ROLE_KEY: undefined },
      async () => {
        const { POST } = loadTsModule('src/app/api/vision/route.ts');
        const res = await POST(visionRequest());
        const body = await res.json();

        // Spending the model budget with no way to bill for it is the one
        // outcome that costs money and returns nothing recoverable.
        assert.equal(res.status, 503);
        assert.equal(body.pieces, undefined, 'no analysis may be handed out off the books');
        assert.equal(body.demo, undefined, 'production must never fall back to sample pieces');
        assert.equal(state.fetchCalls.length, 0, 'the paid model must not be called before billing is possible');
        assert.equal(rpcCallsNamed('consume_credit').length, 0);
      }
    );
  } finally {
    restore();
  }
});

test('in production a missing analysis provider fails closed instead of returning demo pieces', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  await withEnv(
    { ...CONFIGURED, NODE_ENV: 'production', OPENROUTER_API_KEY: undefined, OPENAI_API_KEY: undefined },
    async () => {
      const { POST } = loadTsModule('src/app/api/vision/route.ts');
      const res = await POST(visionRequest());
      const body = await res.json();

      assert.equal(res.status, 503);
      assert.equal(body.demo, undefined);
      assert.equal(body.pieces, undefined);
    }
  );
});

test('an empty balance is refused before the model is called, not after', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  state.admin.rpcResult = (name) => (name === 'ensure_profile' ? { data: 0, error: null } : defaultRpcResult(name));

  const restore = stubFetch(neverCalled);
  try {
    await withEnv({ ...CONFIGURED, OPENROUTER_API_KEY: 'or_real' }, async () => {
      const { POST } = loadTsModule('src/app/api/vision/route.ts');
      const res = await POST(visionRequest());
      const body = await res.json();

      assert.equal(res.status, 402);
      assert.equal(body.error, 'INSUFFICIENT_CREDITS');
      assert.equal(body.creditsRemaining, 0, 'the balance reported is the one the ledger returned');
      assert.equal(state.fetchCalls.length, 0, 'a user with no credits must not be able to spend the model budget');
      assert.equal(rpcCallsNamed('ensure_profile').length, 1);
      assert.equal(rpcCallsNamed('consume_credit').length, 0, 'nothing to debit, so no debit is attempted');
    });
  } finally {
    restore();
  }
});

test('an unreachable ledger at preflight fails closed before the model call', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  state.admin.rpcResult = (name) =>
    name === 'ensure_profile' ? { data: null, error: { message: 'connection reset' } } : defaultRpcResult(name);

  const restore = stubFetch(neverCalled);
  try {
    await withEnv({ ...CONFIGURED, OPENROUTER_API_KEY: 'or_real' }, async () => {
      const { POST } = loadTsModule('src/app/api/vision/route.ts');
      const res = await POST(visionRequest());
      const body = await res.json();

      assert.equal(res.status, 503);
      assert.equal(body.pieces, undefined);
      assert.equal(state.fetchCalls.length, 0);
      assert.equal(rpcCallsNamed('consume_credit').length, 0);
    });
  } finally {
    restore();
  }
});

test('a burst past the per-user rate limit is refused before it reaches the model', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  state.admin.rpcResult = (name) =>
    name === 'consume_credit' ? { data: { success: true, balance: 3 }, error: null } : defaultRpcResult(name);

  const restore = stubFetch(upstreamOk([{ name: 'Panneau', height: 230, width: 120, quantity: 2 }]));
  try {
    await withEnv({ ...CONFIGURED, OPENROUTER_API_KEY: 'or_real' }, async () => {
      const { VISION_RATE_LIMIT } = loadTsModule('src/lib/rate-limit.ts');
      // One module load: the limiter is a route-module singleton, so the burst
      // has to go through the same instance the deployment would use.
      const { POST } = loadTsModule('src/app/api/vision/route.ts');

      const responses = [];
      for (let i = 0; i < VISION_RATE_LIMIT.limit + 1; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        responses.push(await POST(visionRequest()));
      }

      const denied = responses[responses.length - 1];
      const body = await denied.json();

      assert.deepEqual(
        responses.slice(0, -1).map((res) => res.status),
        Array(VISION_RATE_LIMIT.limit).fill(200),
        'everything inside the budget is served normally'
      );
      assert.equal(denied.status, 429);
      assert.equal(body.error, 'RATE_LIMITED');
      assert.ok(
        Number(denied.headers.get('Retry-After')) > 0,
        'a throttled caller must be told when it may come back'
      );
      assert.equal(state.fetchCalls.length, VISION_RATE_LIMIT.limit, 'the refused request never reached the model');
      assert.equal(rpcCallsNamed('consume_credit').length, VISION_RATE_LIMIT.limit, 'a refused request is not debited');
    });
  } finally {
    restore();
  }
});

test('a logical add_credits rejection returns 500 so a paid event is retried', async () => {
  resetState();
  state.stripe.constructEvent = () => ({
    id: 'evt_profile_missing',
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_profile_missing', mode: 'payment', payment_status: 'paid', metadata: { userId: UUID, packId: 'starter' } } },
  });
  state.admin.rpcResult = () => ({ data: { success: false, error: 'PROFILE_NOT_FOUND' }, error: null });

  await withEnv(CONFIGURED, async () => {
    const { POST } = loadTsModule('src/app/api/credits/webhook/route.ts');
    const res = await POST(jsonRequest('https://qatlia.example/api/credits/webhook', {}, { 'stripe-signature': 'ok' }));
    const body = await res.json();
    assert.equal(res.status, 500);
    assert.equal(body.error, 'GRANT_FAILED');
  });
});

test('Vision rejects remote image URLs before any model fetch', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  const restore = stubFetch(neverCalled);
  try {
    await withEnv({ ...CONFIGURED, OPENROUTER_API_KEY: 'or_real' }, async () => {
      const { POST } = loadTsModule('src/app/api/vision/route.ts');
      const res = await POST(visionRequest({ imageBase64: 'https://attacker.example/image.png' }));
      assert.equal(res.status, 400);
      assert.equal(state.fetchCalls.length, 0);
    });
  } finally {
    restore();
  }
});

test('the legacy consume endpoint no longer debits credits', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  await withEnv(CONFIGURED, async () => {
    const { POST } = loadTsModule('src/app/api/credits/consume/route.ts');
    const res = await POST(jsonRequest('https://qatlia.example/api/credits/consume', {}));

    assert.equal(res.status, 410);
    assert.equal(state.admin.rpcCalls.length, 0);
    assert.equal(state.admin.fromCalls.length, 0, 'no direct table write may bypass the atomic RPC');
  });
});
