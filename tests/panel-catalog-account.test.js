const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');
const { stubModule } = require('./helpers/stub-module');

// The catalogue reaches a signed-in artisan's account the first time their
// list is read: once, without duplicates, within the account's limit, and
// never again once copied, even after they removed every panel.

const UUID = '11111111-2222-4333-8444-555555555555';

const state = {};
function resetState() {
  state.user = { id: UUID, app_metadata: { provider: 'google', providers: ['google'] } };
  state.rows = [];
  state.currency = 'MAD';
  state.priceColumnMissing = false;
  state.insertFails = false;
  state.flagFails = false;
  state.flagThrows = false;
  state.flagCalls = [];
  state.nextId = 1;
  state.deleted = [];
  state.meanwhile = null;
}

const MISSING_COLUMN = { code: '42703', message: 'column panel_presets.price_per_sheet does not exist' };

function table() {
  const filters = [];
  let action = { kind: 'select' };
  let columns = '';
  const run = () => {
    const touchesPrice = columns.includes('price_per_sheet') || (action.rows || []).some((r) => 'price_per_sheet' in r);
    if (state.priceColumnMissing && touchesPrice) return { data: null, error: MISSING_COLUMN };
    if (action.kind === 'delete') {
      const gone = state.rows.filter(matches);
      state.rows = state.rows.filter((r) => !matches(r));
      state.deleted.push(...gone.map((r) => r.id));
      return { data: gone, error: null };
    }
    if (action.kind === 'insert') {
      if (state.insertFails) return { data: null, error: { code: '500', message: 'insert failed' } };
      const created = action.rows.map((r) => ({ id: `00000000-0000-4000-8000-${String(state.nextId++).padStart(12, '0')}`, created_at: '2026-11-18T10:00:00Z', ...r }));
      state.rows.push(...created);
      return { data: created, error: null };
    }
    return { data: state.rows.filter(matches), error: null };
  };
  const matches = (r) => filters.every(([c, v, op]) => (op === 'in' ? v.includes(r[c]) : r[c] === v));
  const query = {
    select: (cols = '') => ((columns = cols), query),
    eq: (c, v) => (filters.push([c, v]), query),
    in: (c, v) => (filters.push([c, v, 'in']), query),
    delete: () => ((action = { kind: 'delete' }), query),
    order: () => query,
    insert: (rows) => ((action = { kind: 'insert', rows }), query),
    then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
  };
  return query;
}

stubModule('@/lib/supabase/server', {
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: state.user }, error: null }) } }),
});
stubModule('@supabase/supabase-js', {
  createClient: () => ({
    from: () => table(),
    auth: {
      admin: {
        updateUserById: async (id, attributes) => {
          state.flagCalls.push([id, attributes]);
          if (state.flagThrows) throw new Error("auth down");
          return state.flagFails ? { data: null, error: { message: 'down' } } : { data: { user: {} }, error: null };
        },
      },
    },
  }),
});
// Runs between the read of the list and the copy: another read copying meanwhile.
stubModule('@/lib/currency-server', { resolveRequestCurrency: async () => (state.meanwhile?.(), state.currency) });
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://real.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sbsvc_real';

const listRoute = () => loadTsModule('src/app/api/panel-presets/route.ts');
const { PANEL_CATALOG } = loadTsModule('src/lib/panel-catalog.ts');
const { MAX_PRESETS_PER_USER } = loadTsModule('src/lib/panel-presets-store.ts');
const get = async () => (await listRoute().GET(new Request('https://qatlia.example/api/panel-presets'))).json();

const own = (extra = {}) => ({
  id: `own-${state.nextId++}`, user_id: UUID, name: 'Mon MDF', height: 244, width: 122, material: 'mdf', color: null, has_grain: false, grain_orientation: null, price_per_sheet: null, created_at: '2026-11-01T10:00:00Z', ...extra,
});

test('the first read of a list copies the catalogue into it, and says it is done', async () => {
  resetState();
  state.rows = [own()];

  const body = await get();

  assert.equal(body.presets.length, 1 + PANEL_CATALOG.length, 'the artisan’s panel, then the catalogue');
  assert.equal(body.presets[0].name, 'Mon MDF');
  assert.deepEqual(body.presets[1], {
    id: body.presets[1].id, name: '031 Blanc lisse 18 mm', height: 280, width: 207, material: 'melamine', color: 'Blanc lisse / Polaire', pricePerSheet: 530,
  });
  assert.ok(state.rows.every((r) => r.user_id === UUID));
  assert.deepEqual(state.flagCalls, [[UUID, { app_metadata: { panel_catalog: 1 } }]], 'only the flag: the auth server merges it into what the account holds');
});

test('a panel the artisan already has is not copied twice', async () => {
  resetState();
  state.rows = [own({ height: 280, width: 207, material: 'melamine', color: 'Blanc lisse / polaire' })];

  const body = await get();

  assert.equal(body.presets.length, PANEL_CATALOG.length);
});

test('once copied, the catalogue never comes back, even to an emptied list', async () => {
  resetState();
  state.user.app_metadata.panel_catalog = 1;

  const body = await get();

  assert.deepEqual(body.presets, []);
  assert.equal(state.rows.length, 0);
  assert.deepEqual(state.flagCalls, []);
});

test('the copy stays within the account’s limit', async () => {
  resetState();
  state.rows = Array.from({ length: MAX_PRESETS_PER_USER - 3 }, (_, i) => own({ height: 100 + i }));

  const body = await get();

  assert.equal(body.presets.length, MAX_PRESETS_PER_USER);
});

test('a euro account gets the catalogue prices in euros', async () => {
  resetState();
  state.currency = 'EUR';

  const body = await get();

  assert.equal(body.presets[0].pricePerSheet, 49.07);
});

test('a copy that fails leaves the list as it was, and is tried again next time', async () => {
  resetState();
  state.rows = [own()];
  state.insertFails = true;

  const body = await get();

  assert.equal(body.success, true);
  assert.deepEqual(body.presets.map((p) => p.name), ['Mon MDF']);
  assert.deepEqual(state.flagCalls, [], 'not marked as done');
});

test('an account that cannot be marked still shows its copied list', async () => {
  resetState();
  state.flagFails = true;

  const body = await get();

  assert.equal(body.success, true);
  assert.equal(body.presets.length, PANEL_CATALOG.length);
});

test('before the price column exists, the catalogue is copied without its prices', async () => {
  resetState();
  state.priceColumnMissing = true;

  const body = await get();

  assert.equal(body.presets.length, PANEL_CATALOG.length);
  assert.ok(body.presets.every((p) => !('pricePerSheet' in p)));
  assert.equal(state.flagCalls.length, 1);
});

test('signed out, nothing is read or copied', async () => {
  resetState();
  state.user = null;

  const res = await listRoute().GET(new Request('https://qatlia.example/api/panel-presets'));

  assert.equal(res.status, 401);
  assert.equal(state.rows.length, 0);
});

test('a copy whose marking throws still answers the copied panels', async () => {
  resetState();
  state.flagThrows = true;

  const body = await get();

  assert.equal(body.presets.length, PANEL_CATALOG.length);
});

// Review, 2026-11-18: two first reads at once (two tabs, or the panel page
// opened while the atelier still loads) both find the account unmarked and
// both copy the catalogue. Each then removes the copies it made that another
// read made first, and answers the list without the twins.

test('two first reads at once leave one copy of each catalogue panel', async () => {
  resetState();

  const [a, b] = await Promise.all([get(), get()]);

  const names = state.rows.map((r) => r.name);
  assert.equal(names.length, PANEL_CATALOG.length);
  assert.equal(new Set(names).size, PANEL_CATALOG.length);
  const kept = new Set(state.rows.map((r) => r.id));
  for (const body of [a, b]) {
    assert.equal(body.presets.length, PANEL_CATALOG.length);
    assert.ok(body.presets.every((p) => kept.has(p.id)), 'no removed twin answered');
  }
});

test('a read only ever removes the copies it made itself', async () => {
  resetState();
  const other = own({ name: '031 Blanc lisse 18 mm', height: 280, width: 207, material: 'melamine', color: 'Blanc lisse / Polaire', price_per_sheet: 530 });
  state.meanwhile = () => state.rows.push(other);

  const body = await get();

  assert.ok(state.rows.some((r) => r.id === other.id), 'the copy another read made first stays');
  assert.equal(state.rows.filter((r) => r.name === '031 Blanc lisse 18 mm').length, 1);
  assert.equal(state.rows.length, PANEL_CATALOG.length);
  assert.deepEqual(body.presets.map((p) => p.id).sort(), state.rows.map((r) => r.id).sort());
});
