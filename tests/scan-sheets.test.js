const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// Up to 4 cut-list sheets per project (spec 2026-11-17): their pieces merge in
// one list, each piece remembers its sheet, and the project keeps one entry
// per sheet. Pure module, so every rule is pinned here without a browser.

const sheets = () => loadTsModule('src/lib/projects/scan-sheets.ts');
const metadata = () => loadTsModule('src/lib/projects/history-metadata.ts');

const UUID = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b';
const OTHER_UUID = '7c6b5a4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d';
const FILE = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const PATH = `${UUID}/${FILE}.jpg`;
const THUMB = (n) => `data:image/jpeg;base64,${'A'.repeat(n)}`;

const piece = (name, extra = {}) => ({ id: name, name, height: 50, width: 40, quantity: 1, ...extra });

test('the first sheet of a project replaces the list on screen, tagged sheet 1', () => {
  const { appendSheetPieces } = sheets();
  const out = appendSheetPieces([piece('exemple')], [piece('a'), piece('b')], 1);
  assert.deepEqual(out.map((p) => [p.name, p.scanIndex]), [['a', 1], ['b', 1]]);
});

test('a later sheet adds its pieces at the end and keeps everything already there', () => {
  const { appendSheetPieces } = sheets();
  const current = [piece('a', { scanIndex: 1 }), piece('manuelle')];
  const out = appendSheetPieces(current, [piece('c')], 2);
  assert.deepEqual(out.map((p) => [p.name, p.scanIndex]), [['a', 1], ['manuelle', undefined], ['c', 2]]);
  assert.equal(current.length, 2, 'the list on screen is not mutated');
});

test('removing a sheet drops its pieces, renumbers the next ones and keeps manual pieces', () => {
  const { removeScanSheet } = sheets();
  const current = [
    piece('a', { scanIndex: 1 }),
    piece('b', { scanIndex: 2 }),
    piece('b-corrigée', { scanIndex: 2, height: 99 }),
    piece('manuelle'),
    piece('c', { scanIndex: 3 }),
  ];
  const out = removeScanSheet(current, 2);
  assert.deepEqual(out.map((p) => [p.name, p.scanIndex]), [['a', 1], ['manuelle', undefined], ['c', 2]]);
});

test('an old project with one scan reads as one sheet; a new one reads its list', () => {
  const { readScanSheets } = sheets();
  assert.deepEqual(readScanSheets({ scanThumb: THUMB(10), scanPath: PATH }), [{ thumb: THUMB(10), path: PATH }]);
  assert.deepEqual(readScanSheets({ scanThumb: THUMB(10) }), [{ thumb: THUMB(10) }]);
  assert.deepEqual(readScanSheets({ scanPath: PATH }), [{ path: PATH }]);
  assert.deepEqual(
    readScanSheets({ scans: [{ thumb: THUMB(5) }, {}, { path: PATH }], scanThumb: THUMB(9) }),
    [{ thumb: THUMB(5) }, {}, { path: PATH }],
    'the list wins over the old keys, and an empty entry keeps its place'
  );
});

test('nothing usable reads as no sheet, and never more than 4', () => {
  const { readScanSheets, MAX_SCAN_SHEETS } = sheets();
  assert.equal(MAX_SCAN_SHEETS, 4);
  for (const value of [null, undefined, 'x', 42, {}, { scans: 'x' }, { scanThumb: 'not-an-image' }]) {
    assert.deepEqual(readScanSheets(value), []);
  }
  const many = Array.from({ length: 6 }, () => ({ thumb: THUMB(4) }));
  assert.equal(readScanSheets({ scans: many }).length, 4);
  assert.deepEqual(readScanSheets({ scans: [{ thumb: 'javascript:alert(1)', path: 42 }] }), [{}]);
});

test('the thumbnails of a project share the budget one thumbnail has today', () => {
  const { thumbBudgetFor } = sheets();
  const { SCAN_THUMB_MAX_CHARS } = metadata();
  assert.equal(thumbBudgetFor(1), SCAN_THUMB_MAX_CHARS);
  assert.equal(thumbBudgetFor(0), SCAN_THUMB_MAX_CHARS);
  assert.equal(thumbBudgetFor(4), Math.floor(SCAN_THUMB_MAX_CHARS / 4));
});

test('a thumbnail is shrunk until it fits its share, from the largest size down', async () => {
  const { fitThumb } = sheets();
  const calls = [];
  const downscale = async (_src, side) => {
    calls.push(side);
    return THUMB(side * 100);
  };
  assert.equal(await fitThumb(THUMB(10), 1000, downscale), THUMB(10), 'already small enough: kept as is');
  assert.deepEqual(calls, []);
  assert.equal(await fitThumb(THUMB(200_000), 40_000, downscale), THUMB(32_000));
  assert.deepEqual(calls, [600, 480, 400, 320]);
  assert.equal(await fitThumb(THUMB(200_000), 10, async () => THUMB(500)), undefined, 'never fits: no thumbnail');
  assert.equal(await fitThumb(THUMB(200_000), 40_000, async () => null), undefined, 'no canvas: no thumbnail');
  assert.equal(await fitThumb(null, 40_000, downscale), undefined);
});

test('a save keeps only valid sheets, under the total budget, with the artisan’s own paths', () => {
  const { sanitizeScanSheets } = sheets();
  const { SCAN_THUMB_MAX_CHARS } = metadata();
  const half = THUMB(Math.floor(SCAN_THUMB_MAX_CHARS / 2) - 40);
  const out = sanitizeScanSheets(
    [
      { thumb: half, path: PATH },
      { thumb: half, path: `${OTHER_UUID}/${FILE}.jpg` },
      { thumb: half },
      { thumb: 'data:text/html;base64,AAAA' },
    ],
    UUID
  );
  assert.deepEqual(out, [{ thumb: half, path: PATH }, { thumb: half }, {}, {}],
    'the third thumbnail would pass the total: dropped, its place kept');
  assert.equal(sanitizeScanSheets([{ path: PATH }]).length, 1);
  assert.deepEqual(sanitizeScanSheets([{ path: PATH }]), [{}], 'no owner, no path');
  assert.equal(sanitizeScanSheets('x'), undefined);
  assert.equal(sanitizeScanSheets([]), undefined);
  assert.equal(sanitizeScanSheets(Array.from({ length: 5 }, () => ({}))), undefined, 'more than 4 sheets is refused');
});

test('the history extras of a save carry the sheets and the scan group', () => {
  const { pickProjectHistoryMetadata } = metadata();
  const group = '99999999-8888-4777-8666-555555555555';
  const picked = pickProjectHistoryMetadata({ scans: [{ thumb: THUMB(8), path: PATH }], scanGroup: group }, UUID);
  assert.deepEqual(picked.scans, [{ thumb: THUMB(8), path: PATH }]);
  assert.equal(picked.scanGroup, group);
  assert.equal('scanGroup' in pickProjectHistoryMetadata({ scanGroup: 'nope' }, UUID), false);
});

test('a kept image attached after the save lands on sheet 1 of a project that has a list', () => {
  const { withFirstScanPath } = sheets();
  assert.deepEqual(
    withFirstScanPath({ scans: [{ thumb: THUMB(4) }, { thumb: THUMB(5) }], quotation: { a: 1 } }, PATH),
    { scans: [{ thumb: THUMB(4), path: PATH }, { thumb: THUMB(5) }], quotation: { a: 1 } }
  );
  assert.deepEqual(withFirstScanPath({ scanThumb: THUMB(4) }, PATH), { scanThumb: THUMB(4), scanPath: PATH },
    'an old project keeps the old key');
});
