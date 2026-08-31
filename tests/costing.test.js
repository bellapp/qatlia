const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

// src/lib/costing.ts is the single canonical calculator for material, edge,
// and labor costs (MAD). Every surface that shows or persists a cost —
// the 2D/1D optimizer, the atelier UI, saved projects, PDF exports, and a
// future quotation layer — must call these same functions instead of
// re-deriving its own formula. Tax/discount only ever apply in the
// quotation wrapper (computeQuotationTotals), never inside the plan-level
// cost breakdown itself.

function loadCosting() {
  return loadTsModule('src/lib/costing.ts');
}

// ─── Material cost ──────────────────────────────────────────────────────

test('computeMaterialCost: per_sheet pricing multiplies price by sheet quantity, ignoring area', () => {
  const { computeMaterialCost } = loadCosting();
  const cost = computeMaterialCost({
    sheets: [{ areaM2: 5.78, quantity: 3, pricing: { mode: 'per_sheet', value: 450 } }],
    basis: 'measured',
  });
  assert.equal(cost, 1350);
});

test('computeMaterialCost: per_m2 pricing multiplies price by area and quantity', () => {
  const { computeMaterialCost } = loadCosting();
  const cost = computeMaterialCost({
    sheets: [{ areaM2: 2, quantity: 1, pricing: { mode: 'per_m2', value: 120 } }],
    basis: 'measured',
  });
  assert.equal(cost, 240);
});

test('computeMaterialCost: per_sheet and per_m2 modes agree when the per-sheet price equals area x per-m2 rate', () => {
  const { computeMaterialCost } = loadCosting();
  const areaM2 = 2.78;
  const perM2Rate = 150;
  const equivalentPerSheetPrice = areaM2 * perM2Rate;

  const viaPerSheet = computeMaterialCost({
    sheets: [{ areaM2, quantity: 4, pricing: { mode: 'per_sheet', value: equivalentPerSheetPrice } }],
    basis: 'measured',
  });
  const viaPerM2 = computeMaterialCost({
    sheets: [{ areaM2, quantity: 4, pricing: { mode: 'per_m2', value: perM2Rate } }],
    basis: 'measured',
  });

  assert.equal(viaPerSheet, viaPerM2);
});

test('computeMaterialCost: sums multiple sheet specs (mixed materials/pricing modes) in one breakdown', () => {
  const { computeMaterialCost } = loadCosting();
  const cost = computeMaterialCost({
    sheets: [
      { areaM2: 2, quantity: 2, pricing: { mode: 'per_m2', value: 120 } }, // 480
      { areaM2: 1.5, quantity: 1, pricing: { mode: 'per_sheet', value: 300 } }, // 300
    ],
    basis: 'measured',
  });
  assert.equal(cost, 780);
});

test('computeMaterialCost: zero sheets is a valid boundary that costs nothing', () => {
  const { computeMaterialCost } = loadCosting();
  assert.equal(computeMaterialCost({ sheets: [], basis: 'measured' }), 0);
});

test('computeMaterialCost: zero-priced stock is valid and costs nothing', () => {
  const { computeMaterialCost } = loadCosting();
  const cost = computeMaterialCost({
    sheets: [{ areaM2: 2, quantity: 5, pricing: { mode: 'per_m2', value: 0 } }],
    basis: 'measured',
  });
  assert.equal(cost, 0);
});

test('computeMaterialCost: rejects a negative stock pricing value instead of silently negating cost', () => {
  const { computeMaterialCost } = loadCosting();
  assert.throws(() => computeMaterialCost({
    sheets: [{ areaM2: 2, quantity: 1, pricing: { mode: 'per_m2', value: -1 } }],
    basis: 'measured',
  }), RangeError);
});

test('computeMaterialCost: rejects a non-finite or negative area', () => {
  const { computeMaterialCost } = loadCosting();
  assert.throws(() => computeMaterialCost({
    sheets: [{ areaM2: -0.1, quantity: 1, pricing: { mode: 'per_m2', value: 100 } }],
    basis: 'measured',
  }), RangeError);
  assert.throws(() => computeMaterialCost({
    sheets: [{ areaM2: NaN, quantity: 1, pricing: { mode: 'per_m2', value: 100 } }],
    basis: 'measured',
  }), RangeError);
});

test('computeMaterialCost: rejects a non-integer or negative sheet quantity', () => {
  const { computeMaterialCost } = loadCosting();
  assert.throws(() => computeMaterialCost({
    sheets: [{ areaM2: 2, quantity: 1.5, pricing: { mode: 'per_m2', value: 100 } }],
    basis: 'measured',
  }), RangeError);
  assert.throws(() => computeMaterialCost({
    sheets: [{ areaM2: 2, quantity: -1, pricing: { mode: 'per_m2', value: 100 } }],
    basis: 'measured',
  }), RangeError);
});

// ─── Edge cost ──────────────────────────────────────────────────────────

test('computeEdgeCost: sums length x resolved rate across segments', () => {
  const { computeEdgeCost } = loadCosting();
  const cost = computeEdgeCost({
    segments: [
      { lengthM: 1.6, pricePerMeter: 8 },
      { lengthM: 0.9, pricePerMeter: 12 },
    ],
    basis: 'measured',
  });
  assert.equal(cost, 1.6 * 8 + 0.9 * 12);
});

test('computeEdgeCost: no configured edges is a valid boundary that costs nothing (never a perimeter fallback)', () => {
  const { computeEdgeCost } = loadCosting();
  assert.equal(computeEdgeCost({ segments: [], basis: 'measured' }), 0);
});

test('computeEdgeCost: rejects a negative segment length or rate', () => {
  const { computeEdgeCost } = loadCosting();
  assert.throws(() => computeEdgeCost({ segments: [{ lengthM: -1, pricePerMeter: 8 }], basis: 'measured' }), RangeError);
  assert.throws(() => computeEdgeCost({ segments: [{ lengthM: 1, pricePerMeter: -8 }], basis: 'measured' }), RangeError);
});

test('resolveEdgeRatePerMeter: a preset rate and an equal explicit override resolve identically', () => {
  const { resolveEdgeRatePerMeter, computeEdgeCost } = loadCosting();
  const presetRate = resolveEdgeRatePerMeter({ kind: 'preset', preset: { id: 'white', pricePerMeter: 8 } });
  const explicitRate = resolveEdgeRatePerMeter({ kind: 'explicit', pricePerMeter: 8 });
  assert.equal(presetRate, explicitRate);

  const viaPreset = computeEdgeCost({ segments: [{ lengthM: 2, pricePerMeter: presetRate }], basis: 'measured' });
  const viaExplicit = computeEdgeCost({ segments: [{ lengthM: 2, pricePerMeter: explicitRate }], basis: 'measured' });
  assert.equal(viaPreset, viaExplicit);
});

test('resolveEdgeRatePerMeter: rejects a negative preset or explicit rate', () => {
  const { resolveEdgeRatePerMeter } = loadCosting();
  assert.throws(() => resolveEdgeRatePerMeter({ kind: 'preset', preset: { id: 'x', pricePerMeter: -1 } }), RangeError);
  assert.throws(() => resolveEdgeRatePerMeter({ kind: 'explicit', pricePerMeter: -1 } ), RangeError);
});

// ─── Labor cost ─────────────────────────────────────────────────────────

test('computeLaborCost: per_meter multiplies the rate by a measured cut length', () => {
  const { computeLaborCost } = loadCosting();
  const cost = computeLaborCost({ pricing: { mode: 'per_meter', value: 5 }, cutLengthM: 8.4, basis: 'measured' });
  assert.equal(cost, 42);
});

test('computeLaborCost: fixed mode returns the flat project labor charge regardless of cut length', () => {
  const { computeLaborCost } = loadCosting();
  const cost = computeLaborCost({ pricing: { mode: 'fixed', value: 300 }, cutLengthM: 999, basis: 'estimated' });
  assert.equal(cost, 300);
});

test('computeLaborCost: per_meter and fixed agree when the fixed amount equals rate x length', () => {
  const { computeLaborCost } = loadCosting();
  const viaPerMeter = computeLaborCost({ pricing: { mode: 'per_meter', value: 5 }, cutLengthM: 8.4, basis: 'measured' });
  const viaFixed = computeLaborCost({ pricing: { mode: 'fixed', value: 42 } });
  assert.equal(viaPerMeter, viaFixed);
});

test('computeLaborCost: zero-value fixed labor is a valid boundary that costs nothing', () => {
  const { computeLaborCost } = loadCosting();
  assert.equal(computeLaborCost({ pricing: { mode: 'fixed', value: 0 } }), 0);
});

test('computeLaborCost: per_meter without a cut length is invalid, never silently zero', () => {
  const { computeLaborCost } = loadCosting();
  assert.throws(() => computeLaborCost({ pricing: { mode: 'per_meter', value: 5 } }), RangeError);
});

test('computeLaborCost: rejects a negative pricing value or cut length', () => {
  const { computeLaborCost } = loadCosting();
  assert.throws(() => computeLaborCost({ pricing: { mode: 'fixed', value: -1 } }), RangeError);
  assert.throws(() => computeLaborCost({ pricing: { mode: 'per_meter', value: 5 }, cutLengthM: -1 }), RangeError);
});

// ─── Full breakdown: measured/estimated semantics, rounding, currency ────

test('computeCostBreakdown: combines all three components into a rounded subtotal in MAD', () => {
  const { computeCostBreakdown } = loadCosting();
  const breakdown = computeCostBreakdown({
    material: { sheets: [{ areaM2: 2, quantity: 1, pricing: { mode: 'per_m2', value: 120 } }], basis: 'measured' },
    edge: { segments: [{ lengthM: 1.6, pricePerMeter: 8 }], basis: 'measured' },
    labor: { pricing: { mode: 'fixed', value: 0 } },
  });

  assert.equal(breakdown.currency, 'MAD');
  assert.equal(breakdown.materialCost, 240);
  assert.equal(breakdown.edgeCost, 12.8);
  assert.equal(breakdown.laborCost, 0);
  assert.equal(breakdown.subtotal, 252.8);
});

test('computeCostBreakdown: carries each component\'s measured/estimated basis explicitly, never inferring it', () => {
  const { computeCostBreakdown } = loadCosting();
  const breakdown = computeCostBreakdown({
    material: { sheets: [{ areaM2: 2, quantity: 1, pricing: { mode: 'per_m2', value: 120 } }], basis: 'estimated' },
    edge: { segments: [], basis: 'measured' },
    labor: { pricing: { mode: 'per_meter', value: 5 }, cutLengthM: 3, basis: 'estimated' },
  });

  assert.equal(breakdown.materialCostBasis, 'estimated');
  assert.equal(breakdown.edgeCostBasis, 'measured');
  assert.equal(breakdown.laborCostBasis, 'estimated');
});

test('computeCostBreakdown: fixed-mode labor is always reported as measured, since it is an exact configured amount', () => {
  const { computeCostBreakdown } = loadCosting();
  const breakdown = computeCostBreakdown({
    material: { sheets: [], basis: 'measured' },
    edge: { segments: [], basis: 'measured' },
    labor: { pricing: { mode: 'fixed', value: 300 } },
  });
  assert.equal(breakdown.laborCostBasis, 'measured');
});

test('computeCostBreakdown: per_meter labor requires an explicit basis for the underlying cut length', () => {
  const { computeCostBreakdown } = loadCosting();
  assert.throws(() => computeCostBreakdown({
    material: { sheets: [], basis: 'measured' },
    edge: { segments: [], basis: 'measured' },
    labor: { pricing: { mode: 'per_meter', value: 5 }, cutLengthM: 3 },
  }), RangeError);
});

test('computeCostBreakdown: rounding is deterministic across repeat calls with fraction-of-a-cent inputs', () => {
  const { computeCostBreakdown } = loadCosting();
  const input = {
    material: { sheets: [{ areaM2: 1 / 3, quantity: 7, pricing: { mode: 'per_m2', value: 119.999 } }], basis: 'measured' },
    edge: { segments: [{ lengthM: 0.1, pricePerMeter: 8.005 }], basis: 'measured' },
    labor: { pricing: { mode: 'fixed', value: 10.005 } },
  };
  const first = computeCostBreakdown(input);
  const second = computeCostBreakdown(input);
  assert.deepEqual(first, second);
  // Every reported amount must already be rounded to whole cents.
  for (const amount of [first.materialCost, first.edgeCost, first.laborCost, first.subtotal]) {
    assert.equal(Math.round(amount * 100), amount * 100);
  }
});

test('computeCostBreakdown: subtotal always equals the sum of the three reported (already-rounded) components', () => {
  const { computeCostBreakdown } = loadCosting();
  const breakdown = computeCostBreakdown({
    material: { sheets: [{ areaM2: 1.111, quantity: 3, pricing: { mode: 'per_m2', value: 133.33 } }], basis: 'measured' },
    edge: { segments: [{ lengthM: 2.222, pricePerMeter: 9.99 }], basis: 'measured' },
    labor: { pricing: { mode: 'per_meter', value: 5.55 }, cutLengthM: 4.44, basis: 'measured' },
  });
  const expectedSubtotal = Math.round((breakdown.materialCost + breakdown.edgeCost + breakdown.laborCost) * 100) / 100;
  assert.equal(breakdown.subtotal, expectedSubtotal);
});

// ─── Quotation layer: tax/discount belong only here ──────────────────────

function flatBreakdown(subtotal) {
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

test('computeQuotationTotals: no tax, no discount leaves subtotal untouched as the total', () => {
  const { computeQuotationTotals } = loadCosting();
  const totals = computeQuotationTotals({
    costBreakdown: flatBreakdown(1000),
    tax: { mode: 'none' },
    discount: { mode: 'none' },
  });
  assert.equal(totals.discount, 0);
  assert.equal(totals.tax, 0);
  assert.equal(totals.total, 1000);
  assert.equal(totals.currency, 'MAD');
});

test('computeQuotationTotals: percentage discount is applied before percentage tax', () => {
  const { computeQuotationTotals } = loadCosting();
  const totals = computeQuotationTotals({
    costBreakdown: flatBreakdown(1000),
    tax: { mode: 'percentage', ratePercent: 20 },
    discount: { mode: 'percentage', value: 10 },
  });
  // 1000 - 10% = 900 taxable base; 20% tax on 900 = 180; total = 1080.
  assert.equal(totals.discount, 100);
  assert.equal(totals.tax, 180);
  assert.equal(totals.total, 1080);
});

test('computeQuotationTotals: fixed discount reduces the taxable base by an exact MAD amount', () => {
  const { computeQuotationTotals } = loadCosting();
  const totals = computeQuotationTotals({
    costBreakdown: flatBreakdown(1000),
    tax: { mode: 'percentage', ratePercent: 20 },
    discount: { mode: 'fixed', value: 50 },
  });
  assert.equal(totals.discount, 50);
  assert.equal(totals.tax, 190); // 20% of (1000 - 50)
  assert.equal(totals.total, 1140);
});

test('computeQuotationTotals: a fixed discount larger than the subtotal clamps to the subtotal, never a negative base', () => {
  const { computeQuotationTotals } = loadCosting();
  const totals = computeQuotationTotals({
    costBreakdown: flatBreakdown(100),
    tax: { mode: 'percentage', ratePercent: 20 },
    discount: { mode: 'fixed', value: 500 },
  });
  assert.equal(totals.discount, 100);
  assert.equal(totals.tax, 0);
  assert.equal(totals.total, 0);
});

test('computeQuotationTotals: never assumes a default VAT rate — percentage tax without an explicit rate throws', () => {
  const { computeQuotationTotals } = loadCosting();
  assert.throws(() => computeQuotationTotals({
    costBreakdown: flatBreakdown(1000),
    tax: { mode: 'percentage' },
    discount: { mode: 'none' },
  }), RangeError);
});

test('computeQuotationTotals: rejects a negative discount value', () => {
  const { computeQuotationTotals } = loadCosting();
  assert.throws(() => computeQuotationTotals({
    costBreakdown: flatBreakdown(1000),
    tax: { mode: 'none' },
    discount: { mode: 'fixed', value: -1 },
  }), RangeError);
});

test('computeQuotationTotals: rejects a percentage discount above 100', () => {
  const { computeQuotationTotals } = loadCosting();
  assert.throws(() => computeQuotationTotals({
    costBreakdown: flatBreakdown(1000),
    tax: { mode: 'none' },
    discount: { mode: 'percentage', value: 101 },
  }), RangeError);
});

test('computeQuotationTotals: rejects a tax ratePercent above the documented sane cap of 100', () => {
  const { computeQuotationTotals } = loadCosting();
  assert.throws(() => computeQuotationTotals({
    costBreakdown: flatBreakdown(1000),
    tax: { mode: 'percentage', ratePercent: 101 },
    discount: { mode: 'none' },
  }), RangeError);
});

test('computeQuotationTotals: accepts a tax ratePercent exactly at the documented cap of 100', () => {
  const { computeQuotationTotals } = loadCosting();
  const totals = computeQuotationTotals({
    costBreakdown: flatBreakdown(1000),
    tax: { mode: 'percentage', ratePercent: 100 },
    discount: { mode: 'none' },
  });
  assert.equal(totals.tax, 1000);
  assert.equal(totals.total, 2000);
});

test('computeQuotationTotals: the quotation layer never recomputes material/edge/labor — it forwards the given breakdown verbatim', () => {
  const { computeQuotationTotals } = loadCosting();
  const breakdown = flatBreakdown(777);
  const totals = computeQuotationTotals({ costBreakdown: breakdown, tax: { mode: 'none' }, discount: { mode: 'none' } });
  assert.equal(totals.materialCost, breakdown.materialCost);
  assert.equal(totals.edgeCost, breakdown.edgeCost);
  assert.equal(totals.laborCost, breakdown.laborCost);
  assert.equal(totals.subtotal, breakdown.subtotal);
});

// ─── Quotation layer: delivery cost (Task 8 — client quotations) ─────────
//
// Delivery, like tax/discount, only ever applies in the quotation wrapper —
// never inside computeCostBreakdown's material/edge/labor subtotal. It must
// still be included in the pre-tax base that discount and tax are computed
// against, deterministically, exactly like the subtotal always was.

test('computeQuotationTotals: omitting deliveryCost defaults to 0 and behaves exactly as before', () => {
  const { computeQuotationTotals } = loadCosting();
  const totals = computeQuotationTotals({
    costBreakdown: flatBreakdown(1000),
    tax: { mode: 'percentage', ratePercent: 20 },
    discount: { mode: 'percentage', value: 10 },
  });
  assert.equal(totals.deliveryCost, 0);
  assert.equal(totals.discount, 100);
  assert.equal(totals.tax, 180);
  assert.equal(totals.total, 1080);
});

test('computeQuotationTotals: deliveryCost is added to the pre-tax base before discount and tax', () => {
  const { computeQuotationTotals } = loadCosting();
  const totals = computeQuotationTotals({
    costBreakdown: flatBreakdown(1000),
    tax: { mode: 'percentage', ratePercent: 20 },
    discount: { mode: 'none' },
    deliveryCost: 100,
  });
  // (1000 + 100) taxable base; 20% tax = 220; total = 1320.
  assert.equal(totals.deliveryCost, 100);
  assert.equal(totals.tax, 220);
  assert.equal(totals.total, 1320);
});

test('computeQuotationTotals: a percentage discount applies to (subtotal + deliveryCost), not subtotal alone', () => {
  const { computeQuotationTotals } = loadCosting();
  const totals = computeQuotationTotals({
    costBreakdown: flatBreakdown(1000),
    tax: { mode: 'none' },
    discount: { mode: 'percentage', value: 10 },
    deliveryCost: 200,
  });
  // (1000 + 200) * 10% = 120 discount; total = 1080.
  assert.equal(totals.discount, 120);
  assert.equal(totals.total, 1080);
});

test('computeQuotationTotals: a fixed discount larger than subtotal+deliveryCost clamps to that base, never negative', () => {
  const { computeQuotationTotals } = loadCosting();
  const totals = computeQuotationTotals({
    costBreakdown: flatBreakdown(100),
    tax: { mode: 'none' },
    discount: { mode: 'fixed', value: 500 },
    deliveryCost: 50,
  });
  assert.equal(totals.discount, 150);
  assert.equal(totals.total, 0);
});

test('computeQuotationTotals: rejects a negative deliveryCost instead of silently subtracting', () => {
  const { computeQuotationTotals } = loadCosting();
  assert.throws(() => computeQuotationTotals({
    costBreakdown: flatBreakdown(1000),
    tax: { mode: 'none' },
    discount: { mode: 'none' },
    deliveryCost: -1,
  }), RangeError);
});

test('computeQuotationTotals: rejects a non-finite deliveryCost', () => {
  const { computeQuotationTotals } = loadCosting();
  assert.throws(() => computeQuotationTotals({
    costBreakdown: flatBreakdown(1000),
    tax: { mode: 'none' },
    discount: { mode: 'none' },
    deliveryCost: Infinity,
  }), RangeError);
});

// ─── preTaxBase: the canonical (subtotal + deliveryCost) base, so callers
// never recompute it independently (Task 8 remediation — item 4) ──────────

test('computeQuotationTotals: exposes preTaxBase = subtotal + deliveryCost, before discount/tax', () => {
  const { computeQuotationTotals } = loadCosting();
  const totals = computeQuotationTotals({
    costBreakdown: flatBreakdown(1000),
    tax: { mode: 'percentage', ratePercent: 20 },
    discount: { mode: 'percentage', value: 10 },
    deliveryCost: 200,
  });
  assert.equal(totals.preTaxBase, 1200);
});

test('computeQuotationTotals: preTaxBase defaults to the bare subtotal when deliveryCost is omitted', () => {
  const { computeQuotationTotals } = loadCosting();
  const totals = computeQuotationTotals({
    costBreakdown: flatBreakdown(1000),
    tax: { mode: 'none' },
    discount: { mode: 'none' },
  });
  assert.equal(totals.preTaxBase, 1000);
});

test('computeQuotationTotals: preTaxBase never itself reflects discount or tax', () => {
  const { computeQuotationTotals } = loadCosting();
  const totals = computeQuotationTotals({
    costBreakdown: flatBreakdown(100),
    tax: { mode: 'percentage', ratePercent: 20 },
    discount: { mode: 'fixed', value: 500 },
    deliveryCost: 50,
  });
  assert.equal(totals.preTaxBase, 150);
  assert.equal(totals.discount, 150);
  assert.equal(totals.tax, 0);
});

test('computeQuotationTotals: deliveryCost never changes the plan-level subtotal/material/edge/labor fields', () => {
  const { computeQuotationTotals } = loadCosting();
  const breakdown = flatBreakdown(777);
  const totals = computeQuotationTotals({
    costBreakdown: breakdown,
    tax: { mode: 'none' },
    discount: { mode: 'none' },
    deliveryCost: 33,
  });
  assert.equal(totals.subtotal, breakdown.subtotal);
  assert.equal(totals.materialCost, breakdown.materialCost);
  assert.equal(totals.edgeCost, breakdown.edgeCost);
  assert.equal(totals.laborCost, breakdown.laborCost);
  assert.equal(totals.total, 810);
});

// ─── Cross-surface equivalence: optimizer, PDF, and quotation agree ──────

test('cross-surface equivalence: optimizeCutting2D wires its cost fields through computeCostBreakdown, not an ad hoc formula', () => {
  const { computeCostBreakdown } = loadCosting();
  const { optimizeCutting2D } = loadTsModule('src/lib/cutting/binpacking.ts');

  const sheet = { width: 200, height: 100, kerf: 0.3, margin: 0, material: 'mdf', quantity: 1 };
  const pieces = [
    { id: 'p1', name: 'Panneau', height: 100, width: 80, quantity: 1, material: 'mdf', edges: { top: true, bottom: true, color: 'white' } },
  ];

  const result = optimizeCutting2D(pieces, [sheet], { considerMaterial: false, edgeBanding: true });

  assert.equal(result.sheetsUsed, 1, 'fixture must fit on a single sheet for the expected cost to be exact');

  const expected = computeCostBreakdown({
    material: { sheets: [{ areaM2: (200 * 100) / 10000, quantity: 1, pricing: { mode: 'per_m2', value: 120 } }], basis: 'measured' },
    edge: { segments: [{ lengthM: (80 + 80) / 100, pricePerMeter: 8 }], basis: 'measured' },
    labor: { pricing: { mode: 'fixed', value: 0 } },
  });

  assert.ok(result.costBreakdown, 'optimizeCutting2D must return a costBreakdown computed by the shared calculator');
  assert.deepEqual(result.costBreakdown, expected);
});

test('optimizeCutting1D leaves costBreakdown and costingInput undefined rather than fabricating a per-bar price', () => {
  const { optimizeCutting1D } = loadTsModule('src/lib/cutting/binpacking.ts');

  const pieces = [{ id: 'p1', name: 'Barre', height: 1, width: 80, quantity: 2 }];
  const result = optimizeCutting1D(pieces, 200, 3);

  assert.equal(result.cutMode, '1d');
  assert.equal(result.costBreakdown, undefined, '1D mode has no configured per-bar stock price, so costBreakdown must stay undefined, never a guessed figure');
  assert.equal(result.costingInput, undefined, 'costingInput must be absent exactly when costBreakdown is (see OptimizationResult doc)');
});

test('cross-surface equivalence: the PDF export renders the exact subtotal computed by the shared calculator', async () => {
  const { computeCostBreakdown } = loadCosting();
  const { POST } = loadTsModule('src/app/api/export-pdf/route.ts');

  // The route never trusts a submitted `costBreakdown` (see
  // tests/pdf-cost-integrity.test.js) — it recomputes from `costingInput`,
  // the exact input a real optimizeCutting2D() call would have passed to
  // computeCostBreakdown. So the "cross-surface equivalence" this test
  // proves is: recomputing that same input here and recomputing it again
  // inside the route produce byte-identical figures.
  const costingInput = {
    material: { sheets: [{ areaM2: 5.78, quantity: 1, pricing: { mode: 'per_m2', value: 120 } }], basis: 'measured' },
    edge: { segments: [{ lengthM: 1.6, pricePerMeter: 8 }], basis: 'measured' },
    labor: { pricing: { mode: 'fixed', value: 0 } },
  };
  const costBreakdown = computeCostBreakdown(costingInput);

  const body = {
    projectName: 'Projet Test',
    material: 'mdf',
    displayUnit: 'cm',
    sheet: { width: 208, height: 278, kerf: 0.3, margin: 0 },
    result: {
      sheetsUsed: 1,
      wastePercentage: 12.5,
      totalAreaUsed: 5,
      totalAreaAvailable: 5.78,
      totalLinearCutMeters: 8.4,
      offcuts: [],
      placedPieces: [{ pieceNumber: 1, name: 'Panneau', sheetIndex: 0, width: 120, height: 60, rotated: false, x: 0, y: 0 }],
      costingInput,
    },
  };

  const req = new Request('http://localhost/api/export-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await POST(req);
  assert.equal(res.status, 200);
  const buf = Buffer.from(await res.arrayBuffer());
  const text = buf.toString('latin1');

  const expectedSubtotalLabel = costBreakdown.subtotal.toFixed(2).replace('.', ',');
  assert.ok(
    text.includes(expectedSubtotalLabel),
    `PDF must render the exact shared-calculator subtotal (${expectedSubtotalLabel} MAD), not a re-derived figure`
  );
});

// ─── No invented formulas remain ──────────────────────────────────────

test('binpacking.ts no longer contains the invented edge-banding perimeter fallback or fabricated "money saved" formulas', () => {
  const source = fs.readFileSync(path.resolve('src/lib/cutting/binpacking.ts'), 'utf8');
  assert.doesNotMatch(source, /moneySavedMad/, 'the fabricated "money saved" metric must be removed, not just hidden');
  assert.doesNotMatch(source, /m\s*===\s*0/, 'no silent full-perimeter fallback when no edge side is selected');
  assert.doesNotMatch(source, /\*\s*0\.18/, 'the unexplained 18% "savings" multiplier must be removed');
  assert.doesNotMatch(source, /\*\s*200\b/, 'the unexplained 200 MAD/m² "savings" multiplier must be removed');
  assert.match(source, /costing/, 'binpacking.ts must import and use the shared costing module');
});

test('export-pdf route no longer contains the capped waste formula or unexplained perimeter/efficiency multipliers', () => {
  const source = fs.readFileSync(path.resolve('src/app/api/export-pdf/route.ts'), 'utf8');
  assert.doesNotMatch(source, /nonReusableWasteRate\s*=\s*Math\.min/, 'the capped non-reusable-waste formula must be removed');
  assert.doesNotMatch(source, /\*\s*0\.65/, 'the unexplained 0.65 perimeter/efficiency multiplier must be removed');
  assert.doesNotMatch(source, /estimatedSavingsMad/, 'the fabricated savings estimate must be removed');
  assert.doesNotMatch(source, /sPieces\.length\s*\*\s*2\.5/, 'the unexplained flat per-piece MAD charge must be removed');
  assert.doesNotMatch(source, /costPerSheet/, 'the route must no longer accept an independent, disconnected cost-per-sheet input');
  assert.doesNotMatch(source, /:\s*any\b/, 'route must stay strictly typed (no `any`)');
});
