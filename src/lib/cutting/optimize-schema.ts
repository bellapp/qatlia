import { z } from 'zod';

export const OptimizeSchema = z.object({
  sheet: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
    kerf: z.number().min(0).default(0.3),
    margin: z.number().min(0).default(1.0),
    grainDirection: z.boolean().default(true),
    material: z.enum(['mdf', 'aluminium', 'verre', 'contreplaques']).optional(),
  }),
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
    optimizationPriority: z.string().optional(),
    minReusableOffcutWidth: z.number().finite().min(0).optional(),
    minReusableOffcutHeight: z.number().finite().min(0).optional(),
  }).passthrough().optional(),
});
