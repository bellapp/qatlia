const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');
const { stubModule } = require('./helpers/stub-module');
const { createFakeSupabase } = require('./helpers/fake-supabase');

// Validating a manual payment from the back office (plan 2026-11-12, Task 7).
// The operator checks the transfer or the cash himself, then validates: the
// route only moves the order and credits through the same idempotent RPC.

const ADMIN = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-8888-4777-8666-555555555555';
const CLIENT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PAY_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

let fake;
const auth = { user: null };

stubModule('@/lib/admin/auth', {
  authorizeAdminRequest: async () => {
    if (auth.user !== ADMIN) {
      const { NextResponse } = require('next/server');
      return { ok: false, response: NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }) };
    }
    return { ok: true, admin: { userId: ADMIN, email: 'owner@qatlia.ma' } };
  },
});
stubModule('@/lib/admin/db', {
  getAdminDb: () => fake.client,
  isMissingMigration: (e) => !!e && ['PGRST202', 'PGRST205'].includes(e.code),
});

const { POST } = loadTsModule('src/app/api/admin/payments/route.ts');

function reset() {
  fake = createFakeSupabase();
  auth.user = ADMIN;
  fake.state.tables.manual_payments = { id: PAY_ID, user_id: CLIENT, pack_id: 'standard', credits: 80, amount_mad: 100, status: 'paid' };
  fake.state.rpcResult = () => ({ data: { success: true, duplicate: false, balance: 100 }, error: null });
}

const req = (body, headers = {}) =>
  new Request('https://qatlia.ma/api/admin/payments', {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: 'qatlia.ma', ...headers },
    body: JSON.stringify(body),
  });

const VALID = { order_number: 'QIA-20261112-AB23', decision: 'grant' };
const rpc = (name) => fake.state.rpcCalls.find((c) => c.name === name);
const audit = () => fake.ops('admin_audit_log', 'insert').map(([row]) => row);

test('refuse un appelant non admin sans toucher à la base', async () => {
  reset();
  auth.user = OTHER;
  const res = await POST(req(VALID));
  assert.equal(res.status, 401);
  assert.equal(fake.state.fromCalls.length + fake.state.rpcCalls.length, 0);
});

test("l'ancien code secret n'ouvre plus rien", async () => {
  reset();
  auth.user = null;
  const res = await POST(req(VALID, { authorization: `Bearer ${'x'.repeat(32)}` }));
  assert.equal(res.status, 401);
});

for (const bad of [{ order_number: 'AB' }, { decision: 'maybe' }, { payment_reference: 'x'.repeat(121) }, { operator_note: 'x'.repeat(501) }]) {
  test(`corps invalide ${JSON.stringify(bad).slice(0, 40)} : 400 sans écriture`, async () => {
    reset();
    const res = await POST(req({ ...VALID, ...bad }));
    assert.equal(res.status, 400);
    assert.equal(fake.state.fromCalls.length + fake.state.rpcCalls.length, 0);
  });
}

test('corps qui n’est pas du JSON : 400', async () => {
  reset();
  const res = await POST(
    new Request('https://qatlia.ma/api/admin/payments', { method: 'POST', headers: { host: 'qatlia.ma' }, body: 'not json' })
  );
  assert.equal(res.status, 400);
});

test("valider : crédite avec la clé manual:<id>, renseigne decided_by, le montant et l'audit", async () => {
  reset();
  const res = await POST(req({ ...VALID, payment_reference: 'CashPlus 4488' }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'granted');

  assert.deepEqual(rpc('add_credits').args, { p_user_id: CLIENT, p_credits: 80, p_stripe_payment_id: `manual:${PAY_ID}`, p_pack_id: 'standard' });

  const [claim] = fake.ops('manual_payments', 'update')[0];
  assert.equal(claim.status, 'paid');
  assert.equal(claim.decided_by, ADMIN);
  assert.equal(claim.payment_reference, 'CashPlus 4488');
  assert.ok(fake.ops('manual_payments', 'eq').some(([col, val]) => col === 'status' && val === 'pending'), 'the claim must only take a pending order');

  assert.deepEqual(fake.ops('credit_transactions', 'update')[0], [{ amount_paid: 100, currency: 'MAD' }]);
  assert.equal(audit().length, 1);
  assert.equal(audit()[0].action, 'payment_granted');
  assert.equal(audit()[0].admin_id, ADMIN);
  assert.equal(audit()[0].target_user_id, CLIENT);
  assert.equal(audit()[0].details.order_number, VALID.order_number);
});

test('commande déjà traitée : 409, aucun crédit', async () => {
  reset();
  fake.state.tables.manual_payments = null;
  const res = await POST(req(VALID));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, 'NOT_PENDING');
  assert.equal(rpc('add_credits'), undefined);
  assert.equal(audit().length, 0);
});

test('crédit refusé par la base : la commande revient à pending, réponse 500, pas d’audit', async () => {
  reset();
  fake.state.rpcResult = () => ({ data: null, error: { message: 'boom' } });
  const res = await POST(req(VALID));
  assert.equal(res.status, 500);
  const updates = fake.ops('manual_payments', 'update').map(([row]) => row);
  assert.deepEqual(updates[updates.length - 1], { status: 'pending', decided_at: null, decided_by: null });
  assert.equal(audit().length, 0);
});

test('crédit rejeté par add_credits (success false) : retour à pending, 500', async () => {
  reset();
  fake.state.rpcResult = () => ({ data: { success: false, error: 'PROFILE_NOT_FOUND' }, error: null });
  const res = await POST(req(VALID));
  assert.equal(res.status, 500);
  assert.equal((await res.json()).reason, 'PROFILE_NOT_FOUND');
});

test('refuser : aucun appel à add_credits, audit payment_refused', async () => {
  reset();
  fake.state.tables.manual_payments = { id: PAY_ID, user_id: CLIENT, pack_id: 'standard', credits: 80, amount_mad: 100, status: 'refused' };
  const res = await POST(req({ ...VALID, decision: 'refuse', operator_note: 'Virement jamais reçu' }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'refused');
  assert.equal(rpc('add_credits'), undefined);
  assert.equal(audit()[0].action, 'payment_refused');
  assert.equal(audit()[0].details.operator_note, 'Virement jamais reçu');
});

test("l'échec du journal d'audit ne fait pas échouer une validation déjà créditée", async () => {
  reset();
  fake.state.tableErrors = { admin_audit_log: { code: 'PGRST205', message: 'missing' } };
  const res = await POST(req(VALID));
  assert.equal(res.status, 200);
});
