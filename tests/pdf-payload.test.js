const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// buildPdfPayload() is the pure function that assembles the exact JSON body sent
// to /api/export-pdf. It must not mutate or reshape the caller's data: the
// offcuts array (and the result it lives on) has to survive byte-for-byte, since
// downstream PDF rendering keys off offcut ids that must stay in sync with what
// the UI (cut-plan SVG, offcuts list) already displayed to the user.

function activeSheet() {
  return { id: 'sheet-1', height: 278, width: 208, kerf: 0.3, margin: 1, material: 'mdf', quantity: 1 };
}

function pieces() {
  return [
    { id: 'piece-1', name: 'Panneau 1', height: 120, width: 60, quantity: 1, material: 'mdf' },
    { id: 'piece-2', name: 'Panneau 2', height: 80, width: 40, quantity: 2, material: 'mdf' },
  ];
}

function offcuts() {
  return [
    { id: 'sheet0_offcut_1', x: 0, y: 120, width: 208, height: 158, sheetIndex: 0, areaM2: 3.29, isReusable: true },
    { id: 'sheet0_offcut_2', x: 60, y: 0, width: 148, height: 120, sheetIndex: 0, areaM2: 1.78, isReusable: true },
  ];
}

function optimizationResult() {
  const sheetOffcuts = offcuts();
  return {
    success: true,
    cutMode: '2d',
    sheetsUsed: 1,
    sheets: [
      {
        index: 0, material: 'mdf', width: 208, height: 278,
        pieces: [],
        offcuts: sheetOffcuts,
        usedArea: 0.72, wasteRate: 0.28,
      },
    ],
    placedPieces: [],
    offcuts: sheetOffcuts,
    unplacedPieces: [],
    totalAreaAvailable: 5.78, totalAreaUsed: 0.72, wastePercentage: 87.5,
    totalLinearCutMeters: 8.4, moneySavedMad: 0,
  };
}

test('buildPdfPayload preserves result.offcuts exactly, including both distinct offcuts', () => {
  const { buildPdfPayload } = loadTsModule('src/lib/pdf-payload.ts');
  const result = optimizationResult();

  const payload = buildPdfPayload('Projet Test', activeSheet(), pieces(), result);

  assert.equal(payload.result.offcuts.length, 2);
  assert.deepEqual(payload.result.offcuts, result.offcuts);
  assert.notEqual(payload.result.offcuts[0].id, payload.result.offcuts[1].id, 'the two fixture offcuts must remain distinct');
});

test('buildPdfPayload preserves the entire result object deeply', () => {
  const { buildPdfPayload } = loadTsModule('src/lib/pdf-payload.ts');
  const result = optimizationResult();

  const payload = buildPdfPayload('Projet Test', activeSheet(), pieces(), result);

  assert.deepEqual(payload.result, result);
});

test('buildPdfPayload copies sheet width/height, and top-level material, from the active sheet', () => {
  const { buildPdfPayload } = loadTsModule('src/lib/pdf-payload.ts');
  const sheet = activeSheet();

  const payload = buildPdfPayload('Projet Test', sheet, pieces(), optimizationResult());

  assert.equal(payload.sheet.width, sheet.width);
  assert.equal(payload.sheet.height, sheet.height);
  // `material` is top-level, matching ExportSchema's top-level `material`
  // field (see pdf-schema.ts) and what route.ts actually reads -- nesting it
  // under `sheet` (whose server-side schema object has no `material` field
  // at all) meant every export silently fell back to the schema default
  // ('MDF') regardless of what the artisan had selected.
  assert.equal(payload.material, sheet.material);
  assert.equal(payload.sheet.material, undefined, 'material must not also be duplicated under sheet');
});

test('buildPdfPayload falls back to "mdf" when the active sheet has no material', () => {
  const { buildPdfPayload } = loadTsModule('src/lib/pdf-payload.ts');
  const sheet = { ...activeSheet(), material: undefined };

  const payload = buildPdfPayload('Projet Test', sheet, pieces(), optimizationResult());

  assert.equal(payload.material, 'mdf');
});

test('buildPdfPayload carries a non-MDF material through unchanged', () => {
  const { buildPdfPayload } = loadTsModule('src/lib/pdf-payload.ts');
  const sheet = { ...activeSheet(), material: 'melamine' };

  const payload = buildPdfPayload('Projet Test', sheet, pieces(), optimizationResult());

  assert.equal(payload.material, 'melamine');
});

test('buildPdfPayload carries an artisan-typed Arabic material label through unchanged', () => {
  const { buildPdfPayload } = loadTsModule('src/lib/pdf-payload.ts');
  const sheet = { ...activeSheet(), material: 'خشب الزان' };

  const payload = buildPdfPayload('Projet Test', sheet, pieces(), optimizationResult());

  assert.equal(payload.material, 'خشب الزان');
});

// The PDF report must render in whatever language the artisan's own atelier is
// currently set to (see useLocale() in src/components/LocaleProvider.tsx), so
// buildPdfPayload carries that locale through to /api/export-pdf exactly like
// it already carries displayUnit. A caller that omits it (a legacy call site,
// or a stale client build) must still produce a valid, French payload rather
// than an undefined field the server has to guess about.

test('buildPdfPayload defaults locale to "fr" when the caller omits it', () => {
  const { buildPdfPayload } = loadTsModule('src/lib/pdf-payload.ts');
  const payload = buildPdfPayload('Projet Test', activeSheet(), pieces(), optimizationResult());
  assert.equal(payload.locale, 'fr');
});

test('buildPdfPayload carries the artisan\'s current locale through unchanged', () => {
  const { buildPdfPayload } = loadTsModule('src/lib/pdf-payload.ts');

  const payloadEn = buildPdfPayload('Projet Test', activeSheet(), pieces(), optimizationResult(), 'cm', 'en');
  const payloadAr = buildPdfPayload('Projet Test', activeSheet(), pieces(), optimizationResult(), 'cm', 'ar');

  assert.equal(payloadEn.locale, 'en');
  assert.equal(payloadAr.locale, 'ar');
});

test('buildPdfPayload keeps displayUnit and locale independent of each other', () => {
  const { buildPdfPayload } = loadTsModule('src/lib/pdf-payload.ts');

  const payload = buildPdfPayload('Projet Test', activeSheet(), pieces(), optimizationResult(), 'mm', 'ar');

  assert.equal(payload.displayUnit, 'mm', 'the unit the artisan picked for dimensions must be untouched by locale');
  assert.equal(payload.locale, 'ar');
});
