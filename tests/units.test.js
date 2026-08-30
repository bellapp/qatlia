const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// src/lib/units.ts is the single boundary between the canonical cm domain and
// whatever unit the artisan currently wants to see (cm or mm). Every domain
// calculation (optimizer, costing, persistence) stays in cm; only display
// (inputs, labels, exports that explicitly show a unit) may show mm. No
// implicit `value > 500 ? value / 10 : value` heuristic is allowed anywhere.

function loadUnits() {
  return loadTsModule('src/lib/units.ts');
}

test('toCanonicalCm leaves an explicit cm value untouched, including large legitimate lengths', () => {
  const { toCanonicalCm } = loadUnits();
  assert.equal(toCanonicalCm(600, 'cm'), 600);
  assert.equal(toCanonicalCm(230, 'cm'), 230);
  assert.equal(toCanonicalCm(120, 'cm'), 120);
});

test('toCanonicalCm converts an explicit mm value to cm, and only when the unit says so', () => {
  const { toCanonicalCm } = loadUnits();
  assert.equal(toCanonicalCm(600, 'mm'), 60);
  assert.equal(toCanonicalCm(2300, 'mm'), 230);
  assert.equal(toCanonicalCm(1200, 'mm'), 120);
});

test('a 230x120 cm piece is unaffected by the unit boundary regardless of magnitude', () => {
  const { toCanonicalCm } = loadUnits();
  // 230 and 120 must never be silently reinterpreted as millimetres just
  // because 230 > ... some magic threshold. There is no threshold: the unit
  // is always explicit.
  assert.equal(toCanonicalCm(230, 'cm'), 230);
  assert.equal(toCanonicalCm(120, 'cm'), 120);
});

test('fromCanonicalCm is the exact inverse of toCanonicalCm for both units', () => {
  const { toCanonicalCm, fromCanonicalCm } = loadUnits();
  assert.equal(fromCanonicalCm(60, 'mm'), 600);
  assert.equal(fromCanonicalCm(230, 'mm'), 2300);
  assert.equal(fromCanonicalCm(230, 'cm'), 230);
});

test('repeated display-unit toggles are lossless (no drift after many round trips)', () => {
  const { toCanonicalCm, fromCanonicalCm } = loadUnits();
  const canonical = 41.8; // real fixture value from the app's default project
  let displayed = fromCanonicalCm(canonical, 'mm');
  for (let i = 0; i < 25; i += 1) {
    const backToCm = toCanonicalCm(displayed, 'mm');
    displayed = fromCanonicalCm(backToCm, 'mm');
  }
  assert.equal(displayed, fromCanonicalCm(canonical, 'mm'));
  assert.equal(toCanonicalCm(displayed, 'mm'), canonical);
});

test('kerf stays entered/displayed in mm and converts to cm exactly once', () => {
  const { toCanonicalCm, fromCanonicalCm } = loadUnits();
  // Matches the existing atelier kerf slider: 3 mm of kerf is 0.3 cm internally.
  assert.equal(toCanonicalCm(3, 'mm'), 0.3);
  assert.equal(fromCanonicalCm(0.3, 'mm'), 3);
});

test('toCanonicalCm/fromCanonicalCm reject non-finite values instead of silently coercing them', () => {
  const { toCanonicalCm, fromCanonicalCm } = loadUnits();
  assert.throws(() => toCanonicalCm(NaN, 'cm'));
  assert.throws(() => toCanonicalCm(Infinity, 'mm'));
  assert.throws(() => fromCanonicalCm(-Infinity, 'cm'));
});

test('formatDimensions renders canonical values in the requested display unit', () => {
  const { formatDimensions } = loadUnits();
  assert.equal(formatDimensions(230, 120, 'cm'), '230.0 × 120.0 cm');
  assert.equal(formatDimensions(230, 120, 'mm'), '2300.0 × 1200.0 mm');
});

test('resolveProjectUnitMetadata assumes canonical cm and flags migration for legacy projects without unit metadata', () => {
  const { resolveProjectUnitMetadata } = loadUnits();

  const legacy = resolveProjectUnitMetadata({});
  assert.equal(legacy.displayUnit, 'cm');
  assert.equal(legacy.canonicalUnit, 'cm');
  assert.equal(legacy.migrated, true);
  // Absent metadata means whatever rewrite follows originates from a legacy
  // record, so the persisted historical marker is also true.
  assert.equal(legacy.migratedFromLegacyUnit, true);

  const legacyNullish = resolveProjectUnitMetadata(undefined);
  assert.equal(legacyNullish.displayUnit, 'cm');
  assert.equal(legacyNullish.migrated, true);
  assert.equal(legacyNullish.migratedFromLegacyUnit, true);
});

test('resolveProjectUnitMetadata trusts an explicit displayUnit and does not mark it migrated', () => {
  const { resolveProjectUnitMetadata } = loadUnits();

  const explicitMm = resolveProjectUnitMetadata({ displayUnit: 'mm' });
  assert.equal(explicitMm.displayUnit, 'mm');
  assert.equal(explicitMm.migrated, false);
  // No migratedFromLegacyUnit on the payload -> fresh modern metadata, not
  // a historical legacy origin.
  assert.equal(explicitMm.migratedFromLegacyUnit, false);

  const explicitCm = resolveProjectUnitMetadata({ displayUnit: 'cm' });
  assert.equal(explicitCm.displayUnit, 'cm');
  assert.equal(explicitCm.migrated, false);
  assert.equal(explicitCm.migratedFromLegacyUnit, false);
});

test('resolveProjectUnitMetadata separates pending migration from the persisted historical marker', () => {
  const { resolveProjectUnitMetadata } = loadUnits();

  // A record that was already rewritten with explicit metadata is never a
  // pending migration again, even though its historical origin (it once was
  // a legacy record) is preserved forever.
  const rewrittenLegacy = resolveProjectUnitMetadata({
    displayUnit: 'cm',
    canonicalUnit: 'cm',
    migratedFromLegacyUnit: true,
  });
  assert.equal(rewrittenLegacy.migrated, false);
  assert.equal(rewrittenLegacy.migratedFromLegacyUnit, true);
});

test('resolveProjectUnitMetadata ignores garbage displayUnit values and treats them as missing metadata', () => {
  const { resolveProjectUnitMetadata } = loadUnits();
  const garbage = resolveProjectUnitMetadata({ displayUnit: 'inch' });
  assert.equal(garbage.displayUnit, 'cm');
  assert.equal(garbage.migrated, true);
  assert.equal(garbage.migratedFromLegacyUnit, true);
});

test('readStoredDisplayUnit/writeStoredDisplayUnit persist the selected unit through a storage-like object', () => {
  const { readStoredDisplayUnit, writeStoredDisplayUnit, DEFAULT_DISPLAY_UNIT } = loadUnits();
  const store = new Map();
  const fakeStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
  };

  assert.equal(readStoredDisplayUnit(fakeStorage), DEFAULT_DISPLAY_UNIT);
  writeStoredDisplayUnit(fakeStorage, 'mm');
  assert.equal(readStoredDisplayUnit(fakeStorage), 'mm');
});

test('readStoredDisplayUnit falls back to cm when storage is unavailable or holds an invalid value', () => {
  const { readStoredDisplayUnit } = loadUnits();
  assert.equal(readStoredDisplayUnit(undefined), 'cm');

  const corrupted = { getItem: () => 'parsecs' };
  assert.equal(readStoredDisplayUnit(corrupted), 'cm');
});

// parseDisplayInputToCanonical is the UI-safe boundary for raw <input> strings:
// unlike toCanonicalCm (which throws on programmer misuse), it must never
// throw and instead return null for anything non-finite, so onChange handlers
// can refuse bad keystrokes without corrupting state or crashing the page.

test('parseDisplayInputToCanonical converts a normal typed value exactly like toCanonicalCm', () => {
  const { parseDisplayInputToCanonical, toCanonicalCm } = loadUnits();
  assert.equal(parseDisplayInputToCanonical('230', 'cm'), toCanonicalCm(230, 'cm'));
  assert.equal(parseDisplayInputToCanonical('2300', 'mm'), toCanonicalCm(2300, 'mm'));
  assert.equal(parseDisplayInputToCanonical('45.5', 'cm'), 45.5);
});

test('parseDisplayInputToCanonical never reinterprets a legitimate large cm value as mm', () => {
  const { parseDisplayInputToCanonical } = loadUnits();
  assert.equal(parseDisplayInputToCanonical('600', 'cm'), 600);
});

test('parseDisplayInputToCanonical returns null instead of throwing for non-finite or empty input', () => {
  const { parseDisplayInputToCanonical } = loadUnits();
  assert.equal(parseDisplayInputToCanonical('', 'cm'), null);
  assert.equal(parseDisplayInputToCanonical('abc', 'cm'), null);
  assert.equal(parseDisplayInputToCanonical('NaN', 'cm'), null);
  assert.equal(parseDisplayInputToCanonical('Infinity', 'mm'), null);
  assert.equal(parseDisplayInputToCanonical('-Infinity', 'cm'), null);
  assert.equal(parseDisplayInputToCanonical('1e400', 'cm'), null);
});

test('toCanonicalCm/fromCanonicalCm still throw on non-finite input for programmer misuse (unlike the parse helper)', () => {
  const { toCanonicalCm, parseDisplayInputToCanonical } = loadUnits();
  assert.throws(() => toCanonicalCm(NaN, 'cm'));
  assert.equal(parseDisplayInputToCanonical('NaN', 'cm'), null);
});
