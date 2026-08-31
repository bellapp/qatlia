const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');
const {
  buildOptimizerInput,
  expandedPieceCount,
  loadBenchmarkFixture,
  sourceRowCount,
} = require('./helpers/benchmark-fixtures');

// Benchmark input comes from the immutable fixtures checked in under
// `tests/fixtures/benchmarks/` — never from a machine-local file — so this
// suite reproduces identically on any clone. Fixture provenance, byte
// stability and canonical-parameter checks live in
// `tests/benchmark-fixtures.test.js`.
function loadDataset1BenchmarkInput() {
  return loadBenchmarkFixture('standard-135');
}

function loadDataset2BenchmarkInput() {
  return loadBenchmarkFixture('standard-16');
}

function rectanglesOverlap(a, b, epsilon = 1e-9) {
  return (
    a.x < b.x + b.width - epsilon &&
    a.x + a.width > b.x + epsilon &&
    a.y < b.y + b.height - epsilon &&
    a.y + a.height > b.y + epsilon
  );
}

function assertOptimizationInvariants(result, sheet, expectedExpandedCount) {
  assert.equal(result.placedPieces.length + result.unplacedPieces.length, expectedExpandedCount, 'Every expanded piece must be placed or unplaced exactly once');

  const placedIds = result.placedPieces.map((piece) => piece.pieceId);
  const unplacedIds = result.unplacedPieces.map((piece) => piece.id);
  const allIds = [...placedIds, ...unplacedIds];

  assert.equal(new Set(placedIds).size, placedIds.length, 'Placed piece IDs must be unique');
  assert.equal(new Set(unplacedIds).size, unplacedIds.length, 'Unplaced piece IDs must be unique');
  assert.equal(new Set(allIds).size, expectedExpandedCount, 'Placed and unplaced IDs must partition the expanded pieces');

  // Matches the runner's own margin-band check in `auditPlan`
  // (scripts/benchmark-optimizer.mjs) and the methodology documented in
  // docs/optimizer-benchmark.md: a piece flush with the raw sheet edge is
  // inside the sheet but inside the forbidden margin band, so the bound is
  // the margin, not 0/width/height.
  const margin = Math.max(0, sheet.margin || 0);
  const seenPieceNumbers = new Set();
  for (const placed of result.placedPieces) {
    assert.ok(Number.isInteger(placed.pieceNumber) && placed.pieceNumber > 0, `Piece ${placed.pieceId} must have a positive integer piece number`);
    assert.equal(seenPieceNumbers.has(placed.pieceNumber), false, `Piece number ${placed.pieceNumber} must be unique`);
    seenPieceNumbers.add(placed.pieceNumber);

    assert.ok(placed.x >= margin - 1e-9, `Piece ${placed.pieceId} must stay outside the sheet's left margin`);
    assert.ok(placed.y >= margin - 1e-9, `Piece ${placed.pieceId} must stay outside the sheet's top margin`);
    assert.ok(placed.x + placed.width <= sheet.width - margin + 1e-9, `Piece ${placed.pieceId} exceeds sheet width margin`);
    assert.ok(placed.y + placed.height <= sheet.height - margin + 1e-9, `Piece ${placed.pieceId} exceeds sheet height margin`);
  }

  for (const currentSheet of result.sheets) {
    const sheetArea = currentSheet.width * currentSheet.height;
    assert.ok(currentSheet.usedArea <= sheetArea + 1e-9, `Sheet ${currentSheet.index} used area exceeds capacity`);
    assert.ok(currentSheet.wasteRate >= 0 && currentSheet.wasteRate <= 100, `Sheet ${currentSheet.index} waste must stay within 0..100`);

    for (let i = 0; i < currentSheet.pieces.length; i += 1) {
      for (let j = i + 1; j < currentSheet.pieces.length; j += 1) {
        assert.equal(
          rectanglesOverlap(currentSheet.pieces[i], currentSheet.pieces[j]),
          false,
          `Pieces ${currentSheet.pieces[i].pieceId} and ${currentSheet.pieces[j].pieceId} overlap on sheet ${currentSheet.index}`
        );
      }
    }

    const offcuts = currentSheet.offcuts || [];
    for (const off of offcuts) {
      assert.ok(off.width > 0 && off.height > 0 && off.areaM2 > 0, `Offcut ${off.id} on sheet ${currentSheet.index} must have positive geometry`);
      assert.ok(off.x >= 0 && off.y >= 0, `Offcut ${off.id} on sheet ${currentSheet.index} must stay within the sheet`);
      assert.ok(off.x + off.width <= currentSheet.width + 1e-9, `Offcut ${off.id} exceeds sheet width`);
      assert.ok(off.y + off.height <= currentSheet.height + 1e-9, `Offcut ${off.id} exceeds sheet height`);

      for (const piece of currentSheet.pieces) {
        assert.equal(rectanglesOverlap(off, piece), false, `Offcut ${off.id} overlaps placed piece ${piece.pieceId} on sheet ${currentSheet.index}`);
      }
    }
    for (let i = 0; i < offcuts.length; i += 1) {
      for (let j = i + 1; j < offcuts.length; j += 1) {
        assert.equal(rectanglesOverlap(offcuts[i], offcuts[j]), false, `Offcuts ${offcuts[i].id} and ${offcuts[j].id} overlap on sheet ${currentSheet.index}`);
      }
    }

    const placedArea = currentSheet.pieces.reduce((sum, p) => sum + p.width * p.height, 0);
    const offcutArea = offcuts.reduce((sum, o) => sum + o.width * o.height, 0);
    assert.ok(placedArea + offcutArea <= sheetArea + 1e-9, `Sheet ${currentSheet.index} placed + offcut area must not exceed sheet area`);
  }

  assert.deepEqual(result.offcuts, result.sheets.flatMap((s) => s.offcuts), 'Aggregate offcuts must equal the concatenation of per-sheet offcuts');
  assert.ok(result.wastePercentage >= 0 && result.wastePercentage <= 100, 'Overall waste must stay within 0..100');
}

function runBenchmark(benchmarkInput, overrideOptions = {}) {
  const { optimizeCutting2D } = loadTsModule('src/lib/cutting/binpacking.ts');
  const input = buildOptimizerInput(benchmarkInput);
  const expectedExpandedCount = expandedPieceCount(benchmarkInput);
  const mergedOptions = { ...input.options, ...overrideOptions };
  const result = optimizeCutting2D(input.pieces, input.sheets, mergedOptions);

  return { result, expectedExpandedCount, mergedOptions };
}

test('2D optimizer preserves placement invariants on dataset 1 with the 208x278 benchmark sheet', () => {
  const benchmarkInput = loadDataset1BenchmarkInput();
  const { result, expectedExpandedCount } = runBenchmark(benchmarkInput);

  assert.equal(sourceRowCount(benchmarkInput), 21, 'Dataset 1 must carry the 21 source rows');
  assert.equal(expectedExpandedCount, 135, 'Dataset 1 must expand to 135 pieces');
  assert.ok(result.sheetsUsed > 1, 'Unlimited multi-sheet mode should allocate more than one sheet for dataset 1');
  assertOptimizationInvariants(result, benchmarkInput.sheet, expectedExpandedCount);
});

test('singleSheetOnly leaves overflow unplaced on dataset 1 with the 208x278 benchmark sheet', () => {
  const benchmarkInput = loadDataset1BenchmarkInput();
  const { result, expectedExpandedCount } = runBenchmark(benchmarkInput, { singleSheetOnly: true });

  assert.ok(result.sheetsUsed <= 1, 'singleSheetOnly must not allocate additional sheets');
  assert.ok(result.unplacedPieces.length > 0, 'singleSheetOnly should leave overflow pieces unplaced for dataset 1');
  assertOptimizationInvariants(result, benchmarkInput.sheet, expectedExpandedCount);
});

test('dataset 1 benchmark packs all pieces within 4 sheets or better', () => {
  const benchmarkInput = loadDataset1BenchmarkInput();
  const { result, expectedExpandedCount } = runBenchmark(benchmarkInput);

  assert.equal(benchmarkInput.thresholds.maxSheets, 4, 'Dataset 1 publishes a 4-sheet ceiling');
  assert.equal(result.unplacedPieces.length, 0, 'Dataset 1 should place every expanded piece');
  assert.equal(result.placedPieces.length, expectedExpandedCount, 'Dataset 1 should place all expanded pieces');
  assert.ok(result.sheetsUsed <= 4, `Dataset 1 should use at most 4 sheets, received ${result.sheetsUsed}`);
  assertOptimizationInvariants(result, benchmarkInput.sheet, expectedExpandedCount);
});

test('dataset 2 benchmark packs all pieces within 2 sheets or better', () => {
  const benchmarkInput = loadDataset2BenchmarkInput();
  const { result, expectedExpandedCount } = runBenchmark(benchmarkInput);

  assert.equal(sourceRowCount(benchmarkInput), 5, 'Dataset 2 must carry the 5 source rows');
  assert.equal(expectedExpandedCount, 16, 'Dataset 2 must expand to 16 pieces');
  assert.equal(benchmarkInput.thresholds.maxSheets, 2, 'Dataset 2 publishes a 2-sheet ceiling');
  assert.equal(result.unplacedPieces.length, 0, 'Dataset 2 should place every expanded piece');
  assert.equal(result.placedPieces.length, expectedExpandedCount, 'Dataset 2 should place all expanded pieces');
  assert.ok(result.sheetsUsed <= 2, `Dataset 2 should use at most 2 sheets, received ${result.sheetsUsed}`);
  assertOptimizationInvariants(result, benchmarkInput.sheet, expectedExpandedCount);
});

test('dataset 2 benchmark exposes explanation metadata matching the linear_guillotine priority without regressing sheet count', () => {
  const benchmarkInput = loadDataset2BenchmarkInput();
  const { result, expectedExpandedCount, mergedOptions } = runBenchmark(benchmarkInput);

  assert.equal(mergedOptions.optimizationPriority, 'linear_guillotine');
  assert.ok(result.explanation, 'result must carry explanation metadata');
  assert.equal(result.explanation.chosenGoal, 'linear_guillotine');
  assert.ok(Array.isArray(result.explanation.activeConstraints));
  assert.ok(result.explanation.candidatesEvaluated > 0);
  assert.ok(result.sheetsUsed <= 2, `dataset 2 must still use at most 2 sheets under linear_guillotine, received ${result.sheetsUsed}`);
  assertOptimizationInvariants(result, benchmarkInput.sheet, expectedExpandedCount);
});

test('optimize API route is wired to optimizeCutting2D', () => {
  const routeSource = fs.readFileSync(path.resolve('src/app/api/optimize/route.ts'), 'utf8');

  assert.match(routeSource, /import\s*\{\s*optimizeCutting2D\b/, 'Route must import optimizeCutting2D');
  // Task 2 (item 3): the route now supports multi-stock `sheets` alongside
  // the legacy single `sheet`, so it must call optimizeCutting2D with a
  // sheets array derived from `sheets ?? (sheet ? [sheet] : [])`, not a
  // hardcoded `[sheet]` (which would throw if `sheet` were undefined).
  assert.match(routeSource, /sheets\s*\?\?\s*\(\s*sheet\s*\?\s*\[sheet\]\s*:\s*\[\]\s*\)/, 'Route must safely fall back to `(sheet ? [sheet] : [])` when `sheets` is absent');
  assert.match(routeSource, /optimizeCutting2D\s*\(\s*pieces as Piece\[\],\s*stockSheets as Sheet\[\]/, 'Route must call optimizeCutting2D with the resolved sheets array');
});
