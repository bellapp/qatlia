const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// Task 4: persistence equivalence. `buildPersistedProjectPayload` must
// produce the exact payload atelier.persistProject used to build inline —
// same shape, and (critically) it must forward `result.costBreakdown` and
// `options.stockPricingOverrides`/`laborPricing` byte-identically, with no
// recompute and no mutation of the caller's inputs.

function loadPersistencePayload() {
  return loadTsModule('src/lib/projects/persistence-payload.ts');
}

function sampleCostBreakdown() {
  return {
    currency: 'MAD',
    materialCost: 480.5,
    materialCostBasis: 'measured',
    edgeCost: 20.25,
    edgeCostBasis: 'estimated',
    laborCost: 100,
    laborCostBasis: 'measured',
    subtotal: 600.75,
  };
}

function sampleOptions() {
  return {
    kerfWidth: 3,
    showLabels: true,
    singleSheetOnly: false,
    considerMaterial: true,
    edgeBanding: true,
    grainDirection: false,
    optimizationPriority: 'balanced',
    defaultMaterial: 'mdf',
    minReusableOffcutWidth: 15,
    minReusableOffcutHeight: 15,
    laborPricing: { mode: 'per_meter', value: 12.5 },
    stockPricingOverrides: {
      mdf: { mode: 'per_m2', value: 45.9 },
      oak: { mode: 'per_sheet', value: 320 },
    },
  };
}

function sampleResult(costBreakdown) {
  return {
    success: true,
    cutMode: '2d',
    sheetsUsed: 2,
    sheets: [],
    placedPieces: [],
    offcuts: [],
    unplacedPieces: [],
    totalAreaAvailable: 5.78,
    totalAreaUsed: 4.1,
    wastePercentage: 29.07,
    totalLinearCutMeters: 18.4,
    costBreakdown,
  };
}

function sampleSheet() {
  return {
    id: 's0', height: 278, width: 208, kerf: 0.3, margin: 1.0,
    grainDirection: false, material: 'mdf', quantity: 1, label: 'Panneau standard 278×208',
  };
}

function samplePieces() {
  return [
    { id: 'p1', name: 'Côté', height: 60, width: 40, quantity: 2, material: 'mdf', edges: { top: true } },
  ];
}

function baseInput() {
  const costBreakdown = sampleCostBreakdown();
  return {
    name: 'Débit MDF — 2 pcs',
    sheets: [sampleSheet()],
    sheet: sampleSheet(),
    pieces: samplePieces(),
    options: sampleOptions(),
    result: sampleResult(costBreakdown),
    displayUnit: 'cm',
    migratedFromLegacyUnit: false,
  };
}

test('buildPersistedProjectPayload returns the exact fields atelier.persistProject built inline', () => {
  const { buildPersistedProjectPayload } = loadPersistencePayload();
  const input = baseInput();

  const payload = buildPersistedProjectPayload(input);

  assert.equal(payload.name, input.name);
  assert.deepEqual(payload.sheets, input.sheets);
  assert.deepEqual(payload.sheet, input.sheet);
  assert.deepEqual(payload.pieces, input.pieces);
  assert.deepEqual(payload.options, input.options);
  assert.deepEqual(payload.result, input.result);
  assert.equal(payload.displayUnit, 'cm');
  assert.equal(payload.canonicalUnit, 'cm');
  assert.equal(payload.migratedFromLegacyUnit, false);
});

test('buildPersistedProjectPayload forwards result.costBreakdown byte-identically — no recompute', () => {
  const { buildPersistedProjectPayload } = loadPersistencePayload();
  const input = baseInput();
  const expectedBreakdown = sampleCostBreakdown();

  const payload = buildPersistedProjectPayload(input);

  assert.deepEqual(payload.result.costBreakdown, expectedBreakdown);
  // Same object reference forwarded, not a recomputed clone.
  assert.equal(payload.result.costBreakdown, input.result.costBreakdown);
});

test('buildPersistedProjectPayload forwards options.stockPricingOverrides and laborPricing byte-identically', () => {
  const { buildPersistedProjectPayload } = loadPersistencePayload();
  const input = baseInput();
  const expectedOptions = sampleOptions();

  const payload = buildPersistedProjectPayload(input);

  assert.deepEqual(payload.options.stockPricingOverrides, expectedOptions.stockPricingOverrides);
  assert.deepEqual(payload.options.laborPricing, expectedOptions.laborPricing);
  assert.equal(payload.options.stockPricingOverrides, input.options.stockPricingOverrides);
  assert.equal(payload.options.laborPricing, input.options.laborPricing);
});

test('buildPersistedProjectPayload stamps unit persistence metadata via buildProjectUnitPersistenceMetadata', () => {
  const { buildPersistedProjectPayload } = loadPersistencePayload();
  const { buildProjectUnitPersistenceMetadata } = loadTsModule('src/lib/units.ts');
  const input = baseInput();
  input.displayUnit = 'mm';
  input.migratedFromLegacyUnit = true;

  const payload = buildPersistedProjectPayload(input);
  const expectedMeta = buildProjectUnitPersistenceMetadata('mm', true);

  assert.deepEqual(
    { displayUnit: payload.displayUnit, canonicalUnit: payload.canonicalUnit, migratedFromLegacyUnit: payload.migratedFromLegacyUnit },
    expectedMeta
  );
});

test('buildPersistedProjectPayload never mutates its input', () => {
  const { buildPersistedProjectPayload } = loadPersistencePayload();
  const input = baseInput();
  const snapshot = JSON.parse(JSON.stringify(input));

  buildPersistedProjectPayload(input);

  assert.deepEqual(input, snapshot);
});

test('buildPersistedProjectPayload preserves an absent costBreakdown as undefined (1D mode) rather than fabricating one', () => {
  const { buildPersistedProjectPayload } = loadPersistencePayload();
  const input = baseInput();
  delete input.result.costBreakdown;

  const payload = buildPersistedProjectPayload(input);

  assert.equal(payload.result.costBreakdown, undefined);
});
