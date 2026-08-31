import { z } from 'zod';
import type { Locale } from '@/i18n';

// `satisfies readonly Locale[]` keeps this tuple checked against the
// app-wide locale set at compile time: adding or renaming a locale in
// src/i18n without updating this literal is a type error, not a silent
// runtime drift (z.enum needs a literal tuple, not LOCALES' widened array type).
const PDF_LOCALES = ['fr', 'en', 'ar'] as const satisfies readonly Locale[];

// ─── Shared numeric bounds ──────────────────────────────────────────────
// This route receives its `result` back over the network from a client that
// already ran the optimizer locally — nothing here can assume the payload is
// well-formed. Every bound below exists to keep a malicious or buggy payload
// (Infinity, NaN, a negative price, an absurdly large array) from reaching
// jsPDF/autoTable or the shared cost calculator, never to model a real plan's
// actual limits — real plans stay far inside them.
const MONEY_MAX = 1e9;
const RATE_MAX = 1e9;
const LENGTH_M_MAX = 1e9;
const GEOMETRY_MAX = 1_000_000; // cm — a generous upper bound for any sheet/piece/offcut dimension or position
const AREA_M2_MAX = 1_000_000;
const MAX_ARRAY_LEN = 5000;
const MAX_QUANTITY = 10000;
const MAX_SHEETS_USED = 100;

const money = () => z.number().finite().nonnegative().max(MONEY_MAX);
const rate = () => z.number().finite().nonnegative().max(RATE_MAX);
const lengthM = () => z.number().finite().nonnegative().max(LENGTH_M_MAX);
const geometryValue = () => z.number().finite().nonnegative().max(GEOMETRY_MAX);
const areaM2 = () => z.number().finite().nonnegative().max(AREA_M2_MAX);

const CostBasisSchema = z.enum(['measured', 'estimated']);

// ─── CostBreakdownInput — mirrors src/lib/costing.ts's CostBreakdownInput
// exactly. This is the shape that actually gets trusted: the PDF route feeds
// it straight back into `computeCostBreakdown` and renders that result,
// never a client-submitted `CostBreakdown` (see `CostBreakdownSchema` below
// and src/app/api/export-pdf/route.ts).
const StockPricingSchema = z.object({
  mode: z.enum(['per_sheet', 'per_m2']),
  value: rate(),
});

const SheetCostLineSchema = z.object({
  areaM2: areaM2(),
  quantity: z.number().int().nonnegative().max(MAX_QUANTITY),
  pricing: StockPricingSchema,
});

const MaterialCostInputSchema = z.object({
  sheets: z.array(SheetCostLineSchema).max(MAX_ARRAY_LEN),
  basis: CostBasisSchema,
});

const EdgeSegmentCostLineSchema = z.object({
  lengthM: lengthM(),
  pricePerMeter: rate(),
});

const EdgeCostInputSchema = z.object({
  segments: z.array(EdgeSegmentCostLineSchema).max(MAX_ARRAY_LEN),
  basis: CostBasisSchema,
});

const LaborPricingSchema = z.object({
  mode: z.enum(['per_meter', 'fixed']),
  value: rate(),
});

// `cutLengthM`/`basis` are only meaningful (and, per computeCostBreakdown,
// only accepted) when `pricing.mode` is 'per_meter' — reject the mismatch
// here with a clean 400 rather than let computeCostBreakdown throw a
// RangeError deep inside PDF rendering.
const LaborCostInputSchema = z
  .object({
    pricing: LaborPricingSchema,
    cutLengthM: lengthM().optional(),
    basis: CostBasisSchema.optional(),
  })
  .refine(
    (data) => data.pricing.mode !== 'per_meter' || (data.cutLengthM !== undefined && data.basis !== undefined),
    { message: 'cutLengthM and basis are required when labor pricing.mode is "per_meter"' }
  );

export const CostBreakdownInputSchema = z.object({
  material: MaterialCostInputSchema,
  edge: EdgeCostInputSchema,
  labor: LaborCostInputSchema,
});

// ─── CostBreakdown — mirrors src/lib/costing.ts's CostBreakdown. Accepted
// here purely so a legacy payload still parses instead of 400ing; the PDF
// route never renders this field directly (see route.ts) — only a
// `costBreakdown` recomputed from `costingInput` above is ever shown.
export const CostBreakdownSchema = z.object({
  currency: z.literal('MAD'),
  materialCost: money(),
  materialCostBasis: CostBasisSchema,
  edgeCost: money(),
  edgeCostBasis: CostBasisSchema,
  laborCost: money(),
  laborCostBasis: CostBasisSchema,
  subtotal: money(),
});

export const ExportSchema = z.object({
  projectName: z.string().default('PROJET DÉBIT'),
  material: z.string().default('MDF'),
  /**
   * The unit the artisan had selected for display at export time. All
   * geometry below (sheet/pieces/offcuts) is always canonical centimetres —
   * the optimizer never emits millimetres. `displayUnit` only controls how
   * dimensions are *labeled* in the PDF (via `fromCanonicalCm`); it never
   * feeds back into any area/cost/linear-cut calculation.
   */
  displayUnit: z.enum(['cm', 'mm']).default('cm'),
  /**
   * The atelier's current UI locale. Independent of `displayUnit`: it only
   * selects which catalog (src/i18n) the PDF's labels are rendered from.
   * Legacy clients that never send it get a French PDF, matching the app's
   * default locale (see DEFAULT_LOCALE in src/i18n).
   */
  locale: z.enum(PDF_LOCALES).default('fr'),
  sheet: z.object({
    width: geometryValue(),
    height: geometryValue(),
    kerf: geometryValue().default(0.3),
    margin: geometryValue().default(0.0),
    grainDirection: z.boolean().default(false),
  }),
  result: z.object({
    sheetsUsed: z.number().int().min(0).max(MAX_SHEETS_USED),
    wastePercentage: z.number().finite(),
    totalAreaUsed: areaM2(),
    totalAreaAvailable: areaM2(),
    totalLinearCutMeters: lengthM().optional().default(0),
    /** Computed once by src/lib/costing.ts. Never rendered directly — see route.ts. */
    costBreakdown: CostBreakdownSchema.optional(),
    /** The exact input `costBreakdown` was computed from. Present iff `costBreakdown` is — see OptimizationResult.costingInput. */
    costingInput: CostBreakdownInputSchema.optional(),
    offcuts: z
      .array(
        z.object({
          sheetIndex: z.number().int().nonnegative().max(MAX_SHEETS_USED),
          width: geometryValue(),
          height: geometryValue(),
          x: geometryValue(),
          y: geometryValue(),
          areaM2: areaM2(),
          isReusable: z.boolean(),
        })
      )
      .max(MAX_ARRAY_LEN)
      .optional()
      .default([]),
    placedPieces: z
      .array(
        z.object({
          pieceNumber: z.number().int().nonnegative(),
          name: z.string(),
          sheetIndex: z.number().int().nonnegative().max(MAX_SHEETS_USED),
          width: geometryValue(),
          height: geometryValue(),
          rotated: z.boolean(),
          x: geometryValue(),
          y: geometryValue(),
        })
      )
      .max(MAX_ARRAY_LEN),
  }),
});
