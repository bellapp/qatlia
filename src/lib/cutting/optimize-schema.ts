import { z } from 'zod';
import { MATERIAL_TYPE_VALUES, OPTIMIZATION_PRIORITY_VALUES } from './binpacking';

// Reasonable upper bounds on request geometry/cardinality so a malformed or
// abusive payload fails fast at the API boundary (a clear 400) instead of
// making the optimizer allocate unbounded work off attacker-controlled sizes.
export const MAX_GEOMETRY = 100000;
export const MAX_PIECES = 5000;
export const MAX_PIECE_QUANTITY = 10000;
export const MAX_SHEETS = 100;

// Mirrors src/lib/costing.ts's StockPricing/LaborPricing exactly. Every rate
// must be finite and >= 0 — never a bare `z.number()` that would let NaN,
// Infinity, or a negative price reach the shared cost calculator, which
// throws on those (see costing.ts's `assertFiniteNonNegative`) — better to
// reject at the API boundary with a clear 400 than a 500 from deep inside
// the optimizer.
const StockPricingSchema = z.object({
  mode: z.enum(['per_sheet', 'per_m2']),
  value: z.number().finite().min(0),
});
const LaborPricingSchema = z.object({
  mode: z.enum(['per_meter', 'fixed']),
  value: z.number().finite().min(0),
});

// Per-piece edge banding selection. All fields are optional so omitting
// `edges` entirely (today's default) is unaffected.
const EdgeBandingConfigSchema = z.object({
  top: z.boolean().optional(),
  bottom: z.boolean().optional(),
  left: z.boolean().optional(),
  right: z.boolean().optional(),
  color: z.string().max(100).optional(),
  pricePerM: z.number().finite().min(0).max(1e9).optional(),
});

// Shared shape for a single stock sheet, reused by both the legacy `sheet`
// field and the multi-stock `sheets` array so neither surface can drift.
export const SheetSchema = z.object({
  id: z.string().optional(),
  label: z.string().optional(),
  width: z.number().finite().positive().max(MAX_GEOMETRY),
  height: z.number().finite().positive().max(MAX_GEOMETRY),
  kerf: z.number().finite().min(0).max(MAX_GEOMETRY).default(0.3),
  margin: z.number().finite().min(0).max(MAX_GEOMETRY).default(1.0),
  grainDirection: z.boolean().default(true),
  material: z.enum(MATERIAL_TYPE_VALUES).optional(),
  quantity: z.number().int().positive().max(MAX_SHEETS).optional(),
});

export const OptimizeSchema = z.object({
  // Legacy single-stock callers keep using `sheet`. Multi-material/multi-stock
  // callers use `sheets` instead. At least one of the two is required (see the
  // `.refine` below); when both are present the route prefers `sheets`.
  sheet: SheetSchema.optional(),
  sheets: z.array(SheetSchema).min(1).max(MAX_SHEETS).optional(),
  pieces: z.array(
    z.object({
      id: z.string().optional(),
      name: z.string().optional(),
      width: z.coerce.number().finite().positive().max(MAX_GEOMETRY),
      height: z.coerce.number().finite().positive().max(MAX_GEOMETRY),
      quantity: z.coerce.number().int().positive().max(MAX_PIECE_QUANTITY).default(1),
      material: z.string().optional().nullable(),
      rotatable: z.boolean().optional(),
      color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      edges: EdgeBandingConfigSchema.optional(),
    }).passthrough()
  ).min(1).max(MAX_PIECES),
  options: z.object({
    kerfWidth: z.number().min(0).max(10).optional(),
    showLabels: z.boolean().optional(),
    singleSheetOnly: z.boolean().optional(),
    considerMaterial: z.boolean().optional(),
    edgeBanding: z.boolean().optional(),
    grainDirection: z.boolean().optional(),
    optimizationPriority: z.enum(OPTIMIZATION_PRIORITY_VALUES).optional(),
    minReusableOffcutWidth: z.number().finite().min(0).optional(),
    minReusableOffcutHeight: z.number().finite().min(0).optional(),
    // Explicit, typed pricing inputs (see src/lib/costing.ts). Both are
    // strictly opt-in: omitting them preserves today's default behavior
    // (material-library per_m2 stock pricing, MAD 0 fixed labor) — see
    // OPTIONS_DEFAULTS/DEFAULT_LABOR_PRICING in binpacking.ts.
    stockPricingOverrides: z.partialRecord(z.enum(MATERIAL_TYPE_VALUES), StockPricingSchema).optional(),
    laborPricing: LaborPricingSchema.optional(),
  }).passthrough().optional(),
}).refine((data) => data.sheet !== undefined || (data.sheets !== undefined && data.sheets.length > 0), {
  message: 'Either `sheet` or a non-empty `sheets` array must be provided',
  path: ['sheets'],
});
