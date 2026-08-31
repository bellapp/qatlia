const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  BENCHMARK_FIXTURE_IDS,
  BENCHMARK_FIXTURES_DIR,
  CANONICAL_BENCHMARK_OPTIONS,
  CANONICAL_BENCHMARK_SHEET,
  expandedPieceCount,
  listBenchmarkFixtureFiles,
  loadAllBenchmarkFixtures,
  loadBenchmarkFixture,
  sourceRowCount,
  totalPieceAreaCm2,
} = require('./helpers/benchmark-fixtures');

// Task 6 slice 1. The published benchmark must be reproducible by anyone who
// clones the repository, so the fixtures live in-tree and are pinned by
// content hash. These digests are the "immutable" part: editing a fixture in
// place — silently changing what a published number was measured on — fails
// here instead of quietly re-baselining the marketing evidence.
const PINNED_FIXTURE_SHA256 = {
  'standard-135': '4747f7a856f4b837d115b39b9eea4c2a86b22647bc942f96627b62cbd08df319',
  'standard-16': 'ab606842f681fa8f3250697f93a3bdf7e2804e5778d54698460119471c905f60',
};

function sha256OfFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

test('the optimizer regression suite carries no machine-local benchmark dependency', () => {
  const source = fs.readFileSync(path.resolve('tests/optimizer-regression.test.js'), 'utf8');

  assert.equal(/(^|[^\w])\/home\//.test(source), false, 'Regression suite must not reference an absolute /home/... path');
  assert.equal(source.includes('.hermes'), false, 'Regression suite must not depend on the .hermes cache');
  assert.equal(source.includes('EACCES'), false, 'Regression suite must not carry a permission-error fallback path');
  assert.equal(/\bcache\b/.test(source), false, 'Regression suite must not read benchmark input from any cache');
  assert.match(
    source,
    /require\('\.\/helpers\/benchmark-fixtures'\)/,
    'Regression suite must load its benchmark input from the checked-in fixture loader'
  );
});

test('exactly the two publishable benchmark fixtures are checked in', () => {
  assert.deepEqual(BENCHMARK_FIXTURE_IDS, ['standard-16', 'standard-135'].sort());
  assert.deepEqual(
    listBenchmarkFixtureFiles().map((file) => path.basename(file)),
    ['standard-135.json', 'standard-16.json'],
    'The fixtures directory must hold exactly the two published fixtures, sorted deterministically'
  );
});

test('every benchmark fixture is byte-stable against its pinned digest', () => {
  for (const id of BENCHMARK_FIXTURE_IDS) {
    const filePath = path.join(BENCHMARK_FIXTURES_DIR, `${id}.json`);
    assert.equal(
      sha256OfFile(filePath),
      PINNED_FIXTURE_SHA256[id],
      `Fixture ${id}.json changed content; published benchmark numbers no longer describe it`
    );
  }
});

test('every benchmark fixture declares complete provenance metadata', () => {
  for (const fixture of loadAllBenchmarkFixtures()) {
    assert.equal(typeof fixture.id, 'string');
    assert.match(fixture.version, /^\d+\.\d+\.\d+$/, `Fixture ${fixture.id} needs a semantic version`);
    assert.ok(fixture.label && fixture.label.length > 0, `Fixture ${fixture.id} needs a human label`);
    assert.ok(fixture.source && typeof fixture.source.origin === 'string' && fixture.source.origin.length > 0, `Fixture ${fixture.id} needs a source origin`);
    assert.match(fixture.source.capturedAt, /^\d{4}-\d{2}-\d{2}T/, `Fixture ${fixture.id} needs an ISO capture date`);
    assert.ok(fixture.source.note && fixture.source.note.length > 0, `Fixture ${fixture.id} needs a provenance note`);
  }
});

test('every benchmark fixture uses the identical canonical benchmark parameters', () => {
  for (const fixture of loadAllBenchmarkFixtures()) {
    assert.deepEqual(fixture.sheet, CANONICAL_BENCHMARK_SHEET, `Fixture ${fixture.id} must use the canonical benchmark sheet`);
    assert.deepEqual(fixture.options, CANONICAL_BENCHMARK_OPTIONS, `Fixture ${fixture.id} must use the canonical benchmark options`);
    assert.equal(fixture.sheet.height, 278);
    assert.equal(fixture.sheet.width, 208);
    assert.equal(fixture.sheet.kerf, 0.3);
    assert.equal(fixture.sheet.margin, 1);
    assert.equal(fixture.sheet.grainDirection, false);
    assert.equal(fixture.options.grainDirection, false);
    assert.equal(fixture.options.considerMaterial, false);
    assert.equal(fixture.options.optimizationPriority, 'linear_guillotine');
    assert.ok(fixture.pieces.every((piece) => piece.rotatable === true), `Fixture ${fixture.id} must allow rotation on every row`);
  }
});

test('every benchmark fixture states its own row/piece counts and they match its data', () => {
  for (const fixture of loadAllBenchmarkFixtures()) {
    assert.equal(sourceRowCount(fixture), fixture.expected.sourceRows, `Fixture ${fixture.id} row count disagrees with its declared metadata`);
    assert.equal(expandedPieceCount(fixture), fixture.expected.expandedPieces, `Fixture ${fixture.id} expanded count disagrees with its declared metadata`);

    for (const piece of fixture.pieces) {
      assert.ok(Number.isFinite(piece.width) && piece.width > 0, `Fixture ${fixture.id} has a non-positive width`);
      assert.ok(Number.isFinite(piece.height) && piece.height > 0, `Fixture ${fixture.id} has a non-positive height`);
      assert.ok(Number.isInteger(piece.quantity) && piece.quantity > 0, `Fixture ${fixture.id} has a non-positive quantity`);
    }

    const uniqueIds = new Set(fixture.pieces.map((piece) => piece.id));
    assert.equal(uniqueIds.size, fixture.pieces.length, `Fixture ${fixture.id} must have unique row ids`);
  }
});

test('standard-135 is exactly the 21 saved source rows expanding to 135 pieces', () => {
  const fixture = loadBenchmarkFixture('standard-135');

  assert.equal(fixture.expected.sourceRows, 21);
  assert.equal(fixture.expected.expandedPieces, 135);
  assert.equal(fixture.pieces.length, 21);
  assert.equal(expandedPieceCount(fixture), 135);
  assert.equal(fixture.thresholds.maxSheets, 4);
  assert.equal(fixture.thresholds.maxUnplaced, 0);

  // Provenance, asserted rather than described: the geometry rows must be the
  // saved run's rows verbatim. Only the sheet/options differ, because the saved
  // run was executed on a different panel with grain locked.
  const savedRuns = JSON.parse(fs.readFileSync(path.resolve('saved_runs/test_runs.json'), 'utf8'));
  const savedRun = savedRuns.find((run) => run.id === 'run_01_somfy_notes_mdf');
  assert.ok(savedRun, 'saved_runs/test_runs.json must still carry run_01_somfy_notes_mdf');

  assert.deepEqual(
    fixture.pieces.map((piece) => ({ id: piece.id, name: piece.name, width: piece.width, height: piece.height, quantity: piece.quantity, material: piece.material, rotatable: piece.rotatable })),
    savedRun.input.pieces.map((piece) => ({ id: piece.id, name: piece.name, width: piece.width, height: piece.height, quantity: piece.quantity, material: piece.material, rotatable: piece.rotatable })),
    'standard-135 rows must be copied verbatim from run_01_somfy_notes_mdf'
  );
  assert.equal(fixture.source.origin, 'saved_runs/test_runs.json#run_01_somfy_notes_mdf');
});

test('standard-16 is exactly the historical 5-row dataset expanding to 16 pieces', () => {
  const fixture = loadBenchmarkFixture('standard-16');

  assert.equal(fixture.expected.sourceRows, 5);
  assert.equal(fixture.expected.expandedPieces, 16);
  assert.equal(fixture.thresholds.maxSheets, 2);
  assert.equal(fixture.thresholds.maxUnplaced, 0);

  // The rows the previous `loadDataset2BenchmarkInput` helper hard-coded, kept
  // here so moving them into a JSON file cannot silently alter them.
  assert.deepEqual(
    fixture.pieces,
    [
      { id: 'd2_1', name: 'Pièce 1', height: 230, width: 120, quantity: 2, material: 'mdf', rotatable: true },
      { id: 'd2_2', name: 'Pièce 2', height: 118, width: 48, quantity: 1, material: 'mdf', rotatable: true },
      { id: 'd2_3', name: 'Pièce 3', height: 41.8, width: 38, quantity: 7, material: 'mdf', rotatable: true },
      { id: 'd2_4', name: 'Pièce 4', height: 53.1, width: 48, quantity: 4, material: 'mdf', rotatable: true },
      { id: 'd2_5', name: 'Pièce 5', height: 51.3, width: 48, quantity: 2, material: 'mdf', rotatable: true },
    ],
    'standard-16 must preserve the checked-in dataset 2 rows verbatim'
  );
});

test('total piece area is computed from quantity-expanded rows in cm squared', () => {
  const fixture = loadBenchmarkFixture('standard-16');
  const expected = 230 * 120 * 2 + 118 * 48 + 41.8 * 38 * 7 + 53.1 * 48 * 4 + 51.3 * 48 * 2;

  assert.ok(Math.abs(totalPieceAreaCm2(fixture) - expected) < 1e-9);
});

test('loading an unknown fixture id fails loudly instead of returning a default', () => {
  assert.throws(() => loadBenchmarkFixture('does-not-exist'), /does-not-exist/);
});
