const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// Task 4 blocker (5): a pure quotation-payload builder that forwards the
// exact CostBreakdown produced by the optimizer plus explicit tax/discount
// into computeQuotationTotals — never re-deriving material/edge/labor cost
// itself. No quotation UI is expected in this task.

function loadQuotationPayload() {
  return loadTsModule('src/lib/quotation-payload.ts');
}

function sampleBreakdown() {
  return {
    currency: 'MAD',
    materialCost: 480,
    materialCostBasis: 'measured',
    edgeCost: 20,
    edgeCostBasis: 'measured',
    laborCost: 100,
    laborCostBasis: 'measured',
    subtotal: 600,
  };
}

test('buildQuotationPayload forwards the exact costBreakdown, tax, and discount it was given', () => {
  const { buildQuotationPayload } = loadQuotationPayload();
  const costBreakdown = sampleBreakdown();
  const tax = { mode: 'percentage', ratePercent: 20 };
  const discount = { mode: 'fixed', value: 50 };

  const payload = buildQuotationPayload({ costBreakdown, tax, discount });

  assert.deepEqual(payload.costBreakdown, costBreakdown);
  assert.deepEqual(payload.tax, tax);
  assert.deepEqual(payload.discount, discount);
});

test('buildQuotationPayload.totals matches computeQuotationTotals called directly with the same inputs', () => {
  const { buildQuotationPayload } = loadQuotationPayload();
  const { computeQuotationTotals } = loadTsModule('src/lib/costing.ts');
  const costBreakdown = sampleBreakdown();
  const tax = { mode: 'percentage', ratePercent: 20 };
  const discount = { mode: 'fixed', value: 50 };

  const payload = buildQuotationPayload({ costBreakdown, tax, discount });
  const expectedTotals = computeQuotationTotals({ costBreakdown, tax, discount });

  assert.deepEqual(payload.totals, expectedTotals);
});

test('buildQuotationPayload with no tax/no discount leaves the subtotal as the total', () => {
  const { buildQuotationPayload } = loadQuotationPayload();
  const costBreakdown = sampleBreakdown();

  const payload = buildQuotationPayload({
    costBreakdown,
    tax: { mode: 'none' },
    discount: { mode: 'none' },
  });

  assert.equal(payload.totals.total, costBreakdown.subtotal);
  assert.equal(payload.totals.discount, 0);
  assert.equal(payload.totals.tax, 0);
});

test('buildQuotationPayload never recomputes material/edge/labor cost — it stays byte-identical to the given costBreakdown', () => {
  const { buildQuotationPayload } = loadQuotationPayload();
  const costBreakdown = sampleBreakdown();

  const payload = buildQuotationPayload({
    costBreakdown,
    tax: { mode: 'percentage', ratePercent: 7.5 },
    discount: { mode: 'percentage', value: 15 },
  });

  assert.equal(payload.totals.materialCost, costBreakdown.materialCost);
  assert.equal(payload.totals.edgeCost, costBreakdown.edgeCost);
  assert.equal(payload.totals.laborCost, costBreakdown.laborCost);
  assert.equal(payload.totals.subtotal, costBreakdown.subtotal);
});

test('buildQuotationPayload propagates computeQuotationTotals throwing on an invalid tax/discount input, rather than swallowing it', () => {
  const { buildQuotationPayload } = loadQuotationPayload();
  assert.throws(() => buildQuotationPayload({
    costBreakdown: sampleBreakdown(),
    tax: { mode: 'percentage' }, // missing required ratePercent
    discount: { mode: 'none' },
  }), RangeError);
});
