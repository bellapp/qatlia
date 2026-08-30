const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// Regression for the P0 offcuts task: `minReusableOffcutWidth`/`minReusableOffcutHeight`
// were added to OptimizationOptions but the API's `options` schema is `.passthrough()`,
// so malformed values (strings, negatives, NaN/Infinity) silently reach the optimizer
// instead of being rejected at the API boundary.

function baseBody(options) {
  return {
    sheet: { width: 200, height: 100, kerf: 0.3, margin: 1 },
    pieces: [{ id: 'p1', width: 50, height: 50, quantity: 1 }],
    options,
  };
}

test('OptimizeSchema accepts finite non-negative minReusableOffcutWidth/Height', () => {
  const { OptimizeSchema } = loadTsModule('src/lib/cutting/optimize-schema.ts');

  const parsed = OptimizeSchema.safeParse(baseBody({ minReusableOffcutWidth: 20, minReusableOffcutHeight: 0 }));

  assert.equal(parsed.success, true, 'valid finite non-negative thresholds must be accepted');
  assert.equal(parsed.data.options.minReusableOffcutWidth, 20);
  assert.equal(parsed.data.options.minReusableOffcutHeight, 0);
});

test('OptimizeSchema keeps minReusableOffcutWidth/Height optional', () => {
  const { OptimizeSchema } = loadTsModule('src/lib/cutting/optimize-schema.ts');

  const parsed = OptimizeSchema.safeParse(baseBody({ kerfWidth: 3 }));

  assert.equal(parsed.success, true, 'omitting the thresholds must remain valid for backward compatibility');
  assert.equal(parsed.data.options.minReusableOffcutWidth, undefined);
  assert.equal(parsed.data.options.minReusableOffcutHeight, undefined);
});

test('OptimizeSchema rejects a string minReusableOffcutWidth', () => {
  const { OptimizeSchema } = loadTsModule('src/lib/cutting/optimize-schema.ts');

  const parsed = OptimizeSchema.safeParse(baseBody({ minReusableOffcutWidth: '20' }));

  assert.equal(parsed.success, false, 'a string threshold must be rejected, not silently passed through');
});

test('OptimizeSchema rejects a negative minReusableOffcutHeight', () => {
  const { OptimizeSchema } = loadTsModule('src/lib/cutting/optimize-schema.ts');

  const parsed = OptimizeSchema.safeParse(baseBody({ minReusableOffcutHeight: -5 }));

  assert.equal(parsed.success, false, 'a negative threshold must be rejected');
});

test('OptimizeSchema rejects non-finite minReusableOffcutWidth/Height', () => {
  const { OptimizeSchema } = loadTsModule('src/lib/cutting/optimize-schema.ts');

  const infinityResult = OptimizeSchema.safeParse(baseBody({ minReusableOffcutWidth: Infinity }));
  const nanResult = OptimizeSchema.safeParse(baseBody({ minReusableOffcutHeight: NaN }));

  assert.equal(infinityResult.success, false, 'Infinity must be rejected as a threshold');
  assert.equal(nanResult.success, false, 'NaN must be rejected as a threshold');
});

test('OptimizeSchema still accepts unrelated passthrough option keys', () => {
  const { OptimizeSchema } = loadTsModule('src/lib/cutting/optimize-schema.ts');

  const parsed = OptimizeSchema.safeParse(baseBody({ someFutureOption: 'anything' }));

  assert.equal(parsed.success, true, 'unrelated option keys must continue to pass through untouched');
  assert.equal(parsed.data.options.someFutureOption, 'anything');
});

// Task 2: optimizationPriority must be a closed enum of the four supported
// values, not an open string, so unknown/typo'd values are rejected at the
// API boundary instead of silently reaching the optimizer.

test('OptimizeSchema accepts every supported optimizationPriority value', () => {
  const { OptimizeSchema } = loadTsModule('src/lib/cutting/optimize-schema.ts');
  const { OPTIMIZATION_PRIORITY_VALUES } = loadTsModule('src/lib/cutting/binpacking.ts');

  assert.deepEqual(OPTIMIZATION_PRIORITY_VALUES, ['linear_guillotine', 'min_waste', 'min_sheets', 'balanced']);

  for (const value of OPTIMIZATION_PRIORITY_VALUES) {
    const parsed = OptimizeSchema.safeParse(baseBody({ optimizationPriority: value }));
    assert.equal(parsed.success, true, `optimizationPriority "${value}" must be accepted`);
    assert.equal(parsed.data.options.optimizationPriority, value);
  }
});

test('OptimizeSchema rejects an unknown optimizationPriority value', () => {
  const { OptimizeSchema } = loadTsModule('src/lib/cutting/optimize-schema.ts');

  const parsed = OptimizeSchema.safeParse(baseBody({ optimizationPriority: 'fastest' }));

  assert.equal(parsed.success, false, 'an unrecognized optimizationPriority must be rejected, not passed through');
});

// Task 2 (item 3): the HTTP schema must support multi-stock requests (one
// `sheets` entry per material group) without breaking legacy single-`sheet`
// callers. Exactly one of `sheet`/non-empty `sheets` is required.

test('OptimizeSchema accepts a non-empty multi-material `sheets` array without `sheet`', () => {
  const { OptimizeSchema } = loadTsModule('src/lib/cutting/optimize-schema.ts');

  const body = {
    pieces: [{ id: 'p1', width: 50, height: 50, quantity: 1, material: 'mdf' }],
    sheets: [
      { width: 200, height: 100, kerf: 0.3, margin: 1, material: 'mdf' },
      { width: 150, height: 150, kerf: 0.3, margin: 1, material: 'verre' },
    ],
  };

  const parsed = OptimizeSchema.safeParse(body);

  assert.equal(parsed.success, true, 'a multi-material `sheets` array must be accepted without a legacy `sheet`');
  assert.equal(parsed.data.sheets.length, 2);
  assert.equal(parsed.data.sheets[0].material, 'mdf');
  assert.equal(parsed.data.sheets[1].material, 'verre');
  assert.equal(parsed.data.sheet, undefined, 'legacy `sheet` must remain undefined when only `sheets` is supplied');
});

test('OptimizeSchema still accepts the legacy single `sheet` field without `sheets`', () => {
  const { OptimizeSchema } = loadTsModule('src/lib/cutting/optimize-schema.ts');

  const parsed = OptimizeSchema.safeParse(baseBody({}));

  assert.equal(parsed.success, true, 'legacy callers passing only `sheet` must remain valid');
  assert.equal(parsed.data.sheet.width, 200);
  assert.equal(parsed.data.sheets, undefined, '`sheets` must remain undefined when only the legacy `sheet` is supplied');
});

test('OptimizeSchema rejects a request with neither `sheet` nor `sheets`', () => {
  const { OptimizeSchema } = loadTsModule('src/lib/cutting/optimize-schema.ts');

  const parsed = OptimizeSchema.safeParse({
    pieces: [{ id: 'p1', width: 50, height: 50, quantity: 1 }],
  });

  assert.equal(parsed.success, false, 'a request with neither `sheet` nor `sheets` must be rejected');
});

test('OptimizeSchema rejects an empty `sheets` array', () => {
  const { OptimizeSchema } = loadTsModule('src/lib/cutting/optimize-schema.ts');

  const parsed = OptimizeSchema.safeParse({
    pieces: [{ id: 'p1', width: 50, height: 50, quantity: 1 }],
    sheets: [],
  });

  assert.equal(parsed.success, false, 'an empty `sheets` array must be rejected, not treated as "no stock"');
});

// Route contract: the API route must pass `sheets ?? [sheet]` through to
// optimizeCutting2D so legacy single-sheet callers and new multi-stock
// callers both reach the optimizer, instead of only ever reading `sheet`.

test('optimize API route supports multi-stock `sheets ?? [sheet]` without dropping legacy single-sheet callers', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const routeSource = fs.readFileSync(path.resolve('src/app/api/optimize/route.ts'), 'utf8');

  assert.match(routeSource, /import\s*\{\s*optimizeCutting2D\b/, 'Route must import optimizeCutting2D');
  assert.match(routeSource, /sheets\s*\?\?\s*\(sheet\s*\?\s*\[sheet\]\s*:\s*\[\]\)/, 'Route must fall back to `(sheet ? [sheet] : [])` when `sheets` is absent, for legacy callers');
  assert.doesNotMatch(routeSource, /:\s*any\b/, 'Route must stay strictly typed (no `any`)');
});

// Hardening: the route used to rely on a non-null assertion (`sheet!`) backed
// only by the schema's refine. That's a silent landmine if the refine is ever
// weakened. The route must instead derive `stockSheets` defensively and
// return INVALID_INPUT if it ever ends up empty, without any `sheet!` assertion.

test('optimize API route source contains no `sheet!` non-null assertion', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const routeSource = fs.readFileSync(path.resolve('src/app/api/optimize/route.ts'), 'utf8');

  assert.doesNotMatch(routeSource, /sheet!/, 'Route must not use a `sheet!` non-null assertion');
});

test('optimize API route returns INVALID_INPUT 400 when stockSheets would be empty', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const routeSource = fs.readFileSync(path.resolve('src/app/api/optimize/route.ts'), 'utf8');

  assert.match(routeSource, /stockSheets\.length\s*===\s*0/, 'Route must defensively guard against an empty stockSheets list');
  assert.match(routeSource, /INVALID_INPUT/, 'Route must report INVALID_INPUT for the defensive empty-stock guard');
});

// Task: MaterialType/MATERIAL_TYPE_VALUES is the single source of truth for
// valid materials, shared by SheetSchema.material. All 8 current material
// values must remain accepted, in their exact existing order.

test('MATERIAL_TYPE_VALUES preserves the exact 8 current material values and order', () => {
  const { MATERIAL_TYPE_VALUES } = loadTsModule('src/lib/cutting/binpacking.ts');

  assert.deepEqual(MATERIAL_TYPE_VALUES, [
    'mdf', 'aluminium', 'verre', 'contreplaques', 'melamine', 'chene', 'stratifié', 'medium',
  ]);
});

test('SheetSchema accepts every MATERIAL_TYPE_VALUES entry as sheet.material', () => {
  const { OptimizeSchema } = loadTsModule('src/lib/cutting/optimize-schema.ts');
  const { MATERIAL_TYPE_VALUES } = loadTsModule('src/lib/cutting/binpacking.ts');

  for (const material of MATERIAL_TYPE_VALUES) {
    // baseBody() targets `options`; build a dedicated body per-material for `sheet`.
    const body = {
      sheet: { width: 200, height: 100, kerf: 0.3, margin: 1, material },
      pieces: [{ id: 'p1', width: 50, height: 50, quantity: 1 }],
    };
    const result = OptimizeSchema.safeParse(body);
    assert.equal(result.success, true, `material "${material}" must be accepted`);
    assert.equal(result.data.sheet.material, material);
  }
});

test('SheetSchema rejects an unknown material value', () => {
  const { OptimizeSchema } = loadTsModule('src/lib/cutting/optimize-schema.ts');

  const body = {
    sheet: { width: 200, height: 100, kerf: 0.3, margin: 1, material: 'plastique' },
    pieces: [{ id: 'p1', width: 50, height: 50, quantity: 1 }],
  };
  const parsed = OptimizeSchema.safeParse(body);

  assert.equal(parsed.success, false, 'an unrecognized material must be rejected');
});

// Task: multi-stock `sheets` entries must preserve the Sheet fields the
// optimizer actually consumes (`quantity`, `id`, `label`), not just `material`.

test('SheetSchema preserves sheet quantity, id, and label', () => {
  const { OptimizeSchema } = loadTsModule('src/lib/cutting/optimize-schema.ts');

  const body = {
    sheets: [{ id: 'sheet-a', label: 'Chute A', width: 200, height: 100, kerf: 0.3, margin: 1, material: 'mdf', quantity: 3 }],
    pieces: [{ id: 'p1', width: 50, height: 50, quantity: 1 }],
  };
  const parsed = OptimizeSchema.safeParse(body);

  assert.equal(parsed.success, true, 'a sheet with id/label/quantity must be accepted');
  assert.equal(parsed.data.sheets[0].id, 'sheet-a');
  assert.equal(parsed.data.sheets[0].label, 'Chute A');
  assert.equal(parsed.data.sheets[0].quantity, 3);
});

test('SheetSchema rejects a nonpositive sheet quantity', () => {
  const { OptimizeSchema } = loadTsModule('src/lib/cutting/optimize-schema.ts');

  const zeroBody = {
    sheets: [{ width: 200, height: 100, kerf: 0.3, margin: 1, material: 'mdf', quantity: 0 }],
    pieces: [{ id: 'p1', width: 50, height: 50, quantity: 1 }],
  };
  const negativeBody = {
    sheets: [{ width: 200, height: 100, kerf: 0.3, margin: 1, material: 'mdf', quantity: -1 }],
    pieces: [{ id: 'p1', width: 50, height: 50, quantity: 1 }],
  };

  assert.equal(OptimizeSchema.safeParse(zeroBody).success, false, 'a zero sheet quantity must be rejected');
  assert.equal(OptimizeSchema.safeParse(negativeBody).success, false, 'a negative sheet quantity must be rejected');
});
