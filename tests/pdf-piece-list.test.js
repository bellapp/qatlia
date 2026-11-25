const test = require('node:test');
const { before } = test;
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

// A customer's request, 2026-11-25: one sheet with the pieces only, the chants
// (sinta) as strokes under each measure, to hand to the client who checks the
// sizes and to the worker at the edge-banding machine. No price on it.

const ROOT = path.resolve(__dirname, '..');
const load = (rel) => loadTsModule(path.join(ROOT, rel));
const { buildPieceList } = load('src/lib/exports/piece-list.ts');
const { optimizeCutting2D, optimizeCutting1D } = load('src/lib/cutting/binpacking.ts');

/** The customer's own list (SketchCut PRO), in cm: its PDF counts 45.44 m of chant. */
const all = { left: true, right: true, top: true, bottom: true };
const CUSTOMER = [
  [20, 52, 6, { left: true, top: true, bottom: true }],
  [40, 38.4, 5, all],
  [70, 52.4, 6, { left: true, right: true, top: true }],
  [40, 41.2, 6, { left: true, top: true, bottom: true }],
  [85.2, 40, 9, { left: true, top: true }],
].map(([height, width, quantity, edges], i) => ({ id: String(i + 1), name: i === 0 ? 'Côté' : '', height, width, quantity, edges, rotatable: true, material: 'mdf' }));
const SHEET = { id: 's', height: 280, width: 210, kerf: 0.4, margin: 0, grainDirection: false, material: 'mdf', quantity: 5 };
const customerPlan = () => optimizeCutting2D(CUSTOMER, [SHEET], { kerfWidth: 4 });

test("the customer's list: his five lines, his sizes, the strokes of his sheet, his 45.44 m", () => {
  const plan = customerPlan();
  assert.ok(plan.placedPieces.some((p) => p.width !== p.originalWidth), 'the plan turned some pieces');
  const { rows, quantity, edgeMetres } = buildPieceList(plan.placedPieces);
  assert.deepEqual(
    rows.map((r) => [r.number, r.height, r.width, r.quantity, r.edgesHeight, r.edgesWidth]),
    [[1, 20, 52, 6, 1, 2], [2, 40, 38.4, 5, 2, 2], [3, 70, 52.4, 6, 2, 1], [4, 40, 41.2, 6, 1, 2], [5, 85.2, 40, 9, 1, 1]],
  );
  assert.equal(quantity, 32);
  assert.ok(Math.abs(edgeMetres - 45.436) < 1e-6, String(edgeMetres));
  assert.equal(rows[0].name, 'Côté', 'the name as typed, without the "×6" of the plan');
  assert.equal(rows[1].name, '');
});

const placed = (extra) => ({ pieceNumber: 1, name: 'A ×2', sheetIndex: 0, x: 0, y: 0, width: 87, height: 30, rotated: false, ...extra });

test('an older save without the original sizes: the rotated flag gives them back', () => {
  const { rows } = buildPieceList([placed({ edges: { top: true } }), placed({ width: 30, height: 87, rotated: true, edges: { top: true } })]);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].height, rows[0].width, rows[0].quantity, rows[0].edgesWidth], [30, 87, 2, 1]);
});

test('two lines of the same size stay two lines; the same line with other chants too', () => {
  assert.equal(buildPieceList([placed({ originalIndex: 0 }), placed({ originalIndex: 1 })]).rows.length, 2);
  assert.equal(buildPieceList([placed({ edges: { top: true } }), placed({ edges: { left: true } })]).rows.length, 2);
});

test("the lines come in the artisan's order, whatever order the plan placed them in", () => {
  const { rows } = buildPieceList([placed({ originalIndex: 2, width: 1 }), placed({ originalIndex: 0, width: 2 }), placed({ originalIndex: 1, width: 3 })]);
  assert.deepEqual(rows.map((r) => r.width), [2, 3, 1]);
  assert.deepEqual(rows.map((r) => r.number), [1, 2, 3]);
});

test('no pieces, no list', () => {
  assert.deepEqual(buildPieceList([]), { rows: [], quantity: 0, edgeMetres: 0 });
});

// --- The page ---------------------------------------------------------------

let pdfjsLib;
before(async () => {
  pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
});

async function pdfOf(result, extra = {}) {
  const { POST } = load('src/app/api/export-pdf/route.ts');
  const res = await POST(new Request('http://localhost/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectName: 'Projet', material: 'mdf', sheet: { width: 210, height: 280 }, result, ...extra }),
  }));
  assert.equal(res.status, 200);
  const raw = Buffer.from(await res.arrayBuffer());
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(raw), useSystemFonts: false, disableFontFace: true }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const { width, height } = page.getViewport({ scale: 1 });
    const items = (await page.getTextContent()).items.map((item) => item.str).filter((s) => s.trim());
    pages.push({ width, height, items, text: items.join(' ') });
  }
  return { raw: raw.toString('latin1'), pages };
}
const isList = (page) => page.items.includes('Liste des pièces');
const listPages = (pdf) => pdf.pages.filter(isList);

test('the PDF carries the sheet on its own portrait page, before the plans, with no price', async () => {
  const pdf = await pdfOf(customerPlan());
  const index = pdf.pages.findIndex(isList);
  assert.ok(index > 0);
  const page = pdf.pages[index];
  assert.ok(page.height > page.width, 'portrait');
  assert.ok(pdf.pages[index + 1].width > pdf.pages[index + 1].height, 'the plans follow');
  for (const value of ['Côté', '38.4', '52.4', '85.2', '45.44 m', '32']) assert.ok(page.items.includes(value), value);
  for (const word of [/MAD/, /Devise/, /Prix/, /Co[uû]t/i]) assert.doesNotMatch(page.text, word);
  assert.match(page.text, /sur 1 côté/);
  assert.match(page.text, /sur les 2 côtés/);
});

test('in millimetres the sizes are in millimetres', async () => {
  const [page] = listPages(await pdfOf(customerPlan(), { displayUnit: 'mm' }));
  for (const value of ['384', '524', '852']) assert.ok(page.items.includes(value), value);
});

/** Blue strokes of the page: "0.11 0.306 0.847 RG". */
const blueRuns = (raw) => (raw.match(/0\.11\d* 0\.3\d* 0\.8\d* RG/g) ?? []).length;

test('without chants, or with the chants switched off, the sheet keeps the sizes and drops the strokes and legend', async () => {
  const bare = optimizeCutting2D(CUSTOMER.map((p) => ({ ...p, edges: undefined })), [SHEET], { kerfWidth: 4 });
  for (const pdf of [await pdfOf(bare), await pdfOf(customerPlan(), { showEdges: false })]) {
    const [page] = listPages(pdf);
    assert.ok(page.items.includes('85.2'));
    assert.doesNotMatch(page.text, /sur 1 côté|45\.44/);
    assert.equal(blueRuns(pdf.raw), 0);
  }
  assert.ok(blueRuns((await pdfOf(customerPlan())).raw) > 0);
});

test('a long list runs over several pages, each with its title and its legend', async () => {
  const pieces = Array.from({ length: 60 }, (_, i) => placed({ originalIndex: i, width: 10 + i, height: 5, edges: { top: true } }));
  const pages = listPages(await pdfOf({ sheetsUsed: 1, wastePercentage: 1, totalAreaUsed: 1, totalAreaAvailable: 5, offcuts: [], placedPieces: pieces }));
  assert.ok(pages.length >= 3, String(pages.length));
  for (const page of pages) assert.match(page.text, /sur 1 côté/);
  assert.ok(pages.at(-1).items.includes('60'), 'the last line is there');
});

test('a bar job (1D) has no piece sheet', async () => {
  const bars = optimizeCutting1D([{ id: '1', name: 'Barre', height: 5, width: 120, quantity: 3, material: 'mdf' }], 600, 3);
  assert.equal(listPages(await pdfOf(bars)).length, 0);
});

test('an Arabic piece name in a French PDF is drawn, and the Arabic sheet comes out', async () => {
  const arabicName = customerPlan();
  arabicName.placedPieces.forEach((p) => { p.baseName = 'باب'; });
  const fr = await pdfOf(arabicName);
  assert.match(fr.raw, /Amiri/, 'the Arabic font is embedded for the name');
  const ar = await pdfOf(customerPlan(), { locale: 'ar' });
  const page = ar.pages.find((p) => p.items.includes('45.44 m'));
  assert.ok(page && page.height > page.width);
  assert.ok(page.items.some((s) => /[؀-ۿﭐ-﻿]/.test(s)));
});

test('damaged fields in an old save never cost the PDF', async () => {
  const pieces = [placed({ originalIndex: 'x', baseName: 42, edges: 'oui', originalWidth: null })];
  const pdf = await pdfOf({ sheetsUsed: 1, wastePercentage: 1, totalAreaUsed: 1, totalAreaAvailable: 5, offcuts: [], placedPieces: pieces, cutMode: 7 });
  assert.equal(listPages(pdf).length, 1);
});
