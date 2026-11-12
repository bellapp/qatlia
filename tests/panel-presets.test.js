const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');
const { stubModule, PROJECT_ROOT } = require('./helpers/stub-module');

// Account panel presets: each artisan keeps their own list of stock panels in
// the database, and panels of the same size are distinct when their material,
// colour or grain differ (user request, 2026-11-12).

const UUID = '11111111-2222-4333-8444-555555555555';
const OTHER_UUID = '99999999-8888-7777-6666-555555555555';
const PRESET_ID = '22222222-3333-4444-8888-555555555555';
const OTHER_PRESET_ID = '33333333-3333-4444-8888-555555555555';

const state = { user: null, rows: [], tableMissing: false, nextId: 1 };

function resetState() {
  state.user = null;
  state.rows = [];
  state.tableMissing = false;
  state.nextId = 1;
}

const MISSING = { code: 'PGRST205', message: "Could not find the table 'public.panel_presets' in the schema cache" };

/** A tiny PostgREST-like query builder over `state.rows`. */
function panelPresetsTable() {
  const filters = [];
  let action = { kind: 'select' };
  const run = () => {
    if (state.tableMissing) return { data: null, error: MISSING };
    const match = (row) => filters.every(([col, value]) => row[col] === value);
    if (action.kind === 'insert') {
      const created = action.rows.map((row) => ({ id: `00000000-0000-4000-8000-${String(state.nextId++).padStart(12, '0')}`, created_at: new Date().toISOString(), ...row }));
      state.rows.push(...created);
      return { data: created, error: null };
    }
    if (action.kind === 'delete') {
      const removed = state.rows.filter(match);
      state.rows = state.rows.filter((row) => !match(row));
      return { data: removed.map((row) => ({ id: row.id })), error: null };
    }
    return { data: state.rows.filter(match), error: null };
  };
  const query = {
    select: () => query,
    eq: (col, value) => {
      filters.push([col, value]);
      return query;
    },
    order: () => query,
    insert: (rows) => {
      action = { kind: 'insert', rows };
      return query;
    },
    delete: () => {
      action = { kind: 'delete' };
      return query;
    },
    then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
  };
  return query;
}

stubModule('@/lib/supabase/server', {
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
  }),
});
stubModule('@supabase/supabase-js', {
  createClient: () => ({
    from: (table) => {
      if (table === 'panel_presets') return panelPresetsTable();
      throw new Error(`unexpected table: ${table}`);
    },
  }),
});

const ENV = { NEXT_PUBLIC_SUPABASE_URL: 'https://real.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sbsvc_real' };
for (const [key, value] of Object.entries(ENV)) process.env[key] = value;

const rules = () => loadTsModule('src/lib/panel-preset-rules.ts');
const listRoute = () => loadTsModule('src/app/api/panel-presets/route.ts');
const itemRoute = () => loadTsModule('src/app/api/panel-presets/[id]/route.ts');

const MDF_WHITE = { height: 244, width: 122, material: 'mdf', color: 'Blanc' };

function post(presets) {
  return new Request('https://qatlia.example/api/panel-presets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ presets }),
  });
}

function remove(id) {
  return [new Request(`https://qatlia.example/api/panel-presets/${id}`, { method: 'DELETE' }), { params: Promise.resolve({ id }) }];
}

function row(extra) {
  return { id: PRESET_ID, user_id: UUID, name: 'MDF blanc', height: 244, width: 122, material: 'mdf', color: 'Blanc', has_grain: false, grain_orientation: null, ...extra };
}

// ─── The duplicate rule ─────────────────────────────────────────────────────

test('same dimensions with a different colour is a different panel', () => {
  const { isSamePanel } = rules();
  assert.equal(isSamePanel(MDF_WHITE, { ...MDF_WHITE, color: 'Noyer' }), false);
  assert.equal(isSamePanel(MDF_WHITE, { ...MDF_WHITE, color: undefined }), false);
});

test('same dimensions with a different material is a different panel', () => {
  const { isSamePanel } = rules();
  assert.equal(isSamePanel(MDF_WHITE, { ...MDF_WHITE, material: 'contreplaques' }), false);
});

test('same dimensions with or without grain, or another grain direction, are different panels', () => {
  const { isSamePanel } = rules();
  const grainedV = { ...MDF_WHITE, hasGrain: true, grainOrientation: 'vertical' };
  assert.equal(isSamePanel(MDF_WHITE, grainedV), false);
  assert.equal(isSamePanel(grainedV, { ...grainedV, grainOrientation: 'horizontal' }), false);
});

test('an identical panel is a duplicate whatever its name, colour case or stray direction', () => {
  const { isSamePanel, findDuplicatePreset } = rules();
  assert.equal(isSamePanel(MDF_WHITE, { ...MDF_WHITE, color: '  blanc ' }), true);
  // A direction on a panel without grain means nothing.
  assert.equal(isSamePanel(MDF_WHITE, { ...MDF_WHITE, hasGrain: false, grainOrientation: 'horizontal' }), true);
  const saved = [{ ...MDF_WHITE, name: 'Mon MDF blanc' }];
  assert.equal(findDuplicatePreset({ ...MDF_WHITE, name: 'Autre nom' }, saved).name, 'Mon MDF blanc');
});

// ─── GET /api/panel-presets ─────────────────────────────────────────────────

test('listing presets requires a signed-in artisan', async () => {
  resetState();
  const res = await listRoute().GET();
  assert.equal(res.status, 401);
});

test('an artisan only sees their own presets, with numbers and grain mapped for the atelier', async () => {
  resetState();
  state.user = { id: UUID };
  state.rows = [
    row({ height: '244', width: '122', has_grain: true, grain_orientation: 'horizontal' }),
    row({ id: OTHER_PRESET_ID, user_id: OTHER_UUID, name: 'Pas à moi' }),
  ];
  const body = await (await listRoute().GET()).json();
  assert.equal(body.presets.length, 1);
  assert.deepEqual(body.presets[0], {
    id: PRESET_ID, name: 'MDF blanc', height: 244, width: 122, material: 'mdf', color: 'Blanc', hasGrain: true, grainOrientation: 'horizontal',
  });
});

test('before migration 011 is applied, the list is empty and flagged so the device list stays in use', async () => {
  resetState();
  state.user = { id: UUID };
  state.tableMissing = true;
  const res = await listRoute().GET();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.presets, []);
  assert.equal(body.note, 'cloud_not_ready');
});

// ─── POST /api/panel-presets ────────────────────────────────────────────────

test('two panels of the same size but different colour or grain are both saved', async () => {
  resetState();
  state.user = { id: UUID };
  const res = await listRoute().POST(post([
    { name: 'MDF blanc', ...MDF_WHITE },
    { name: 'MDF noyer', ...MDF_WHITE, color: 'Noyer' },
    { name: 'MDF blanc ramage', ...MDF_WHITE, hasGrain: true, grainOrientation: 'vertical' },
  ]));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.created.length, 3);
  assert.deepEqual(body.duplicates, []);
  assert.equal(state.rows.length, 3);
});

test('an identical panel is reported as a duplicate and not stored', async () => {
  resetState();
  state.user = { id: UUID };
  state.rows = [row()];
  const body = await (await listRoute().POST(post([{ name: 'Copie', ...MDF_WHITE, color: 'blanc' }]))).json();
  assert.deepEqual(body.created, []);
  assert.deepEqual(body.duplicates, [{ name: 'Copie', existingName: 'MDF blanc' }]);
  assert.equal(state.rows.length, 1);
});

test('another artisan\'s identical panel is not a duplicate of mine', async () => {
  resetState();
  state.user = { id: UUID };
  state.rows = [row({ user_id: OTHER_UUID })];
  const body = await (await listRoute().POST(post([{ name: 'MDF blanc', ...MDF_WHITE }]))).json();
  assert.equal(body.created.length, 1);
});

test('a saved preset is normalised: blank colour stored as null, direction only when grained', async () => {
  resetState();
  state.user = { id: UUID };
  await listRoute().POST(post([{ name: '  Sans couleur  ', height: 200, width: 100, color: '   ', hasGrain: false, grainOrientation: 'horizontal' }]));
  const [stored] = state.rows;
  assert.equal(stored.user_id, UUID);
  assert.equal(stored.name, 'Sans couleur');
  assert.equal(stored.material, 'mdf');
  assert.equal(stored.color, null);
  assert.equal(stored.has_grain, false);
  assert.equal(stored.grain_orientation, null);
});

test('a panel the optimizer would reject is refused', async () => {
  resetState();
  state.user = { id: UUID };
  const res = await listRoute().POST(post([{ name: 'Faux', height: -1, width: 100 }, { name: 'Matière inconnue', height: 10, width: 10, material: 'plywood' }]));
  assert.equal(res.status, 400);
  assert.equal(state.rows.length, 0);
});

test('an artisan cannot go past the preset limit', async () => {
  resetState();
  state.user = { id: UUID };
  const { MAX_PRESETS_PER_USER } = loadTsModule('src/lib/panel-presets-store.ts');
  state.rows = Array.from({ length: MAX_PRESETS_PER_USER }, (_, i) => row({ id: `id-${i}`, height: 100 + i }));
  const res = await listRoute().POST(post([{ name: 'De trop', height: 50, width: 50 }]));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, 'PRESET_LIMIT');
  assert.equal(state.rows.length, MAX_PRESETS_PER_USER);
});

test('saving before migration 011 is applied answers 503 so the atelier keeps the device list', async () => {
  resetState();
  state.user = { id: UUID };
  state.tableMissing = true;
  const res = await listRoute().POST(post([{ name: 'MDF blanc', ...MDF_WHITE }]));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'CLOUD_NOT_READY');
});

// ─── DELETE /api/panel-presets/[id] ─────────────────────────────────────────

test('an artisan deletes their own preset', async () => {
  resetState();
  state.user = { id: UUID };
  state.rows = [row()];
  const res = await itemRoute().DELETE(...remove(PRESET_ID));
  assert.equal(res.status, 200);
  assert.equal(state.rows.length, 0);
});

test('another artisan\'s preset answers like a missing one and is never deleted', async () => {
  resetState();
  state.user = { id: UUID };
  state.rows = [row({ id: OTHER_PRESET_ID, user_id: OTHER_UUID })];
  const notOwned = await itemRoute().DELETE(...remove(OTHER_PRESET_ID));
  const missing = await itemRoute().DELETE(...remove(PRESET_ID));
  assert.equal(notOwned.status, 404);
  assert.equal(missing.status, 404);
  assert.deepEqual(await notOwned.json(), await missing.json());
  assert.equal(state.rows.length, 1);
});

// ─── Migration 011 ──────────────────────────────────────────────────────────

test('migration 011 keeps the table behind RLS and out of reach of client roles', () => {
  const sql = fs.readFileSync(path.join(PROJECT_ROOT, 'supabase/migrations/011_panel_presets.sql'), 'utf8');
  assert.match(sql, /ALTER TABLE public\.panel_presets ENABLE ROW LEVEL SECURITY;/);
  assert.match(sql, /REVOKE ALL ON public\.panel_presets FROM PUBLIC, anon, authenticated;/);
  assert.match(sql, /REFERENCES auth\.users\(id\) ON DELETE CASCADE/);
  // Reads only for clients: every write goes through /api/panel-presets.
  const policies = sql.match(/CREATE POLICY[\s\S]*?;/g) || [];
  assert.equal(policies.length, 1);
  assert.match(policies[0], /FOR SELECT TO authenticated/);
  assert.doesNotMatch(sql, /GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*TO (anon|authenticated)/);
});
