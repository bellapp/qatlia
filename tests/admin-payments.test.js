const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');
const { createFakeSupabase } = require('./helpers/fake-supabase');

// One list for every payment: manual orders and card payments (plan
// 2026-11-12, Task 8). A card amount is exact when the webhook recorded it,
// otherwise the catalog price marked as an estimate — never invented.

const { toCardPaymentView, toManualPaymentView, parsePaymentFilters, listPayments } = loadTsModule('src/lib/admin/payments.ts');
const { CREDIT_PACKS } = loadTsModule('src/lib/billing/catalog.ts');

const CLIENT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ledger = (over) => ({
  id: 'l1',
  user_id: CLIENT,
  type: 'purchase',
  amount: 30,
  balance_after: 50,
  description: null,
  reason: 'starter',
  stripe_payment_id: 'creem:tran_1',
  amount_paid: null,
  currency: null,
  created_at: '2026-11-10T11:00:00Z',
  ...over,
});
const order = (over) => ({
  id: 'o1',
  order_number: 'QIA-20261110-AAAA',
  user_id: CLIENT,
  pack_id: 'starter',
  amount_mad: '50.00',
  credits: 30,
  status: 'pending',
  method: 'bank_transfer',
  payment_reference: null,
  created_at: '2026-11-10T10:00:00Z',
  decided_at: null,
  ...over,
});

test('paiement Creem avec montant enregistré : montant exact', () => {
  const v = toCardPaymentView(ledger({ amount_paid: 4.99, currency: 'USD' }));
  assert.deepEqual([v.source, v.amount, v.currency, v.amountIsEstimate, v.status, v.credits], ['creem', 4.99, 'USD', false, 'granted', 30]);
});

test('paiement Creem sans montant : prix catalogue marqué comme estimation', () => {
  const v = toCardPaymentView(ledger({ reason: 'standard', amount: 80 }));
  assert.deepEqual([v.amount, v.currency, v.amountIsEstimate], [CREDIT_PACKS.standard.priceUSD, 'USD', true]);
});

test('paiement Stripe sans montant : prix catalogue en MAD', () => {
  const v = toCardPaymentView(ledger({ stripe_payment_id: 'cs:cs_1', reason: 'pro', amount: 200 }));
  assert.deepEqual([v.source, v.amount, v.currency, v.amountIsEstimate], ['stripe', CREDIT_PACKS.pro.priceMAD, 'MAD', true]);
});

test("pack inconnu : montant nul plutôt qu'inventé", () => {
  const v = toCardPaymentView(ledger({ stripe_payment_id: 'cs:cs_9', reason: 'unlimited', amount: 999 }));
  assert.equal(v.amount, null);
  assert.equal(v.amountIsEstimate, false);
});

test("un remboursement ou une commande manuelle n'est pas un paiement par carte", () => {
  assert.equal(toCardPaymentView(ledger({ stripe_payment_id: 'optimize_refund_1', reason: 'refund' })), null);
  assert.equal(toCardPaymentView(ledger({ stripe_payment_id: 'manual:abc' })), null);
});

test('commande manuelle : montant en MAD exact', () => {
  const v = toManualPaymentView(order({ status: 'granted' }));
  assert.deepEqual([v.source, v.amount, v.currency, v.amountIsEstimate, v.status, v.orderNumber], ['manual', 50, 'MAD', false, 'granted', 'QIA-20261110-AAAA']);
});

test('parsePaymentFilters : défauts et valeurs inconnues', () => {
  assert.deepEqual(parsePaymentFilters({}), { source: 'all', status: 'pending', search: '' });
  assert.deepEqual(parsePaymentFilters({ source: 'x', status: 'drop', q: ' QIA ' }), { source: 'all', status: 'pending', search: 'QIA' });
  assert.deepEqual(parsePaymentFilters({ source: 'card', status: 'all' }), { source: 'card', status: 'all', search: '' });
});

function seeded() {
  const fake = createFakeSupabase();
  fake.state.tables = {
    manual_payments: [order({ created_at: '2026-11-10T10:00:00Z' }), order({ id: 'o2', order_number: 'QIA-20261109-BBBB', status: 'granted', created_at: '2026-11-09T10:00:00Z' })],
    credit_transactions: [ledger({ created_at: '2026-11-10T11:00:00Z' })],
    profiles: [{ id: CLIENT, email: 'chaima@bois.ma' }],
  };
  return fake;
}

test('le filtre « en attente » ne montre que des commandes manuelles en attente', async () => {
  const fake = seeded();
  fake.state.tables.manual_payments = [order()];
  const r = await listPayments(fake.client, { source: 'all', status: 'pending', search: '' });
  assert.equal(r.status, 'ok');
  assert.ok(r.payments.length > 0);
  assert.ok(r.payments.every((p) => p.source === 'manual' && p.status === 'pending'));
  assert.deepEqual(fake.ops('manual_payments', 'eq'), [['status', 'pending']]);
  assert.equal(fake.state.fromCalls.filter((c) => c.table === 'credit_transactions').length, 0, 'card payments are never pending');
});

test('fusion triée par date décroissante, emails résolus', async () => {
  const fake = seeded();
  const r = await listPayments(fake.client, { source: 'all', status: 'all', search: '' });
  assert.deepEqual(
    r.payments.map((p) => p.source),
    ['creem', 'manual', 'manual']
  );
  assert.ok(r.payments.every((p) => p.email === 'chaima@bois.ma'));
});

test('source carte : aucune lecture des commandes manuelles', async () => {
  const fake = seeded();
  const r = await listPayments(fake.client, { source: 'card', status: 'all', search: '' });
  assert.deepEqual(r.payments.map((p) => p.source), ['creem']);
  assert.equal(fake.state.fromCalls.filter((c) => c.table === 'manual_payments').length, 0);
});

test('recherche sur numéro de commande, email, référence', async () => {
  const fake = seeded();
  const byOrder = await listPayments(fake.client, { source: 'all', status: 'all', search: 'bbbb' });
  assert.deepEqual(byOrder.payments.map((p) => p.orderNumber), ['QIA-20261109-BBBB']);
  const byReference = await listPayments(fake.client, { source: 'all', status: 'all', search: 'tran_1' });
  assert.deepEqual(byReference.payments.map((p) => p.source), ['creem']);
  const byEmail = await listPayments(fake.client, { source: 'all', status: 'all', search: 'CHAIMA' });
  assert.equal(byEmail.payments.length, 3);
});

test('échec de lecture : error', async () => {
  const fake = seeded();
  fake.state.tableErrors = { manual_payments: { code: '57014', message: 'timeout' } };
  assert.deepEqual(await listPayments(fake.client, { source: 'all', status: 'all', search: '' }), { status: 'error' });
});
