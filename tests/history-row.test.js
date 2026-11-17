const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// One line of the history, whichever way it is shown (cards or table): a pure
// summary of a saved project, so an old project with nothing but its geometry
// still makes a row and the views only ever print dashes for what is missing.

const UUID = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b';
const PROJECT_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const TINY_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/';

const rows = () => loadTsModule('src/lib/projects/history-row.ts');
const packing = () => loadTsModule('src/lib/cutting/binpacking.ts');

function savedResult() {
  const { optimizeCutting2D, DEFAULT_STOCK_SHEET, OPTIONS_DEFAULTS } = packing();
  const pieces = [{ id: 'a', name: 'Côté', height: 70, width: 40, quantity: 3 }];
  return JSON.parse(JSON.stringify(optimizeCutting2D(pieces, [DEFAULT_STOCK_SHEET], OPTIONS_DEFAULTS)));
}

const base = { id: PROJECT_ID, name: 'Cuisine', material: 'mdf', sheet_width: 206, sheet_height: 279, created_at: '2026-11-13T18:40:00.000Z' };

test('a full project is summarised for the list', () => {
  const row = rows().toHistoryRow({ ...base, options_json: {
    pieces: [{ quantity: 2 }, { quantity: 65 }], result: savedResult(), scanThumb: TINY_JPEG,
    scanPath: `${UUID}/${PROJECT_ID}.jpg`, pdfGeneratedAt: '2026-11-13T18:45:00.000Z' } });
  assert.equal(row.pieceCount, 67);
  assert.equal(row.hasPlan, true);
  assert.equal(row.hasFullScan, true);
  assert.equal(row.scanThumb, TINY_JPEG);
  assert.equal(row.isCloud, true);
  assert.equal(row.pdfGeneratedAt, '2026-11-13T18:45:00.000Z');
  assert.deepEqual(
    [row.id, row.name, row.createdAt, row.material, row.sheetWidth, row.sheetHeight],
    [PROJECT_ID, 'Cuisine', base.created_at, 'mdf', 206, 279]);
});

test('an old project with nothing but its geometry still makes a row', () => {
  const row = rows().toHistoryRow({ ...base, id: 'optimize_1699999999999', options_json: undefined });
  assert.deepEqual(
    { pieceCount: row.pieceCount, sheetsUsed: row.sheetsUsed, wastePercentage: row.wastePercentage, scanThumb: row.scanThumb, hasPlan: row.hasPlan, hasFullScan: row.hasFullScan, isCloud: row.isCloud },
    { pieceCount: 0, sheetsUsed: null, wastePercentage: null, scanThumb: null, hasPlan: false, hasFullScan: false, isCloud: false });
  assert.equal(row.pdfGeneratedAt, null);
});

test('a summary-only result gives the figures but no plan to reopen', () => {
  const row = rows().toHistoryRow({ ...base, options_json: { result: { sheetsUsed: 4, wastePercentage: 19.7 } } });
  assert.deepEqual([row.sheetsUsed, row.wastePercentage, row.hasPlan], [4, 19.7, false]);
});

test('a piece without a quantity counts once, an unusable quantity not at all', () => {
  const row = rows().toHistoryRow({ ...base, options_json: {
    pieces: [{}, { quantity: 3 }, { quantity: 0 }, { quantity: -2 }, { quantity: 'x' }, { quantity: NaN }, null] } });
  assert.equal(row.pieceCount, 4);
});

test('damaged extras never reach the row', () => {
  const row = rows().toHistoryRow({ ...base, options_json: {
    scanThumb: 'javascript:alert(1)', scanPath: '', pdfGeneratedAt: 'yesterday', pieces: 'many',
    result: { sheetsUsed: 'four', wastePercentage: null } } });
  assert.deepEqual(
    { scanThumb: row.scanThumb, hasFullScan: row.hasFullScan, pdfGeneratedAt: row.pdfGeneratedAt, pieceCount: row.pieceCount, sheetsUsed: row.sheetsUsed, wastePercentage: row.wastePercentage },
    { scanThumb: null, hasFullScan: false, pdfGeneratedAt: null, pieceCount: 0, sheetsUsed: null, wastePercentage: null });
});

test('the view defaults to cards and remembers a valid choice only', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(rows().readHistoryView(storage), 'cards');
  rows().writeHistoryView(storage, 'table');
  assert.equal(rows().readHistoryView(storage), 'table');
  store.set('qatlia_history_view', 'grid');
  assert.equal(rows().readHistoryView(storage), 'cards');
  assert.equal(rows().readHistoryView(null), 'cards');
});

test('a storage that throws never breaks the history', () => {
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } };
  assert.equal(rows().readHistoryView(broken), 'cards');
  assert.doesNotThrow(() => rows().writeHistoryView(broken, 'table'));
  assert.doesNotThrow(() => rows().writeHistoryView(null, 'table'));
});

// A project that kept no saved data reopens with what its row knows.

test('restoreSeedFromRow gives the atelier the panel and the name of a project with no saved data', () => {
  const seed = rows().restoreSeedFromRow({ name: '  Placard Benali ', material: 'verre', sheet_width: 250, sheet_height: 321, kerf: 0.4, grain_direction: true });
  assert.deepEqual(seed, {
    sheet: { id: 's0', width: 250, height: 321, kerf: 0.4, margin: 0, grainDirection: true, material: 'verre', quantity: 1 },
    projectName: 'Placard Benali',
  });
});

test('restoreSeedFromRow leaves to the atelier what the row does not hold in a usable form', () => {
  const { restoreSeedFromRow } = rows();
  const unknown = restoreSeedFromRow({ name: 'Cuisine', material: 'bois-exotique', sheet_width: 206, sheet_height: 279 });
  assert.equal(unknown.sheet.material, 'mdf');
  assert.equal(unknown.sheet.kerf, 0);
  assert.equal(unknown.sheet.grainDirection, false);
  assert.deepEqual(restoreSeedFromRow({ name: '', material: 'mdf', sheet_width: 0, sheet_height: NaN, kerf: -1 }), {});
  assert.equal(restoreSeedFromRow({ name: 'x'.repeat(121), material: 'mdf', sheet_width: 206, sheet_height: 279 }).projectName, undefined);
});

test('the history reopens a project with no saved data through restoreSeedFromRow, in the shape the atelier reads', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const atelier = fs.readFileSync(path.resolve('src/app/(site)/atelier/page.tsx'), 'utf8');
  assert.match(atelier, /if \(parsed\.sheet\) setSheets\(\[restoreSheet\(parsed\.sheet\)\]\);/);
  assert.match(atelier, /typeof parsed\.projectName === 'string' && parsed\.projectName\.trim\(\)/);
});

test('a project read from several sheets shows its first one and says how many', () => {
  const row = rows().toHistoryRow({ ...base, options_json: {
    scans: [{ thumb: TINY_JPEG, path: `${UUID}/${PROJECT_ID}.jpg` }, { thumb: TINY_JPEG }, {}] } });
  assert.equal(row.scanThumb, TINY_JPEG);
  assert.equal(row.hasFullScan, true);
  assert.equal(row.scanCount, 3);
  const legacy = rows().toHistoryRow({ ...base, options_json: { scanThumb: TINY_JPEG } });
  assert.equal(legacy.scanCount, 1);
  assert.equal(rows().toHistoryRow({ ...base, options_json: {} }).scanCount, 0);
});
