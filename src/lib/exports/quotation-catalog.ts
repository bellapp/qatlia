/**
 * Dedicated label catalog for the `/api/export-quotation` PDF document.
 *
 * Follows the same "French sets the shape, the other locale is checked
 * against it" pattern as `src/lib/exports/pdf-catalog.ts`, but scoped to
 * exactly the two locales the quotation document is ever rendered in — `fr`
 * and `ar` (see `src/lib/quotation.ts`'s `QUOTATION_LOCALES`). The atelier's
 * own three-locale UI (`src/i18n`) is independent of this: an artisan can
 * build the quotation in an English UI and still choose a French or Arabic
 * *document*.
 *
 * `ar` is typed against `QuotationCatalog` (derived from `fr`), so an
 * added/renamed/removed key on either side is a compile error, not a silent
 * runtime `undefined` in a customer-facing document.
 *
 * "MAD" is intentionally never translated (see pdf-catalog.ts's own note) —
 * every money label here reads "... (MAD)" rather than a translated
 * currency name.
 */
import type { QuotationLocale } from '@/lib/quotation';
import { translate } from '@/i18n';
import { MATERIAL_LABEL_KEYS } from '@/i18n/domain';

const fr = {
  documentTitle: 'DEVIS',
  quoteNumberLabel: 'Devis N°',
  issueDateLabel: 'Date',
  expiryDateLabel: "Validité jusqu'au",
  /** Optional, artisan-free-typed reference (e.g. a client's own order/PO number) — rendered only when actually provided, never fabricated. */
  projectReferenceLabel: 'Réf. projet',
  companySection: 'Émetteur',
  clientSection: 'Client',
  iceLabel: 'ICE',
  taxIdLabel: 'IF',
  itemsTitle: 'Détail de la prestation',
  itemLabel: 'Poste',
  amountColumn: 'Montant (MAD)',
  materialCostLabel: 'Matière première',
  edgeCostLabel: 'Chants',
  laborCostLabel: "Main d'œuvre",
  deliveryCostLabel: 'Livraison',
  // Item 5: this line actually prints `totals.preTaxBase` (subtotal +
  // delivery — see computeQuotationTotals in src/lib/costing.ts), never
  // `costBreakdown.subtotal` alone, so the label must say so rather than
  // implicitly claiming it excludes delivery.
  subtotalLabel: 'Sous-total (livraison incluse) (MAD)',
  discountLabel: 'Remise (MAD)',
  taxLabel: (ratePercent: number) => `TVA ${ratePercent}% (MAD)`,
  taxNoneLabel: 'TVA non applicable',
  totalLabel: 'TOTAL À PAYER (MAD)',
  amountInWordsLabel: 'Arrêté le présent devis à la somme de :',
  notesLabel: 'Notes',
  footerNote: "Devis établi par QatlIA — n'engage l'émetteur que jusqu'à sa date de validité.",
  // Panels/pieces detail table (Task 8 remediation — item 1) — rendered only
  // when the request actually carries panels/pieces (see route.ts); never
  // fabricated when the optimizer result carried none.
  panelsTitle: 'Panneaux utilisés',
  panelsColumnRef: 'Réf.',
  panelsColumnMaterial: 'Matériau',
  panelsColumnDimension: 'Dimensions (cm)',
  panelsColumnQuantity: 'Qté',
  piecesTitle: 'Détail des pièces',
  piecesColumnNumber: 'N°',
  piecesColumnName: 'Désignation',
  piecesColumnDimension: 'Dimensions (cm)',
  piecesColumnQuantity: 'Qté',
  piecesColumnEdge: 'Chant (m)',
  // Pagination (Task 8 remediation — item 2) — stamped on every page.
  pageIndicator: (page: number, total: number) => `Page ${page} / ${total}`,
  // Task 8 remediation (re-review, item 4) — a piece the optimizer placed
  // with no artisan-given name gets this localized, numbered fallback
  // instead of a hardcoded French "Pièce N" leaking into an Arabic document.
  // `n` is the piece's own stable `pieceNumber` (see quotation-items.ts),
  // never a separately-tracked "unnamed-only" counter.
  unnamedPieceLabel: (n: number) => `Pièce ${n}`,
};

export type QuotationCatalog = typeof fr;

const ar: QuotationCatalog = {
  documentTitle: 'عرض سعر',
  quoteNumberLabel: 'رقم العرض',
  issueDateLabel: 'التاريخ',
  expiryDateLabel: 'صالح إلى غاية',
  projectReferenceLabel: 'مرجع المشروع',
  companySection: 'المُصدر',
  clientSection: 'الزبون',
  iceLabel: 'ICE',
  taxIdLabel: 'IF',
  itemsTitle: 'تفاصيل الخدمة',
  itemLabel: 'البند',
  amountColumn: 'المبلغ (MAD)',
  materialCostLabel: 'المادة الخام',
  edgeCostLabel: 'الحواف',
  laborCostLabel: 'اليد العاملة',
  deliveryCostLabel: 'التوصيل',
  subtotalLabel: 'المجموع الفرعي (شامل التوصيل) (MAD)',
  discountLabel: 'التخفيض (MAD)',
  taxLabel: (ratePercent) => `الضريبة على القيمة المضافة ${ratePercent}% (MAD)`,
  taxNoneLabel: 'غير خاضع للضريبة',
  totalLabel: 'المجموع الإجمالي الواجب أداؤه (MAD)',
  amountInWordsLabel: 'أوقفنا هذا العرض عند مبلغ:',
  notesLabel: 'ملاحظات',
  footerNote: 'عرض سعر صادر عن QatlIA — لا يلزم المُصدر إلا إلى غاية تاريخ صلاحيته.',
  panelsTitle: 'الألواح المستعملة',
  panelsColumnRef: 'المرجع',
  panelsColumnMaterial: 'المادة',
  panelsColumnDimension: 'الأبعاد (سم)',
  panelsColumnQuantity: 'الكمية',
  piecesTitle: 'تفاصيل القطع',
  piecesColumnNumber: 'رقم',
  piecesColumnName: 'التسمية',
  piecesColumnDimension: 'الأبعاد (سم)',
  piecesColumnQuantity: 'الكمية',
  piecesColumnEdge: 'الحافة (م)',
  pageIndicator: (page, total) => `صفحة ${page} / ${total}`,
  unnamedPieceLabel: (n) => `قطعة ${n}`,
};

export const quotationCatalogs: Record<QuotationLocale, QuotationCatalog> = { fr, ar };

export function quotationCatalogFor(locale: string): QuotationCatalog {
  return locale === 'ar' ? quotationCatalogs.ar : quotationCatalogs.fr;
}

// ─── Known internal material keys — localized; anything else (an artisan's
// own free-typed material name) renders verbatim (Task 8 remediation —
// re-review, item 6) ────────────────────────────────────────────────────
//
// `MATERIAL_LABEL_KEYS` (src/i18n/domain.ts) is the app-wide catalog of the
// optimizer's own closed `MaterialType` set (see
// src/lib/cutting/binpacking.ts's `MATERIAL_TYPE_VALUES`) — reused here
// rather than duplicated, so a material added there never silently drifts
// out of sync with this document. Only a value that is *exactly* one of
// those stable keys is translated; `materialLabelKey`'s own "falls back to
// MDF" behaviour is deliberately never used here; instead an unrecognized
// string (an artisan typing e.g. "Chêne huilé main") is left completely
// untouched — this document must never relabel an artisan's own words as a
// material they didn't actually type.
const KNOWN_MATERIAL_KEYS = new Set<string>(Object.keys(MATERIAL_LABEL_KEYS));

export function localizeQuotationMaterial(material: string, locale: QuotationLocale): string {
  if (!KNOWN_MATERIAL_KEYS.has(material)) return material;
  return translate(locale, MATERIAL_LABEL_KEYS[material as keyof typeof MATERIAL_LABEL_KEYS]);
}
