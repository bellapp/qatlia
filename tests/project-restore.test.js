const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// Reopening a project from the history puts its saved plan back on screen
// without running the optimizer again, so the saved result is checked first:
// an old save that kept only a summary, or a damaged one, must not reach the
// plan drawing.

const restore = () => loadTsModule('src/lib/projects/restore.ts');
const packing = () => loadTsModule('src/lib/cutting/binpacking.ts');

function savedResult() {
  const { optimizeCutting2D, DEFAULT_STOCK_SHEET, OPTIONS_DEFAULTS } = packing();
  const pieces = [{ id: 'a', name: 'Côté', height: 70, width: 40, quantity: 3 }];
  return JSON.parse(JSON.stringify(optimizeCutting2D(pieces, [DEFAULT_STOCK_SHEET], OPTIONS_DEFAULTS)));
}

test('a saved result comes back unchanged', () => {
  const saved = savedResult();
  assert.deepEqual(restore().pickRestorableResult(saved), saved);
});

test('a summary-only result from an old save is not a plan', () => {
  assert.equal(restore().pickRestorableResult({ sheetsUsed: 1, wastePercentage: 12 }), null);
});

test('anything that is not a result is refused', () => {
  for (const value of [null, undefined, 'x', 42, [], {}]) assert.equal(restore().pickRestorableResult(value), null);
});

test('a placed piece without finite coordinates refuses the whole result', () => {
  const saved = savedResult();
  saved.placedPieces[0].x = null;
  assert.equal(restore().pickRestorableResult(saved), null);
});

test('missing offcuts and unplaced pieces are read as none', () => {
  const saved = savedResult();
  delete saved.offcuts;
  delete saved.unplacedPieces;
  const result = restore().pickRestorableResult(saved);
  assert.deepEqual(result.offcuts, []);
  assert.deepEqual(result.unplacedPieces, []);
});
