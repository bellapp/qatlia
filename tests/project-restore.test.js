const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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

test('a sheet that is not an object refuses the result', () => {
  const saved = savedResult();
  saved.sheets = [null];
  assert.equal(restore().pickRestorableResult(saved), null);
});

test('fewer sheets than sheetsUsed refuses the result', () => {
  const saved = savedResult();
  saved.sheetsUsed = saved.sheets.length + 1;
  assert.equal(restore().pickRestorableResult(saved), null);
});

test('a piece placed on a sheet beyond sheetsUsed refuses the result', () => {
  const saved = savedResult();
  saved.placedPieces[0].sheetIndex = saved.sheetsUsed;
  assert.equal(restore().pickRestorableResult(saved), null);
});

test('the cost breakdown is returned by reference', () => {
  const saved = savedResult();
  assert.ok(saved.costBreakdown, 'a real result carries a cost breakdown');
  const result = restore().pickRestorableResult(saved);
  assert.equal(result.costBreakdown, saved.costBreakdown);
});

const atelierSource = () => fs.readFileSync(path.resolve('src/app/(site)/atelier/page.tsx'), 'utf8');
const historySource = () => fs.readFileSync(path.resolve('src/app/(site)/history/page.tsx'), 'utf8');

test('the atelier puts the saved plan and the scan back on screen', () => {
  const page = atelierSource();
  assert.match(page, /const restoredResult = pickRestorableResult\(parsed\.result\);/);
  assert.match(page, /if \(restoredResult\) \{\s*setResult\(restoredResult\);\s*setActiveSheetIndex\(0\);/);
  assert.match(page, /setPreviewImage\(restoredThumb\)/);
});

test('the history writes the save date and the atelier reads it, then clears it like the other keys', () => {
  assert.match(historySource(), /sessionStorage\.setItem\('qatlia_restored_project_meta'/);
  const page = atelierSource();
  assert.match(page, /sessionStorage\.getItem\('qatlia_restored_project_meta'\)/);
  // Removed after the timeout in the success branch, at once in the catch branch.
  assert.equal(page.match(/sessionStorage\.removeItem\('qatlia_restored_project_meta'\)/g).length, 2);
});

test('a successful optimization takes the "reopened as saved" notice away', () => {
  assert.match(atelierSource(), /setResult\(optResult\);\s*setRestoredAt\(null\);/);
});

test('the save date left by the history is read back only when it is a date', () => {
  const { readRestoredProjectDate } = restore();
  assert.equal(readRestoredProjectDate(JSON.stringify({ createdAt: '2026-11-14T09:30:00.000Z' })), '2026-11-14T09:30:00.000Z');
  for (const raw of [null, '', 'not json', '[]', '{}', JSON.stringify({ createdAt: 42 }), JSON.stringify({ createdAt: 'yesterday' })]) {
    assert.equal(readRestoredProjectDate(raw), null);
  }
});
