const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// Task 4 blocker (2): `totalLinearCutMeters` used to be a fabricated
// per-sheet-perimeter sum ((sheet.width + sheet.height) / 100 for every used
// sheet) rather than a measurement of any real saw pass. It must instead be
// derived from `SheetResult.cuts` — the actual `CutInstruction`s the
// guillotine packer produced while splitting free rectangles to free up
// each placed piece — summed across every *used* sheet and divided by 100.

function loadBinpacking() {
  return loadTsModule('src/lib/cutting/binpacking.ts');
}

test('a single piece that exactly fills the sheet needs zero interior cuts', () => {
  const { optimizeCutting2D } = loadBinpacking();
  const sheet = { width: 100, height: 100, kerf: 0, margin: 0, material: 'mdf', quantity: 1 };
  const pieces = [{ id: 'p1', width: 100, height: 100, quantity: 1, rotatable: false }];

  const result = optimizeCutting2D(pieces, [sheet], {});

  assert.equal(result.sheetsUsed, 1);
  assert.deepEqual(result.sheets[0].cuts, [], 'a piece that consumes the whole free rectangle needs no split cut');
  assert.equal(result.totalLinearCutMeters, 0, 'zero real cuts must report zero linear cut meters, not a fabricated perimeter of 2m');
});

test('two half-sheet pieces require exactly one measured cut, whichever packing strategy wins', () => {
  const { optimizeCutting2D } = loadBinpacking();
  const sheet = { width: 100, height: 100, kerf: 0, margin: 0, material: 'mdf', quantity: 1 };
  // Each piece exactly fills the full sheet width and half its height, so
  // every packing strategy (rows or columns axis) produces the identical,
  // strategy-independent layout: one shelf-separating cut of length 100cm.
  const pieces = [{ id: 'p1', width: 100, height: 50, quantity: 2, rotatable: false }];

  const result = optimizeCutting2D(pieces, [sheet], {});

  assert.equal(result.sheetsUsed, 1);
  assert.equal(result.unplacedPieces.length, 0);
  const cuts = result.sheets[0].cuts;
  assert.equal(cuts.length, 1, 'exactly one guillotine cut separates the two half-sheet pieces');
  assert.equal(cuts[0].lengthCm, 100);
  assert.equal(cuts[0].sheetIndex, 0);
  // 100cm / 100 = 1m — not the old fabricated (100+100)/100 = 2m perimeter sum.
  assert.equal(result.totalLinearCutMeters, 1);
});

test('totalLinearCutMeters sums CutInstruction lengths across every used sheet, not just the first', () => {
  const { optimizeCutting2D } = loadBinpacking();
  const sheet = { width: 100, height: 50, kerf: 0, margin: 0, material: 'mdf', quantity: 2 };
  // Each piece exactly fills one whole sheet (100x50) on its own — this forces
  // exactly 2 sheets used, each with 0 interior cuts, so the aggregate must
  // stay 0 rather than accumulate a fabricated per-sheet perimeter.
  const pieces = [{ id: 'p1', width: 100, height: 50, quantity: 2, rotatable: false }];

  const result = optimizeCutting2D(pieces, [sheet], {});

  assert.equal(result.sheetsUsed, 2);
  assert.equal(result.totalLinearCutMeters, 0);
});

test('CutInstruction basis: a per_meter labor charge is reported measured because cut length comes from real CutInstructions', () => {
  const { optimizeCutting2D } = loadBinpacking();
  const sheet = { width: 100, height: 100, kerf: 0, margin: 0, material: 'mdf', quantity: 1 };
  const pieces = [{ id: 'p1', width: 100, height: 50, quantity: 2, rotatable: false }];

  const result = optimizeCutting2D(pieces, [sheet], { laborPricing: { mode: 'per_meter', value: 10 } });

  assert.equal(result.totalLinearCutMeters, 1);
  assert.equal(result.costBreakdown.laborCost, 10, '10 MAD/m x 1m of real cuts');
  assert.equal(result.costBreakdown.laborCostBasis, 'measured');
});

test('binpacking.ts no longer derives totalLinearCutMeters from a per-sheet perimeter sum', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.resolve('src/lib/cutting/binpacking.ts'), 'utf8');
  assert.doesNotMatch(source, /sheet\.width\s*\+\s*sheet\.height/, 'the fabricated perimeter-sum formula must be removed');
  assert.match(source, /CutInstruction/, 'binpacking.ts must define/use CutInstruction records for the real cut length');
});
