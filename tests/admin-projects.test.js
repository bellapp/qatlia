const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// A saved project as the back office shows it (plan 2026-11-12, Task 2).
// options_json is written by the client and may be anything.

const { summarizeProject } = loadTsModule('src/lib/admin/projects.ts');

const base = {
  id: 'p1',
  name: 'Cuisine',
  material: 'mdf',
  sheet_width: '208.00',
  sheet_height: '278.00',
  created_at: '2026-11-01T10:00:00Z',
};

test('summarizeProject lit pièces, résultat, scan et devis', () => {
  const s = summarizeProject({
    ...base,
    options_json: {
      pieces: [{ quantity: 2 }, { quantity: 3 }, {}],
      result: { sheetsUsed: 2, wastePercentage: 12.5 },
      scanThumb: 'data:image/jpeg;base64,AAA',
      pdfGeneratedAt: '2026-11-01T11:00:00Z',
      quotation: { clientName: 'X' },
    },
  });
  assert.deepEqual([s.pieceCount, s.sheetsUsed, s.wastePercentage, s.hasQuotation, s.sheetWidth, s.sheetHeight], [6, 2, 12.5, true, 208, 278]);
  assert.equal(s.scanThumb, 'data:image/jpeg;base64,AAA');
  assert.equal(s.pdfGeneratedAt, '2026-11-01T11:00:00Z');
  assert.equal(s.name, 'Cuisine');
});

for (const bad of [null, 'texte', 42, [], { pieces: 'non' }, { result: null }]) {
  test(`summarizeProject tolère options_json = ${JSON.stringify(bad)}`, () => {
    const s = summarizeProject({ ...base, options_json: bad });
    assert.deepEqual([s.pieceCount, s.sheetsUsed, s.scanThumb, s.hasQuotation, s.pdfGeneratedAt], [0, null, null, false, null]);
  });
}

test("summarizeProject refuse un scanThumb qui n'est pas une image data:", () => {
  assert.equal(summarizeProject({ ...base, options_json: { scanThumb: 'javascript:alert(1)' } }).scanThumb, null);
});

test('summarizeProject : nom et matériau manquants, dimensions illisibles', () => {
  const s = summarizeProject({ ...base, name: null, material: null, sheet_width: null, sheet_height: 'abc', options_json: {} });
  assert.deepEqual([s.name, s.material, s.sheetWidth, s.sheetHeight], ['Sans nom', '—', 0, 0]);
});

test('summarizeProject : une quantité négative ou non numérique compte pour 1', () => {
  const s = summarizeProject({ ...base, options_json: { pieces: [{ quantity: -4 }, { quantity: 'x' }, null] } });
  assert.equal(s.pieceCount, 2);
});
