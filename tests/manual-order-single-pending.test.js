const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');
const { stubModule } = require('./helpers/stub-module');
const { createFakeSupabase } = require('./helpers/fake-supabase');

// A customer ended up with three transfer orders pending at once. Rule: one
// order to pay at a time. Clicking any pack while one is pending gives that
// order back; switching packs means cancelling it first, which only the owner
// can do and only while it is still pending.

const CLIENT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PENDING = { order_number: 'QIA-20261115-JNVS', amount_mad: 100, credits: 80, pack_id: 'standard', method: 'manual', status: 'pending' };

let fake;
const auth = { user: null };

stubModule('@/lib/supabase/server', {
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: auth.user } }) } }),
});
stubModule('@supabase/supabase-js', { createClient: () => fake.client });
stubModule('@/lib/billing/config', { getSupabaseAdminConfig: () => ({ url: 'https://db.example', serviceRoleKey: 'service' }) });

const { POST, DELETE } = loadTsModule('src/app/api/credits/manual/route.ts');

const hasOp = (call, name) => call.ops.some(([op]) => op === name);
const filters = (call) => call.ops.filter(([op]) => op === 'eq').map(([, args]) => args);

function reset() {
  fake = createFakeSupabase();
  auth.user = { id: CLIENT, email: 'client@example.com' };
}

const post = (body) =>
  new Request('https://qatlia.ma/api/credits/manual', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const del = (body) =>
  new Request('https://qatlia.ma/api/credits/manual', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

test('a pending order is given back instead of creating a second one, whatever pack is clicked', async () => {
  reset();
  fake.state.tables.manual_payments = (call) => (hasOp(call, 'insert') ? null : PENDING);

  const res = await POST(post({ packId: 'starter', method: 'manual' }));
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.existing, true);
  assert.equal(body.order.order_number, PENDING.order_number);
  assert.equal(fake.ops('manual_payments', 'insert').length, 0, 'no new order is created');
  // The lookup is scoped to this customer's pending orders.
  const lookup = fake.state.fromCalls.find((c) => c.table === 'manual_payments');
  assert.deepEqual(filters(lookup), [['user_id', CLIENT], ['status', 'pending']]);
});

test('without a pending order, a new one is created', async () => {
  reset();
  const created = { ...PENDING, order_number: 'QIA-20261115-ABCD', pack_id: 'starter', amount_mad: 50, credits: 30 };
  fake.state.tables.manual_payments = (call) => (hasOp(call, 'insert') ? created : null);

  const res = await POST(post({ packId: 'starter', method: 'manual' }));
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.existing, undefined);
  assert.equal(body.order.order_number, 'QIA-20261115-ABCD');
  const [[row]] = fake.ops('manual_payments', 'insert');
  assert.equal(row.user_id, CLIENT);
  assert.equal(row.status, 'pending');
  assert.equal(row.pack_id, 'starter');
});

test('a failing pending lookup creates nothing', async () => {
  reset();
  fake.state.tableErrors.manual_payments = { message: 'boom' };
  const original = console.error;
  console.error = () => {};
  try {
    const res = await POST(post({ packId: 'starter', method: 'manual' }));
    assert.equal(res.status, 500);
  } finally {
    console.error = original;
  }
  assert.equal(fake.ops('manual_payments', 'insert').length, 0);
});

test('cancel: an anonymous caller is refused without touching the database', async () => {
  reset();
  auth.user = null;
  const res = await DELETE(del({ orderNumber: PENDING.order_number }));
  assert.equal(res.status, 401);
  assert.equal(fake.state.fromCalls.length, 0);
});

for (const bad of [{}, { orderNumber: 'QIA-2026-1' }, { orderNumber: "QIA-20261115-JNVS' or 1=1" }, { orderNumber: 'QIA-20261115-OIL0' }]) {
  test(`cancel: malformed order number ${JSON.stringify(bad)} is refused`, async () => {
    reset();
    const res = await DELETE(del(bad));
    assert.equal(res.status, 400);
    assert.equal(fake.state.fromCalls.length, 0);
  });
}

test('cancel: only the owner’s still-pending order moves to expired', async () => {
  reset();
  fake.state.tables.manual_payments = { order_number: PENDING.order_number, status: 'expired' };

  const res = await DELETE(del({ orderNumber: PENDING.order_number }));
  assert.equal(res.status, 200);

  const [[update]] = fake.ops('manual_payments', 'update');
  assert.equal(update.status, 'expired');
  const call = fake.state.fromCalls.find((c) => c.table === 'manual_payments');
  assert.deepEqual(filters(call), [
    ['order_number', PENDING.order_number],
    ['user_id', CLIENT],
    ['status', 'pending'],
  ]);
});

test('cancel: an order already validated, refused or someone else’s answers 409', async () => {
  reset();
  fake.state.tables.manual_payments = null; // the conditional update matched no row
  const res = await DELETE(del({ orderNumber: PENDING.order_number }));
  assert.equal(res.status, 409);
});

test('every locale names the cancelled status and the cancel actions', () => {
  const { translate } = loadTsModule('src/i18n/index.ts');
  for (const locale of ['fr', 'en', 'ar']) {
    for (const key of ['status.expired', 'existingTitle', 'existingNotice', 'cancel', 'cancelShort', 'cancelConfirm', 'cancelYes', 'cancelKeep', 'cancelFailed']) {
      const value = translate(locale, `creditsPage.manual.${key}`);
      assert.notEqual(value, `creditsPage.manual.${key}`, `${locale}: ${key}`);
    }
  }
});
