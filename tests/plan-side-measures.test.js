const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

// Owner request, 2026-11-25, on a customer's plan: each measure is written
// along its own side (the width along the width, the height along the height)
// and no longer « H × W » in the middle, so the one who cuts does not mix them up.

const ROOT = path.resolve(__dirname, '..');
const load = (rel) => loadTsModule(path.join(ROOT, rel));
const { sideMeasures, shortMeasure, SCREEN_MEASURES, PDF_MEASURES } = load('src/lib/cutting/side-measures.ts');
const { edgeLines, EDGE_STROKE_CM, EDGE_INSET_PDF_CM } = load('src/lib/cutting/edge-lines.ts');

const place = (width, height, extra = {}) =>
  sideMeasures({ x: 0, y: 0, width, height }, { width: shortMeasure(String(width)), height: shortMeasure(String(height)) }, { ...SCREEN_MEASURES, ...extra });

/** The rectangles the two labels cover. */
function boxes(m) {
  const list = [];
  if (m.width) list.push({ x1: m.width.x - m.width.length / 2, x2: m.width.x + m.width.length / 2, y1: m.width.y - m.width.thickness / 2, y2: m.width.y + m.width.thickness / 2 });
  if (m.height) list.push({ x1: m.height.x - m.height.thickness / 2, x2: m.height.x + m.height.thickness / 2, y1: m.height.y - m.height.length / 2, y2: m.height.y + m.height.length / 2 });
  return list;
}
const overlap = (a, b) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

test('the width runs along the top side, the height along the left side', () => {
  const m = place(87, 30);
  assert.equal(m.width.text, '87');
  assert.equal(m.height.text, '30');
  assert.equal(m.width.x, 43.5);
  assert.ok(m.width.y < 30 * 0.25, 'near the top');
  assert.equal(m.height.y, 15);
  assert.ok(m.height.x < 87 * 0.1, 'near the left');
});

test('the measures follow the piece on the panel', () => {
  const at = sideMeasures({ x: 100, y: 50, width: 87, height: 30 }, { width: '87', height: '30' }, SCREEN_MEASURES);
  const origin = place(87, 30);
  assert.equal(at.width.x, origin.width.x + 100);
  assert.equal(at.height.y, origin.height.y + 50);
});

test('no measure is in the middle of the piece, whatever the size', () => {
  for (const [w, h] of [[87, 30], [32, 120], [60, 60], [12, 12], [228, 9]]) {
    const m = place(w, h);
    for (const b of boxes(m)) {
      assert.equal(b.x1 < w / 2 && b.x2 > w / 2 && b.y1 < h / 2 && b.y2 > h / 2, false, `${w}x${h}`);
    }
  }
});

test('the two measures and the number never overlap and stay inside', () => {
  for (const w of [5, 6, 8, 9, 10, 12, 15, 20, 30.5, 60, 120, 278]) {
    for (const h of [4, 5, 8, 10, 12.5, 20, 41.2, 87, 208]) {
      const m = place(w, h, { number: { text: '#128', font: Math.min(5.5, Math.max(2.5, Math.min(w, h) / 12)) } });
      const all = boxes(m);
      if (all.length === 2) assert.equal(overlap(all[0], all[1]), false, `${w}x${h} measures`);
      for (const b of all) assert.ok(b.x1 >= 0 && b.y1 >= 0 && b.x2 <= w && b.y2 <= h, `${w}x${h} inside`);
      if (Math.min(w, h) < 10) continue;
      const len = 4 * 0.6 * m.number.font;
      const thick = 0.72 * m.number.font;
      const number = { x1: m.number.x - len / 2, x2: m.number.x + len / 2, y1: m.number.y - thick / 2, y2: m.number.y + thick / 2 };
      for (const b of all) assert.equal(overlap(number, b), false, `${w}x${h} number`);
    }
  }
});

test('a narrow strip is written as big as it can be', () => {
  assert.ok(place(10, 60).height.font >= 2.5);
  assert.ok(place(12, 12).width.font >= 2.4);
});

test('a thin strip now shows both its measures', () => {
  const m = place(228, 9);
  assert.equal(m.width.text, '228');
  assert.equal(m.height.text, '9');
  // A 5.5 cm strip too, on paper: the point is narrow.
  const paper = sideMeasures({ x: 0, y: 0, width: 5.5, height: 90 }, { width: '5.5', height: '90' }, { ...PDF_MEASURES, minFont: 2.52 });
  assert.equal(paper.width.text, '5.5');
  const tall = place(4, 60);
  assert.equal(tall.height.text, '60');
});

test('a 1 cm bar (1D mode) has no measure: none is readable there', () => {
  const m = place(580, 1);
  assert.equal(m.width, null);
  assert.equal(m.height, null);
});

test('a measure never sits on the chant line of its side', () => {
  const edges = { top: true, left: true };
  for (const [style, inset] of [[SCREEN_MEASURES, undefined], [PDF_MEASURES, EDGE_INSET_PDF_CM]]) {
    for (const [w, h] of [[87, 30], [40, 20], [32, 120], [15, 70]]) {
      const lines = edgeLines({ x: 0, y: 0, width: w, height: h, rotated: false, edges }, inset);
      const top = lines.find((l) => l.y1 === l.y2).y1 + EDGE_STROKE_CM / 2;
      const left = lines.find((l) => l.x1 === l.x2).x1 + EDGE_STROKE_CM / 2;
      const m = sideMeasures({ x: 0, y: 0, width: w, height: h }, { width: String(w), height: String(h) }, style);
      assert.ok(m.width.y - m.width.thickness / 2 > top, `${w}x${h} top`);
      assert.ok(m.height.x - m.height.thickness / 2 > left, `${w}x${h} left`);
    }
  }
});

test('a whole measure is written without its ".0"', () => {
  assert.equal(shortMeasure('87.0'), '87');
  assert.equal(shortMeasure('29.5'), '29.5');
  assert.equal(shortMeasure('120'), '120');
  assert.equal(shortMeasure('100.0'), '100');
});

async function pdfText(placedPieces, extra = {}) {
  const { POST } = load('src/app/api/export-pdf/route.ts');
  const res = await POST(new Request('http://localhost/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectName: 'Projet', material: 'mdf', sheet: { width: 206, height: 279 },
      result: { sheetsUsed: 1, wastePercentage: 1, totalAreaUsed: 1, totalAreaAvailable: 5, offcuts: [], placedPieces },
      ...extra,
    }),
  }));
  assert.equal(res.status, 200);
  return Buffer.from(await res.arrayBuffer()).toString('latin1');
}

test('the PDF plan writes the height sideways and the width upright, turned pieces as they lie', async () => {
  // A 30 wide x 87 high piece laid on its side: 87 wide on the plan.
  const pdf = await pdfText([{ pieceNumber: 1, name: 'A', sheetIndex: 0, width: 87, height: 30, originalWidth: 30, originalHeight: 87, rotated: true, x: 0, y: 0 }]);
  assert.match(pdf, /0\.?0*1? 1\.?0* -1\.?0* 0\.?0*1? [\d.]+ [\d.]+ Tm\s*\(30\) Tj/, 'the height, a quarter turn');
  assert.match(pdf, /[\d.]+ [\d.]+ Td\s*\(87\) Tj/, 'the width, upright');
});

test('the screen draws the measures by the shared rule, never « H×W » in the middle', () => {
  const atelier = fs.readFileSync(path.join(ROOT, 'src/app/(site)/atelier/page.tsx'), 'utf8');
  const start = atelier.search(/<svg\s+data-testid="cut-plan-svg"/);
  const svg = atelier.slice(start, atelier.indexOf('</svg>', start));
  assert.match(svg, /<PlanMeasures/);
  assert.doesNotMatch(svg, /×/);
});
