/**
 * The drawing of the plan picture (layout: src/lib/whatsapp/plan-image.ts),
 * rendered to PNG by next/og in src/app/(site)/w/[code]/plan.png/route.ts.
 *
 * It copies the atelier's plan in its light theme (the SVG in
 * src/app/(site)/atelier/page.tsx): white panel, each piece in its color as a
 * 0.85 → 0.6 gradient with a slate outline, "#N" over « H×W cm », the offcuts
 * hatched with a dashed outline and their size. next/og draws a subset of CSS:
 * every element with children is a flex box, everything is absolutely placed.
 * Digits and Latin text only (the bundled font).
 */

import type { PlanImageLayout, PlanImageOffcut, PlanImagePiece } from '@/lib/whatsapp/plan-image';

const BACKGROUND = '#F8FAFC';
const INK = '#1E293B';
const PIECE_OUTLINE = '#334155';
const PANEL_OUTLINE = '#94A3B8';
const BRAND = '#F59E0B';

/** "#D97706" at `opacity`, for the atelier's piece gradient. */
function withOpacity(hex: string, opacity: number): string {
  const value = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

function Piece({ piece, outline }: { piece: PlanImagePiece; outline: number }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        position: 'absolute',
        left: piece.left,
        top: piece.top,
        width: piece.width,
        height: piece.height,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundImage: `linear-gradient(135deg, ${withOpacity(piece.color, 0.85)}, ${withOpacity(piece.color, 0.6)})`,
        border: `${outline}px solid ${PIECE_OUTLINE}`,
        color: INK,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      <div style={{ display: 'flex', fontSize: piece.numberFont, lineHeight: 1.1 }}>{piece.number}</div>
      {piece.size && <div style={{ display: 'flex', fontSize: piece.sizeFont, lineHeight: 1.1 }}>{piece.size}</div>}
    </div>
  );
}

function Offcut({ offcut }: { offcut: PlanImageOffcut }) {
  return (
    <div
      style={{
        display: 'flex',
        position: 'absolute',
        left: offcut.left,
        top: offcut.top,
        width: offcut.width,
        height: offcut.height,
        alignItems: 'center',
        justifyContent: 'center',
        // The atelier's 45° hatch; next/og has no repeating gradient, so one
        // 18 px tile with a diagonal stroke (its gradient line is 25.5 px), repeated.
        backgroundImage: 'linear-gradient(45deg, transparent 11.7px, #CBD5E1 11.7px, #CBD5E1 13.8px, transparent 13.8px)',
        backgroundSize: '18px 18px',
        backgroundRepeat: 'repeat',
        border: `2px dashed ${PANEL_OUTLINE}`,
        color: '#64748B',
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      {offcut.size && <div style={{ display: 'flex', fontSize: offcut.font }}>{offcut.size}</div>}
    </div>
  );
}

export function PlanImage({ layout }: { layout: PlanImageLayout }) {
  const { panel } = layout;
  const footerTop = panel.top + panel.height;
  // The atelier's strokes, in cm: 1.5 for the panel, 0.4 for a piece.
  const panelOutline = Math.max(2, Math.round(1.5 * layout.scale * 0.5));
  const pieceOutline = Math.max(1, Math.round(0.4 * layout.scale));
  return (
    <div style={{ display: 'flex', position: 'relative', width: layout.width, height: layout.height, background: BACKGROUND }}>
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          left: panel.left,
          top: panel.top,
          width: panel.width,
          height: panel.height,
          backgroundImage: 'linear-gradient(135deg, #FFFFFF, #F8FAFC)',
          border: `${panelOutline}px solid ${PANEL_OUTLINE}`,
        }}
      />
      {layout.offcuts.map((offcut, i) => (
        <Offcut key={`o${i}`} offcut={offcut} />
      ))}
      {layout.pieces.map((piece, i) => (
        <Piece key={`p${i}`} piece={piece} outline={pieceOutline} />
      ))}
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          left: panel.left,
          top: footerTop,
          width: panel.width,
          height: layout.height - footerTop,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', fontSize: 48, fontWeight: 700, color: BRAND }}>QatliA</div>
        <div
          style={{
            display: 'flex',
            fontSize: 40,
            fontWeight: 700,
            color: '#FFFFFF',
            background: '#1C1917',
            borderRadius: 999,
            padding: '8px 28px',
          }}
        >
          {layout.badge}
        </div>
      </div>
    </div>
  );
}
