import { NextResponse } from 'next/server';
import { optimizeCutting, OptimizationResult } from '@/lib/cutting/binpacking';

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { pieces, sheet, options } = body;

    if (!pieces?.length || !sheet) {
      return NextResponse.json({ error: 'pieces and sheet required' }, { status: 400 });
    }

    const result: OptimizationResult = optimizeCutting(pieces, sheet, options);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Optimization failed' },
      { status: 500 }
    );
  }
}