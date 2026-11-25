const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

// Owner report, 2026-11-25: with a price per metre typed, the sides read from
// a photo or ticked by hand were banded for free, since they carry no colour.
// The price typed is for every side ticked, with or without a colour.

const ROOT = path.resolve(__dirname, '..');
const load = (rel) => loadTsModule(path.join(ROOT, rel));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const { optimizeCutting2D, repriceCostingInput } = load('src/lib/cutting/binpacking.ts');
const { computeCostBreakdown } = load('src/lib/costing.ts');
const { uncountedEdgeMetres } = load('src/lib/uncounted-edges.ts');

const SHEET = { id: 's1', height: 278, width: 208, kerf: 0, margin: 0, material: 'mdf', quantity: 5 };
const plan = (pieces, options = {}) => optimizeCutting2D(pieces.map((p, i) => ({ id: `p${i}`, rotatable: true, ...p })), [SHEET], { kerfWidth: 0, ...options });
/** 2 x (1 m + 0,5 m) = 3 m of edge banding. */
const ticked = (edges) => [{ name: 'Porte', height: 100, width: 50, quantity: 2, edges: { left: true, top: true, ...edges } }];

test('the price typed counts every ticked side, whatever its colour', () => {
  for (const edges of [{}, { color: 'none' }, { color: '' }, { color: 'white' }, { color: 'couleur inconnue' }]) {
    const result = plan(ticked(edges), { edgeBandPricePerM: 10 });
    assert.equal(result.costBreakdown.edgeCost, 30, JSON.stringify(edges));
    assert.equal(uncountedEdgeMetres(result), 0);
  }
});

test('a piece with no side ticked costs no edge banding', () => {
  for (const edges of [undefined, {}, { left: false, right: false, top: false, bottom: false, color: 'none' }]) {
    const result = plan([{ name: 'Fond', height: 100, width: 50, quantity: 2, edges }], { edgeBandPricePerM: 10 });
    assert.equal(result.costBreakdown.edgeCost, 0);
    assert.equal(uncountedEdgeMetres(result), 0);
  }
});

test('without a price typed, a colour keeps its catalog price and no colour stays at zero, said as uncounted', () => {
  assert.equal(plan(ticked({ color: 'white' })).costBreakdown.edgeCost, 24);
  assert.equal(uncountedEdgeMetres(plan(ticked({ color: 'white' }))), 0);
  const bare = plan(ticked({}));
  assert.equal(bare.costBreakdown.edgeCost, 0);
  assert.equal(uncountedEdgeMetres(bare), 3);
  // Both in one job: only what is not counted is said.
  const mixed = plan([...ticked({ color: 'white' }), { name: 'Fond', height: 200, width: 40, quantity: 1, edges: { left: true } }]);
  assert.equal(mixed.costBreakdown.edgeCost, 24);
  assert.equal(uncountedEdgeMetres(mixed), 2);
});

test('typing the price after the plan counts the sides at once, and clearing it takes them back', () => {
  const before = plan(ticked({}));
  const priced = repriceCostingInput(before.costingInput, { edgeBandPricePerM: 10, placedPieces: before.placedPieces });
  assert.deepEqual(computeCostBreakdown(priced), plan(ticked({}), { edgeBandPricePerM: 10 }).costBreakdown);
  const cleared = repriceCostingInput(priced, { placedPieces: before.placedPieces });
  assert.deepEqual(computeCostBreakdown(cleared), before.costBreakdown);
});

test('repricing keeps the old segments when the saved pieces cannot say the lengths', () => {
  const before = plan(ticked({ color: 'white' }));
  const legacy = before.placedPieces.map(({ originalWidth, originalHeight, ...piece }) => piece);
  const repriced = repriceCostingInput(before.costingInput, { edgeBandPricePerM: 10, placedPieces: legacy });
  assert.equal(computeCostBreakdown(repriced).edgeCost, 30);
  // A segment saved before segments were named keeps its price.
  const unnamed = { ...before.costingInput, edge: { ...before.costingInput.edge, segments: [{ lengthM: 1, pricePerMeter: 8 }] } };
  assert.deepEqual(repriceCostingInput(unnamed, { edgeBandPricePerM: 20, placedPieces: before.placedPieces }).edge, unnamed.edge);
});

test('a plan without prices, or damaged, has nothing to say', () => {
  assert.equal(uncountedEdgeMetres({ placedPieces: [] }), 0);
  const result = plan(ticked({}));
  assert.equal(uncountedEdgeMetres({ ...result, costingInput: undefined }), 0);
  assert.equal(uncountedEdgeMetres({ ...result, placedPieces: result.placedPieces.map((p) => ({ ...p, originalWidth: undefined, originalHeight: undefined })) }), 0);
});

test('the atelier says it under the cost, with the way to count them', () => {
  const atelier = read('src/app/(site)/atelier/page.tsx');
  assert.match(atelier, /data-testid="uncounted-edges"/);
  // A price of zero is a choice: nothing to say.
  assert.match(atelier, /edgePrice !== 0/);
  assert.match(atelier, /placedPieces: current\.placedPieces/);
  for (const [locale, word] of [['fr', 'Mettre le prix du chant'], ['en', 'Set the edge banding price'], ['ar', 'ضع ثمن الحافة']]) {
    assert.equal(load(`src/i18n/messages/${locale}.ts`)[locale].atelier.cost.uncountedSet, word);
  }
});

test('the quote says it too, before it is made', () => {
  assert.match(read('src/components/QuotationDialog.tsx'), /uncountedEdgeMetres > 0 && \(\s*<div role="status" data-testid="quotation-uncounted-edges"/);
  assert.match(read('src/app/(site)/atelier/page.tsx'), /uncountedEdgeMetres=\{uncountedEdges\}/);
});

test('a side without a colour is written "Chant" alone in the price detail', () => {
  for (const file of ['src/app/(site)/atelier/page.tsx', 'src/app/api/export-pdf/route.ts']) {
    assert.match(read(file), /edge\.edgeId && edge\.edgeId !== 'none' \?/, file);
  }
  // It may be billed now: the choice no longer reads "none".
  for (const [locale, word] of [['fr', 'Sans couleur'], ['en', 'No colour'], ['ar', 'بدون لون']]) {
    assert.equal(load(`src/i18n/messages/${locale}.ts`)[locale].pieces.edgeBanding.none, word);
  }
});
