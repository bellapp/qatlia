/**
 * The metres of edge banding on the plan that its price leaves out: sides
 * without a colour while no price per metre is set, or a plan saved before
 * such sides were counted. The atelier says it by the cost, so that a quote
 * never goes out short without the artisan knowing. Pure module.
 */

import { bandedLengthM, type OptimizationResult } from '@/lib/cutting/binpacking';

/** Below this, the two sums only differ by their rounding. */
const NOTHING_M = 0.005;

export function uncountedEdgeMetres(result: Pick<OptimizationResult, 'placedPieces' | 'costingInput'>): number {
  if (!result.costingInput) return 0;
  const banded = result.placedPieces.reduce((sum, piece) => sum + (bandedLengthM(piece) ?? 0), 0);
  const counted = result.costingInput.edge.segments.reduce((sum, segment) => sum + segment.lengthM, 0);
  const missing = banded - counted;
  return missing > NOTHING_M ? Math.round(missing * 100) / 100 : 0;
}
