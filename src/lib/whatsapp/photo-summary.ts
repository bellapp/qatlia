/**
 * The bot's answer to a photographed cut list (plan 2026-11-19): the plan is
 * computed on the panel the sheet states, or on the atelier's default panel,
 * and the reply always names the panel used. The full plan stays in the app,
 * after sign-up: the reply gives counts, the first lines and the link.
 *
 * Pure: no network, no database.
 */

import { DEFAULT_STOCK_SHEET, optimizeCutting2D, type Piece } from '@/lib/cutting/binpacking';
import type { ReadPiece, ReadSheet } from '@/lib/vision/read-cut-list';
import type { PhotoSummary } from '@/lib/whatsapp/photo-store';
import type { Lang } from '@/lib/whatsapp/copy';

/** Lines of the cut list repeated in the reply; the rest is counted. */
const SHOWN_LINES = 5;

export function photoLink(code: string): string {
  return `https://qatlia.ma/w/${code}?utm_source=whatsapp&utm_medium=bot&utm_campaign=photo`;
}

/** The panel a summary is computed on: the one stated on the sheet, or the atelier's default. */
export function panelFor(sheet: ReadSheet | null): ReadSheet {
  return sheet ?? { height: DEFAULT_STOCK_SHEET.height, width: DEFAULT_STOCK_SHEET.width };
}

export function summarizeCutList(pieces: ReadPiece[], sheet: ReadSheet | null): PhotoSummary {
  const panel = panelFor(sheet);
  const result = optimizeCutting2D(
    pieces.map((p, i): Piece => ({ ...p, id: String(i + 1), material: 'mdf', rotatable: true })),
    [{ ...DEFAULT_STOCK_SHEET, height: panel.height, width: panel.width }],
  );
  return {
    pieceCount: pieces.reduce((sum, p) => sum + p.quantity, 0),
    lineCount: pieces.length,
    sheetsUsed: result.sheetsUsed,
    wastePercent: Math.round(result.wastePercentage),
    sheet: panel,
    unplaced: result.unplacedPieces.length,
  };
}

const isDefaultPanel = (sheet: ReadSheet) =>
  sheet.height === DEFAULT_STOCK_SHEET.height && sheet.width === DEFAULT_STOCK_SHEET.width;

const number = (value: number, lang: Lang) => {
  const text = String(Math.round(value * 10) / 10);
  return lang === 'fr' ? text.replace('.', ',') : text;
};

function pieceLines(pieces: ReadPiece[], lang: Lang): string {
  const unnamed = lang === 'fr' ? 'Pièce' : 'قطعة';
  const shown = pieces
    .slice(0, SHOWN_LINES)
    .map((p, i) => `${p.name || `${unnamed} ${i + 1}`} ${number(p.height, lang)} × ${number(p.width, lang)} ×${p.quantity}`)
    .join(' · ');
  const rest = pieces.length - SHOWN_LINES;
  if (rest <= 0) return shown;
  return `${shown} … (+${rest} ${lang === 'fr' ? 'autres' : 'أخرى'})`;
}

export function photoResultText(lang: Lang, summary: PhotoSummary, pieces: ReadPiece[], link: string): string {
  const panel = `${number(summary.sheet.height, lang)}×${number(summary.sheet.width, lang)}`;
  const standard = isDefaultPanel(summary.sheet);

  if (lang === 'ar') {
    const lines = [
      `✅ تقرات ${summary.pieceCount} قطعة · ${summary.sheetsUsed} لوحة ${panel} · ${summary.wastePercent}% ضياع`,
      ...(standard ? ['(لوحة عادية، تقدر تبدلها فالورشة)'] : []),
      pieceLines(pieces, lang),
      ...(summary.unplaced > 0 ? [`⚠️ ${summary.unplaced} قطعة كبر من اللوحة`] : []),
      `👉 شوف المخطط كامل (من بعد التسجيل فابور): ${link}`,
    ];
    return lines.join('\n');
  }

  const pieceWord = summary.pieceCount > 1 ? 'pièces lues' : 'pièce lue';
  const panelWord = summary.sheetsUsed > 1 ? 'panneaux' : 'panneau';
  const unplacedWord = summary.unplaced > 1 ? 'pièces plus grandes' : 'pièce plus grande';
  const lines = [
    `✅ ${summary.pieceCount} ${pieceWord} · ${summary.sheetsUsed} ${panelWord} ${panel} · ${summary.wastePercent} % de chute`,
    ...(standard ? ['(panneau standard, modifiable dans l\'atelier)'] : []),
    pieceLines(pieces, lang),
    ...(summary.unplaced > 0 ? [`⚠️ ${summary.unplaced} ${unplacedWord} que le panneau`] : []),
    `👉 Voir le plan complet (après inscription gratuite) : ${link}`,
  ];
  return lines.join('\n');
}
