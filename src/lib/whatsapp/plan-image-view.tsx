/**
 * The drawing of the plan picture (layout: src/lib/whatsapp/plan-image.ts),
 * rendered to PNG by next/og in src/app/(site)/w/[code]/plan.png/route.ts.
 * next/og draws a subset of CSS: every element with children is a flex box,
 * the pieces are absolutely placed boxes, each with its line and size. Digits
 * and Latin text only (the bundled font): the words the prospect reads are in
 * the caption.
 */

import type { PlanImageLabel, PlanImageLayout } from '@/lib/whatsapp/plan-image';

const BACKGROUND = '#F8FAFC';
const PANEL = '#E7E5E4';
const INK = '#1C1917';
const BRAND = '#F59E0B';

/**
 * The line in a dark pill, then the size. Along a standing piece the label is
 * laid out lying down, as long as the piece is tall, centred on it, then turned
 * a quarter: laid out in the piece's own width, next/og would cut the text.
 */
function PieceLabel({ label, width, height }: { label: PlanImageLabel; width: number; height: number }) {
  const { fontSize } = label;
  const box = label.vertical
    ? { position: 'absolute' as const, width: height, height: width, left: (width - height) / 2, top: (height - width) / 2, transform: 'rotate(-90deg)' }
    : { flexShrink: 0 };
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        whiteSpace: 'nowrap',
        fontSize,
        fontWeight: 700,
        color: INK,
        ...box,
      }}
    >
      <div
        style={{
          display: 'flex',
          color: '#FFFFFF',
          background: INK,
          borderRadius: fontSize,
          padding: `0 ${Math.round(fontSize * 0.3)}px`,
          marginRight: label.size ? Math.round(fontSize * 0.3) : 0,
        }}
      >
        {String(label.line)}
      </div>
      {label.size && <div style={{ display: 'flex' }}>{label.size}</div>}
    </div>
  );
}

export function PlanImage({ layout }: { layout: PlanImageLayout }) {
  const { panel } = layout;
  const footerTop = panel.top + panel.height;
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
          background: PANEL,
          border: `4px solid ${INK}`,
        }}
      />
      {layout.pieces.map((piece, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            position: 'absolute',
            left: piece.left,
            top: piece.top,
            width: piece.width,
            height: piece.height,
            background: piece.color,
            border: `2px solid ${INK}`,
            alignItems: 'center',
            justifyContent: 'center',
            // No overflow clip: next/og clips before it turns a label, which
            // would cut a standing one to the piece's width. pieceLabel sizes
            // every label to fit its piece.
          }}
        >
          {piece.label && <PieceLabel label={piece.label} width={piece.width} height={piece.height} />}
        </div>
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
            background: INK,
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
