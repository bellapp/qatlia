/**
 * Loader for the published optimizer benchmark fixtures.
 *
 * Everything the benchmark is measured on lives in `tests/fixtures/benchmarks/`
 * and is loaded from the repository, never from a machine-local cache or an
 * external download: a clone of this repository is sufficient to reproduce
 * every number published in `docs/optimizer-benchmark.md`.
 *
 * This module is deliberately dependency-free CommonJS so that both the Node
 * test suite (`require`) and the ESM benchmark runner
 * (`scripts/benchmark-optimizer.mjs`, via `createRequire`) read the fixtures
 * through exactly the same code path.
 */
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const BENCHMARK_FIXTURES_DIR = path.join(PROJECT_ROOT, 'tests', 'fixtures', 'benchmarks');

/**
 * The one configuration every published fixture is measured under. Comparing
 * two optimizers is only meaningful at identical sheet size, kerf, margin,
 * rotation and material settings, so the fixtures are not allowed to vary it.
 */
const CANONICAL_BENCHMARK_SHEET = Object.freeze({
  height: 278,
  width: 208,
  kerf: 0.3,
  margin: 1,
  grainDirection: false,
  material: 'mdf',
  quantity: 1,
});

const CANONICAL_BENCHMARK_OPTIONS = Object.freeze({
  kerfWidth: 3,
  showLabels: true,
  singleSheetOnly: false,
  considerMaterial: false,
  edgeBanding: false,
  grainDirection: false,
  optimizationPriority: 'linear_guillotine',
});

/**
 * Fixture file names, sorted so every consumer iterates in the same order —
 * this is what makes the benchmark runner's output byte-stable across runs.
 *
 * `dir` exists so the runner can be pointed at an alternative fixture set (its
 * own failure-path test does exactly that); production callers always use the
 * checked-in directory.
 */
function listBenchmarkFixtureFiles(dir = BENCHMARK_FIXTURES_DIR) {
  return fs
    .readdirSync(dir)
    .filter((entry) => entry.endsWith('.json'))
    .sort()
    .map((entry) => path.join(dir, entry));
}

const BENCHMARK_FIXTURE_IDS = listBenchmarkFixtureFiles()
  .map((file) => path.basename(file, '.json'))
  .sort();

function loadBenchmarkFixture(id, dir = BENCHMARK_FIXTURES_DIR) {
  const filePath = path.join(dir, `${id}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Unknown benchmark fixture "${id}" (expected ${filePath})`);
  }

  const fixture = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (fixture.id !== id) {
    throw new Error(`Benchmark fixture ${id}.json declares a mismatched id "${fixture.id}"`);
  }
  return fixture;
}

function loadAllBenchmarkFixtures(dir = BENCHMARK_FIXTURES_DIR) {
  return listBenchmarkFixtureFiles(dir).map((file) => loadBenchmarkFixture(path.basename(file, '.json'), dir));
}

/** Rows as written on the artisan's cut list, before quantity expansion. */
function sourceRowCount(fixture) {
  return fixture.pieces.length;
}

/** Individual panels to cut, i.e. rows multiplied by their quantity. */
function expandedPieceCount(fixture) {
  return fixture.pieces.reduce((sum, piece) => sum + piece.quantity, 0);
}

/** Quantity-expanded piece area in cm², the numerator of the area lower bound. */
function totalPieceAreaCm2(fixture) {
  return fixture.pieces.reduce((sum, piece) => sum + piece.width * piece.height * piece.quantity, 0);
}

/**
 * Usable area of one stock sheet after the edge margin is trimmed off both
 * sides of each axis. This is the *optimistic* denominator for the lower
 * bound: it accounts for the margin only, and deliberately ignores kerf loss
 * and every packing constraint (see `areaLowerBoundSheets`).
 */
function usableSheetAreaCm2(sheet) {
  const margin = Math.max(0, sheet.margin || 0);
  return Math.max(0, sheet.width - margin * 2) * Math.max(0, sheet.height - margin * 2);
}

/**
 * Optimistic lower bound on sheet count: total piece area divided by the
 * usable inner rectangle of one sheet, rounded up.
 *
 * This is NOT an achievable target. It assumes pieces could be poured into the
 * sheet like a liquid: no kerf consumed by saw passes, no guillotine
 * constraint, no rectangle-packing loss. A real plan can only ever meet or
 * exceed it, so it is useful as a floor and must never be published as "the
 * optimum".
 */
function areaLowerBoundSheets(fixture) {
  const usable = usableSheetAreaCm2(fixture.sheet);
  if (usable <= 0) return Infinity;
  return Math.ceil(totalPieceAreaCm2(fixture) / usable);
}

/** Arguments for `optimizeCutting2D(pieces, sheets, options)`. */
function buildOptimizerInput(fixture) {
  return {
    pieces: fixture.pieces.map((piece) => ({ ...piece })),
    sheets: [{ ...fixture.sheet }],
    options: { ...fixture.options },
  };
}

/**
 * True when nothing in the fixture forbids rotating a piece: every row is
 * rotatable and neither the sheet nor the options lock the grain direction.
 * Derived rather than stored, so it can never disagree with the input.
 */
function rotationAllowed(fixture) {
  return (
    fixture.pieces.every((piece) => piece.rotatable === true) &&
    fixture.options.grainDirection === false &&
    fixture.sheet.grainDirection === false
  );
}

module.exports = {
  BENCHMARK_FIXTURES_DIR,
  BENCHMARK_FIXTURE_IDS,
  CANONICAL_BENCHMARK_OPTIONS,
  CANONICAL_BENCHMARK_SHEET,
  areaLowerBoundSheets,
  buildOptimizerInput,
  expandedPieceCount,
  listBenchmarkFixtureFiles,
  loadAllBenchmarkFixtures,
  loadBenchmarkFixture,
  rotationAllowed,
  sourceRowCount,
  totalPieceAreaCm2,
  usableSheetAreaCm2,
};
