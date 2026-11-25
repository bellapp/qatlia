import type { SideMeasures } from '@/lib/cutting/side-measures';

/** From the middle of a digit down to its baseline, for a font size of 1. */
const BASELINE = 0.36;

/** The two measures of a piece (src/lib/cutting/side-measures.ts), inside the plan's SVG. */
export default function PlanMeasures({ measures, fill }: { measures: SideMeasures; fill: string }) {
  const { width, height } = measures;
  return (
    <g data-testid="plan-measures" pointerEvents="none" fill={fill} fontFamily="monospace" fontWeight="bold" textAnchor="middle">
      {width && <text x={width.x} y={width.y + BASELINE * width.font} fontSize={width.font}>{width.text}</text>}
      {height && (
        <text x={height.x} y={height.y + BASELINE * height.font} fontSize={height.font} transform={`rotate(-90 ${height.x} ${height.y})`}>{height.text}</text>
      )}
    </g>
  );
}
