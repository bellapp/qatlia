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
