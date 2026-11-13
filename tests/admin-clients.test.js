const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');
const { createFakeSupabase } = require('./helpers/fake-supabase');

// Client list and client page data (plan 2026-11-12, Task 4).

const { parseClientListParams, listClients, getClientDetail } = loadTsModule('src/lib/admin/clients.ts');

const UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const defaults = { search: '', segment: 'all', sort: 'created_desc', page: 1 };

function freshDb() {
  const fake = createFakeSupabase();
  fake.state.authUser = {
    id: UUID,
    email: 'a@b.ma',
    created_at: '2026-11-01T00:00:00Z',
    last_sign_in_at: null,
    email_confirmed_at: null,
    phone: '',
    app_metadata: { provider: 'google' },
    user_metadata: {},
  };
  fake.state.tables = {
    profiles: null,
    credit_transactions: [],
    manual_payments: [],
    projects: [],
    panel_presets: [],
    admin_client_notes: null,
  };
  return fake;
}

test('parseClientListParams ramène les valeurs inconnues aux défauts', () => {
  assert.deepEqual(parseClientListParams({ segment: 'x', sort: 'DROP', page: '-3', q: ['a', 'b'] }), defaults);
  assert.equal(parseClientListParams({ q: 'a'.repeat(200) }).search.length, 80);
  assert.deepEqual(parseClientListParams({ q: '  ali ', segment: 'paying', sort: 'paid_desc', page: '3' }), {
    search: 'ali',
    segment: 'paying',
    sort: 'paid_desc',
    page: 3,
  });
  assert.equal(parseClientListParams({ page: '2.7' }).page, 2);
  assert.equal(parseClientListParams({ page: 'abc' }).page, 1);
});

test('listClients transmet recherche, segment, tri et décalage à la fonction SQL', async () => {
  const { client, state } = freshDb();
  state.rpcResult = () => ({ data: [], error: null });
  await listClients(client, { search: 'ali', segment: 'paying', sort: 'paid_desc', page: 3 });
  assert.deepEqual(state.rpcCalls[0], {
    name: 'admin_client_list',
    args: { p_search: 'ali', p_segment: 'paying', p_sort: 'paid_desc', p_limit: 50, p_offset: 100 },
  });
});

test('listClients : recherche vide envoyée comme null', async () => {
  const { client, state } = freshDb();
  state.rpcResult = () => ({ data: [], error: null });
  await listClients(client, defaults);
  assert.equal(state.rpcCalls[0].args.p_search, null);
});

test('listClients convertit les lignes et lit le total', async () => {
  const { client, state } = freshDb();
  state.rpcResult = () => ({
    data: [
      {
        user_id: UUID,
        email: 'a@b.ma',
        full_name: 'Ali',
        locale: 'fr',
        provider: 'google',
        credits: 98,
        signed_up_at: '2026-10-01T00:00:00Z',
        last_sign_in_at: null,
        scans: 2,
        optimizations: 1,
        purchases: 1,
        credits_purchased: 80,
        paid_mad: '100.00',
        pending_orders: 0,
        projects: 1,
        last_activity_at: '2026-11-10T00:00:00Z',
        phone: null,
        tags: null,
        total_count: 7,
      },
    ],
    error: null,
  });
  const r = await listClients(client, defaults);
  assert.equal(r.status, 'ok');
  assert.equal(r.total, 7);
  assert.equal(r.pageSize, 50);
  assert.deepEqual(
    [r.rows[0].userId, r.rows[0].paidMad, r.rows[0].creditsPurchased, r.rows[0].tags, r.rows[0].lastActivityAt],
    [UUID, 100, 80, [], '2026-11-10T00:00:00Z']
  );
});

test('listClients : aucune ligne donne un total de 0', async () => {
  const { client, state } = freshDb();
  state.rpcResult = () => ({ data: [], error: null });
  assert.deepEqual(await listClients(client, defaults), { status: 'ok', rows: [], total: 0, pageSize: 50 });
});

test('listClients : fonction absente donne migration_missing, pas une exception', async () => {
  const { client, state } = freshDb();
  state.rpcResult = () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
  assert.deepEqual(await listClients(client, defaults), { status: 'migration_missing' });
});

test('listClients : autre erreur donne error', async () => {
  const { client, state } = freshDb();
  state.rpcResult = () => ({ data: null, error: { code: '57014', message: 'timeout' } });
  assert.deepEqual(await listClients(client, defaults), { status: 'error' });
});

test('getClientDetail : identifiant invalide ou utilisateur absent donne not_found sans lire les tables', async () => {
  const { client, state } = freshDb();
  assert.deepEqual(await getClientDetail(client, 'pas-un-uuid'), { status: 'not_found' });
  assert.equal(state.fromCalls.length, 0);
  state.authUser = null;
  assert.deepEqual(await getClientDetail(client, UUID), { status: 'not_found' });
  assert.equal(state.fromCalls.length, 0);
});

test("getClientDetail : utilisateur sans profil ni mouvement s'affiche avec des zéros", async () => {
  const { client } = freshDb();
  const r = await getClientDetail(client, UUID);
  assert.equal(r.status, 'ok');
  assert.deepEqual(
    [r.client.balance, r.client.summary.scans, r.client.paidMad, r.client.projects.length, r.client.note, r.client.panelPresetCount],
    [null, 0, 0, 0, null, 0]
  );
  assert.equal(r.client.identity.provider, 'google');
  assert.equal(r.client.identity.email, 'a@b.ma');
  assert.equal(r.client.identity.phone, null);
  assert.equal(r.client.ledgerTruncated, false);
});

test('getClientDetail : paidMad ne compte que les commandes validées', async () => {
  const { client, state } = freshDb();
  state.tables.manual_payments = [
    { order_number: 'A', amount_mad: 100, status: 'granted', credits: 80, created_at: '2026-11-01T00:00:00Z' },
    { order_number: 'B', amount_mad: '50.00', status: 'pending', credits: 30, created_at: '2026-11-02T00:00:00Z' },
    { order_number: 'C', amount_mad: 200, status: 'refused', credits: 200, created_at: '2026-11-03T00:00:00Z' },
  ];
  const r = await getClientDetail(client, UUID);
  assert.equal(r.client.paidMad, 100);
  assert.equal(r.client.orders.length, 3);
  assert.equal(r.client.orders[1].amount_mad, 50);
});

test('getClientDetail : profil, grand livre et projets sont lus et résumés', async () => {
  const { client, state } = freshDb();
  state.tables.profiles = { full_name: 'Ali Menuisier', locale: 'ar', credits: 98, updated_at: '2026-11-02T00:00:00Z' };
  state.tables.credit_transactions = [
    { id: '1', type: 'usage', amount: -1, balance_after: 98, description: null, reason: 'vision', stripe_payment_id: null, created_at: '2026-11-03T00:00:00Z' },
    { id: '2', type: 'purchase', amount: 80, balance_after: 99, description: null, reason: 'standard', stripe_payment_id: 'manual:x', created_at: '2026-11-02T00:00:00Z' },
  ];
  state.tables.projects = [{ id: 'p', name: 'Cuisine', material: 'mdf', sheet_width: 208, sheet_height: 278, created_at: '2026-11-03T00:00:00Z', options_json: { pieces: [{ quantity: 4 }] } }];
  state.tables.panel_presets = [{ id: 'a' }, { id: 'b' }];
  state.tables.admin_client_notes = { phone: '+212 600', tags: ['VIP'], note: 'Rappeler', updated_at: '2026-11-04T00:00:00Z' };
  const r = await getClientDetail(client, UUID);
  assert.deepEqual(
    [r.client.balance, r.client.identity.fullName, r.client.identity.locale, r.client.summary.scans, r.client.summary.purchaseCount, r.client.summary.freeCredits],
    [98, 'Ali Menuisier', 'ar', 1, 1, 19]
  );
  assert.equal(r.client.projects[0].pieceCount, 4);
  assert.equal(r.client.panelPresetCount, 2);
  assert.deepEqual(r.client.note, { phone: '+212 600', tags: ['VIP'], note: 'Rappeler', updatedAt: '2026-11-04T00:00:00Z' });
  assert.equal(r.client.identity.phone, '+212 600');
});

test('getClientDetail : table des notes ou des panneaux absente ne casse pas la fiche', async () => {
  const { client, state } = freshDb();
  state.tableErrors = {
    admin_client_notes: { code: 'PGRST205', message: 'not found' },
    panel_presets: { code: 'PGRST205', message: 'not found' },
    manual_payments: { code: '57014', message: 'timeout' },
  };
  const r = await getClientDetail(client, UUID);
  assert.equal(r.status, 'ok');
  assert.deepEqual([r.client.note, r.client.panelPresetCount, r.client.orders], [null, 0, []]);
});

test('getClientDetail renvoie les dernières actions admin, [] si la table manque', async () => {
  const { client, state, ops } = freshDb();
  state.tables.admin_audit_log = [
    { action: 'credits_adjusted', details: { delta: 5, reason: 'Geste', balance: 25 }, created_at: '2026-11-12T10:00:00Z', admin_id: 'a' },
    { action: 'note_updated', details: null, created_at: '2026-11-11T10:00:00Z', admin_id: 'a' },
  ];
  const r = await getClientDetail(client, UUID);
  assert.deepEqual(r.client.audit[0], { action: 'credits_adjusted', details: { delta: 5, reason: 'Geste', balance: 25 }, createdAt: '2026-11-12T10:00:00Z', adminId: 'a' });
  assert.deepEqual(r.client.audit[1].details, {});
  assert.deepEqual(ops('admin_audit_log', 'limit'), [[50]]);

  state.tableErrors = { admin_audit_log: { code: 'PGRST205', message: 'missing' } };
  assert.deepEqual((await getClientDetail(client, UUID)).client.audit, []);
});

test('getClientDetail : échec du grand livre donne error (les chiffres seraient faux)', async () => {
  const { client, state } = freshDb();
  state.tableErrors = { credit_transactions: { code: '57014', message: 'timeout' } };
  assert.deepEqual(await getClientDetail(client, UUID), { status: 'error' });
});

test('getClientDetail : échec de la lecture du compte donne error', async () => {
  const { client, state } = freshDb();
  state.authError = { message: 'network' };
  assert.deepEqual(await getClientDetail(client, UUID), { status: 'error' });
});
