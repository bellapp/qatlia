const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');
const { stubModule } = require('./helpers/stub-module');

// The artisan's own prices (user request, 2026-11-13): a price per panel on
// the stock panel and its saved presets, one price per metre of edge banding
// for every colour, kept in the account. Without them, the catalog prices
// apply, the panel's as a price per panel.

const binpacking = () => loadTsModule('src/lib/cutting/binpacking.ts');
const costing = () => loadTsModule('src/lib/costing.ts');

const PIECES = [
  { name: 'Côté', height: 63, width: 55, quantity: 10, edges: { left: true, color: 'white' } },
  { name: 'Porte', height: 70, width: 40, quantity: 3, edges: { left: true, right: true, top: true, bottom: true, color: 'oak' } },
];
const SHEET = { id: 's1', height: 244, width: 122, kerf: 0.3, material: 'melamine' };

// ─── Pricing rules ──────────────────────────────────────────────────────────

test('a panel is priced by its own price, else the catalog price of that whole panel', () => {
  const { sheetPricing, catalogPanelPrice } = binpacking();
  const panel = { material: 'melamine', width: 122, height: 244 };
  assert.deepEqual(sheetPricing({ ...panel, pricePerSheet: 450 }), { mode: 'per_sheet', value: 450 });
  // 150 MAD/m² × 2,9768 m² = 446,52 MAD the panel.
  assert.equal(catalogPanelPrice('melamine', 122, 244), 446.52);
  assert.deepEqual(sheetPricing(panel), { mode: 'per_sheet', value: 446.52 });
  // 120 MAD/m² × 2,9768 m² = 357,216, to the cent.
  assert.deepEqual(sheetPricing({ material: 'mdf', width: 122, height: 244 }), { mode: 'per_sheet', value: 357.22 });
  // A free panel (supplied by the client) is a real price, not "no price".
  assert.deepEqual(sheetPricing({ ...panel, pricePerSheet: 0 }), { mode: 'per_sheet', value: 0 });
  // An API caller's per-material override still applies.
  assert.deepEqual(sheetPricing(panel, { melamine: { mode: 'per_m2', value: 170 } }), { mode: 'per_m2', value: 170 });
});

test("every edge colour is priced at the artisan's one rate, else its catalog rate; « Aucun » is never charged", () => {
  const { edgePricePerM } = binpacking();
  assert.equal(edgePricePerM('white', 9.5), 9.5);
  assert.equal(edgePricePerM('oak', 9.5), 9.5);
  assert.equal(edgePricePerM('oak'), 12);
  assert.equal(edgePricePerM('none', 5), 0);
  assert.equal(edgePricePerM('white', -1), 8);
});

test('a panel price once set in the cut settings becomes the panel price when the work is reopened', () => {
  const { withLegacyStockPrice } = binpacking();
  const panel = { material: 'mdf', width: 122, height: 244 };
  assert.equal(withLegacyStockPrice(panel, { mdf: { mode: 'per_sheet', value: 400 } }).pricePerSheet, 400);
  assert.equal(withLegacyStockPrice(panel, { mdf: { mode: 'per_m2', value: 100 } }).pricePerSheet, 297.68);
  assert.equal(withLegacyStockPrice({ ...panel, pricePerSheet: 380 }, { mdf: { mode: 'per_sheet', value: 400 } }).pricePerSheet, 380);
  assert.equal(withLegacyStockPrice(panel, { melamine: { mode: 'per_sheet', value: 400 } }), panel);
  assert.equal(withLegacyStockPrice(panel, undefined), panel);
  assert.equal(withLegacyStockPrice(panel, { mdf: { mode: 'per_sheet', value: -3 } }), panel);
});

// ─── The optimizer ──────────────────────────────────────────────────────────

test('without any price of the artisan, the plan costs exactly what it cost before', () => {
  const { optimizeCutting2D } = binpacking();
  const result = optimizeCutting2D(PIECES, [SHEET], { kerfWidth: 3 });
  // 2 melamine panels 244 × 122 at 150 MAD/m², 6,3 m of white at 8, 6,6 m of oak at 12.
  assert.equal(result.costBreakdown.materialCost, 893.04);
  assert.equal(result.costBreakdown.edgeCost, 129.6);
  assert.equal(result.costBreakdown.subtotal, 1022.64);
});

test("the plan uses the panel's own price and the artisan's edge rates", () => {
  const { optimizeCutting2D } = binpacking();
  const result = optimizeCutting2D(
    PIECES,
    [{ ...SHEET, color: 'Blanc', pricePerSheet: 420 }],
    { kerfWidth: 3, edgeBandPricePerM: 10 }
  );
  assert.equal(result.costBreakdown.materialCost, 840);
  assert.equal(result.costBreakdown.edgeCost, 129); // (6,3 + 6,6) × 10
  assert.equal(result.costingInput.material.sheets[0].color, 'Blanc');
  assert.deepEqual(result.costingInput.material.sheets[0].pricing, { mode: 'per_sheet', value: 420 });
});

// ─── Repricing a plan already on screen ─────────────────────────────────────

test('a new price updates the plan on screen without a new optimization', () => {
  const { optimizeCutting2D, repriceCostingInput } = binpacking();
  const { computeCostBreakdown } = costing();
  const plan = optimizeCutting2D(PIECES, [SHEET], { kerfWidth: 3 });
  const repriced = repriceCostingInput(plan.costingInput, {
    edgeBandPricePerM: 10,
    sheet: { ...SHEET, color: 'Blanc', pricePerSheet: 420 },
  });
  const fresh = optimizeCutting2D(PIECES, [{ ...SHEET, color: 'Blanc', pricePerSheet: 420 }], {
    kerfWidth: 3,
    edgeBandPricePerM: 10,
  });
  assert.deepEqual(computeCostBreakdown(repriced), fresh.costBreakdown);
  // Clearing both prices goes back to the catalog: the plan as first priced.
  const back = repriceCostingInput(repriced, { sheet: SHEET });
  assert.deepEqual(computeCostBreakdown(back), plan.costBreakdown);
});

test('repricing leaves alone a panel of another size and a line saved before lines were named', () => {
  const { repriceCostingInput } = binpacking();
  const input = {
    material: {
      sheets: [
        { areaM2: 2, quantity: 1, pricing: { mode: 'per_m2', value: 100 }, material: 'mdf', widthCm: 100, heightCm: 200 },
        { areaM2: 2, quantity: 1, pricing: { mode: 'per_m2', value: 100 } },
      ],
      basis: 'measured',
    },
    edge: { segments: [{ lengthM: 1, pricePerMeter: 8 }], basis: 'measured' },
    labor: { pricing: { mode: 'fixed', value: 0 } },
  };
  const repriced = repriceCostingInput(input, {
    edgeBandPricePerM: 20,
    sheet: { material: 'mdf', width: 122, height: 244, pricePerSheet: 999 },
  });
  assert.deepEqual(repriced, input);
});

// ─── What /api/optimize accepts ─────────────────────────────────────────────

test('the optimize request keeps the panel price, its colour and the edge rate', () => {
  const { OptimizeSchema } = loadTsModule('src/lib/cutting/optimize-schema.ts');
  const parsed = OptimizeSchema.parse({
    sheets: [{ ...SHEET, color: 'Blanc', pricePerSheet: 420 }],
    pieces: PIECES,
    options: { edgeBandPricePerM: 10 },
  });
  assert.equal(parsed.sheets[0].pricePerSheet, 420);
  assert.equal(parsed.sheets[0].color, 'Blanc');
  assert.equal(parsed.options.edgeBandPricePerM, 10);
});

test('the optimize request refuses a negative price, and a page open from before is not refused', () => {
  const { OptimizeSchema } = loadTsModule('src/lib/cutting/optimize-schema.ts');
  assert.equal(OptimizeSchema.safeParse({ sheets: [{ ...SHEET, pricePerSheet: -1 }], pieces: PIECES }).success, false);
  assert.equal(OptimizeSchema.safeParse({ sheets: [SHEET], pieces: PIECES, options: { edgeBandPricePerM: -1 } }).success, false);
  assert.equal(OptimizeSchema.safeParse({ sheets: [SHEET], pieces: PIECES, options: { edgeBandPricePerM: Infinity } }).success, false);
  // Prices per colour, sent by a page loaded before this change, are ignored.
  const { optimizeCutting2D } = binpacking();
  const old = OptimizeSchema.parse({ sheets: [SHEET], pieces: PIECES, options: { kerfWidth: 3, edgePricesPerM: { white: 10 } } });
  assert.equal(optimizeCutting2D(PIECES, [SHEET], old.options).costBreakdown.edgeCost, 129.6);
});

// ─── Account storage (routes over a stubbed Supabase) ───────────────────────

const UUID = '11111111-2222-4333-8444-555555555555';
const PRESET_ID = '22222222-3333-4444-8888-555555555555';

const state = { user: null, presets: [], edgePrices: [], priceColumnMissing: false, edgeTableMissing: false };

function resetState() {
  state.user = { id: UUID };
  state.presets = [];
  state.edgePrices = [];
  state.priceColumnMissing = false;
  state.edgeTableMissing = false;
}

const MISSING_COLUMN = { code: '42703', message: 'column panel_presets.price_per_sheet does not exist' };
const MISSING_TABLE = { code: 'PGRST205', message: "Could not find the table 'public.edge_band_prices' in the schema cache" };

/** A tiny PostgREST-like builder over one in-memory table. */
function table(name) {
  const filters = [];
  let action = { kind: 'select' };
  let columns = '';
  const rowsOf = () => (name === 'panel_presets' ? state.presets : state.edgePrices);
  const setRows = (rows) => {
    if (name === 'panel_presets') state.presets = rows;
    else state.edgePrices = rows;
  };
  const match = (row) => filters.every(([col, value, op]) => (op === 'in' ? value.includes(row[col]) : row[col] === value));
  const run = () => {
    if (name === 'edge_band_prices' && state.edgeTableMissing) return { data: null, error: MISSING_TABLE };
    if (name === 'panel_presets' && state.priceColumnMissing) {
      const touchesPrice =
        columns.includes('price_per_sheet') ||
        (action.rows || []).some((row) => 'price_per_sheet' in row) ||
        (action.values && 'price_per_sheet' in action.values);
      if (touchesPrice) return { data: null, error: MISSING_COLUMN };
    }
    if (action.kind === 'insert') {
      const created = action.rows.map((row, i) => ({ id: `00000000-0000-4000-8000-00000000000${i}`, created_at: new Date().toISOString(), ...row }));
      setRows([...rowsOf(), ...created]);
      return { data: created, error: null };
    }
    if (action.kind === 'update') {
      const updated = [];
      setRows(rowsOf().map((row) => (match(row) ? (updated.push({ ...row, ...action.values }), { ...row, ...action.values }) : row)));
      return { data: updated, error: null };
    }
    if (action.kind === 'upsert') {
      let rows = rowsOf();
      for (const next of action.rows) {
        rows = rows.filter((row) => !(row.user_id === next.user_id && row.edge_id === next.edge_id));
        rows.push(next);
      }
      setRows(rows);
      return { data: null, error: null };
    }
    if (action.kind === 'delete') {
      setRows(rowsOf().filter((row) => !match(row)));
      return { data: null, error: null };
    }
    return { data: rowsOf().filter(match), error: null };
  };
  const query = {
    select: (cols = '') => {
      columns = cols;
      return query;
    },
    eq: (col, value) => (filters.push([col, value]), query),
    in: (col, values) => (filters.push([col, values, 'in']), query),
    order: () => query,
    insert: (rows) => ((action = { kind: 'insert', rows }), query),
    update: (values) => ((action = { kind: 'update', values }), query),
    upsert: (rows) => ((action = { kind: 'upsert', rows }), query),
    delete: () => ((action = { kind: 'delete' }), query),
    maybeSingle: () => Promise.resolve(run()).then(({ data, error }) => ({ data: Array.isArray(data) ? data[0] ?? null : data, error })),
    then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
  };
  return query;
}

stubModule('@/lib/supabase/server', {
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: state.user }, error: null }) } }),
});
stubModule('@supabase/supabase-js', { createClient: () => ({ from: (name) => table(name) }) });
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://real.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sbsvc_real';

const listRoute = () => loadTsModule('src/app/api/panel-presets/route.ts');
const itemRoute = () => loadTsModule('src/app/api/panel-presets/[id]/route.ts');
const edgeRoute = () => loadTsModule('src/app/api/edge-prices/route.ts');

function presetRow(extra = {}) {
  return { id: PRESET_ID, user_id: UUID, name: 'Mélaminé blanc', height: 244, width: 122, material: 'melamine', color: 'Blanc', has_grain: false, grain_orientation: null, created_at: '2026-11-13T08:00:00Z', ...extra };
}

function json(method, url, body) {
  return new Request(`https://qatlia.example${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

function patchPrice(id, pricePerSheet) {
  return [json('PATCH', `/api/panel-presets/${id}`, { pricePerSheet }), { params: Promise.resolve({ id }) }];
}

test('a saved panel comes back with its price (NUMERIC arrives as text)', async () => {
  resetState();
  state.presets = [presetRow({ price_per_sheet: '420.00' })];
  const data = await (await listRoute().GET()).json();
  assert.equal(data.presets[0].pricePerSheet, 420);
});

test('saving a panel with its price stores the price', async () => {
  resetState();
  const res = await listRoute().POST(json('POST', '/api/panel-presets', { presets: [{ name: 'Blanc', height: 244, width: 122, material: 'melamine', color: 'Blanc', pricePerSheet: 420.456 }] }));
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(state.presets[0].price_per_sheet, 420.46);
  assert.equal(data.created[0].pricePerSheet, 420.46);
});

test("changing a saved panel's price, and clearing it", async () => {
  resetState();
  state.presets = [presetRow({ price_per_sheet: 400 })];
  let res = await itemRoute().PATCH(...patchPrice(PRESET_ID, 450));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).preset.pricePerSheet, 450);
  res = await itemRoute().PATCH(...patchPrice(PRESET_ID, null));
  assert.equal(res.status, 200);
  assert.equal(state.presets[0].price_per_sheet, null);
  assert.equal((await res.json()).preset.pricePerSheet, undefined);
});

test("nobody can price another artisan's panel, and a negative price is refused", async () => {
  resetState();
  state.presets = [presetRow({ user_id: '99999999-8888-4777-8666-555555555555', price_per_sheet: 400 })];
  assert.equal((await itemRoute().PATCH(...patchPrice(PRESET_ID, 1))).status, 404);
  assert.equal(state.presets[0].price_per_sheet, 400);
  state.presets = [presetRow()];
  assert.equal((await itemRoute().PATCH(...patchPrice(PRESET_ID, -5))).status, 400);
  state.user = null;
  assert.equal((await itemRoute().PATCH(...patchPrice(PRESET_ID, 5))).status, 401);
});

test('before migration 015, saved panels are still listed and saved, without a price', async () => {
  resetState();
  state.priceColumnMissing = true;
  state.presets = [presetRow()];
  const list = await (await listRoute().GET()).json();
  assert.equal(list.success, true);
  assert.equal(list.presets.length, 1);

  const res = await listRoute().POST(json('POST', '/api/panel-presets', { presets: [{ name: 'Noyer', height: 244, width: 122, material: 'melamine', color: 'Noyer', pricePerSheet: 500 }] }));
  assert.equal(res.status, 200);
  assert.equal(state.presets.length, 2);
  assert.equal('price_per_sheet' in state.presets[1], false);

  assert.equal((await itemRoute().PATCH(...patchPrice(PRESET_ID, 450))).status, 503);
});

test('the edge price is kept per account: set it, change it, clear it', async () => {
  resetState();
  // A price per colour saved before this change is no longer read.
  state.edgePrices = [{ user_id: UUID, edge_id: 'oak', price_per_m: '13.00' }];
  assert.equal((await (await edgeRoute().GET()).json()).price, null);

  let res = await edgeRoute().PUT(json('PUT', '/api/edge-prices', { price: 9.5 }));
  assert.equal(res.status, 200);
  res = await edgeRoute().PUT(json('PUT', '/api/edge-prices', { price: 10.456 }));
  assert.equal(res.status, 200);
  let data = await (await edgeRoute().GET()).json();
  assert.equal(data.price, 10.46);
  assert.equal(state.edgePrices.filter((row) => row.edge_id === 'all').length, 1);
  assert.ok(state.edgePrices.every((row) => row.user_id === UUID));

  res = await edgeRoute().PUT(json('PUT', '/api/edge-prices', { price: null }));
  assert.equal(res.status, 200);
  data = await (await edgeRoute().GET()).json();
  assert.equal(data.price, null);
});

test('edge price: a negative or missing price is refused, and a visitor must sign in', async () => {
  resetState();
  assert.equal((await edgeRoute().PUT(json('PUT', '/api/edge-prices', { price: -1 }))).status, 400);
  assert.equal((await edgeRoute().PUT(json('PUT', '/api/edge-prices', {}))).status, 400);
  assert.equal((await edgeRoute().PUT(json('PUT', '/api/edge-prices', { prices: { white: 9 } }))).status, 400);
  state.user = null;
  assert.equal((await edgeRoute().GET()).status, 401);
  assert.equal((await edgeRoute().PUT(json('PUT', '/api/edge-prices', { price: 9 }))).status, 401);
  assert.equal(state.edgePrices.length, 0);
});

test('before migration 015, the edge price stays on the device', async () => {
  resetState();
  state.edgeTableMissing = true;
  const data = await (await edgeRoute().GET()).json();
  assert.equal(data.note, 'cloud_not_ready');
  assert.equal((await edgeRoute().PUT(json('PUT', '/api/edge-prices', { price: 9 }))).status, 503);
});

test('the device copy of the edge price keeps only a usable price, to the cent', () => {
  const { cleanEdgePrice } = loadTsModule('src/lib/edge-prices.ts');
  assert.equal(cleanEdgePrice(9.456), 9.46);
  assert.equal(cleanEdgePrice(0), 0);
  assert.equal(cleanEdgePrice(-2), null);
  assert.equal(cleanEdgePrice('9'), null);
  assert.equal(cleanEdgePrice({ white: 9 }), null);
});
