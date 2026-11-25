/**
 * The drawing of the plan picture (layout: src/lib/whatsapp/plan-image.ts),
 * rendered to PNG by next/og in src/app/(site)/w/[code]/plan.png/route.ts.
 *
 * It copies the atelier's result screen in its light theme
 * (src/app/(site)/atelier/page.tsx): the navy cost banner, the panel tabs
 * (src/components/SheetTabs.tsx), the plan — white panel, each piece in its
 * color as a 0.85 → 0.6 gradient with a slate outline, "#N" over « H×W cm »,
 * the offcuts hatched with a dashed outline and their size — and the export
 * buttons. next/og draws a subset of CSS: every element with children is a
 * flex box, everything is absolutely placed. Latin text only (the bundled font).
 */

import { EDGE_COLOR, EDGE_HALO } from '@/lib/cutting/edge-lines';
import type { PlanImageLayout, PlanImageOffcut, PlanImagePiece, PlanImageTab } from '@/lib/whatsapp/plan-image';
import { PLAN_IMAGE_EXPORT_ROWS, PLAN_IMAGE_TABS_HEIGHT } from '@/lib/whatsapp/plan-image';

const BACKGROUND = '#F1F5F9';
const CARD = '#FFFFFF';
const CARD_BORDER = '#E2E8F0';
const PLAN_BACKGROUND = '#F8FAFC';
const INK = '#1E293B';
const MUTED = '#64748B';
const PIECE_OUTLINE = '#334155';
const PANEL_OUTLINE = '#94A3B8';
/** brand-400 / brand-500 of tailwind.config. */
const BRAND = '#F5A623';
const NAVY = '#0F172A';

/** "#D97706" at `opacity`, for the atelier's piece gradient. */
function withOpacity(hex: string, opacity: number): string {
  const value = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

function Banner({ layout }: { layout: PlanImageLayout }) {
  const { banner, bannerBox } = layout;
  return (
    <div
      style={{
        display: 'flex',
        position: 'absolute',
        left: bannerBox.left,
        top: bannerBox.top,
        width: bannerBox.width,
        height: bannerBox.height,
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 52px',
        borderRadius: 28,
        background: NAVY,
        border: '2px solid #1E3A5F',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', fontSize: 24, fontWeight: 700, letterSpacing: 5, color: BRAND }}>{banner.label}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', marginTop: 10, fontSize: 80, fontWeight: 700, color: '#FFFFFF' }}>
          {banner.amount}
          <span style={{ marginLeft: 18, color: BRAND }}>{banner.currency}</span>
        </div>
        <div style={{ display: 'flex', marginTop: 10, fontSize: 28, color: '#94A3B8' }}>{banner.meta}</div>
      </div>
      <div
        style={{
          display: 'flex',
          width: 120,
          height: 120,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 26,
          background: 'rgba(245, 166, 35, 0.12)',
          border: '2px solid rgba(217, 134, 15, 0.35)',
        }}
      >
        {/* lucide TrendingUp */}
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
          <polyline points="16 7 22 7 22 13" />
        </svg>
      </div>
    </div>
  );
}

function Arrow({ left, top, enabled, direction }: { left: number; top: number; enabled: boolean; direction: 'prev' | 'next' }) {
  return (
    <div style={{ display: 'flex', position: 'absolute', left, top, width: 40, height: 72, alignItems: 'center', justifyContent: 'center', opacity: enabled ? 1 : 0.3 }}>
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <polyline points={direction === 'prev' ? '15 18 9 12 15 6' : '9 18 15 12 9 6'} />
      </svg>
    </div>
  );
}

function Tab({ tab }: { tab: PlanImageTab }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        position: 'absolute',
        left: tab.left,
        top: tab.top,
        width: tab.width,
        height: tab.height,
        padding: '0 18px',
        borderRadius: 16,
        background: tab.active ? BRAND : CARD,
        border: `2px solid ${tab.active ? BRAND : CARD_BORDER}`,
        color: tab.active ? NAVY : '#334155',
      }}
    >
      <div style={{ display: 'flex', fontSize: 26, fontWeight: 700, lineHeight: 1 }}>{tab.label}</div>
      <div style={{ display: 'flex', alignItems: 'center', marginTop: 10 }}>
        <div style={{ display: 'flex', width: 70, height: 8, borderRadius: 8, background: tab.active ? 'rgba(15, 23, 42, 0.15)' : CARD_BORDER }}>
          <div style={{ display: 'flex', width: (70 * tab.yield) / 100, height: 8, borderRadius: 8, background: tab.active ? 'rgba(15, 23, 42, 0.7)' : BRAND }} />
        </div>
        <div style={{ display: 'flex', marginLeft: 10, fontSize: 20, fontWeight: 700, color: tab.active ? 'rgba(15, 23, 42, 0.8)' : MUTED }}>{`${tab.yield}%`}</div>
      </div>
    </div>
  );
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
        color: MUTED,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      {offcut.size && <div style={{ display: 'flex', fontSize: offcut.font }}>{offcut.size}</div>}
    </div>
  );
}

function ExportButton({ left, top, width, height, label, primary, tone }: {
  left: number; top: number; width: number; height: number; label: string; primary?: boolean; tone?: 'quote';
}) {
  const quote = tone === 'quote';
  return (
    <div
      style={{
        display: 'flex',
        position: 'absolute',
        left,
        top,
        width,
        height,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: primary || quote ? 22 : 16,
        background: primary ? BRAND : quote ? 'rgba(99, 102, 241, 0.1)' : CARD,
        border: `2px solid ${primary ? BRAND : quote ? 'rgba(99, 102, 241, 0.3)' : CARD_BORDER}`,
        color: primary ? NAVY : quote ? '#6366F1' : '#334155',
        fontSize: primary ? 32 : 26,
        fontWeight: 700,
      }}
    >
      {label}
    </div>
  );
}

function Exports({ layout }: { layout: PlanImageLayout }) {
  const { exports, exportsTop, card } = layout;
  const rows = PLAN_IMAGE_EXPORT_ROWS;
  const fileGap = 12;
  const fileWidth = (card.width - fileGap * (exports.files.length - 1)) / exports.files.length;
  const pdfTop = exportsTop + rows.files + rows.gap;
  const quoteTop = pdfTop + rows.pdf + rows.gap;
  return (
    <>
      {exports.files.map((label, i) => (
        <ExportButton key={label} left={card.left + i * (fileWidth + fileGap)} top={exportsTop} width={fileWidth} height={rows.files} label={label} />
      ))}
      <ExportButton left={card.left} top={pdfTop} width={card.width} height={rows.pdf} label={exports.pdf} primary />
      <ExportButton left={card.left} top={quoteTop} width={card.width} height={rows.quote} label={exports.quote} tone="quote" />
    </>
  );
}

/** The chants, in one drawing over the whole panel: two paths, however many pieces. */
function Edges({ layout }: { layout: PlanImageLayout }) {
  const { edges, panel } = layout;
  if (!edges) return null;
  const d = edges.lines.map((l) => `M${l.x1} ${l.y1}L${l.x2} ${l.y2}`).join('');
  return (
    <svg
      width={panel.width}
      height={panel.height}
      viewBox={`0 0 ${panel.width} ${panel.height}`}
      fill="none"
      style={{ position: 'absolute', left: panel.left, top: panel.top }}
    >
      <path d={d} stroke={EDGE_HALO} strokeWidth={edges.halo} strokeOpacity="0.85" />
      <path d={d} stroke={EDGE_COLOR} strokeWidth={edges.stroke} strokeDasharray={edges.dash.join(' ')} />
    </svg>
  );
}

function EdgeLegend({ layout }: { layout: PlanImageLayout }) {
  const legend = layout.edgeLegend;
  if (!legend) return null;
  return (
    <div
      style={{
        display: 'flex',
        position: 'absolute',
        left: legend.left,
        top: legend.top,
        width: legend.width,
        height: legend.height,
        alignItems: 'center',
        fontSize: 28,
        fontWeight: 700,
        color: INK,
      }}
    >
      <svg width="84" height="8" viewBox="0 0 84 8" fill="none" style={{ marginRight: 16 }}>
        <path d="M0 4L84 4" stroke={EDGE_COLOR} strokeWidth="6" strokeDasharray="16 10" />
      </svg>
      {legend.label}
    </div>
  );
}

export function PlanImage({ layout }: { layout: PlanImageLayout }) {
  const { panel, card } = layout;
  // The atelier's strokes, in cm: 1.5 for the panel, 0.4 for a piece.
  const panelOutline = Math.max(2, Math.round(1.5 * layout.scale * 0.5));
  const pieceOutline = Math.max(1, Math.round(0.4 * layout.scale));
  const tabsBottom = layout.tabsTop + PLAN_IMAGE_TABS_HEIGHT;
  const arrowTop = layout.tabs[0]?.top ?? layout.tabsTop;
  const footerTop = layout.exportsTop + PLAN_IMAGE_EXPORT_ROWS.files + PLAN_IMAGE_EXPORT_ROWS.pdf + PLAN_IMAGE_EXPORT_ROWS.quote + 2 * PLAN_IMAGE_EXPORT_ROWS.gap;
  return (
    <div style={{ display: 'flex', position: 'relative', width: layout.width, height: layout.height, background: BACKGROUND }}>
      <Banner layout={layout} />

      {/* The plan card: the tabs row over the plan. */}
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          left: card.left,
          top: card.top,
          width: card.width,
          height: card.height,
          borderRadius: 24,
          background: PLAN_BACKGROUND,
          border: `2px solid ${CARD_BORDER}`,
        }}
      />
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          left: card.left + 2,
          top: card.top + 2,
          width: card.width - 4,
          height: tabsBottom - card.top - 2,
          borderRadius: '22px 22px 0 0',
          background: CARD,
          borderBottom: `2px solid ${CARD_BORDER}`,
        }}
      />
      {layout.sheetCount > 1 && <Arrow left={card.left + 16} top={arrowTop} enabled={false} direction="prev" />}
      {layout.tabs.map((tab) => (
        <Tab key={tab.label} tab={tab} />
      ))}
      {layout.sheetCount > 1 && <Arrow left={card.left + card.width - 16 - 40} top={arrowTop} enabled={layout.moreTabs} direction="next" />}

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
      <Edges layout={layout} />
      <EdgeLegend layout={layout} />

      <Exports layout={layout} />

      <div
        style={{
          display: 'flex',
          position: 'absolute',
          left: card.left,
          top: footerTop,
          width: card.width,
          height: layout.height - footerTop,
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 40,
          fontWeight: 700,
          color: BRAND,
        }}
      >
        QatliA
      </div>
    </div>
  );
}
