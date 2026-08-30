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

test('buildPdfPayload copies sheet width/height/material from the active sheet', () => {
  const { buildPdfPayload } = loadTsModule('src/lib/pdf-payload.ts');
  const sheet = activeSheet();

  const payload = buildPdfPayload('Projet Test', sheet, pieces(), optimizationResult());

  assert.equal(payload.sheet.width, sheet.width);
  assert.equal(payload.sheet.height, sheet.height);
  assert.equal(payload.sheet.material, sheet.material);
});

test('buildPdfPayload falls back to "mdf" when the active sheet has no material', () => {
  const { buildPdfPayload } = loadTsModule('src/lib/pdf-payload.ts');
  const sheet = { ...activeSheet(), material: undefined };

  const payload = buildPdfPayload('Projet Test', sheet, pieces(), optimizationResult());

  assert.equal(payload.sheet.material, 'mdf');
});
