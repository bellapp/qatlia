/**
 * The line-by-line detail behind a project's cost: which panels, how many,
 * at what price; how many linear metres of each edge banding, at what rate;
 * the labour. Shown under the totals on screen and in the PDF report, so a
 * client can check the figures (user request, 2026-11-13).
 *
 * It only regroups the `CostBreakdownInput` the optimizer priced, and every
 * group total goes through the same calculator (src/lib/costing.ts). With
 * one panel type and whole-cent rates, the groups add up exactly to the
 * breakdown. With several groups, each group is rounded on its own, so their
 * sum can differ from the category total by a cent; the totals shown stay
 * the breakdown's.
 *
 * Pure module: no React, no i18n. Labels are the caller's job.
 */

import {
  computeEdgeCost,
  computeLaborCost,
  computeMaterialCost,
  type CostBreakdownInput,
  type EdgeSegmentCostLine,
  type LaborPricing,
  type SheetCostLine,
  type StockPricing,
} from './costing';

export interface PanelCostDetail {
  material?: string;
  label?: string;
  color?: string;
  widthCm?: number;
  heightCm?: number;
  /** Area of one panel, m². */
  areaM2: number;
  /** Panels of this kind used by the plan. */
  count: number;
  pricing: StockPricing;
  total: number;
}

export interface EdgeCostDetail {
  /** Edge-banding preset id; absent on results saved before it was recorded. */
  edgeId?: string;
  /** Banded length, metres, across every placed piece. */
  lengthM: number;
  pricePerMeter: number;
  total: number;
}

export interface LaborCostDetail {
  pricing: LaborPricing;
  /** Measured cut length, metres, when labour is priced per metre. */
  cutLengthM?: number;
  total: number;
}

export interface CostDetail {
  panels: PanelCostDetail[];
  edges: EdgeCostDetail[];
  labor: LaborCostDetail;
}

/** Lengths summed in floating point (0.63 + 0.63 …) carry noise; metres to 0.1 mm is plenty. */
function cleanLength(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function panelKey(line: SheetCostLine): string {
  return JSON.stringify([
    line.material ?? null,
    line.label ?? null,
    line.color ?? null,
    line.widthCm ?? null,
    line.heightCm ?? null,
    line.areaM2,
    line.pricing.mode,
    line.pricing.value,
  ]);
}

export function buildCostDetail(input: CostBreakdownInput): CostDetail {
  const panelGroups = new Map<string, SheetCostLine[]>();
  for (const line of input.material.sheets) {
    if (line.quantity <= 0) continue;
    const key = panelKey(line);
    const group = panelGroups.get(key);
    if (group) group.push(line);
    else panelGroups.set(key, [line]);
  }
  const panels: PanelCostDetail[] = Array.from(panelGroups.values()).map((lines) => {
    const first = lines[0];
    return {
      ...(first.material !== undefined ? { material: first.material } : {}),
      ...(first.label !== undefined ? { label: first.label } : {}),
      ...(first.color !== undefined ? { color: first.color } : {}),
      ...(first.widthCm !== undefined ? { widthCm: first.widthCm } : {}),
      ...(first.heightCm !== undefined ? { heightCm: first.heightCm } : {}),
      areaM2: first.areaM2,
      count: lines.reduce((sum, line) => sum + line.quantity, 0),
      pricing: first.pricing,
      total: computeMaterialCost({ sheets: lines, basis: input.material.basis }),
    };
  });

  const edgeGroups = new Map<string, EdgeSegmentCostLine[]>();
  for (const segment of input.edge.segments) {
    if (segment.lengthM <= 0) continue;
    const key = JSON.stringify([segment.edgeId ?? null, segment.pricePerMeter]);
    const group = edgeGroups.get(key);
    if (group) group.push(segment);
    else edgeGroups.set(key, [segment]);
  }
  const edges: EdgeCostDetail[] = Array.from(edgeGroups.values()).map((segments) => ({
    ...(segments[0].edgeId !== undefined ? { edgeId: segments[0].edgeId } : {}),
    lengthM: cleanLength(segments.reduce((sum, segment) => sum + segment.lengthM, 0)),
    pricePerMeter: segments[0].pricePerMeter,
    total: computeEdgeCost({ segments, basis: input.edge.basis }),
  }));

  const labor: LaborCostDetail = {
    pricing: input.labor.pricing,
    ...(input.labor.pricing.mode === 'per_meter' && input.labor.cutLengthM !== undefined
      ? { cutLengthM: input.labor.cutLengthM }
      : {}),
    total: computeLaborCost(input.labor),
  };

  return { panels, edges, labor };
}

/** Whether the labour line is worth showing: a configured charge, not the unset 0 MAD default. */
export function hasLaborCharge(labor: LaborCostDetail): boolean {
  return labor.total > 0 || labor.pricing.value > 0;
}
