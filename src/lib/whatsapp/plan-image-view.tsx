/**
 * The drawing of the plan picture (layout: src/lib/whatsapp/plan-image.ts),
 * rendered to PNG by next/og in src/app/(site)/w/[code]/plan.png/route.ts.
 * next/og draws a subset of CSS: every element with children is a flex box,
 * the pieces are absolutely placed boxes. Latin text only (the bundled font):
 * the words the prospect reads are in the caption.
 */

import type { PlanImageLayout } from '@/lib/whatsapp/plan-image';

const BACKGROUND = '#F8FAFC';
const PANEL = '#E7E5E4';
const INK = '#1C1917';
const BRAND = '#F59E0B';

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
          }}
        />
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
