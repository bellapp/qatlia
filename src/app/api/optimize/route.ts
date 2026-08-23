import { NextResponse } from 'next/server';
import { optimizeCutting, Piece, Sheet, OptimizationOptions } from '@/lib/cutting/binpacking';
import { z } from 'zod';

const OptimizeSchema = z.object({
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
  }).passthrough().optional(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = OptimizeSchema.safeParse(body);

    if (!parsed.success) {
      console.error('Validation Optimize error:', JSON.stringify(parsed.error.format()));
      return NextResponse.json(
        { error: 'INVALID_INPUT', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { sheet, pieces, options } = parsed.data;
    const result = optimizeCutting(pieces as Piece[], sheet as Sheet, options as Partial<OptimizationOptions>);

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erreur inconnue';
    return NextResponse.json(
      { error: 'OPTIMIZATION_FAILED', message },
      { status: 500 }
    );
  }
}
