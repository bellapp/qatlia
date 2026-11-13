const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');
const { stubModule } = require('./helpers/stub-module');
const { createFakeSupabase } = require('./helpers/fake-supabase');

// Adjusting a client's credits by hand (plan 2026-11-12, Task 10). The reason
// the admin types goes to the audit log only — the client can read the ledger.

const ADMIN = '11111111-2222-4333-8444-555555555555';
const CLIENT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const REQ = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

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
});
stubModule('@/lib/admin/db', {
  getAdminDb: () => fake.client,
  isMissingMigration: (e) => !!e && ['PGRST202', 'PGRST205'].includes(e.code),
});

const { POST } = loadTsModule('src/app/api/admin/clients/[id]/credits/route.ts');

function reset() {
  fake = createFakeSupabase();
  auth.isAdmin = true;
  fake.state.rpcResult = () => ({ data: { success: true, duplicate: false, balance: 45 }, error: null });
}

const VALID = { delta: 20, reason: 'Geste commercial', requestId: REQ };
const req = (body) =>
  new Request(`https://qatlia.ma/api/admin/clients/${CLIENT}/credits`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: 'qatlia.ma' },
    body: JSON.stringify(body),
  });
const ctx = (id) => ({ params: { id } });
const audit = () => fake.ops('admin_audit_log', 'insert').map(([row]) => row);

test('non admin : 401 et aucun appel à la base', async () => {
  reset();
  auth.isAdmin = false;
  const res = await POST(req(VALID), ctx(CLIENT));
  assert.equal(res.status, 401);
  assert.equal(fake.state.rpcCalls.length + fake.state.fromCalls.length, 0);
});

test('identifiant client invalide : 404', async () => {
  reset();
  const res = await POST(req(VALID), ctx('pas-un-uuid'));
  assert.equal(res.status, 404);
  assert.equal(fake.state.rpcCalls.length, 0);
});

for (const bad of [{ delta: 0 }, { delta: 1001 }, { delta: -1001 }, { delta: 1.5 }, { delta: '5' }, { reason: 'ab' }, { reason: 'x'.repeat(501) }, { requestId: 'x' }]) {
  test(`corps invalide ${JSON.stringify(bad).slice(0, 40)} : 400 sans appel à la base`, async () => {
    reset();
    const res = await POST(req({ ...VALID, ...bad }), ctx(CLIENT));
    assert.equal(res.status, 400);
    assert.equal(fake.state.rpcCalls.length, 0);
  });
}

test("ajout : appelle admin_adjust_credits avec le requestId et écrit l'audit avec le motif", async () => {
  reset();
  const res = await POST(req(VALID), ctx(CLIENT));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { success: true, balance: 45, duplicate: false });
  assert.deepEqual(fake.state.rpcCalls[0], { name: 'admin_adjust_credits', args: { p_user_id: CLIENT, p_delta: 20, p_request_id: REQ } });
  assert.equal(audit().length, 1);
  assert.equal(audit()[0].action, 'credits_adjusted');
  assert.equal(audit()[0].target_user_id, CLIENT);
  assert.deepEqual(audit()[0].details, { delta: 20, reason: 'Geste commercial', balance: 45 });
});

test('même requestId rejoué : succès, duplicate, aucun second audit', async () => {
  reset();
  fake.state.rpcResult = () => ({ data: { success: true, duplicate: true, balance: 45 }, error: null });
  const res = await POST(req(VALID), ctx(CLIENT));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).duplicate, true);
  assert.equal(audit().length, 0);
});

test('retrait supérieur au solde : 409 avec le solde, aucun audit', async () => {
  reset();
  fake.state.rpcResult = () => ({ data: { success: false, error: 'INSUFFICIENT_CREDITS', balance: 3 }, error: null });
  const res = await POST(req({ ...VALID, delta: -10 }), ctx(CLIENT));
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: 'INSUFFICIENT_CREDITS', balance: 3 });
  assert.equal(audit().length, 0);
});

test('client sans profil : 409 PROFILE_NOT_FOUND', async () => {
  reset();
  fake.state.rpcResult = () => ({ data: { success: false, error: 'PROFILE_NOT_FOUND' }, error: null });
  const res = await POST(req(VALID), ctx(CLIENT));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, 'PROFILE_NOT_FOUND');
});

test('fonction absente : 503 MIGRATION_MISSING', async () => {
  reset();
  fake.state.rpcResult = () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
  const res = await POST(req(VALID), ctx(CLIENT));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'MIGRATION_MISSING');
});
