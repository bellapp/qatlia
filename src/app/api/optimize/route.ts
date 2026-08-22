import { NextResponse } from 'next/server';
import { optimizeCutting, Piece, Sheet } from '@/lib/cutting/binpacking';
import { z } from 'zod';

const OptimizeSchema = z.object({
  sheet: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
    kerf: z.number().min(0).default(0.3),
    margin: z.number().min(0).default(0),
    grainDirection: z.boolean().default(true),
  }),
  pieces: z.array(
    z.object({
      id: z.string().optional(),
      name: z.string().optional(),
      width: z.number().positive(),
      height: z.number().positive(),
      quantity: z.number().int().positive().default(1),
      rotatable: z.boolean().optional(),
    })
  ).min(1),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = OptimizeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'INVALID_INPUT', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { sheet, pieces } = parsed.data;
    const result = optimizeCutting(pieces as Piece[], sheet as Sheet);

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
