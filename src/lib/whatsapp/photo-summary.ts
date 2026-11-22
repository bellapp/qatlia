/**
 * The bot's answer to a photographed cut list (plan 2026-11-19): the plan is
 * computed on the panel the sheet states, or on the atelier's default panel,
 * and the reply always names the panel used. The full plan stays in the app,
 * after sign-up: the reply gives counts, the first lines and the link.
 *
 * Pure: no network, no database.
 */

import { DEFAULT_STOCK_SHEET, optimizeCutting2D, type OptimizationResult, type Piece, type Sheet } from '@/lib/cutting/binpacking';
import type { ReadPiece, ReadSheet } from '@/lib/vision/read-cut-list';
import type { PhotoDraft, PhotoSummary } from '@/lib/whatsapp/photo-store';
import type { AtelierDraft } from '@/lib/atelier-draft';
import type { Lang } from '@/lib/whatsapp/copy';
import type { DisplayUnit } from '@/lib/units';
import { getResolvedPieceColor } from '@/lib/pieces/catalog';

/** Lines of the cut list repeated in the reply; the rest is counted. */
const SHOWN_LINES = 5;

/**
 * The provenance of a visitor who opens a photo link: the page records it
 * itself (OpenInAtelier), so the link carries no tag the prospect would read.
 */
export const PHOTO_LINK_TRACKING = '?utm_source=whatsapp&utm_medium=bot&utm_campaign=photo';

export function photoLink(code: string): string {
  return `https://qatlia.ma/w/${code}`;
}

/** The panel a summary is computed on: the one stated on the sheet, or the atelier's default. */
export function panelFor(sheet: ReadSheet | null): ReadSheet {
  return sheet ?? { height: DEFAULT_STOCK_SHEET.height, width: DEFAULT_STOCK_SHEET.width };
}

/**
 * The standard panels, smallest first: the atelier's default, then the 280 × 207
 * of the panel catalogue (src/lib/panel-catalog.ts).
 */
const STANDARD_PANELS: readonly ReadSheet[] = [
  { height: DEFAULT_STOCK_SHEET.height, width: DEFAULT_STOCK_SHEET.width },
  { height: 280, width: 207 },
];

const holds = (panel: ReadSheet, piece: ReadPiece) =>
  (piece.height <= panel.height && piece.width <= panel.width) || (piece.width <= panel.height && piece.height <= panel.width);

/**
 * Owner, 22/11/2026: « Si la taille du panneau est spécifiée, c'est bon. Sinon,
 * on doit prendre la taille des panneaux qui peuvent contenir la taille des
 * pièces. » The panel written on the sheet; else the first standard panel
 * every piece fits in (turned if need be); else the default, whose oversize
 * pieces the answer counts. `fitted` when a larger panel was taken.
 */
export function fittingPanel(pieces: ReadPiece[], sheet: ReadSheet | null): { panel: ReadSheet; fitted: boolean } {
  if (sheet) return { panel: sheet, fitted: false };
  const index = STANDARD_PANELS.findIndex((panel) => pieces.every((piece) => holds(panel, piece)));
  return index > 0 ? { panel: STANDARD_PANELS[index], fitted: true } : { panel: panelFor(null), fitted: false };
}

/** Panel sides the bot believes, in cm. Outside this, the size was misread (mm, a piece line) and the default is used. */
const PANEL_MIN_CM = 30;
const PANEL_MAX_CM = 400;

export function plausiblePanel(sheet: ReadSheet | null): ReadSheet | null {
  if (!sheet) return null;
  const ok = (side: number) => Number.isFinite(side) && side >= PANEL_MIN_CM && side <= PANEL_MAX_CM;
  return ok(sheet.height) && ok(sheet.width) ? sheet : null;
}

/** The lines the plan can use: a size the reader could not turn into a positive number is left out. */
export function usablePieces(pieces: ReadPiece[]): ReadPiece[] {
  const positive = (value: number) => Number.isFinite(value) && value > 0;
  return pieces.filter((p) => positive(p.height) && positive(p.width) && positive(p.quantity));
}

/**
 * The most pieces (quantities expanded) the bot and the link page plan. The plan
 * of 319 pieces takes ~1.5 s, of 480 ~5 s, of 640 ~20 s, of 960 ~40 s (21/11/2026):
 * over this, it would not fit in the webhook's 60 s after the read, and the
 * atelier plans the list after sign-up (its normal, paid optimization).
 */
export const BOT_PLAN_MAX_PIECES = 450;

const pieceTotal = (pieces: Array<{ quantity: number }>) => pieces.reduce((sum, p) => sum + p.quantity, 0);

/** The counts of a list too long to plan here: no panel count, no waste. */
export function listSummary(pieces: ReadPiece[], sheet: ReadSheet | null): PhotoSummary {
  return {
    pieceCount: pieceTotal(pieces),
    lineCount: pieces.length,
    sheetsUsed: 0,
    wastePercent: 0,
    sheet: fittingPanel(pieces, sheet).panel,
    unplaced: 0,
    ...(fittingPanel(pieces, sheet).fitted ? { fitted: true as const } : {}),
  };
}

export function summarizeCutList(pieces: ReadPiece[], sheet: ReadSheet | null): PhotoSummary {
  const { panel, fitted } = fittingPanel(pieces, sheet);
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
    ...(fitted ? { fitted: true as const } : {}),
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
    .map((p, i) => `${p.name || `${unnamed} ${i + 1}`} ${ltr(lang, `${number(p.height, lang)} × ${number(p.width, lang)} ×${p.quantity}`)}`)
    .join(' · ');
  const rest = pieces.length - SHOWN_LINES;
  if (rest <= 0) return shown;
  return `${shown} … (+${rest} ${lang === 'fr' ? 'autres' : 'أخرى'})`;
}

/**
 * In a right-to-left message, "278×208" or "41.8 × 38 ×7" would show with
 * their numbers in reverse order: each is wrapped in a left-to-right isolate
 * (U+2066 … U+2069). French text is left as is.
 */
const ltr = (lang: Lang, text: string) => (lang === 'ar' ? `⁦${text}⁩` : text);

/** The counts, the panel note and the warning, shared by the text answer and the picture's caption. */
function resultLines(lang: Lang, summary: PhotoSummary): { head: string; panelNote: string[]; warning: string[] } {
  const panel = `${number(summary.sheet.height, lang)}×${number(summary.sheet.width, lang)}`;
  const standard = isDefaultPanel(summary.sheet);

  if (lang === 'ar') {
    return {
      // Labelled figures (« القطع: 14 ») rather than counted nouns: no number agreement to get wrong.
      head: `✅ القطع اللي تقرات: ${ltr(lang, String(summary.pieceCount))} · اللوحات: ${ltr(lang, String(summary.sheetsUsed))} (${ltr(lang, panel)}) · الهدر: ${ltr(lang, `${summary.wastePercent}%`)}`,
      panelNote: summary.fitted
        ? [`(لوحة ${ltr(lang, panel)} حيت القطع طوال، تقدر تبدلها فالورشة)`]
        : standard ? ['(لوحة عادية، تقدر تبدلها فالورشة)'] : [],
      warning: summary.unplaced > 0 ? [`⚠️ قطع كبر من اللوحة: ${ltr(lang, String(summary.unplaced))}`] : [],
    };
  }

  const pieceWord = summary.pieceCount > 1 ? 'pièces lues' : 'pièce lue';
  const panelWord = summary.sheetsUsed > 1 ? 'panneaux' : 'panneau';
  const unplacedWord = summary.unplaced > 1 ? 'pièces plus grandes' : 'pièce plus grande';
  return {
    head: `✅ ${summary.pieceCount} ${pieceWord} · ${summary.sheetsUsed} ${panelWord} ${panel} · ${summary.wastePercent} % de chute`,
    panelNote: summary.fitted
      ? [`(panneau ${panel} choisi pour la longueur des pièces, modifiable dans l'atelier)`]
      : standard ? ['(panneau standard, modifiable dans l\'atelier)'] : [],
    warning: summary.unplaced > 0 ? [`⚠️ ${summary.unplaced} ${unplacedWord} que le panneau`] : [],
  };
}

export function photoResultText(lang: Lang, summary: PhotoSummary, pieces: ReadPiece[], link: string): string {
  const { head, panelNote, warning } = resultLines(lang, summary);
  // The link shows the plan at once (preview); it lasts PHOTO_READ_TTL_HOURS.
  const cta = lang === 'ar'
    ? `👉 شوف مخطط التقطيع ديالك (الرابط صالح ${ltr(lang, '24')} ساعة): ${link}`
    : `👉 Voir votre plan de coupe (lien valable 24 h) : ${link}`;
  return [head, ...panelNote, pieceLines(pieces, lang), ...warning, cta].join('\n');
}

/**
 * The caption of the plan picture (src/lib/whatsapp/plan-image.ts): the counts
 * and the link, without the list of pieces. The picture shows one panel and no
 * measure, so the caption points up at it and on to the whole plan.
 */
export function photoResultCaption(lang: Lang, summary: PhotoSummary, link: string): string {
  const { head, panelNote, warning } = resultLines(lang, summary);
  const cta = lang === 'ar'
    ? `👆 هادا طرف من مخطط التقطيع ديالك. شوفو كامل هنا (الرابط صالح ${ltr(lang, '24')} ساعة): ${link}`
    : `👆 Voici le début de votre plan de coupe. Voyez-le en entier ici (lien valable 24 h) : ${link}`;
  return [head, ...panelNote, ...warning, cta].join('\n');
}

/** The button under the plan picture (WhatsApp: 20 characters at most). */
const PLAN_BUTTON: Record<Lang, string> = { ar: 'شوف المخطط كامل', fr: 'Voir le plan complet' };

/**
 * The plan picture with a button to the link (owner, 21/11/2026: « l'image
 * cliquable pour renvoyer vers le site »): the caption's counts, a line that
 * points at the picture, and the link as the button rather than in the text.
 */
export function photoResultCard(lang: Lang, summary: PhotoSummary, link: string): {
  image: string;
  body: string;
  button: string;
  url: string;
} {
  const { head, panelNote, warning } = resultLines(lang, summary);
  const pointer = lang === 'ar'
    ? `👆 هادا طرف من مخطط التقطيع ديالك. كليكي على «${PLAN_BUTTON.ar}» باش تشوفو كامل (صالح ${ltr(lang, '24')} ساعة).`
    : `👆 Voici le début de votre plan de coupe. Touchez « ${PLAN_BUTTON.fr} » pour le voir en entier (valable 24 h).`;
  return { image: `${link}/plan.jpg`, body: [head, ...panelNote, ...warning, pointer].join('\n'), button: PLAN_BUTTON[lang], url: link };
}

/**
 * The answer for a list over BOT_PLAN_MAX_PIECES: what was read and the link,
 * which opens the atelier on the pieces; the plan is made there.
 */
export function bigListText(lang: Lang, summary: PhotoSummary, link: string): string {
  if (lang === 'ar') {
    return [
      `✅ القطع اللي تقرات: ${ltr(lang, String(summary.pieceCount))} (${ltr(lang, String(summary.lineCount))} سطر)`,
      'هادي لائحة كبيرة: المخطط ديالها كيتوجد فالورشة.',
      `👉 حلها هنا (الرابط صالح ${ltr(lang, '24')} ساعة): ${link}`,
    ].join('\n');
  }
  return [
    `✅ ${summary.pieceCount} pièces lues (${summary.lineCount} lignes)`,
    "C'est une grande liste : son plan de coupe se fait dans l'atelier.",
    `👉 Ouvrez-la ici (lien valable 24 h) : ${link}`,
  ].join('\n');
}

/** The draft's pieces as the atelier holds them; the preview is laid out on these same ids. */
export function atelierPieces(draft: PhotoDraft): Piece[] {
  return draft.pieces.map((p, i) => {
    const id = String(i + 1);
    // The color the atelier gives this line (its row swatch, normalizePiecesWithColors):
    // without it the plan colored every copy of one line differently (owner, 21/11/2026).
    const color = getResolvedPieceColor({ id, name: p.name, height: p.height, width: p.width, quantity: p.quantity, index: i });
    return { ...p, id, material: 'mdf', rotatable: true, color };
  });
}

function atelierSheet(draft: PhotoDraft): Sheet {
  return { ...DEFAULT_STOCK_SHEET, height: draft.sheet.height, width: draft.sheet.width };
}

/**
 * The plan a visitor of the link sees before signing up (plan
 * 2026-11-19-whatsapp-plan-apercu): computed on the server from the pieces the
 * bot stored, never from what a browser sends, so it cannot be used to plan
 * another list for free. Signing in runs the normal, paid optimization.
 */
export function photoPreviewPlan(draft: PhotoDraft): OptimizationResult {
  return optimizeCutting2D(atelierPieces(draft), [atelierSheet(draft)]);
}

/** The free preview for the link page, or null for a list over BOT_PLAN_MAX_PIECES (the atelier plans it). */
export function previewPlanFor(draft: PhotoDraft): OptimizationResult | null {
  return pieceTotal(draft.pieces) <= BOT_PLAN_MAX_PIECES ? photoPreviewPlan(draft) : null;
}

/** A job opened from a WhatsApp link and still showing the free preview. */
export function isPhotoPreview(project: unknown): boolean {
  return typeof project === 'object' && project !== null && (project as { photoPreview?: unknown }).photoPreview === true;
}

/**
 * The atelier's own draft (src/lib/atelier-draft.ts) for the pieces of a read
 * photo, on the panel its summary used, with the preview plan when given: the
 * atelier restores it on opening as it restores a job kept while visiting
 * another screen, and the marker tells it the plan is only a preview.
 */
export function photoDraftToAtelierDraft(
  draft: PhotoDraft,
  now: number,
  displayUnit: DisplayUnit = 'cm',
  result: OptimizationResult | null = null,
): AtelierDraft {
  return {
    v: 1,
    project: {
      pieces: atelierPieces(draft),
      sheets: [atelierSheet(draft)],
      projectName: 'Fiche WhatsApp',
      // Stated, so the atelier does not take the job for a legacy save (src/lib/units.ts).
      displayUnit,
      canonicalUnit: 'cm',
      photoPreview: true,
      ...(result ? { result } : {}),
    },
    plannedPieces: null,
    cutMode: '2d',
    projectId: null,
    localProjectId: null,
    restoredAt: null,
    keptAt: now,
  };
}
