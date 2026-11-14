const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// The price behind each total, line by line: panels × unit price, linear
// metres of each edge banding × rate, labour (user request, 2026-11-13).

const detailModule = () => loadTsModule('src/lib/cost-detail.ts');
const costing = () => loadTsModule('src/lib/costing.ts');

function input({ sheets = [], segments = [], labor = { pricing: { mode: 'fixed', value: 0 } } } = {}) {
  return {
    material: { sheets, basis: 'measured' },
    edge: { segments, basis: 'measured' },
    labor,
  };
}

const MDF_244 = { material: 'mdf', widthCm: 122, heightCm: 244 };

test('panels of the same kind and price are counted together', () => {
  const { buildCostDetail } = detailModule();
  const line = { areaM2: 2.9768, quantity: 1, pricing: { mode: 'per_sheet', value: 450 }, ...MDF_244, color: 'Blanc' };
  const detail = buildCostDetail(input({ sheets: [line, line, line] }));
  assert.equal(detail.panels.length, 1);
  assert.equal(detail.panels[0].count, 3);
  assert.equal(detail.panels[0].total, 1350);
  assert.equal(detail.panels[0].color, 'Blanc');
});

test('panels priced per m² keep their area so the line can be checked by hand', () => {
  const { buildCostDetail } = detailModule();
  const { computeCostBreakdown } = costing();
  const line = { areaM2: 2.9768, quantity: 1, pricing: { mode: 'per_m2', value: 120 }, ...MDF_244 };
  const costingInput = input({ sheets: [line, line, line] });
  const detail = buildCostDetail(costingInput);
  assert.equal(detail.panels[0].areaM2, 2.9768);
  assert.equal(detail.panels[0].count, 3);
  // 3 × 2,9768 m² × 120 MAD/m² = 1071,648
  assert.equal(detail.panels[0].total, 1071.65);
  assert.equal(detail.panels[0].total, computeCostBreakdown(costingInput).materialCost);
});

test('two panels of the same size but another colour or price stay on separate lines', () => {
  const { buildCostDetail } = detailModule();
  const white = { areaM2: 2.9768, quantity: 1, pricing: { mode: 'per_sheet', value: 450 }, ...MDF_244, color: 'Blanc' };
  const walnut = { ...white, color: 'Noyer', pricing: { mode: 'per_sheet', value: 520 } };
  const detail = buildCostDetail(input({ sheets: [white, walnut, white] }));
  assert.deepEqual(
    detail.panels.map((p) => [p.color, p.count, p.total]),
    [['Blanc', 2, 900], ['Noyer', 1, 520]]
  );
});

test('edge banding is summed in linear metres per colour and rate', () => {
  const { buildCostDetail } = detailModule();
  const { computeCostBreakdown } = costing();
  // Ten pieces 63 cm high banded on the left in white, three pieces banded all
  // round (2 × 63 + 2 × 55 = 2,36 m) in oak.
  const segments = [
    ...Array.from({ length: 10 }, () => ({ lengthM: 0.63, pricePerMeter: 8, edgeId: 'white' })),
    ...Array.from({ length: 3 }, () => ({ lengthM: 2.36, pricePerMeter: 12, edgeId: 'oak' })),
  ];
  const costingInput = input({ segments });
  const detail = buildCostDetail(costingInput);
  assert.deepEqual(
    detail.edges.map((e) => [e.edgeId, e.lengthM, e.pricePerMeter, e.total]),
    [['white', 6.3, 8, 50.4], ['oak', 7.08, 12, 84.96]]
  );
  const sum = detail.edges.reduce((s, e) => s + e.total, 0);
  assert.equal(Math.round(sum * 100) / 100, computeCostBreakdown(costingInput).edgeCost);
});

test('a result saved before the detail existed still gets a detail', () => {
  const { buildCostDetail } = detailModule();
  const detail = buildCostDetail(
    input({
      sheets: [{ areaM2: 2, quantity: 2, pricing: { mode: 'per_m2', value: 100 } }],
      segments: [{ lengthM: 1.5, pricePerMeter: 10 }],
    })
  );
  assert.equal(detail.panels[0].count, 2);
  assert.equal(detail.panels[0].total, 400);
  assert.equal(detail.panels[0].material, undefined);
  assert.equal(detail.edges[0].edgeId, undefined);
  assert.equal(detail.edges[0].total, 15);
});

test('labour shows only when it is actually charged', () => {
  const { buildCostDetail, hasLaborCharge } = detailModule();
  assert.equal(hasLaborCharge(buildCostDetail(input()).labor), false);
  const fixed = buildCostDetail(input({ labor: { pricing: { mode: 'fixed', value: 150 } } })).labor;
  assert.equal(hasLaborCharge(fixed), true);
  assert.equal(fixed.total, 150);
  const perMeter = buildCostDetail(
    input({ labor: { pricing: { mode: 'per_meter', value: 2 }, cutLengthM: 35.2, basis: 'measured' } })
  ).labor;
  assert.equal(perMeter.cutLengthM, 35.2);
  assert.equal(perMeter.total, 70.4);
});

// ─── The optimizer records what each cost line is ────────────────────────

const PIECES = [
  { name: 'Côté', height: 63, width: 55, quantity: 10, edges: { left: true, color: 'white' } },
  { name: 'Porte', height: 70, width: 40, quantity: 3, edges: { left: true, right: true, top: true, bottom: true, color: 'oak' } },
];
const SHEET = { id: 's1', height: 244, width: 122, kerf: 0.3, material: 'mdf', label: 'Stock atelier' };

test('the optimizer names the panel and the edge colour behind each cost line', () => {
  const { optimizeCutting2D } = loadTsModule('src/lib/cutting/binpacking.ts');
  const result = optimizeCutting2D(PIECES, [SHEET], { kerfWidth: 3 });
  const sheetLine = result.costingInput.material.sheets[0];
  assert.equal(sheetLine.material, 'mdf');
  assert.equal(sheetLine.label, 'Stock atelier');
  assert.equal(sheetLine.widthCm, 122);
  assert.equal(sheetLine.heightCm, 244);
  const edgeIds = new Set(result.costingInput.edge.segments.map((s) => s.edgeId));
  assert.deepEqual([...edgeIds].sort(), ['oak', 'white']);
});

test('naming the lines changes no figure: the totals are those of the bare lines', () => {
  const { optimizeCutting2D } = loadTsModule('src/lib/cutting/binpacking.ts');
  const { computeCostBreakdown } = costing();
  const result = optimizeCutting2D(PIECES, [SHEET], { kerfWidth: 3 });
  const bare = {
    material: {
      ...result.costingInput.material,
      sheets: result.costingInput.material.sheets.map(({ areaM2, quantity, pricing }) => ({ areaM2, quantity, pricing })),
    },
    edge: {
      ...result.costingInput.edge,
      segments: result.costingInput.edge.segments.map(({ lengthM, pricePerMeter }) => ({ lengthM, pricePerMeter })),
    },
    labor: result.costingInput.labor,
  };
  assert.deepEqual(computeCostBreakdown(bare), result.costBreakdown);
  // 10 × 0,63 m white at 8 MAD/m + 3 × 2,20 m oak at 12 MAD/m.
  assert.equal(result.costBreakdown.edgeCost, 129.6);
});

// ─── The PDF accepts and prints the detail ───────────────────────────────

test('the PDF payload keeps the panel and edge names, and cuts an over-long name instead of refusing', () => {
  const { CostBreakdownInputSchema } = loadTsModule('src/lib/exports/pdf-schema.ts');
  const parsed = CostBreakdownInputSchema.parse(
    input({
      sheets: [{ areaM2: 2, quantity: 1, pricing: { mode: 'per_sheet', value: 450 }, material: 'mdf', label: 'x'.repeat(300), color: 'Blanc' }],
      segments: [{ lengthM: 1, pricePerMeter: 8, edgeId: 'white' }],
    })
  );
  assert.equal(parsed.material.sheets[0].material, 'mdf');
  assert.equal(parsed.material.sheets[0].color, 'Blanc');
  assert.equal(parsed.material.sheets[0].label.length, 80);
  assert.equal(parsed.edge.segments[0].edgeId, 'white');
});

function pdfRequest(locale, costingInput) {
  return new Request('http://localhost/api/export-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectName: 'Cuisine',
      material: 'mdf',
      locale,
      sheet: { width: 122, height: 244, kerf: 0.3, margin: 0 },
      result: {
        sheetsUsed: 1,
        wastePercentage: 20,
        totalAreaUsed: 2.3,
        totalAreaAvailable: 2.9768,
        offcuts: [],
        placedPieces: [{ pieceNumber: 1, name: 'Côté', sheetIndex: 0, width: 55, height: 63, rotated: false, x: 0, y: 0 }],
        costingInput,
      },
    }),
  });
}

const PDF_COSTING = input({
  sheets: [{ areaM2: 2.9768, quantity: 2, pricing: { mode: 'per_sheet', value: 450 }, ...MDF_244, color: 'Blanc' }],
  segments: Array.from({ length: 10 }, () => ({ lengthM: 0.63, pricePerMeter: 8, edgeId: 'white' })),
});

test('the PDF report prints the price detail: panels × price, metres of edge × rate', async () => {
  const { POST } = loadTsModule('src/app/api/export-pdf/route.ts');
  const res = await POST(pdfRequest('fr', PDF_COSTING));
  assert.equal(res.status, 200);
  const text = Buffer.from(await res.arrayBuffer()).toString('latin1');
  assert.ok(text.includes('tail du chiffrage'), 'section title');
  assert.ok(text.includes('450,00 MAD / panneau'), 'panel unit price');
  assert.ok(text.includes('900,00 MAD'), 'panel line total');
  assert.ok(text.includes('6,3 m'), 'linear metres of edge banding');
  assert.ok(text.includes('8 MAD/m'), 'edge rate');
  assert.ok(text.includes('50,40 MAD'), 'edge line total');
  assert.ok(text.includes('950,40 MAD'), 'subtotal');
});

test('the price detail renders in English and Arabic too', async () => {
  const { POST } = loadTsModule('src/app/api/export-pdf/route.ts');
  for (const locale of ['en', 'ar']) {
    const res = await POST(pdfRequest(locale, PDF_COSTING));
    assert.equal(res.status, 200, locale);
    const text = Buffer.from(await res.arrayBuffer()).toString('latin1');
    assert.ok(text.includes('50,40 MAD'), `${locale}: edge line total`);
  }
});
