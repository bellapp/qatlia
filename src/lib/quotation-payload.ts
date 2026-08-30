/**
 * Pure builder for the client-quotation request payload. It never
 * recomputes material/edge/labor cost itself — it forwards the exact
 * `CostBreakdown` produced by the optimizer (see `src/lib/costing.ts`)
 * verbatim into `computeQuotationTotals`, so a quotation's totals always
 * match the plan screen and PDF export they were generated from.
 *
 * No quotation UI ships in this task — this module only exists so the
 * eventual UI (and its tests) has a single, pure entry point instead of
 * every call site re-deriving tax/discount wiring by hand.
 */
import {
  computeQuotationTotals,
  type CostBreakdown,
  type QuotationDiscount,
  type QuotationTax,
  type QuotationTotals,
} from '@/lib/costing';

export interface QuotationPayloadInput {
  /** Forwarded verbatim — never recomputed here. */
  costBreakdown: CostBreakdown;
  tax: QuotationTax;
  discount: QuotationDiscount;
}

export interface QuotationPayload {
  costBreakdown: CostBreakdown;
  tax: QuotationTax;
  discount: QuotationDiscount;
  totals: QuotationTotals;
}

/**
 * Builds the full quotation payload: the exact inputs the caller supplied,
 * plus the totals `computeQuotationTotals` derives from them. Pure and
 * side-effect free so it can be unit-tested without a UI or network call.
 */
export function buildQuotationPayload(input: QuotationPayloadInput): QuotationPayload {
  const totals = computeQuotationTotals({
    costBreakdown: input.costBreakdown,
    tax: input.tax,
    discount: input.discount,
  });

  return {
    costBreakdown: input.costBreakdown,
    tax: input.tax,
    discount: input.discount,
    totals,
  };
}
