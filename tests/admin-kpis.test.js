const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');
const { createFakeSupabase } = require('./helpers/fake-supabase');

// Overview figures (plan 2026-11-12, Task 9). The shape mirrors what
// admin_kpis() (migration 013) returns — captured from a real run on
// PostgreSQL with seeded accounts.

const { parseKpis, getKpis, conversionRate } = loadTsModule('src/lib/admin/kpis.ts');

const SAMPLE = {
  signups: { today: 2, d7: 9, d30: 31, total: 120 },
  active: { d7: 14, d30: 40 },
  paying_clients: 12,
  revenue_mad: { d30: 450, month: 300, total: 2150.5 },
  card_payments: { count_d30: 3, count_total: 7, usd_total: 54.93, without_amount: 2 },
  usage: { scans_d7: 60, scans_d30: 210, optimizations_d30: 35, credits_used_d30: 245 },
  pending_orders: { count: 2, oldest_created_at: '2026-11-11T22:03:02.393571+01:00' },
  out_of_credits_never_paid: 17,
  monthly: [
    { month: '2026-06', scans: 0, signups: 0, revenue_mad: 0 },
    { month: '2026-07', scans: 3, signups: 4, revenue_mad: 0 },
    { month: '2026-08', scans: 10, signups: 8, revenue_mad: 100 },
    { month: '2026-09', scans: 30, signups: 20, revenue_mad: 400 },
    { month: '2026-10', scans: 80, signups: 50, revenue_mad: 1350.5 },
    { month: '2026-11', scans: 90, signups: 38, revenue_mad: 300 },
  ],
};

test('parseKpis accepte la forme renvoyée par admin_kpis', () => {
  const k = parseKpis(SAMPLE);
  assert.equal(k.signups.total, 120);
  assert.equal(k.monthly.length, 6);
  assert.equal(k.revenueMad.total, 2150.5);
  assert.equal(k.cardPayments.withoutAmount, 2);
  assert.equal(k.pendingOrders.oldestCreatedAt, SAMPLE.pending_orders.oldest_created_at);
  assert.equal(k.outOfCreditsNeverPaid, 17);
  assert.equal(k.monthly[4].revenueMad, 1350.5);
});

test('parseKpis : aucune commande en attente donne une date nulle', () => {
  const k = parseKpis({ ...SAMPLE, pending_orders: { count: 0, oldest_created_at: null } });
  assert.deepEqual(k.pendingOrders, { count: 0, oldestCreatedAt: null });
});

test('parseKpis rejette une forme inattendue au lieu de lever', () => {
  for (const bad of [null, [], 'x', { signups: {} }, { ...SAMPLE, monthly: 'non' }, { ...SAMPLE, signups: { ...SAMPLE.signups, total: 'abc' } }]) {
    assert.equal(parseKpis(bad), null);
  }
});

test('conversionRate : aucun inscrit donne null, pas NaN', () => {
  assert.equal(conversionRate({ ...parseKpis(SAMPLE), signups: { today: 0, d7: 0, d30: 0, total: 0 } }), null);
  assert.equal(conversionRate(parseKpis(SAMPLE)), 0.1);
});

test('getKpis : fonction absente donne migration_missing', async () => {
  const fake = createFakeSupabase();
  fake.state.rpcResult = () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
  assert.deepEqual(await getKpis(fake.client), { status: 'migration_missing' });
});

test('getKpis : réponse illisible donne error', async () => {
  const fake = createFakeSupabase();
  fake.state.rpcResult = () => ({ data: { nope: true }, error: null });
  assert.deepEqual(await getKpis(fake.client), { status: 'error' });
});

test('getKpis : appelle admin_kpis sans argument', async () => {
  const fake = createFakeSupabase();
  fake.state.rpcResult = () => ({ data: SAMPLE, error: null });
  const r = await getKpis(fake.client);
  assert.equal(r.status, 'ok');
  assert.deepEqual(fake.state.rpcCalls, [{ name: 'admin_kpis', args: undefined }]);
});
