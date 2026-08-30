import { z } from 'zod';

export const ExportSchema = z.object({
  projectName: z.string().default('PROJET DÉBIT'),
  material: z.string().default('MDF'),
  costPerSheet: z.number().default(450.0),
  costCutPerMeter: z.number().default(5.0),
  /**
   * The unit the artisan had selected for display at export time. All
   * geometry below (sheet/pieces/offcuts) is always canonical centimetres —
   * the optimizer never emits millimetres. `displayUnit` only controls how
   * dimensions are *labeled* in the PDF (via `fromCanonicalCm`); it never
   * feeds back into any area/cost/linear-cut calculation.
   */
  displayUnit: z.enum(['cm', 'mm']).default('cm'),
  sheet: z.object({
    width: z.number(),
    height: z.number(),
    kerf: z.number().default(0.3),
    margin: z.number().default(0.0),
    grainDirection: z.boolean().default(false),
  }),
  result: z.object({
    sheetsUsed: z.number(),
    wastePercentage: z.number(),
    totalAreaUsed: z.number(),
    totalAreaAvailable: z.number(),
    moneySavedMad: z.number().optional().default(0),
    offcuts: z.array(
      z.object({
        sheetIndex: z.number(),
        width: z.number(),
        height: z.number(),
        x: z.number(),
        y: z.number(),
        areaM2: z.number(),
        isReusable: z.boolean(),
      })
    ).optional().default([]),
    placedPieces: z.array(
      z.object({
        pieceNumber: z.number(),
        name: z.string(),
        sheetIndex: z.number(),
        width: z.number(),
        height: z.number(),
        rotated: z.boolean(),
        x: z.number(),
        y: z.number(),
      })
    ),
  }),
});
