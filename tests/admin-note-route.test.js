const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');
const { stubModule } = require('./helpers/stub-module');
const { createFakeSupabase } = require('./helpers/fake-supabase');

// The admin's private note, phone and tags per client (plan 2026-11-12,
// Task 11). The audit log names which fields changed, never their content.

const ADMIN = '11111111-2222-4333-8444-555555555555';
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
});
stubModule('@/lib/admin/db', {
  getAdminDb: () => fake.client,
  isMissingMigration: (e) => !!e && ['PGRST202', 'PGRST205'].includes(e.code),
});

const { PUT } = loadTsModule('src/app/api/admin/clients/[id]/note/route.ts');

function reset() {
  fake = createFakeSupabase();
  auth.isAdmin = true;
  fake.state.authUser = { id: CLIENT, email: 'c@b.ma' };
  fake.state.tables.admin_client_notes = null;
}

const VALID = { phone: '+212 6 12 34 56 78', tags: [' Atelier ', 'atelier', 'VIP', ''], note: 'Rappeler lundi' };
const req = (body) =>
  new Request(`https://qatlia.ma/api/admin/clients/${CLIENT}/note`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', host: 'qatlia.ma' },
    body: JSON.stringify(body),
  });
const ctx = (id) => ({ params: { id } });
const upserts = () => fake.ops('admin_client_notes', 'upsert').map(([row]) => row);
const audit = () => fake.ops('admin_audit_log', 'insert').map(([row]) => row);

test('non admin : 401', async () => {
  reset();
  auth.isAdmin = false;
  assert.equal((await PUT(req(VALID), ctx(CLIENT))).status, 401);
  assert.equal(upserts().length, 0);
});

test('identifiant invalide ou utilisateur inexistant : 404, aucune écriture', async () => {
  reset();
  assert.equal((await PUT(req(VALID), ctx('nope'))).status, 404);
  fake.state.authUser = null;
  assert.equal((await PUT(req(VALID), ctx(CLIENT))).status, 404);
  assert.equal(upserts().length, 0);
});

for (const bad of [
  { phone: '06 12 AB' },
  { phone: '1'.repeat(31) },
  { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) },
  { tags: ['x'.repeat(31)] },
  { note: 'x'.repeat(2001) },
  { tags: 'VIP' },
]) {
  test(`corps invalide ${JSON.stringify(bad).slice(0, 40)} : 400`, async () => {
    reset();
    assert.equal((await PUT(req({ ...VALID, ...bad }), ctx(CLIENT))).status, 400);
    assert.equal(upserts().length, 0);
  });
}

test('enregistre en normalisant les étiquettes', async () => {
  reset();
  const res = await PUT(req(VALID), ctx(CLIENT));
  assert.equal(res.status, 200);
  const row = upserts()[0];
  assert.deepEqual(
    [row.user_id, row.phone, row.tags, row.note, row.updated_by],
    [CLIENT, '+212 6 12 34 56 78', ['Atelier', 'atelier', 'VIP'], 'Rappeler lundi', ADMIN]
  );
  assert.ok(typeof row.updated_at === 'string');
});

test('champs vides enregistrés comme null', async () => {
  reset();
  await PUT(req({ phone: '  ', tags: [], note: '' }), ctx(CLIENT));
  const row = upserts()[0];
  assert.deepEqual([row.phone, row.tags, row.note], [null, [], null]);
});

test("l'audit nomme les champs modifiés sans recopier la note", async () => {
  reset();
  fake.state.tables.admin_client_notes = { phone: null, tags: ['VIP'], note: null };
  await PUT(req({ phone: '+212 600', tags: ['VIP'], note: 'secret' }), ctx(CLIENT));
  assert.equal(audit()[0].action, 'note_updated');
  assert.deepEqual(audit()[0].details, { fields: ['phone', 'note'] });
  assert.ok(!JSON.stringify(audit()[0]).includes('secret'));
});

test('rien de changé : enregistré, pas d’audit', async () => {
  reset();
  fake.state.tables.admin_client_notes = { phone: '+212 600', tags: ['VIP'], note: 'x' };
  const res = await PUT(req({ phone: '+212 600', tags: ['VIP'], note: 'x' }), ctx(CLIENT));
  assert.equal(res.status, 200);
  assert.equal(audit().length, 0);
});

test('table absente : 503 MIGRATION_MISSING', async () => {
  reset();
  fake.state.tableErrors = { admin_client_notes: { code: 'PGRST205', message: 'missing' } };
  const res = await PUT(req(VALID), ctx(CLIENT));
  assert.equal(res.status, 503);
});
