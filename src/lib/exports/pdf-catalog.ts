import type { Locale } from '@/i18n';

/**
 * Dedicated label catalog for the `/api/export-pdf` report.
 *
 * This is deliberately separate from the app-wide UI catalog (src/i18n) even
 * though it follows the exact same "French sets the shape, en/ar are checked
 * against it" pattern (see src/i18n/index.ts's `catalogs`): the PDF route
 * runs server-side, renders a fixed, known set of labels (never an arbitrary
 * dotted key looked up at runtime), and several of its strings are
 * parameterized (a page number, a unit, a sample count) in ways that read
 * more clearly as small functions than as `{token}` templates threaded
 * through a generic interpolator. Keeping it here, next to pdf-schema.ts and
 * pdf-bidi.ts, keeps every PDF-only concern in one place.
 *
 * `en`/`ar` are typed against `PdfCatalog` (derived from `fr`), so an
 * added/renamed/removed key on either side is a compile error, not a silent
 * runtime `undefined` in a customer-facing PDF — the same guarantee
 * src/i18n/index.ts gives the rest of the app.
 *
 * "MAD" (the currency code) is intentionally never translated, matching the
 * app-wide convention (see e.g. src/i18n/messages/ar.ts's `currency: 'MAD'`
 * and `amount: '{value} MAD'`): Moroccan artisans read the ISO code the same
 * way in every locale.
 */

const fr = {
  brand: 'QatlIA Pro 2026',
  tagline: 'Plan de Débit Linéaire & Optimisation',
  pageIndicator: (page: number, total: number) => `Page ${page} / ${total}`,
  currencyLabel: 'Devise : MAD',
  totalCostLabel: 'COÛT TOTAL ESTIMÉ DU DÉBIT :',
  costUnavailable: 'Non calculé',
  cuttingList: {
    title: 'Liste de débit',
    columnMaterial: 'Matériau',
    columnDimension: (unit: string) => `Dimension (${unit})`,
    columnQuantity: 'Quantité',
    total: 'TOTAL',
  },
  panelsUsed: {
    title: 'Panneaux utilisés',
    columnMaterial: 'Matériau',
    columnReference: 'Référence',
    columnDimension: (unit: string) => `Dimension (${unit})`,
    columnQuantity: 'Quantité',
    columnArea: 'Surface',
    stockRaw: 'Stock Brut',
  },
  cutPlans: {
    title: 'Liste des plans de coupe (Passes Linéaires Traversantes)',
    columnMaterial: 'Matériau',
    columnReference: 'Référence',
    columnDimension: (unit: string) => `Dimension (${unit})`,
    columnQuantity: 'Quantité',
    columnPieces: 'Pièces',
    columnWasteRate: 'Taux de chutes',
    stockReference: 'Stock',
    total: 'TOTAL',
  },
  recap: {
    title: 'Récapitulatif Données & Chiffrage MAD',
    technicalHeader: 'Données techniques',
    financialHeader: 'Chiffrage Financier (MAD)',
    sheetsUsedLabel: 'Nombre de panneaux utilisés',
    cutPlansCountLabel: 'Nombre de plans de coupe',
    totalSheetAreaLabel: 'Surface totale des panneaux',
    totalPiecesAreaLabel: 'Surface totale des pièces',
    wasteRateLabel: 'Taux de chutes',
    nonReusableWasteRateLabel: 'Taux des chutes non réutilisables',
    linearCutLabel: 'Linéaire de découpe opérateur',
    materialYieldLabel: 'Rentabilité matière',
    materialCostLabel: 'Coût matière',
    edgeCostLabel: 'Coût chants',
    laborCostLabel: "Coût main d'œuvre",
    subtotalLabel: 'Sous-total du débit',
    costingLabel: 'Chiffrage',
    costingUnavailable: 'Non disponible',
  },
  schema: {
    uniqueSample: 'Exemplaire unique',
    multipleSamples: (count: number) => `À fabriquer en ${count} exemplaires`,
    header: (index: number, total: number, material: string, dims: string, samples: string) =>
      `${index}/${total} -- ${material} -- ${dims} -- ${samples}`,
  },
};

export type PdfCatalog = typeof fr;

const en: PdfCatalog = {
  brand: 'QatlIA Pro 2026',
  tagline: 'Linear Cutting Plan & Optimization',
  pageIndicator: (page, total) => `Page ${page} / ${total}`,
  currencyLabel: 'Currency: MAD',
  totalCostLabel: 'ESTIMATED TOTAL CUTTING COST:',
  costUnavailable: 'Not calculated',
  cuttingList: {
    title: 'Cutting list',
    columnMaterial: 'Material',
    columnDimension: (unit) => `Dimension (${unit})`,
    columnQuantity: 'Quantity',
    total: 'TOTAL',
  },
  panelsUsed: {
    title: 'Panels used',
    columnMaterial: 'Material',
    columnReference: 'Reference',
    columnDimension: (unit) => `Dimension (${unit})`,
    columnQuantity: 'Quantity',
    columnArea: 'Area',
    stockRaw: 'Raw stock',
  },
  cutPlans: {
    title: 'Cutting plans list (Edge-to-Edge Linear Passes)',
    columnMaterial: 'Material',
    columnReference: 'Reference',
    columnDimension: (unit) => `Dimension (${unit})`,
    columnQuantity: 'Quantity',
    columnPieces: 'Pieces',
    columnWasteRate: 'Waste rate',
    stockReference: 'Stock',
    total: 'TOTAL',
  },
  recap: {
    title: 'Data Summary & MAD Costing',
    technicalHeader: 'Technical data',
    financialHeader: 'Financial costing (MAD)',
    sheetsUsedLabel: 'Number of panels used',
    cutPlansCountLabel: 'Number of cutting plans',
    totalSheetAreaLabel: 'Total panel area',
    totalPiecesAreaLabel: 'Total pieces area',
    wasteRateLabel: 'Waste rate',
    nonReusableWasteRateLabel: 'Non-reusable waste rate',
    linearCutLabel: 'Operator linear cut length',
    materialYieldLabel: 'Material yield',
    materialCostLabel: 'Material cost',
    edgeCostLabel: 'Edge banding cost',
    laborCostLabel: 'Labor cost',
    subtotalLabel: 'Cutting subtotal',
    costingLabel: 'Costing',
    costingUnavailable: 'Not available',
  },
  schema: {
    uniqueSample: 'Single copy',
    multipleSamples: (count) => `To be produced in ${count} copies`,
    header: (index, total, material, dims, samples) => `${index}/${total} -- ${material} -- ${dims} -- ${samples}`,
  },
};

const ar: PdfCatalog = {
  brand: 'QatlIA Pro 2026',
  tagline: 'مخطط القطع الخطي والتحسين',
  pageIndicator: (page, total) => `صفحة ${page} / ${total}`,
  currencyLabel: 'العملة: MAD',
  totalCostLabel: 'التكلفة الإجمالية التقديرية للقطع:',
  costUnavailable: 'غير محسوب',
  cuttingList: {
    title: 'قائمة القطع',
    columnMaterial: 'المادة',
    columnDimension: (unit) => `الأبعاد (${unit})`,
    columnQuantity: 'الكمية',
    total: 'المجموع',
  },
  panelsUsed: {
    title: 'الألواح المستعملة',
    columnMaterial: 'المادة',
    columnReference: 'المرجع',
    columnDimension: (unit) => `الأبعاد (${unit})`,
    columnQuantity: 'الكمية',
    columnArea: 'المساحة',
    stockRaw: 'مخزون خام',
  },
  cutPlans: {
    title: 'قائمة مخططات القطع (تمريرات خطية من طرف إلى طرف)',
    columnMaterial: 'المادة',
    columnReference: 'المرجع',
    columnDimension: (unit) => `الأبعاد (${unit})`,
    columnQuantity: 'الكمية',
    columnPieces: 'القطع',
    columnWasteRate: 'نسبة الهدر',
    stockReference: 'مخزون',
    total: 'المجموع',
  },
  recap: {
    title: 'ملخص المعطيات والتكلفة بالدرهم',
    technicalHeader: 'المعطيات التقنية',
    financialHeader: 'التكلفة المالية (MAD)',
    sheetsUsedLabel: 'عدد الألواح المستعملة',
    cutPlansCountLabel: 'عدد مخططات القطع',
    totalSheetAreaLabel: 'المساحة الإجمالية للألواح',
    totalPiecesAreaLabel: 'المساحة الإجمالية للقطع',
    wasteRateLabel: 'نسبة الهدر',
    nonReusableWasteRateLabel: 'نسبة الهدر غير القابل لإعادة الاستعمال',
    linearCutLabel: 'الطول الخطي للقطع',
    materialYieldLabel: 'مردود المادة',
    materialCostLabel: 'تكلفة المادة',
    edgeCostLabel: 'تكلفة الحواف',
    laborCostLabel: 'تكلفة اليد العاملة',
    subtotalLabel: 'المجموع الفرعي للقطع',
    costingLabel: 'التكلفة',
    costingUnavailable: 'غير متوفر',
  },
  schema: {
    uniqueSample: 'نسخة واحدة',
    multipleSamples: (count) => `للتصنيع في ${count} نسخ`,
    header: (index, total, material, dims, samples) => `${index}/${total} -- ${material} -- ${dims} -- ${samples}`,
  },
};

export const pdfCatalogs: Record<Locale, PdfCatalog> = { fr, en, ar };

export function pdfCatalogFor(locale: Locale): PdfCatalog {
  return pdfCatalogs[locale] ?? pdfCatalogs.fr;
}
