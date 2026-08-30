const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// Task 4 blocker (3): stock/labor pricing must be reachable end-to-end —
// typed on OptimizationOptions, validated by the HTTP schema, and actually
// consumed by the optimizer — with finite non-negative values enforced at
// the API boundary and defaults matching today's behavior (material-library
// per_m2 stock pricing, MAD 0 fixed labor) when omitted.

function baseBody(options) {
  return {
    sheet: { width: 200, height: 100, kerf: 0.3, margin: 1 },
    pieces: [{ id: 'p1', width: 50, height: 50, quantity: 1 }],
    options,
  };
}

test('OptimizeSchema accepts an explicit per-material stockPricingOverrides entry', () => {
  const { OptimizeSchema } = loadTsModule('src/lib/cutting/optimize-schema.ts');
  const parsed = OptimizeSchema.safeParse(baseBody({
    stockPricingOverrides: { mdf: { mode: 'per_sheet', value: 450 } },
  }));
  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.data.options.stockPricingOverrides, { mdf: { mode: 'per_sheet', value: 450 } });
});

test('OptimizeSchema accepts an explicit laborPricing input', () => {
  const { OptimizeSchema } = loadTsModule('src/lib/cutting/optimize-schema.ts');
  const parsed = OptimizeSchema.safeParse(baseBody({ laborPricing: { mode: 'per_meter', value: 5 } }));
  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.data.options.laborPricing, { mode: 'per_meter', value: 5 });
});

test('OptimizeSchema rejects a negative stockPricingOverrides value', () => {
  const { OptimizeSchema } = loadTsModule('src/lib/cutting/optimize-schema.ts');
  const parsed = OptimizeSchema.safeParse(baseBody({
    stockPricingOverrides: { mdf: { mode: 'per_m2', value: -1 } },
  }));
  assert.equal(parsed.success, false);
});

test('OptimizeSchema rejects a non-finite laborPricing value', () => {
  const { OptimizeSchema } = loadTsModule('src/lib/cutting/optimize-schema.ts');
  const infinityResult = OptimizeSchema.safeParse(baseBody({ laborPricing: { mode: 'fixed', value: Infinity } }));
  const nanResult = OptimizeSchema.safeParse(baseBody({ laborPricing: { mode: 'fixed', value: NaN } }));
  assert.equal(infinityResult.success, false);
  assert.equal(nanResult.success, false);
});

test('OptimizeSchema rejects an unknown stockPricingOverrides material key', () => {
  const { OptimizeSchema } = loadTsModule('src/lib/cutting/optimize-schema.ts');
  const parsed = OptimizeSchema.safeParse(baseBody({
    stockPricingOverrides: { plutonium: { mode: 'per_m2', value: 1 } },
  }));
  assert.equal(parsed.success, false);
});

test('OptimizeSchema rejects an unknown stockPricingOverrides/laborPricing mode', () => {
  const { OptimizeSchema } = loadTsModule('src/lib/cutting/optimize-schema.ts');
  const badStock = OptimizeSchema.safeParse(baseBody({ stockPricingOverrides: { mdf: { mode: 'per_kg', value: 1 } } }));
  const badLabor = OptimizeSchema.safeParse(baseBody({ laborPricing: { mode: 'per_hour', value: 1 } }));
  assert.equal(badStock.success, false);
  assert.equal(badLabor.success, false);
});

test('omitting stockPricingOverrides/laborPricing remains valid (opt-in only)', () => {
  const { OptimizeSchema } = loadTsModule('src/lib/cutting/optimize-schema.ts');
  const parsed = OptimizeSchema.safeParse(baseBody({ kerfWidth: 3 }));
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.options.stockPricingOverrides, undefined);
  assert.equal(parsed.data.options.laborPricing, undefined);
});

// End-to-end: the optimizer must actually consume stockPricingOverrides,
// switching a used sheet's material cost line away from the material
// library's default pricePerM2.

test('optimizeCutting2D honors an explicit stockPricingOverrides entry instead of the material library price', () => {
  const { optimizeCutting2D, getMaterialDef } = loadTsModule('src/lib/cutting/binpacking.ts');
  const sheet = { width: 100, height: 100, kerf: 0, margin: 0, material: 'mdf', quantity: 1 };
  const pieces = [{ id: 'p1', width: 50, height: 50, quantity: 1 }];

  const defaultResult = optimizeCutting2D(pieces, [sheet], {});
  const overriddenResult = optimizeCutting2D(pieces, [sheet], {
    stockPricingOverrides: { mdf: { mode: 'per_sheet', value: 999 } },
  });

  const libraryPricePerM2 = getMaterialDef('mdf').pricePerM2;
  assert.equal(defaultResult.costBreakdown.materialCost, libraryPricePerM2, 'default behavior must still use the material library price (1 m^2 sheet)');
  assert.equal(overriddenResult.costBreakdown.materialCost, 999, 'an explicit per_sheet override must replace the material library price entirely');
});

test('optimizeCutting2D honors an explicit laborPricing input and keeps the fixed-0 default when omitted', () => {
  const { optimizeCutting2D } = loadTsModule('src/lib/cutting/binpacking.ts');
  const sheet = { width: 100, height: 100, kerf: 0, margin: 0, material: 'mdf', quantity: 1 };
  const pieces = [{ id: 'p1', width: 100, height: 100, quantity: 1 }];

  const defaultResult = optimizeCutting2D(pieces, [sheet], {});
  assert.equal(defaultResult.costBreakdown.laborCost, 0, 'omitting laborPricing must preserve the existing fixed-0 default');

  const fixedResult = optimizeCutting2D(pieces, [sheet], { laborPricing: { mode: 'fixed', value: 250 } });
  assert.equal(fixedResult.costBreakdown.laborCost, 250);
});

// UI reachability: OptionsPanel must expose compact controls for both
// pricing inputs, wired through the same `laborPricing`/`stockPricingOverrides`
// fields, defaulting to today's behavior (fixed MAD 0 labor, no stock
// override) so an artisan who never touches these controls sees no change.

// Per-piece edge banding config: validated shape, and geometry/cardinality
// caps at the API boundary (see MAX_GEOMETRY/MAX_PIECES/MAX_PIECE_QUANTITY/
// MAX_SHEETS in optimize-schema.ts).

test('OptimizeSchema preserves a valid piece-level edges config', () => {
  const { OptimizeSchema } = loadTsModule('src/lib/cutting/optimize-schema.ts');
  const edges = { top: true, bottom: false, left: true, right: false, color: 'white', pricePerM: 2.5 };
  const parsed = OptimizeSchema.safeParse({
    sheet: { width: 200, height: 100, kerf: 0.3, margin: 1 },
    pieces: [{ id: 'p1', width: 50, height: 50, quantity: 1, edges }],
  });
  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.data.pieces[0].edges, edges);
});

test('OptimizeSchema rejects an invalid piece-level edges.pricePerM', () => {
  const { OptimizeSchema } = loadTsModule('src/lib/cutting/optimize-schema.ts');
  const base = { sheet: { width: 200, height: 100, kerf: 0.3, margin: 1 } };

  const negative = OptimizeSchema.safeParse({
    ...base,
    pieces: [{ id: 'p1', width: 50, height: 50, quantity: 1, edges: { pricePerM: -1 } }],
  });
  const infinite = OptimizeSchema.safeParse({
    ...base,
    pieces: [{ id: 'p1', width: 50, height: 50, quantity: 1, edges: { pricePerM: Infinity } }],
  });
  const stringy = OptimizeSchema.safeParse({
    ...base,
    pieces: [{ id: 'p1', width: 50, height: 50, quantity: 1, edges: { pricePerM: 'expensive' } }],
  });

  assert.equal(negative.success, false);
  assert.equal(infinite.success, false);
  assert.equal(stringy.success, false);
});

test('OptimizeSchema rejects more than 5000 pieces', () => {
  const { OptimizeSchema } = loadTsModule('src/lib/cutting/optimize-schema.ts');
  const pieces = Array.from({ length: 5001 }, () => ({ width: 10, height: 10, quantity: 1 }));
  const parsed = OptimizeSchema.safeParse({
    sheet: { width: 200, height: 100, kerf: 0.3, margin: 1 },
    pieces,
  });
  assert.equal(parsed.success, false);
});

test('OptimizeSchema rejects a piece quantity over 10000', () => {
  const { OptimizeSchema } = loadTsModule('src/lib/cutting/optimize-schema.ts');
  const parsed = OptimizeSchema.safeParse({
    sheet: { width: 200, height: 100, kerf: 0.3, margin: 1 },
    pieces: [{ id: 'p1', width: 50, height: 50, quantity: 10001 }],
  });
  assert.equal(parsed.success, false);
});

test('OptimizeSchema rejects more than 100 sheets', () => {
  const { OptimizeSchema } = loadTsModule('src/lib/cutting/optimize-schema.ts');
  const sheets = Array.from({ length: 101 }, () => ({ width: 200, height: 100, kerf: 0.3, margin: 1 }));
  const parsed = OptimizeSchema.safeParse({
    sheets,
    pieces: [{ id: 'p1', width: 50, height: 50, quantity: 1 }],
  });
  assert.equal(parsed.success, false);
});

test('OptionsPanel wires laborPricing and stockPricingOverrides controls with defaults matching current behavior', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.resolve('src/components/OptionsPanel.tsx'), 'utf8');

  assert.match(source, /laborPricing/, 'OptionsPanel must read/write options.laborPricing');
  assert.match(source, /stockPricingOverrides/, 'OptionsPanel must read/write options.stockPricingOverrides');
  assert.match(source, /mode:\s*'fixed',\s*value:\s*0/, 'the labor pricing default must stay a fixed MAD 0 charge');
  assert.match(source, /per_m2/, 'the stock override control must offer the per_m2 mode');
  assert.doesNotMatch(source, /:\s*any\b/, 'OptionsPanel must stay strictly typed (no `any`)');
});
