import { NextResponse } from 'next/server';
import { optimizeCutting2D, Piece, Sheet, OptimizationOptions } from '@/lib/cutting/binpacking';
import { OptimizeSchema } from '@/lib/cutting/optimize-schema';

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
    const result = optimizeCutting2D(pieces as Piece[], [sheet as Sheet], options as Partial<OptimizationOptions>);

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
