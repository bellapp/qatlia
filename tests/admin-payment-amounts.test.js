const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');
const { stubModule } = require('./helpers/stub-module');
const { createFakeSupabase } = require('./helpers/fake-supabase');

// Card payments record what was really charged (plan 2026-11-12, Task 6), so
// the back office can show revenue instead of a catalog estimate. The amount
// never influences the credits granted, and failing to record it never fails
// the webhook — the customer has paid and must be credited regardless.

const UUID = '11111111-2222-4333-8444-555555555555';
const PRODUCTS = {
  starter: 'prod_3GauWfIWgKNQEdIsdf2Zbs',
  standard: 'prod_3IDcgmGhEszxRz7Gl4lmTT',
  pro: 'prod_6nrhVHrH4FA3Z40GkyszID',
  atelier_max: 'prod_592WDHbLmTPSI7Gb0J2VVc',
};
const ONE_TIME = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'creem', 'checkout-completed-onetime.json'), 'utf8'));

const fake = createFakeSupabase();
stubModule('@supabase/supabase-js', { createClient: () => fake.client });

const { resolveGrant, readAmountPaid } = loadTsModule('src/lib/billing/grant.ts');
const { resolveCreemGrant } = loadTsModule('src/lib/billing/creem.ts');
const { CREDIT_PACKS } = loadTsModule('src/lib/billing/catalog.ts');
const { applyGrant } = loadTsModule('src/lib/billing/apply-grant.ts');

function session(overrides) {
  return {
    id: 'evt_1',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_1',
        mode: 'payment',
        payment_status: 'paid',
        metadata: { userId: UUID, packId: 'standard' },
        ...overrides,
      },
    },
  };
}

const grant = (over) => ({
  userId: UUID,
  packId: 'starter',
  credits: 30,
  idempotencyKey: 'creem:tran_1',
  source: 'creem_checkout',
  amountPaid: null,
  currency: null,
  ...over,
});

function withSupabaseEnv(fn) {
  return async () => {
    const saved = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://real.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'sbsvc_real';
    fake.state.rpcCalls = [];
    fake.state.fromCalls = [];
    fake.state.tableErrors = {};
    fake.state.rpcResult = () => ({ data: { success: true, duplicate: false }, error: null });
    try {
      await fn();
    } finally {
      for (const [k, v] of [['NEXT_PUBLIC_SUPABASE_URL', saved.url], ['SUPABASE_SERVICE_ROLE_KEY', saved.key]]) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };
}

test('readAmountPaid convertit des centimes en unité majeure et normalise la devise', () => {
  assert.deepEqual(readAmountPaid(10000, 'mad'), { amountPaid: 100, currency: 'MAD' });
  assert.deepEqual(readAmountPaid(299, 'USD'), { amountPaid: 2.99, currency: 'USD' });
  assert.deepEqual(readAmountPaid(0, 'usd'), { amountPaid: 0, currency: 'USD' });
  for (const [amount, currency] of [[undefined, 'mad'], [null, 'mad'], ['abc', 'mad'], [-5, 'mad'], [1.5, 'mad'], [100, ''], [100, null], [100, 'dollars']]) {
    assert.deepEqual(readAmountPaid(amount, currency), { amountPaid: null, currency: null }, `${amount} ${currency}`);
  }
});

test('Creem : le montant payé et la devise suivent la commande', () => {
  const r = resolveCreemGrant(ONE_TIME, PRODUCTS);
  assert.equal(r.ok, true);
  assert.deepEqual([r.grant.amountPaid, r.grant.currency], [2.99, 'USD']);
});

test('Creem : montant absent, crédits inchangés', () => {
  const event = JSON.parse(JSON.stringify(ONE_TIME));
  delete event.object.order.amount_paid;
  const r = resolveCreemGrant(event, PRODUCTS);
  assert.deepEqual([r.grant.amountPaid, r.grant.currency, r.grant.credits], [null, null, CREDIT_PACKS.starter.credits]);
});

test('Stripe : amount_total en centimes devient un montant en unité majeure', () => {
  const r = resolveGrant(session({ amount_total: 10000, currency: 'mad' }));
  assert.deepEqual([r.grant.amountPaid, r.grant.currency], [100, 'MAD']);
});

test('montant absent ou invalide : champs nuls, crédits inchangés', () => {
  for (const amount_total of [undefined, null, 'abc', -5]) {
    const r = resolveGrant(session({ amount_total, currency: 'mad' }));
    assert.deepEqual([r.grant.amountPaid, r.grant.currency, r.grant.credits], [null, null, CREDIT_PACKS.standard.credits]);
  }
});

test(
  'applyGrant : enregistre le montant sur la ligne du grand livre après un crédit réussi',
  withSupabaseEnv(async () => {
    const res = await applyGrant(grant({ amountPaid: 2.99, currency: 'USD' }));
    assert.equal(res.status, 200);
    const updates = fake.ops('credit_transactions', 'update');
    assert.deepEqual(updates, [[{ amount_paid: 2.99, currency: 'USD' }]]);
    const eqs = fake.ops('credit_transactions', 'eq');
    assert.deepEqual(eqs, [['stripe_payment_id', 'creem:tran_1']]);
  })
);

test(
  "applyGrant : l'échec de l'écriture du montant laisse la réponse à 200",
  withSupabaseEnv(async () => {
    fake.state.tableErrors = { credit_transactions: { message: 'column amount_paid does not exist' } };
    const res = await applyGrant(grant({ amountPaid: 2.99, currency: 'USD' }));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).granted, true);
  })
);

test(
  "applyGrant : un événement redélivré n'écrit pas le montant une seconde fois",
  withSupabaseEnv(async () => {
    fake.state.rpcResult = () => ({ data: { success: true, duplicate: true }, error: null });
    await applyGrant(grant({ amountPaid: 2.99, currency: 'USD' }));
    assert.equal(fake.ops('credit_transactions', 'update').length, 0);
  })
);

test(
  "applyGrant : sans montant, aucune écriture supplémentaire",
  withSupabaseEnv(async () => {
    await applyGrant(grant());
    assert.equal(fake.state.fromCalls.length, 0);
  })
);
