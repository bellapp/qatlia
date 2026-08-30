const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

// The PDF export route receives `result` back over the network from a client
// that already ran the optimizer locally. It must never trust a submitted
// `result.costBreakdown` verbatim (a client could forge any figure there,
// independent of the components that are supposed to sum to it): it must
// instead recompute the breakdown itself, from `result.costingInput` (the
// exact input the optimizer originally passed to computeCostBreakdown — see
// OptimizationResult.costingInput in src/lib/cutting/binpacking.ts), through
// the one shared calculator (src/lib/costing.ts). When no costingInput is
// present (legacy/1D plans), the PDF must report cost unavailable, never a
// submitted totals object.

function baseBody(overrides = {}) {
  return {
    projectName: 'Projet Test',
    material: 'mdf',
    sheet: { width: 208, height: 278, kerf: 0.3, margin: 0 },
    result: {
      sheetsUsed: 1,
      wastePercentage: 12.5,
      totalAreaUsed: 5,
      totalAreaAvailable: 5.78,
      offcuts: [],
      placedPieces: [
        { pieceNumber: 1, name: 'Panneau', sheetIndex: 0, width: 120, height: 60, rotated: false, x: 0, y: 0 },
      ],
    },
    ...overrides,
  };
}

function makeRequest(body) {
  return new Request('http://localhost/api/export-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function pdfTextOf(res) {
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString('latin1');
}

// A small, legitimate costingInput: one 2 m² sheet at 100 MAD/m², no edge
// banding, no labor -> materialCost 200, edgeCost 0, laborCost 0, subtotal 200.
function legitCostingInput() {
  return {
    material: { sheets: [{ areaM2: 2, quantity: 1, pricing: { mode: 'per_m2', value: 100 } }], basis: 'measured' },
    edge: { segments: [], basis: 'measured' },
    labor: { pricing: { mode: 'fixed', value: 0 } },
  };
}

function forgedCostBreakdown(subtotal) {
  return {
    currency: 'MAD',
    materialCost: subtotal,
    materialCostBasis: 'measured',
    edgeCost: 0,
    edgeCostBasis: 'measured',
    laborCost: 0,
    laborCostBasis: 'measured',
    subtotal,
  };
}

// ─── Schema: strict numeric bounds on CostBreakdownInput ────────────────

test('CostBreakdownInputSchema rejects Infinity in a rate field', () => {
  const { CostBreakdownInputSchema } = loadTsModule('src/lib/exports/pdf-schema.ts');
  const input = legitCostingInput();
  input.material.sheets[0].pricing.value = Infinity;
  assert.equal(CostBreakdownInputSchema.safeParse(input).success, false);
});

test('CostBreakdownInputSchema rejects a negative price', () => {
  const { CostBreakdownInputSchema } = loadTsModule('src/lib/exports/pdf-schema.ts');
  const input = legitCostingInput();
  input.material.sheets[0].pricing.value = -1;
  assert.equal(CostBreakdownInputSchema.safeParse(input).success, false);
});

test('CostBreakdownInputSchema rejects a negative edge segment length', () => {
  const { CostBreakdownInputSchema } = loadTsModule('src/lib/exports/pdf-schema.ts');
  const input = legitCostingInput();
  input.edge.segments.push({ lengthM: -1, pricePerMeter: 5 });
  assert.equal(CostBreakdownInputSchema.safeParse(input).success, false);
});

test('CostBreakdownInputSchema rejects a sheet quantity above 10000', () => {
  const { CostBreakdownInputSchema } = loadTsModule('src/lib/exports/pdf-schema.ts');
  const input = legitCostingInput();
  input.material.sheets[0].quantity = 10001;
  assert.equal(CostBreakdownInputSchema.safeParse(input).success, false);
});

test('CostBreakdownInputSchema rejects a material.sheets array longer than 5000', () => {
  const { CostBreakdownInputSchema } = loadTsModule('src/lib/exports/pdf-schema.ts');
  const input = legitCostingInput();
  input.material.sheets = Array.from({ length: 5001 }, () => ({
    areaM2: 1,
    quantity: 1,
    pricing: { mode: 'per_m2', value: 1 },
  }));
  assert.equal(CostBreakdownInputSchema.safeParse(input).success, false);
});

test('CostBreakdownInputSchema rejects an edge.segments array longer than 5000', () => {
  const { CostBreakdownInputSchema } = loadTsModule('src/lib/exports/pdf-schema.ts');
  const input = legitCostingInput();
  input.edge.segments = Array.from({ length: 5001 }, () => ({ lengthM: 1, pricePerMeter: 1 }));
  assert.equal(CostBreakdownInputSchema.safeParse(input).success, false);
});

test('CostBreakdownInputSchema rejects per_meter labor pricing missing cutLengthM/basis', () => {
  const { CostBreakdownInputSchema } = loadTsModule('src/lib/exports/pdf-schema.ts');
  const input = legitCostingInput();
  input.labor = { pricing: { mode: 'per_meter', value: 10 } };
  assert.equal(CostBreakdownInputSchema.safeParse(input).success, false);
});

test('CostBreakdownInputSchema accepts a well-formed input', () => {
  const { CostBreakdownInputSchema } = loadTsModule('src/lib/exports/pdf-schema.ts');
  assert.equal(CostBreakdownInputSchema.safeParse(legitCostingInput()).success, true);
});

test('CostBreakdownSchema rejects Infinity and negative submitted totals', () => {
  const { CostBreakdownSchema } = loadTsModule('src/lib/exports/pdf-schema.ts');
  assert.equal(CostBreakdownSchema.safeParse(forgedCostBreakdown(Infinity)).success, false);
  assert.equal(CostBreakdownSchema.safeParse(forgedCostBreakdown(-1)).success, false);
});

// ─── Schema: strict bounds on the result envelope ───────────────────────

test('ExportSchema rejects sheetsUsed above 100', () => {
  const { ExportSchema } = loadTsModule('src/lib/exports/pdf-schema.ts');
  const body = baseBody({ result: { ...baseBody().result, sheetsUsed: 101 } });
  assert.equal(ExportSchema.safeParse(body).success, false);
});

test('ExportSchema accepts sheetsUsed of exactly 100', () => {
  const { ExportSchema } = loadTsModule('src/lib/exports/pdf-schema.ts');
  const body = baseBody({ result: { ...baseBody().result, sheetsUsed: 100 } });
  assert.equal(ExportSchema.safeParse(body).success, true);
});

test('ExportSchema rejects an offcuts array longer than 5000', () => {
  const { ExportSchema } = loadTsModule('src/lib/exports/pdf-schema.ts');
  const hugeOffcuts = Array.from({ length: 5001 }, () => ({
    sheetIndex: 0,
    width: 10,
    height: 10,
    x: 0,
    y: 0,
    areaM2: 0.01,
    isReusable: false,
  }));
  const body = baseBody({ result: { ...baseBody().result, offcuts: hugeOffcuts } });
  assert.equal(ExportSchema.safeParse(body).success, false);
});

test('ExportSchema rejects a placedPieces array longer than 5000', () => {
  const { ExportSchema } = loadTsModule('src/lib/exports/pdf-schema.ts');
  const hugePieces = Array.from({ length: 5001 }, (_, i) => ({
    pieceNumber: i + 1,
    name: 'P',
    sheetIndex: 0,
    width: 10,
    height: 10,
    rotated: false,
    x: 0,
    y: 0,
  }));
  const body = baseBody({ result: { ...baseBody().result, placedPieces: hugePieces } });
  assert.equal(ExportSchema.safeParse(body).success, false);
});

test('ExportSchema rejects Infinity in a placed piece dimension', () => {
  const { ExportSchema } = loadTsModule('src/lib/exports/pdf-schema.ts');
  const body = baseBody();
  body.result.placedPieces[0].width = Infinity;
  assert.equal(ExportSchema.safeParse(body).success, false);
});

test('ExportSchema rejects a negative sheet width', () => {
  const { ExportSchema } = loadTsModule('src/lib/exports/pdf-schema.ts');
  const body = baseBody({ sheet: { width: -1, height: 278, kerf: 0.3, margin: 0 } });
  assert.equal(ExportSchema.safeParse(body).success, false);
});

// ─── Route: recomputation, never trusting a submitted totals object ────

test('a forged result.costBreakdown is ignored: the PDF shows the total recomputed from costingInput', async () => {
  const { POST } = loadTsModule('src/app/api/export-pdf/route.ts');
  const body = baseBody({
    result: {
      ...baseBody().result,
      costingInput: legitCostingInput(),
      costBreakdown: forgedCostBreakdown(999999.99),
    },
  });

  const res = await POST(makeRequest(body));
  assert.equal(res.status, 200);
  const text = await pdfTextOf(res);

  assert.ok(text.includes('200,00 MAD'), 'must render the subtotal recomputed from costingInput (200 MAD)');
  assert.ok(!text.includes('999999,99'), 'the forged submitted subtotal must never reach the PDF');
});

test('without costingInput, the PDF reports cost unavailable — it never falls back to a submitted costBreakdown', async () => {
  const { POST } = loadTsModule('src/app/api/export-pdf/route.ts');
  const body = baseBody({
    result: {
      ...baseBody().result,
      costBreakdown: forgedCostBreakdown(555.55),
      // deliberately no costingInput
    },
  });

  const res = await POST(makeRequest(body));
  assert.equal(res.status, 200);
  const text = await pdfTextOf(res);

  assert.ok(text.includes('Non calcul'), 'top total must read cost-unavailable, not a submitted figure');
  assert.ok(text.includes('Non disponible'), 'the financial recap must also read cost-unavailable');
  assert.ok(!text.includes('555,55'), 'a submitted costBreakdown with no costingInput must never be rendered');
});

// ─── Source contract: the route must recompute, never destructure verbatim ─

test('route source never destructures result.costBreakdown directly, and recomputes via computeCostBreakdown(result.costingInput)', () => {
  const source = fs.readFileSync(path.resolve('src/app/api/export-pdf/route.ts'), 'utf8');

  assert.doesNotMatch(
    source,
    /const\s*\{\s*costBreakdown\s*\}\s*=\s*result/,
    'must never bind result.costBreakdown verbatim'
  );
  assert.match(
    source,
    /computeCostBreakdown\(result\.costingInput\)/,
    'must recompute from result.costingInput through the shared calculator'
  );
  assert.match(
    source,
    /import\s*\{\s*computeCostBreakdown\s*\}\s*from\s*'@\/lib\/costing'/,
    'must import the shared calculator'
  );
  assert.doesNotMatch(source, /:\s*any\b/, 'route must stay strictly typed (no `any`)');
});
