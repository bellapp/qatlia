const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const { loadTsModule } = require('./helpers/load-ts-module');

const {
  areaLowerBoundSheets,
  buildOptimizerInput,
  expandedPieceCount,
  loadAllBenchmarkFixtures,
  loadBenchmarkFixture,
  sourceRowCount,
  totalPieceAreaCm2,
} = require('./helpers/benchmark-fixtures');

const SCRIPT = path.resolve('scripts/benchmark-optimizer.mjs');

/** Loads the runner's own pure functions, so audit logic can be unit-tested against a controlled/mutated result instead of only through a full subprocess run. */
function loadBenchmarkModule() {
  return import(pathToFileURL(SCRIPT).href);
}

function runBenchmarkScript(args = []) {
  return execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd: path.resolve('.') });
}

function runBenchmarkScriptExpectingFailure(args = []) {
  try {
    execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd: path.resolve('.'), stdio: 'pipe' });
  } catch (error) {
    return { status: error.status, stdout: String(error.stdout || ''), stderr: String(error.stderr || '') };
  }
  return null;
}

function decimalsOf(value) {
  const text = String(value);
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

test('the benchmark runner is exposed as an npm script', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));

  assert.equal(pkg.scripts['benchmark:optimizer'], 'node scripts/benchmark-optimizer.mjs');
});

test('the benchmark runner is deterministic: two real runs produce byte-identical output', () => {
  const first = runBenchmarkScript();
  const second = runBenchmarkScript();

  assert.equal(first, second, 'Two runs of the benchmark must produce identical output');
  // The only dates allowed in the report are the fixtures' own declared
  // capture dates; a run timestamp would make the output uncomparable.
  for (const field of ['generatedAt', 'runAt', 'timestamp', 'durationMs']) {
    assert.equal(first.includes(field), false, `Output must not carry a per-run "${field}" field`);
  }
});

test('the benchmark runner reports every checked-in fixture', () => {
  const report = JSON.parse(runBenchmarkScript());
  const fixtures = loadAllBenchmarkFixtures();

  assert.equal(report.schemaVersion, 1);
  assert.deepEqual(report.fixtures.map((entry) => entry.id), fixtures.map((fixture) => fixture.id));
  assert.deepEqual(report.failures, []);
});

test('every reported fixture carries its identity, provenance and exact input parameters', () => {
  const report = JSON.parse(runBenchmarkScript());

  for (const entry of report.fixtures) {
    const fixture = loadBenchmarkFixture(entry.id);

    assert.equal(entry.version, fixture.version);
    assert.equal(entry.label, fixture.label);
    assert.equal(entry.source.origin, fixture.source.origin);
    assert.equal(entry.source.capturedAt, fixture.source.capturedAt);

    assert.equal(entry.input.sheetHeightCm, fixture.sheet.height);
    assert.equal(entry.input.sheetWidthCm, fixture.sheet.width);
    assert.equal(entry.input.kerfCm, fixture.sheet.kerf);
    assert.equal(entry.input.marginCm, fixture.sheet.margin);
    assert.equal(entry.input.rotationAllowed, true);
    assert.equal(entry.input.materialSeparation, false);
    assert.equal(entry.input.grainLocked, false);
    assert.equal(entry.input.objective, 'linear_guillotine');
    assert.equal(entry.input.sourceRows, sourceRowCount(fixture));
    assert.equal(entry.input.expandedPieces, expandedPieceCount(fixture));
    assert.ok(Math.abs(entry.input.totalPieceAreaM2 - totalPieceAreaCm2(fixture) / 10000) < 5e-4);
  }
});

test('every reported fixture publishes the optimistic area lower bound and what it excludes', () => {
  const report = JSON.parse(runBenchmarkScript());

  for (const entry of report.fixtures) {
    const fixture = loadBenchmarkFixture(entry.id);

    assert.equal(entry.lowerBound.sheets, areaLowerBoundSheets(fixture));
    assert.match(entry.lowerBound.basis, /usable inner rectangle/i);
    assert.ok(
      entry.lowerBound.excludes.some((item) => /kerf/i.test(item)),
      'The lower bound must state that it excludes kerf loss'
    );
    assert.ok(
      entry.lowerBound.excludes.some((item) => /packing/i.test(item)),
      'The lower bound must state that it excludes packing constraints'
    );
    assert.ok(entry.result.sheetsUsed >= entry.lowerBound.sheets, 'A real plan can never beat the area lower bound');
  }
});

test('every reported fixture publishes the measured plan, utilization and explanation metadata', () => {
  const report = JSON.parse(runBenchmarkScript());

  for (const entry of report.fixtures) {
    const fixture = loadBenchmarkFixture(entry.id);

    assert.ok(Number.isInteger(entry.result.sheetsUsed) && entry.result.sheetsUsed > 0);
    assert.equal(entry.result.placedPieces + entry.result.unplacedPieces, expandedPieceCount(fixture), 'Every expanded piece must be accounted for as placed or unplaced');
    assert.equal(entry.result.unplacedPieces, 0);
    assert.ok(entry.result.utilizationPercent > 0 && entry.result.utilizationPercent <= 100);
    assert.ok(Math.abs(entry.result.utilizationPercent + entry.result.wastePercent - 100) < 0.11, 'Utilization and waste must sum to 100');
    assert.match(entry.result.utilizationBasis, /sheet/i);
    assert.ok(entry.result.candidatesEvaluated > 0);
    assert.ok(Array.isArray(entry.result.activeConstraints));
    assert.equal(entry.result.chosenGoal, 'linear_guillotine');

    assert.equal(entry.thresholds.maxSheets, fixture.thresholds.maxSheets);
    assert.ok(entry.result.sheetsUsed <= fixture.thresholds.maxSheets);
    assert.deepEqual(entry.checks, {
      allPiecesAccountedFor: true,
      placedPiecesMatchSheets: true,
      sheetsUsedMatchesSheetCount: true,
      validSheetIndices: true,
      everyPieceWithinSheet: true,
      noOverlappingPieces: true,
      offcutsWithinBoundsNoOverlap: true,
      utilizationMatchesGeometry: true,
      withinSheetThreshold: true,
      withinUnplacedThreshold: true,
      thresholdAtOrAboveLowerBound: true,
    });
  }
});

test('the benchmark runner states its rounding rules and honours them', () => {
  const report = JSON.parse(runBenchmarkScript());

  assert.equal(report.rounding.areaM2Decimals, 4);
  assert.equal(report.rounding.percentDecimals, 1);
  assert.equal(report.rounding.lengthMDecimals, 1);

  for (const entry of report.fixtures) {
    assert.ok(decimalsOf(entry.input.totalPieceAreaM2) <= 4);
    assert.ok(decimalsOf(entry.lowerBound.usableSheetAreaM2) <= 4);
    assert.ok(decimalsOf(entry.result.utilizationPercent) <= 1);
    assert.ok(decimalsOf(entry.result.wastePercent) <= 1);
    assert.ok(decimalsOf(entry.result.totalLinearCutMeters) <= 1);
  }
});

test('the benchmark runner can also emit a Markdown report from the same measurements', () => {
  const markdown = runBenchmarkScript(['--format=markdown']);
  const report = JSON.parse(runBenchmarkScript());

  for (const entry of report.fixtures) {
    assert.ok(markdown.includes(entry.id), `Markdown report must mention ${entry.id}`);
    assert.ok(markdown.includes(String(entry.result.sheetsUsed)), `Markdown report must carry the measured sheet count for ${entry.id}`);
  }
  assert.match(markdown, /\|/, 'Markdown report must be tabular');
});

test('the benchmark runner exits non-zero when a fixture breaks its published threshold', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qatlia-benchmark-'));
  try {
    const fixture = loadBenchmarkFixture('standard-135');
    fixture.thresholds = { maxSheets: 1, maxUnplaced: 0 };
    fs.writeFileSync(path.join(tempDir, 'standard-135.json'), JSON.stringify(fixture, null, 2));

    const failure = runBenchmarkScriptExpectingFailure([`--fixtures-dir=${tempDir}`]);

    assert.ok(failure, 'The runner must fail when a threshold is broken');
    assert.equal(failure.status, 1);
    assert.match(failure.stderr, /standard-135/);
    const report = JSON.parse(failure.stdout);
    assert.equal(report.failures.length > 0, true);
    assert.equal(report.fixtures[0].checks.withinSheetThreshold, false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('measureFixture rounds wastePercent and utilizationPercent independently from the raw wastePercentage, without double-rounding', async () => {
  const { measureFixture } = await loadBenchmarkModule();
  const { optimizeCutting2D } = loadTsModule(path.resolve('src/lib/cutting/binpacking.ts'));
  const fixture = loadBenchmarkFixture('standard-16');
  const input = buildOptimizerInput(fixture);
  const realResult = optimizeCutting2D(input.pieces, input.sheets, input.options);

  // A raw wastePercentage ending exactly on a rounding boundary (x.x5) is the
  // case that exposes double-rounding: round(16.25, 1) is 16.3, so deriving
  // utilization as 100 - 16.3 gives 83.7 — but rounding utilization straight
  // from the raw value, round(100 - 16.25, 1), gives 83.8. Both figures must
  // be rounded once each, from the same raw number, not chained through one
  // another.
  const syntheticResult = { ...structuredClone(realResult), wastePercentage: 16.25 };
  const entry = measureFixture(() => syntheticResult, fixture);

  assert.equal(entry.result.wastePercent, 16.3);
  assert.equal(entry.result.utilizationPercent, 83.8, 'utilizationPercent must be rounded from the raw waste, not from the already-rounded wastePercent');
  assert.ok(
    Math.abs(entry.result.wastePercent + entry.result.utilizationPercent - 100) > 0.05,
    'sanity check: this synthetic case must actually produce figures that do not sum to exactly 100, proving no double-rounding coincidence'
  );
});

test('auditPlan ties placedPieces exactly to the flattened sheets, sheetsUsed to sheets.length, and validates sheet indices — proven on controlled mutations of a real result', async () => {
  const { auditPlan } = await loadBenchmarkModule();
  const { optimizeCutting2D } = loadTsModule(path.resolve('src/lib/cutting/binpacking.ts'));
  const fixture = loadBenchmarkFixture('standard-16');
  const input = buildOptimizerInput(fixture);
  const result = optimizeCutting2D(input.pieces, input.sheets, input.options);

  const baseline = auditPlan(fixture, result);
  assert.equal(baseline.allPiecesAccountedFor, true);
  assert.equal(baseline.placedPiecesMatchSheets, true);
  assert.equal(baseline.sheetsUsedMatchesSheetCount, true);
  assert.equal(baseline.validSheetIndices, true);
  assert.equal(baseline.thresholdAtOrAboveLowerBound, true);

  // A placedPieces entry claims a piece id that does not actually appear
  // anywhere in the flattened sheets — the exact fabrication the old audit,
  // which only cross-checked placedPieces/unplacedPieces against each other,
  // could never catch.
  const fabricatedPlacedId = structuredClone(result);
  fabricatedPlacedId.placedPieces = fabricatedPlacedId.placedPieces.map((piece, index) =>
    index === 0 ? { ...piece, pieceId: 'not-a-real-piece' } : piece
  );
  const afterFabricatedId = auditPlan(fixture, fabricatedPlacedId);
  assert.equal(afterFabricatedId.placedPiecesMatchSheets, false, 'placedPieces must be tied exactly to the flattened sheets');
  assert.equal(afterFabricatedId.allPiecesAccountedFor, true, 'the fabrication must not be masked by the pre-existing count check');

  // sheetsUsed disagrees with the actual number of sheets in the plan.
  const fabricatedSheetsUsed = structuredClone(result);
  fabricatedSheetsUsed.sheetsUsed = result.sheetsUsed + 1;
  assert.equal(auditPlan(fixture, fabricatedSheetsUsed).sheetsUsedMatchesSheetCount, false, 'sheetsUsed must equal sheets.length');

  // Two sheets claim the same index.
  const fabricatedSheetIndex = structuredClone(result);
  fabricatedSheetIndex.sheets[0].index = fabricatedSheetIndex.sheets[fabricatedSheetIndex.sheets.length - 1].index;
  assert.equal(auditPlan(fixture, fabricatedSheetIndex).validSheetIndices, false, 'sheet indices must be unique and match their position');

  // A piece's own sheetIndex disagrees with the sheet it is nested under.
  const fabricatedPieceSheetIndex = structuredClone(result);
  fabricatedPieceSheetIndex.sheets[0].pieces[0].sheetIndex = fabricatedPieceSheetIndex.sheets.length;
  assert.equal(auditPlan(fixture, fabricatedPieceSheetIndex).validSheetIndices, false, "a piece's sheetIndex must match the sheet it is placed on");

  // A published ceiling set below the mathematically required area lower bound.
  const fabricatedFixture = structuredClone(fixture);
  fabricatedFixture.thresholds = { ...fabricatedFixture.thresholds, maxSheets: 0 };
  assert.equal(
    auditPlan(fabricatedFixture, result).thresholdAtOrAboveLowerBound,
    false,
    'a threshold set below the area lower bound must fail the check'
  );
});

test('auditPlan enforces the canonical sheet margin on all four sides, not just the raw sheet bounds', async () => {
  const { auditPlan } = await loadBenchmarkModule();
  const { optimizeCutting2D } = loadTsModule(path.resolve('src/lib/cutting/binpacking.ts'));
  const fixture = loadBenchmarkFixture('standard-16');
  const input = buildOptimizerInput(fixture);
  const result = optimizeCutting2D(input.pieces, input.sheets, input.options);

  assert.equal(auditPlan(fixture, result).everyPieceWithinSheet, true);
  assert.ok(fixture.sheet.margin > 0, 'this test is only meaningful when the fixture has a positive margin');

  const piece = result.sheets[0].pieces[0];

  // Moved flush to the raw sheet edge: inside the full sheet, but inside the
  // forbidden margin band the old (margin-unaware) bounds check missed.
  const violatesLeftMargin = structuredClone(result);
  violatesLeftMargin.sheets[0].pieces[0].x = 0;
  assert.equal(auditPlan(fixture, violatesLeftMargin).everyPieceWithinSheet, false, 'x < margin must fail');

  const violatesTopMargin = structuredClone(result);
  violatesTopMargin.sheets[0].pieces[0].y = 0;
  assert.equal(auditPlan(fixture, violatesTopMargin).everyPieceWithinSheet, false, 'y < margin must fail');

  const violatesRightMargin = structuredClone(result);
  violatesRightMargin.sheets[0].pieces[0].x = violatesRightMargin.sheets[0].width - piece.width;
  assert.equal(
    auditPlan(fixture, violatesRightMargin).everyPieceWithinSheet,
    false,
    'x + width > width - margin must fail'
  );

  const violatesBottomMargin = structuredClone(result);
  violatesBottomMargin.sheets[0].pieces[0].y = violatesBottomMargin.sheets[0].height - piece.height;
  assert.equal(
    auditPlan(fixture, violatesBottomMargin).everyPieceWithinSheet,
    false,
    'y + height > height - margin must fail'
  );
});

test('auditPlan derives utilization independently and audits offcuts for margin/overlap/area sanity', async () => {
  const { auditPlan } = await loadBenchmarkModule();
  const { optimizeCutting2D } = loadTsModule(path.resolve('src/lib/cutting/binpacking.ts'));
  const fixture = loadBenchmarkFixture('standard-16');
  const input = buildOptimizerInput(fixture);
  const result = optimizeCutting2D(input.pieces, input.sheets, input.options);

  const baseline = auditPlan(fixture, result);
  assert.equal(baseline.utilizationMatchesGeometry, true);
  assert.equal(baseline.offcutsWithinBoundsNoOverlap, true);

  // An offcut that overlaps a placed piece on the same sheet.
  const overlappingOffcut = structuredClone(result);
  const targetPiece = overlappingOffcut.sheets[0].pieces[0];
  overlappingOffcut.sheets[0].offcuts.push({
    id: 'fabricated_offcut',
    x: targetPiece.x,
    y: targetPiece.y,
    width: 5,
    height: 5,
    sheetIndex: 0,
    areaM2: 0.0025,
    isReusable: false,
  });
  assert.equal(
    auditPlan(fixture, overlappingOffcut).offcutsWithinBoundsNoOverlap,
    false,
    'an offcut overlapping a placed piece must fail'
  );

  // An offcut placed outside the margin band.
  const offcutOutsideMargin = structuredClone(result);
  offcutOutsideMargin.sheets[0].offcuts.push({
    id: 'fabricated_offcut_2',
    x: -1,
    y: 0,
    width: 5,
    height: 5,
    sheetIndex: 0,
    areaM2: 0.0025,
    isReusable: false,
  });
  assert.equal(
    auditPlan(fixture, offcutOutsideMargin).offcutsWithinBoundsNoOverlap,
    false,
    'an offcut outside the margin band must fail'
  );

  // A fabricated wastePercentage that disagrees with the plan's own geometry.
  const fabricatedWaste = structuredClone(result);
  fabricatedWaste.wastePercentage = 0;
  assert.equal(
    auditPlan(fixture, fabricatedWaste).utilizationMatchesGeometry,
    false,
    'a wastePercentage that disagrees with the placed/gross-area geometry must fail'
  );
});
