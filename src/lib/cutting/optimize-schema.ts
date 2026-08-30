import { z } from 'zod';
import { MATERIAL_TYPE_VALUES, OPTIMIZATION_PRIORITY_VALUES } from './binpacking';

// Shared shape for a single stock sheet, reused by both the legacy `sheet`
// field and the multi-stock `sheets` array so neither surface can drift.
export const SheetSchema = z.object({
  id: z.string().optional(),
  label: z.string().optional(),
  width: z.number().positive(),
  height: z.number().positive(),
  kerf: z.number().min(0).default(0.3),
  margin: z.number().min(0).default(1.0),
  grainDirection: z.boolean().default(true),
  material: z.enum(MATERIAL_TYPE_VALUES).optional(),
  quantity: z.number().int().positive().optional(),
});

export const OptimizeSchema = z.object({
  // Legacy single-stock callers keep using `sheet`. Multi-material/multi-stock
  // callers use `sheets` instead. At least one of the two is required (see the
  // `.refine` below); when both are present the route prefers `sheets`.
  sheet: SheetSchema.optional(),
  sheets: z.array(SheetSchema).min(1).optional(),
  pieces: z.array(
    z.object({
      id: z.string().optional(),
      name: z.string().optional(),
      width: z.coerce.number().positive(),
      height: z.coerce.number().positive(),
      quantity: z.coerce.number().int().positive().default(1),
      material: z.string().optional().nullable(),
      rotatable: z.boolean().optional(),
      color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    }).passthrough()
  ).min(1),
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
  }).passthrough().optional(),
}).refine((data) => data.sheet !== undefined || (data.sheets !== undefined && data.sheets.length > 0), {
  message: 'Either `sheet` or a non-empty `sheets` array must be provided',
  path: ['sheets'],
});
