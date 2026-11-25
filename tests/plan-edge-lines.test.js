const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

// Owner request, 2026-11-25: draw the chants on the cutting plan as blue
// dashes inside the piece, as another optimizer's PDF does. The flags are the
// piece's own sides; on the plan the piece may be turned, so its chants turn
// with it: an 87 cm chant drawn on the 30 cm side would be banded wrong.

const ROOT = path.resolve(__dirname, '..');
const load = (rel) => loadTsModule(path.join(ROOT, rel));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const { edgeSidesOnPlan, edgeLines, hasEdgeLines } = load('src/lib/cutting/edge-lines.ts');
const { optimizeCutting2D } = load('src/lib/cutting/binpacking.ts');

/** A piece 30 high and 87 wide, placed as it is. */
const straight = (edges, extra = {}) => ({
  x: 10, y: 20, width: 87, height: 30, originalWidth: 87, originalHeight: 30, rotated: false, edges, ...extra,
});
/** The same piece, turned. */
const turned = (edges, extra = {}) => ({
  x: 10, y: 20, width: 30, height: 87, originalWidth: 87, originalHeight: 30, rotated: true, edges, ...extra,
});

const lengthOf = (line) => Math.hypot(line.x2 - line.x1, line.y2 - line.y1);

test('a piece placed as it is keeps its own sides', () => {
  assert.deepEqual(edgeSidesOnPlan(straight({ bottom: true })), { top: false, right: false, bottom: true, left: false });
  assert.deepEqual(edgeSidesOnPlan(straight({ top: true, left: true, right: false })), { top: true, right: false, bottom: false, left: true });
});

test('a turned piece turns its chants a quarter clockwise', () => {
  assert.deepEqual(edgeSidesOnPlan(turned({ top: true })), { top: false, right: true, bottom: false, left: false });
  assert.deepEqual(edgeSidesOnPlan(turned({ right: true })), { top: false, right: false, bottom: true, left: false });
  assert.deepEqual(edgeSidesOnPlan(turned({ bottom: true })), { top: false, right: false, bottom: false, left: true });
  assert.deepEqual(edgeSidesOnPlan(turned({ left: true })), { top: true, right: false, bottom: false, left: false });
});

test('a piece swapped for its grain is turned even though it is not flagged rotated', () => {
  assert.deepEqual(edgeSidesOnPlan(turned({ top: true }, { rotated: false })), { top: false, right: true, bottom: false, left: false });
});

test('without the original size (an older save), the rotated flag decides', () => {
  const old = { originalWidth: undefined, originalHeight: undefined };
  assert.equal(edgeSidesOnPlan(turned({ top: true }, old)).right, true);
  assert.equal(edgeSidesOnPlan(straight({ top: true }, old)).top, true);
});

test('a square piece follows the rotated flag', () => {
  const square = { x: 0, y: 0, width: 40, height: 40, originalWidth: 40, originalHeight: 40, edges: { top: true } };
  assert.equal(edgeSidesOnPlan({ ...square, rotated: false }).top, true);
  assert.equal(edgeSidesOnPlan({ ...square, rotated: true }).right, true);
});

test('no chant, no line: undefined, null, all false, or damaged flags', () => {
  for (const edges of [undefined, null, {}, { top: false, color: 'white' }, { top: 'yes', left: 1 }]) {
    assert.deepEqual(edgeLines(straight(edges)), [], JSON.stringify(edges));
  }
  assert.equal(hasEdgeLines([straight(undefined), straight({ top: false })]), false);
  assert.equal(hasEdgeLines([straight(undefined), straight({ top: true })]), true);
});

test('each line runs along its side, inside the piece', () => {
  for (const piece of [straight({ top: true, right: true, bottom: true, left: true }), straight({ top: true, left: true }, { width: 57.4, height: 3, originalWidth: 57.4, originalHeight: 3 })]) {
    const lines = edgeLines(piece);
    assert.ok(lines.length >= 2);
    for (const line of lines) {
      assert.ok(line.x1 === line.x2 || line.y1 === line.y2, 'straight');
      assert.ok(Math.min(line.x1, line.x2) > piece.x && Math.max(line.x1, line.x2) < piece.x + piece.width);
      assert.ok(Math.min(line.y1, line.y2) > piece.y && Math.max(line.y1, line.y2) < piece.y + piece.height);
    }
  }
  const [bottom] = edgeLines(straight({ bottom: true }));
  assert.ok(bottom.y1 > 20 + 30 / 2, 'the bottom line sits in the lower half');
});

// The real optimizer, not a hand-made placement: whatever it turned, the line
// drawn is as long as the side the artisan flagged.
test('on a real plan, a chant of the long side is always drawn on the long side', () => {
  const sheet = { id: 's', width: 206, height: 279, kerf: 0.5, margin: 0, grainDirection: false, material: 'mdf', quantity: 1 };
  const pieces = [
    { id: 'a', name: 'A', height: 30, width: 87, quantity: 6, rotatable: true, edges: { bottom: true } },
    { id: 'b', name: 'B', height: 120, width: 32, quantity: 3, rotatable: true, edges: { left: true } },
    { id: 'c', name: 'C', height: 88, width: 29.5, quantity: 4, rotatable: true, edges: { right: true } },
    { id: 'd', name: 'D', height: 20, width: 60, quantity: 2, rotatable: true, grain: 'horizontal', edges: { top: true } },
  ];
  const { placedPieces } = optimizeCutting2D(pieces, [sheet], { kerfWidth: 5 });
  assert.equal(placedPieces.length, 15);
  assert.ok(placedPieces.some((p) => p.width !== p.originalWidth), 'the fixture turns at least one piece');
  for (const placed of placedPieces) {
    const lines = edgeLines(placed);
    assert.equal(lines.length, 1);
    const longSide = Math.max(placed.width, placed.height);
    assert.ok(lengthOf(lines[0]) > longSide * 0.8, `${placed.name}: ${lengthOf(lines[0])} on ${longSide}`);
  }
});

// --- Where it is drawn ------------------------------------------------------

const atelier = read('src/app/(site)/atelier/page.tsx');

test('the plan on screen draws the chants over each piece, and says what the dashes are', () => {
  const start = atelier.search(/<svg\s+data-testid="cut-plan-svg"/);
  const svg = atelier.slice(start, atelier.indexOf('</svg>', start));
  assert.match(svg, /edgeLines\(p\)/);
  assert.match(svg, /strokeDasharray=\{EDGE_DASH_CM\.join\(' '\)\}/);
  assert.match(atelier, /data-testid="cut-plan-edge-legend"/);
  assert.match(atelier, /t\('atelier\.plan\.edgeLegend'\)/);
  for (const locale of ['fr', 'en', 'ar']) {
    const messages = load(`src/i18n/messages/${locale}.ts`)[locale];
    assert.equal(typeof messages.atelier.plan.edgeLegend, 'string', locale);
  }
});

// The PNG took the first <svg> of the page: the logo of the header.
test('the PNG export takes the plan, at a size that can be read', () => {
  const png = atelier.slice(atelier.indexOf('const handleDownloadPng'), atelier.indexOf('const handleDownloadDxf'));
  assert.doesNotMatch(png, /querySelector\('svg'\)/);
  assert.match(png, /querySelector<SVGSVGElement>\('\[data-testid="cut-plan-svg"\]'\)/);
  assert.match(png, /setAttribute\('width'/);
  assert.match(png, /setAttribute\('height'/);
});

// --- The PDF ----------------------------------------------------------------

const pdfPiece = (extra = {}) => ({ pieceNumber: 1, name: 'A', sheetIndex: 0, width: 87, height: 30, rotated: false, x: 0, y: 0, ...extra });
const pdfBody = (placedPieces, extra = {}) => ({
  projectName: 'Projet',
  material: 'mdf',
  sheet: { width: 206, height: 279, kerf: 0.5, margin: 0 },
  result: {
    sheetsUsed: Math.max(...placedPieces.map((p) => p.sheetIndex)) + 1,
    wastePercentage: 10, totalAreaUsed: 1, totalAreaAvailable: 5, offcuts: [], placedPieces,
  },
  ...extra,
});
async function pdfOf(body) {
  const { POST } = load('src/app/api/export-pdf/route.ts');
  const res = await POST(new Request('http://localhost/api/export-pdf', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
  assert.equal(res.status, 200);
  return Buffer.from(await res.arrayBuffer()).toString('latin1');
}
const pageCount = (pdf) => (pdf.match(/\/Type\s*\/Page\b/g) ?? []).length;
// The blue of the chants as jsPDF writes a stroke colour: "0.11 0.306 0.847 RG".
const BLUE = /0\.11\d* 0\.3\d* 0\.8\d* RG/;

test('the PDF draws the chants in blue dashes with a legend, only when there are some', async () => {
  const plain = await pdfOf(pdfBody([pdfPiece()]));
  assert.doesNotMatch(plain, BLUE);
  assert.equal(plain.includes('(Chant)'), false);

  const banded = await pdfOf(pdfBody([pdfPiece({ edges: { bottom: true, color: 'white' } })]));
  assert.match(banded, BLUE);
  assert.ok(banded.includes('(Chant)'));
  const dashes = banded.match(/\[[\d. ]*\] 0\.? d/g);
  assert.ok(dashes.some((d) => /^\[\d/.test(d)), 'a dash pattern');
  assert.match(dashes.at(-1), /^\[\]/, 'and back to a solid line');
});

test('two panels cut alike but banded differently are two drawings, not "2 copies"', async () => {
  const same = await pdfOf(pdfBody([pdfPiece({ edges: { top: true } }), pdfPiece({ sheetIndex: 1, edges: { top: true } })]));
  const different = await pdfOf(pdfBody([pdfPiece({ edges: { top: true } }), pdfPiece({ sheetIndex: 1, edges: { bottom: true } })]));
  assert.equal(pageCount(different), pageCount(same) + 1);
});

test('damaged chants in a saved plan never cost the PDF', async () => {
  for (const edges of [null, 'oui', 3, { top: 'yes' }, []]) {
    const pdf = await pdfOf(pdfBody([pdfPiece({ edges, originalWidth: 'x', originalHeight: null })]));
    assert.doesNotMatch(pdf, BLUE, JSON.stringify(edges));
  }
});

// --- The picture sent on WhatsApp --------------------------------------------

test('the WhatsApp picture carries the chants of its panel and their legend', () => {
  const { photoPreviewPlan } = load('src/lib/whatsapp/photo-summary.ts');
  const { planImageLayout } = load('src/lib/whatsapp/plan-image.ts');
  const draft = (edges) => ({ pieces: [{ name: '', height: 88, width: 34, quantity: 2, ...(edges ? { edges } : {}) }], sheet: { height: 278, width: 208 } });

  const plain = planImageLayout(photoPreviewPlan(draft(null)));
  assert.equal(plain.edges, null);
  assert.equal(plain.legend.edges, null);

  const layout = planImageLayout(photoPreviewPlan(draft({ left: true, right: true, top: true, bottom: true })));
  assert.equal(layout.edges.lines.length, 8);
  for (const line of layout.edges.lines) {
    for (const [x, y] of [[line.x1, line.y1], [line.x2, line.y2]]) {
      assert.ok(x > 0 && x < layout.panel.width && y > 0 && y < layout.panel.height, 'inside the panel');
    }
  }
  assert.equal(layout.legend.edges, 'Chant');
  assert.ok(layout.legend.top >= layout.panel.top + layout.panel.height);
  assert.ok(layout.legend.top + layout.legend.height <= layout.card.top + layout.card.height);
  assert.equal(layout.height, plain.height, 'the line under the panel is there for the unit anyway');
});
