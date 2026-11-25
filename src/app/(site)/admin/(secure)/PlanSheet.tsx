/**
 * One cut panel of a saved plan, drawn as the artisan got it: the panel, its
 * placed pieces at their saved position and size (as placed, so possibly
 * rotated). Server-rendered SVG, no interaction.
 */

import type { DetailSheet } from '@/lib/admin/project-detail';

/** Beyond this many pieces, labels would only overlap: the rectangles stay. */
const MAX_LABELS = 40;

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function PlanSheet({ sheet, number }: { sheet: DetailSheet; number: number }) {
  const { width, height } = sheet;
  // Text sized from the panel, so a 280 cm panel and a 60 cm offcut read alike.
  const font = Math.max(width, height) / 45;
  const labelled = sheet.pieces.length <= MAX_LABELS;

  return (
    <figure className="space-y-1.5 min-w-0">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2 text-[11px] text-slate-400">
        <span className="font-bold text-slate-200">
          Panneau {number}
          {sheet.label ? ` · ${sheet.label}` : ''}
        </span>
        <span dir="ltr">
          {fmt(width)} × {fmt(height)} · {sheet.pieces.length} pièce{sheet.pieces.length > 1 ? 's' : ''}
          {sheet.wasteRate !== null ? ` · chute ${(sheet.wasteRate <= 1 ? sheet.wasteRate * 100 : sheet.wasteRate).toFixed(1)} %` : ''}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto rounded-lg bg-slate-800/60 border border-white/10"
        role="img"
        aria-label={`Panneau ${number}, ${sheet.pieces.length} pièces`}
      >
        <rect x={0} y={0} width={width} height={height} fill="none" stroke="#64748b" strokeWidth={font / 6} />
        {sheet.pieces.map((piece, index) => {
          const showText = labelled && piece.width > font * 3 && piece.height > font * 1.4;
          return (
            <g key={index}>
              <rect
                x={piece.x}
                y={piece.y}
                width={piece.width}
                height={piece.height}
                fill="rgba(245, 158, 11, 0.22)"
                stroke="#f59e0b"
                strokeWidth={font / 8}
              />
              {showText ? (
                <text
                  x={piece.x + piece.width / 2}
                  y={piece.y + piece.height / 2}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={font}
                  fill="#e2e8f0"
                >
                  {`${piece.name ? `${piece.name} · ` : ''}${fmt(piece.width)}×${fmt(piece.height)}${piece.rotated ? ' ↻' : ''}`}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
