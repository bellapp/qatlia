const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');
const { stubModule } = require('./helpers/stub-module');
const { createFakeSupabase } = require('./helpers/fake-supabase');

// Deleting a client's account from the back office (test accounts, accounts
// created by mistake). Nothing anyone paid for may disappear, an admin account
// is never deletable, and the admin confirms by typing the client's email.

const ADMIN = '11111111-2222-4333-8444-555555555555';
const OTHER_ADMIN = '22222222-2222-4333-8444-555555555555';
const CLIENT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

let fake;
const auth = { isAdmin: true };

stubModule('@/lib/admin/auth', {
  authorizeAdminRequest: async () => {
    if (!auth.isAdmin) {
      const { NextResponse } = require('next/server');
      return { ok: false, response: NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }) };
    }
    return { ok: true, admin: { userId: ADMIN, email: 'owner@qatlia.ma' } };
  },
  isAdminUserId: (id) => [ADMIN, OTHER_ADMIN].includes(String(id).toLowerCase()),
});
stubModule('@/lib/admin/db', {
  getAdminDb: () => fake.client,
  isMissingMigration: () => false,
});

const { DELETE } = loadTsModule('src/app/api/admin/clients/[id]/route.ts');

function reset() {
  fake = createFakeSupabase();
  auth.isAdmin = true;
  fake.state.authUser = { id: CLIENT, email: 'Test@Example.ma' };
  fake.state.tables.manual_payments = [];
  fake.state.tables.credit_transactions = [];
  fake.state.storage = { scans: ['a.jpg', 'b.webp'] };
}

const req = (body) =>
  new Request(`https://qatlia.ma/api/admin/clients/${CLIENT}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', host: 'qatlia.ma' },
    body: JSON.stringify(body),
  });
const ctx = (id) => ({ params: { id } });
const calls = (name) => fake.state.rpcCalls.filter((c) => c.name === name);
const deleted = () => calls('auth.deleteUser').length > 0;
const audit = () => fake.ops('admin_audit_log', 'insert').map(([row]) => row);
const CONFIRM = { confirm: 'test@example.ma' };

test('non admin : 401, rien supprimé', async () => {
  reset();
  auth.isAdmin = false;
  assert.equal((await DELETE(req(CONFIRM), ctx(CLIENT))).status, 401);
  assert.equal(deleted(), false);
});

test('identifiant invalide ou compte inexistant : 404', async () => {
  reset();
  assert.equal((await DELETE(req(CONFIRM), ctx('nope'))).status, 404);
  fake.state.authUser = null;
  assert.equal((await DELETE(req(CONFIRM), ctx(CLIENT))).status, 404);
  assert.equal(deleted(), false);
});

test('corps absent ou confirmation vide : 400', async () => {
  reset();
  assert.equal((await DELETE(req({}), ctx(CLIENT))).status, 400);
  assert.equal((await DELETE(req({ confirm: '  ' }), ctx(CLIENT))).status, 400);
  assert.equal(deleted(), false);
});

test('confirmation qui ne correspond pas à l’email : 400 CONFIRMATION_MISMATCH', async () => {
  reset();
  const res = await DELETE(req({ confirm: 'autre@example.ma' }), ctx(CLIENT));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'CONFIRMATION_MISMATCH');
  assert.equal(deleted(), false);
});

test('compte sans email : la confirmation est son identifiant', async () => {
  reset();
  fake.state.authUser = { id: CLIENT, email: null };
  assert.equal((await DELETE(req({ confirm: 'x' }), ctx(CLIENT))).status, 400);
  assert.equal((await DELETE(req({ confirm: CLIENT.toUpperCase() }), ctx(CLIENT))).status, 200);
});

test('compte admin, le sien compris : 403, rien supprimé', async () => {
  for (const id of [ADMIN, OTHER_ADMIN]) {
    reset();
    fake.state.authUser = { id, email: 'test@example.ma' };
    const res = await DELETE(req(CONFIRM), ctx(id));
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, 'ADMIN_ACCOUNT');
    assert.equal(deleted(), false);
  }
});

for (const [label, key] of [
  ['paiement manuel', 'manual:QAT-1234'],
  ['carte Creem', 'creem:ch_1'],
  ['carte Stripe', 'cs:test_1'],
]) {
  test(`client qui a payé (${label}) : 409 HAS_PAYMENTS`, async () => {
    reset();
    fake.state.tables.credit_transactions = [
      { id: '1', type: 'purchase', amount: 50, reason: 'pack', stripe_payment_id: key, created_at: '2026-11-18' },
    ];
    const res = await DELETE(req(CONFIRM), ctx(CLIENT));
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error, 'HAS_PAYMENTS');
    assert.equal(deleted(), false);
  });
}

for (const [label, row] of [
  ['achat sans clé', { id: '1', type: 'purchase', amount: 50, reason: 'pack', stripe_payment_id: null }],
  ['achat à clé inconnue', { id: '1', type: 'purchase', amount: 50, reason: 'pack', stripe_payment_id: 'old_ch_1' }],
  ['montant payé hors achat', { id: '1', type: 'bonus', amount: 50, reason: null, stripe_payment_id: null, amount_paid: 99 }],
]) {
  test(`doute sur un paiement (${label}) : 409, rien supprimé`, async () => {
    reset();
    fake.state.tables.credit_transactions = [{ created_at: '2026-11-18', ...row }];
    assert.equal((await DELETE(req(CONFIRM), ctx(CLIENT))).status, 409);
    assert.equal(deleted(), false);
  });
}

test('grand livre trop long pour être vérifié en entier : 409', async () => {
  reset();
  fake.state.tables.credit_transactions = Array.from({ length: 1000 }, (_, i) => ({
    id: String(i),
    type: 'bonus',
    amount: 1,
    reason: null,
    stripe_payment_id: null,
    created_at: '2026-11-18',
  }));
  assert.equal((await DELETE(req(CONFIRM), ctx(CLIENT))).status, 409);
  assert.equal(deleted(), false);
});

test('commande manuelle en cours : 409, et seuls les statuts ouverts ou payés sont cherchés', async () => {
  reset();
  fake.state.tables.manual_payments = [{ status: 'pending' }];
  assert.equal((await DELETE(req(CONFIRM), ctx(CLIENT))).status, 409);
  assert.equal(deleted(), false);
  const filter = fake.state.fromCalls.find((c) => c.table === 'manual_payments').ops.find(([op]) => op === 'in');
  assert.deepEqual(filter[1], ['status', ['pending', 'paid', 'granted']]);
});

test('remboursement ou ajustement admin seuls : supprimable', async () => {
  reset();
  fake.state.tables.credit_transactions = [
    { id: '1', type: 'purchase', amount: 5, reason: 'refund', stripe_payment_id: 'optimize_refund_x', created_at: '2026-11-18' },
    { id: '2', type: 'adjustment', amount: 10, reason: null, stripe_payment_id: 'admin:y', created_at: '2026-11-18' },
  ];
  assert.equal((await DELETE(req(CONFIRM), ctx(CLIENT))).status, 200);
  assert.equal(deleted(), true);
});

test('vérification des paiements en échec : 500, rien supprimé', async () => {
  reset();
  fake.state.tableErrors = { credit_transactions: { code: 'XX000', message: 'down' } };
  assert.equal((await DELETE(req(CONFIRM), ctx(CLIENT))).status, 500);
  assert.equal(deleted(), false);
});

test('supprime le compte, ses photos, et l’écrit au journal', async () => {
  reset();
  const res = await DELETE(req(CONFIRM), ctx(CLIENT));
  assert.equal(res.status, 200);
  assert.deepEqual(calls('auth.deleteUser')[0].args, { id: CLIENT });
  assert.equal(calls('storage.list')[0].args.folder, CLIENT);
  assert.deepEqual(calls('storage.remove')[0].args, { bucket: 'scans', paths: [`${CLIENT}/a.jpg`, `${CLIENT}/b.webp`] });
  const [entry] = audit();
  assert.deepEqual(
    [entry.admin_id, entry.action, entry.target_user_id, entry.details],
    [ADMIN, 'account_deleted', CLIENT, { email: 'Test@Example.ma', scans_removed: 2 }]
  );
});

test('suppression refusée par Supabase : 500, ni photos ni journal touchés', async () => {
  reset();
  fake.state.deleteError = { message: 'Database error deleting user' };
  assert.equal((await DELETE(req(CONFIRM), ctx(CLIENT))).status, 500);
  assert.equal(calls('storage.remove').length, 0);
  assert.equal(audit().length, 0);
});

test('photos non supprimées : le compte reste supprimé, le journal le note', async () => {
  reset();
  fake.state.storageError = { message: 'storage down' };
  assert.equal((await DELETE(req(CONFIRM), ctx(CLIENT))).status, 200);
  assert.equal(audit()[0].details.scans_removed, null);
});
