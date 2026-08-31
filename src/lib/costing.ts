/**
 * Single canonical cost calculator for QatlIA (MAD only, for now).
 *
 * Every surface that shows or persists a project's cost — the 2D/1D
 * optimizer, the atelier UI, saved projects, PDF exports, and the future
 * client-quotation layer — must call the functions in this module instead
 * of re-deriving its own formula. That is the whole point of this file:
 * before it existed, the optimizer, the PDF export route, and the atelier
 * UI each computed a different number for "the same" project cost.
 *
 * Design rules this module enforces:
 * - Tax and discount only ever apply in the quotation wrapper
 *   (`computeQuotationTotals`). The plan-level `CostBreakdown` never
 *   contains them.
 * - Every cost component carries an explicit `CostBasis` ('measured' or
 *   'estimated') supplied by the caller. Nothing here infers "measured"
 *   from the mere presence of a number — a caller that fabricates a
 *   quantity must say so by tagging it 'estimated'.
 * - No invented multipliers, caps, or per-piece flat fees. Every quantity
 *   that feeds a calculation here is a plain, explained rate x amount.
 * - All money is rounded once, deterministically, to the nearest MAD cent
 *   (round-half-up), so every surface reproduces byte-identical figures
 *   from the same inputs.
 */

export type Currency = 'MAD';
export type CostBasis = 'measured' | 'estimated';

const CURRENCY_DECIMALS = 2;

/** Deterministic round-half-up to the nearest MAD cent. */
export function roundCurrency(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`roundCurrency: expected a finite number, received ${value}`);
  }
  const factor = 10 ** CURRENCY_DECIMALS;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function assertFiniteNonNegative(value: number, fnName: string, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${fnName}: ${label} must be a finite number >= 0, received ${value}`);
  }
}

function assertNonNegativeInteger(value: number, fnName: string, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${fnName}: ${label} must be a non-negative integer, received ${value}`);
  }
}

// ─── Material (stock) cost ────────────────────────────────────────────────

export interface StockPricing {
  mode: 'per_sheet' | 'per_m2';
  /** MAD per sheet (mode 'per_sheet') or MAD per m² (mode 'per_m2'). Must be >= 0. */
  value: number;
}

export interface SheetCostLine {
  /** Sheet area in m² (canonical cm² / 10000). Must be > 0 when quantity > 0. */
  areaM2: number;
  /** How many sheets of this exact spec/price were consumed. Non-negative integer. */
  quantity: number;
  pricing: StockPricing;
}

export interface MaterialCostInput {
  sheets: SheetCostLine[];
  /** Whether `sheets` reflects an actual optimizer/plan result (measured) or a pre-optimization projection (estimated). */
  basis: CostBasis;
}

export function computeMaterialCost(input: MaterialCostInput): number {
  const total = input.sheets.reduce((sum, line) => {
    assertFiniteNonNegative(line.areaM2, 'computeMaterialCost', 'sheet areaM2');
    assertNonNegativeInteger(line.quantity, 'computeMaterialCost', 'sheet quantity');
    assertFiniteNonNegative(line.pricing.value, 'computeMaterialCost', 'stock pricing value');
    const pricePerSheet = line.pricing.mode === 'per_sheet' ? line.pricing.value : line.pricing.value * line.areaM2;
    return sum + pricePerSheet * line.quantity;
  }, 0);
  return roundCurrency(total);
}

// ─── Edge banding cost ─────────────────────────────────────────────────────

export interface EdgeRatePreset {
  id: string;
  pricePerMeter: number;
}

/** An edge rate is always resolved from exactly one of: a named preset, or an explicit override. Never guessed. */
export type EdgeRateSource = { kind: 'preset'; preset: EdgeRatePreset } | { kind: 'explicit'; pricePerMeter: number };

export function resolveEdgeRatePerMeter(source: EdgeRateSource): number {
  const rate = source.kind === 'preset' ? source.preset.pricePerMeter : source.pricePerMeter;
  assertFiniteNonNegative(rate, 'resolveEdgeRatePerMeter', 'rate');
  return rate;
}

export interface EdgeSegmentCostLine {
  /** Edge length in metres actually specified for banding. Never a perimeter fallback for unspecified sides. Must be >= 0. */
  lengthM: number;
  /** Resolved MAD/metre rate — see `resolveEdgeRatePerMeter`. Must be >= 0. */
  pricePerMeter: number;
}

export interface EdgeCostInput {
  segments: EdgeSegmentCostLine[];
  basis: CostBasis;
}

export function computeEdgeCost(input: EdgeCostInput): number {
  const total = input.segments.reduce((sum, segment) => {
    assertFiniteNonNegative(segment.lengthM, 'computeEdgeCost', 'segment lengthM');
    assertFiniteNonNegative(segment.pricePerMeter, 'computeEdgeCost', 'segment pricePerMeter');
    return sum + segment.lengthM * segment.pricePerMeter;
  }, 0);
  return roundCurrency(total);
}

// ─── Labor / cutting cost ───────────────────────────────────────────────────

export interface LaborPricing {
  mode: 'per_meter' | 'fixed';
  /** MAD/metre (mode 'per_meter') or a flat MAD amount (mode 'fixed'). Must be >= 0. */
  value: number;
}

export interface LaborCostInput {
  pricing: LaborPricing;
  /** Required, and only meaningful, when `pricing.mode === 'per_meter'`. */
  cutLengthM?: number;
  /**
   * Basis of `cutLengthM` when mode is 'per_meter'. Required in that case —
   * a caller must say whether the cut length came from a real plan or a
   * pre-plan projection. Ignored for 'fixed' (see `resolveLaborBasis`).
   */
  basis?: CostBasis;
}

export function computeLaborCost(input: LaborCostInput): number {
  assertFiniteNonNegative(input.pricing.value, 'computeLaborCost', 'labor pricing value');
  if (input.pricing.mode === 'fixed') {
    return roundCurrency(input.pricing.value);
  }
  if (input.cutLengthM === undefined) {
    throw new RangeError('computeLaborCost: cutLengthM is required when pricing.mode is "per_meter"');
  }
  assertFiniteNonNegative(input.cutLengthM, 'computeLaborCost', 'cutLengthM');
  return roundCurrency(input.pricing.value * input.cutLengthM);
}

/**
 * A flat project labor fee is an exact configured amount, not an
 * interpretation of anything — it is always reported 'measured'. A
 * per-metre fee is only as good as the cut length behind it, so the caller
 * must say explicitly whether that length was measured from a real plan.
 */
function resolveLaborBasis(input: LaborCostInput): CostBasis {
  if (input.pricing.mode === 'fixed') return 'measured';
  if (!input.basis) {
    throw new RangeError('computeCostBreakdown: labor.basis is required when pricing.mode is "per_meter"');
  }
  return input.basis;
}

// ─── Full plan-level breakdown (no tax/discount here) ──────────────────────

export interface CostBreakdownInput {
  material: MaterialCostInput;
  edge: EdgeCostInput;
  labor: LaborCostInput;
}

export interface CostBreakdown {
  currency: Currency;
  materialCost: number;
  materialCostBasis: CostBasis;
  edgeCost: number;
  edgeCostBasis: CostBasis;
  laborCost: number;
  laborCostBasis: CostBasis;
  /** Sum of materialCost + edgeCost + laborCost. Never includes tax/discount. */
  subtotal: number;
}

export function computeCostBreakdown(input: CostBreakdownInput): CostBreakdown {
  const materialCost = computeMaterialCost(input.material);
  const edgeCost = computeEdgeCost(input.edge);
  const laborCost = computeLaborCost(input.labor);
  const laborCostBasis = resolveLaborBasis(input.labor);
  const subtotal = roundCurrency(materialCost + edgeCost + laborCost);

  return {
    currency: 'MAD',
    materialCost,
    materialCostBasis: input.material.basis,
    edgeCost,
    edgeCostBasis: input.edge.basis,
    laborCost,
    laborCostBasis,
    subtotal,
  };
}

// ─── Quotation layer: the only place tax/discount are allowed ─────────────

export type TaxMode = 'none' | 'percentage';
export interface QuotationTax {
  mode: TaxMode;
  /**
   * VAT rate as a percentage (e.g. 20 for 20%). Required when mode is
   * 'percentage' — never defaulted. Capped at a documented sane maximum of
   * 100 (see `resolveTaxAmount`) — no real Moroccan tax regime approaches
   * that, so anything above it is a caller bug, not a legitimate rate.
   */
  ratePercent?: number;
}

export type DiscountMode = 'none' | 'percentage' | 'fixed';
export interface QuotationDiscount {
  mode: DiscountMode;
  /** A percentage (0-100) when mode is 'percentage', or a flat MAD amount when mode is 'fixed'. */
  value?: number;
}

export interface QuotationInput {
  costBreakdown: CostBreakdown;
  tax: QuotationTax;
  discount: QuotationDiscount;
  /**
   * Explicit MAD delivery/shipping fee, defaulting to 0 so every existing
   * caller that never configured delivery sees no change. Like tax and
   * discount, delivery only ever exists in this quotation wrapper — it is
   * never added to `costBreakdown.subtotal` itself, and never rederives
   * material/edge/labor.
   */
  deliveryCost?: number;
}

export interface QuotationTotals extends CostBreakdown {
  /** The resolved (validated) MAD delivery fee this quotation was computed with. 0 when none was given. */
  deliveryCost: number;
  /**
   * The canonical (subtotal + deliveryCost) base, before discount/tax —
   * exactly what discount is computed against (see `resolveDiscountAmount`).
   * Every caller that needs "subtotal including delivery" (e.g. a PDF's
   * line-item table) must read this field rather than re-deriving
   * `subtotal + deliveryCost` itself, so a quotation's displayed pre-tax
   * base can never drift from what discount/tax were actually computed on.
   */
  preTaxBase: number;
  /** MAD amount actually deducted (already resolved from percentage/fixed and clamped to subtotal + deliveryCost). */
  discount: number;
  /** MAD amount actually charged (already resolved from the taxable base). */
  tax: number;
  /** (subtotal + deliveryCost) - discount + tax. */
  total: number;
}

function resolveDiscountAmount(discount: QuotationDiscount, subtotal: number): number {
  if (discount.mode === 'none') return 0;

  if (discount.value === undefined) {
    throw new RangeError(`computeQuotationTotals: discount.value is required when mode is "${discount.mode}"`);
  }
  assertFiniteNonNegative(discount.value, 'computeQuotationTotals', 'discount.value');

  if (discount.mode === 'percentage') {
    if (discount.value > 100) {
      throw new RangeError('computeQuotationTotals: discount.value as a percentage cannot exceed 100');
    }
    return roundCurrency(subtotal * (discount.value / 100));
  }

  // 'fixed': an artisan may legitimately comp more than the computed
  // subtotal (goodwill discount) — clamp rather than produce a negative
  // taxable base.
  return roundCurrency(Math.min(discount.value, subtotal));
}

function resolveTaxAmount(tax: QuotationTax, taxableBase: number): number {
  if (tax.mode === 'none') return 0;

  if (tax.ratePercent === undefined) {
    throw new RangeError(
      'computeQuotationTotals: tax.ratePercent is required when mode is "percentage" (never assume a default VAT rate)'
    );
  }
  assertFiniteNonNegative(tax.ratePercent, 'computeQuotationTotals', 'tax.ratePercent');
  if (tax.ratePercent > 100) {
    throw new RangeError('computeQuotationTotals: tax.ratePercent cannot exceed a documented sane cap of 100 (100%)');
  }
  return roundCurrency(taxableBase * (tax.ratePercent / 100));
}

/**
 * Applies delivery/tax/discount on top of an already-computed
 * `CostBreakdown`. Never recomputes material/edge/labor — those come from
 * `computeCostBreakdown` verbatim, which is what keeps a quotation's totals
 * identical to the plan screen and the PDF export it was generated from.
 *
 * `deliveryCost` (default 0) is folded into the pre-tax base *before*
 * discount and tax are resolved — a delivery fee is part of what the client
 * owes, so a percentage discount/VAT computed only on `subtotal` would
 * quietly under- or over-charge relative to the amount actually invoiced.
 * Discount is then applied to that (subtotal + delivery) base first; tax is
 * charged on the discounted (taxable) base. This matches standard invoicing
 * practice and is documented here rather than left implicit.
 */
export function computeQuotationTotals(input: QuotationInput): QuotationTotals {
  const { costBreakdown, tax, discount } = input;
  const deliveryCost = input.deliveryCost ?? 0;
  assertFiniteNonNegative(deliveryCost, 'computeQuotationTotals', 'deliveryCost');

  const preTaxBase = roundCurrency(costBreakdown.subtotal + deliveryCost);
  const discountAmount = resolveDiscountAmount(discount, preTaxBase);
  const taxableBase = roundCurrency(preTaxBase - discountAmount);
  const taxAmount = resolveTaxAmount(tax, taxableBase);
  const total = roundCurrency(taxableBase + taxAmount);

  return {
    ...costBreakdown,
    deliveryCost,
    preTaxBase,
    discount: discountAmount,
    tax: taxAmount,
    total,
  };
}
