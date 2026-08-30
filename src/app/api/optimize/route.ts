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

    const { sheet, sheets, pieces, options } = parsed.data;
    const stockSheets = sheets ?? (sheet ? [sheet] : []);
    if (stockSheets.length === 0) {
      // Defensive, practically unreachable: `OptimizeSchema`'s refine already
      // guarantees at least one of `sheet`/non-empty `sheets` is present, so
      // this guards against a future schema change silently letting an empty
      // stock list reach the optimizer instead of ever executing.
      return NextResponse.json(
        { error: 'INVALID_INPUT', details: 'Either `sheet` or a non-empty `sheets` array must be provided' },
        { status: 400 }
      );
    }
    const result = optimizeCutting2D(pieces as Piece[], stockSheets as Sheet[], options as Partial<OptimizationOptions>);

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
