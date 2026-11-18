const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');
const { stubModule } = require('./helpers/stub-module');

// Owner request, 2026-11-17: the artisan configures the list of panels they
// work with on a page of its own, where a panel is edited as a whole (name,
// size, material, colour, grain, price) instead of deleted and saved again.

const UUID = '11111111-2222-4333-8444-555555555555';
const OTHER_UUID = '99999999-8888-4777-8666-555555555555';
const PRESET_ID = '22222222-3333-4444-8888-555555555555';
const SECOND_ID = '33333333-3333-4444-8888-555555555555';
const FOREIGN_ID = '44444444-3333-4444-8888-555555555555';

const state = { user: null, rows: [], priceColumnMissing: false, tableMissing: false, writes: 0 };

function resetState() {
  state.user = { id: UUID };
  state.rows = [];
  state.priceColumnMissing = false;
  state.tableMissing = false;
  state.writes = 0;
}

const MISSING_COLUMN = { code: '42703', message: 'column panel_presets.price_per_sheet does not exist' };
const MISSING_TABLE = { code: 'PGRST205', message: "Could not find the table 'public.panel_presets' in the schema cache" };

/** A tiny PostgREST-like builder over `state.rows`. */
function table() {
  const filters = [];
  let action = { kind: 'select' };
  let columns = '';
  const match = (row) => filters.every(([col, value]) => row[col] === value);
  const run = () => {
    if (state.tableMissing) return { data: null, error: MISSING_TABLE };
    const touchesPrice = columns.includes('price_per_sheet') || (action.values && 'price_per_sheet' in action.values);
    if (state.priceColumnMissing && touchesPrice) return { data: null, error: MISSING_COLUMN };
    if (action.kind === 'update') {
      state.writes += 1;
      const updated = [];
      state.rows = state.rows.map((row) => {
        if (!match(row)) return row;
        const next = { ...row, ...action.values };
        updated.push(next);
        return next;
      });
      return { data: updated, error: null };
    }
    return { data: state.rows.filter(match), error: null };
  };
  const query = {
    select: (cols = '') => ((columns = cols), query),
    eq: (col, value) => (filters.push([col, value]), query),
    order: () => query,
    update: (values) => ((action = { kind: 'update', values }), query),
    then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
  };
  return query;
}

stubModule('@/lib/supabase/server', {
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: state.user }, error: null }) } }),
});
stubModule('@supabase/supabase-js', { createClient: () => ({ from: () => table() }) });
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://real.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sbsvc_real';

const itemRoute = () => loadTsModule('src/app/api/panel-presets/[id]/route.ts');

function row(extra = {}) {
  return {
    id: PRESET_ID,
    user_id: UUID,
    name: 'MDF blanc',
    height: 244,
    width: 122,
    material: 'mdf',
    color: 'Blanc',
    has_grain: false,
    grain_orientation: null,
    price_per_sheet: '320.00',
    created_at: '2026-11-13T08:00:00Z',
    ...extra,
  };
}

function patch(id, body) {
  return [
    new Request(`https://qatlia.example/api/panel-presets/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  ];
}

const OAK = { name: 'Chêne clair', height: 280, width: 207, material: 'melamine', color: 'Chêne', hasGrain: true, grainOrientation: 'horizontal', pricePerSheet: 540 };

test('a panel is edited as a whole, and stays the same panel of the same artisan', async () => {
  resetState();
  state.rows = [row()];

  const res = await itemRoute().PATCH(...patch(PRESET_ID, OAK));

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { success: true, preset: { id: PRESET_ID, ...OAK } });
  const [stored] = state.rows;
  assert.equal(stored.id, PRESET_ID);
  assert.equal(stored.user_id, UUID);
  assert.equal(stored.created_at, '2026-11-13T08:00:00Z');
  assert.deepEqual(
    [stored.name, stored.height, stored.width, stored.material, stored.color, stored.has_grain, stored.grain_orientation, stored.price_per_sheet],
    ['Chêne clair', 280, 207, 'melamine', 'Chêne', true, 'horizontal', 540]
  );
});

test('an edit without a price takes the price off, and an edit without grain takes the direction off', async () => {
  resetState();
  state.rows = [row({ has_grain: true, grain_orientation: 'vertical' })];

  const res = await itemRoute().PATCH(...patch(PRESET_ID, { name: 'MDF blanc', height: 244, width: 122, material: 'mdf', color: 'Blanc', hasGrain: false, grainOrientation: 'vertical' }));

  assert.equal(res.status, 200);
  const [stored] = state.rows;
  assert.equal(stored.price_per_sheet, null);
  assert.equal(stored.has_grain, false);
  assert.equal(stored.grain_orientation, null);
});

test('an edit that makes a panel the same as another one is refused with the name of the other', async () => {
  resetState();
  state.rows = [row(), row({ id: SECOND_ID, name: 'Chêne atelier', height: 280, width: 207, material: 'melamine', color: 'chêne', has_grain: true, grain_orientation: 'horizontal' })];

  const res = await itemRoute().PATCH(...patch(PRESET_ID, OAK));

  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: 'DUPLICATE_PRESET', existingName: 'Chêne atelier' });
  assert.equal(state.writes, 0);
  assert.equal(state.rows[0].name, 'MDF blanc');
});

test('a panel renamed, or repriced, with the same attributes is not a duplicate of itself', async () => {
  resetState();
  state.rows = [row()];

  const res = await itemRoute().PATCH(...patch(PRESET_ID, { name: 'MDF 19 mm blanc', height: 244, width: 122, material: 'mdf', color: 'blanc', pricePerSheet: 335 }));

  assert.equal(res.status, 200);
  assert.equal(state.rows[0].name, 'MDF 19 mm blanc');
});

test('another artisan\'s identical panel is not a duplicate of mine', async () => {
  resetState();
  state.rows = [row(), row({ id: FOREIGN_ID, user_id: OTHER_UUID, name: 'Le sien', height: 280, width: 207, material: 'melamine', color: 'Chêne', has_grain: true, grain_orientation: 'horizontal' })];

  assert.equal((await itemRoute().PATCH(...patch(PRESET_ID, OAK))).status, 200);
});

test('another artisan\'s panel answers like a missing one and is never changed', async () => {
  resetState();
  state.rows = [row({ id: FOREIGN_ID, user_id: OTHER_UUID })];

  const foreign = await itemRoute().PATCH(...patch(FOREIGN_ID, OAK));
  const missing = await itemRoute().PATCH(...patch(PRESET_ID, OAK));

  assert.equal(foreign.status, 404);
  assert.equal(missing.status, 404);
  assert.deepEqual(await foreign.json(), await missing.json());
  assert.equal(state.writes, 0);
  assert.equal(state.rows[0].name, 'MDF blanc');
});

test('a panel the optimizer would reject is refused, and nothing is written', async () => {
  resetState();
  state.rows = [row()];

  for (const bad of [{ ...OAK, height: -1 }, { ...OAK, material: 'plywood' }, { ...OAK, name: '   ' }, { ...OAK, name: 'x'.repeat(81) }]) {
    const res = await itemRoute().PATCH(...patch(PRESET_ID, bad));
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.deepEqual(await res.json(), { error: 'INVALID_PRESET' });
  }
  assert.equal(state.writes, 0);
});

test('a price alone still changes the price only, as before', async () => {
  resetState();
  state.rows = [row()];

  const res = await itemRoute().PATCH(...patch(PRESET_ID, { pricePerSheet: 450 }));

  assert.equal(res.status, 200);
  assert.equal(state.rows[0].price_per_sheet, 450);
  assert.equal(state.rows[0].name, 'MDF blanc');
  assert.equal((await itemRoute().PATCH(...patch(PRESET_ID, { pricePerSheet: -5 }))).status, 400);
});

test('editing requires a signed-in artisan', async () => {
  resetState();
  state.user = null;
  state.rows = [row()];

  assert.equal((await itemRoute().PATCH(...patch(PRESET_ID, OAK))).status, 401);
  assert.equal(state.writes, 0);
});

test('before the price column exists, the panel is still edited, without its price', async () => {
  resetState();
  state.priceColumnMissing = true;
  const { price_per_sheet: _price, ...withoutPrice } = row();
  void _price;
  state.rows = [withoutPrice];

  const res = await itemRoute().PATCH(...patch(PRESET_ID, OAK));

  assert.equal(res.status, 200);
  assert.equal(state.rows[0].name, 'Chêne clair');
  assert.equal('price_per_sheet' in state.rows[0], false);
});

test('before the table exists, an edit answers that the account list is not ready', async () => {
  resetState();
  state.tableMissing = true;

  const res = await itemRoute().PATCH(...patch(PRESET_ID, OAK));

  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: 'CLOUD_NOT_READY' });
});
