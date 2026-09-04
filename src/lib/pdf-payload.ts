import type { Piece, Sheet, OptimizationResult, MaterialType } from '@/lib/cutting/binpacking';
import { DEFAULT_DISPLAY_UNIT, type DisplayUnit } from '@/lib/units';
import { DEFAULT_LOCALE, type Locale } from '@/i18n';

export interface PdfPayloadSheet {
  width: number;
  height: number;
  /** Grain (ramage) fields passed through so the PDF can draw the veining as an option. */
  hasGrain?: boolean;
  grainOrientation?: 'vertical' | 'horizontal';
}

export interface PdfExportPayload {
  projectName: string;
  /**
   * The material actually selected for the active sheet, falling back to
   * 'mdf' exactly like the atelier's own selector does (see activeSheet.material
   * in src/app/atelier/page.tsx). This must be top-level, matching
   * ExportSchema's top-level `material` field (see pdf-schema.ts) and what
   * route.ts destructures and renders (`material.toUpperCase()`) — nesting it
   * under `sheet` instead, as an earlier version of this payload did, meant
   * the server-side schema (whose `sheet` object has no `material` field at
   * all) silently ignored it and every export fell back to the schema's own
   * default ('MDF'), regardless of what the artisan had actually selected.
   */
  material: MaterialType | string;
  sheet: PdfPayloadSheet;
  pieces: Piece[];
  result: OptimizationResult;
  /**
   * The unit the artisan had selected for display at export time. All
   * geometry above (sheet/pieces/result) stays canonical cm; this field only
   * tells /api/export-pdf which unit to use when labeling dimensions.
   */
  displayUnit: DisplayUnit;
  /**
   * The atelier's current UI locale (see useLocale() in
   * src/components/LocaleProvider.tsx). Independent of `displayUnit`: it only
   * tells /api/export-pdf which catalog to render labels from, never touches
   * geometry, cost or any other computed figure.
   */
  locale: Locale;
}

/**
 * Builds the exact JSON body sent to /api/export-pdf.
 * Pure function so it can be unit-tested without touching auth/network.
 */
export function buildPdfPayload(
  projectName: string,
  activeSheet: Sheet,
  pieces: Piece[],
  result: OptimizationResult,
  displayUnit: DisplayUnit = DEFAULT_DISPLAY_UNIT,
  locale: Locale = DEFAULT_LOCALE
): PdfExportPayload {
  return {
    projectName,
    material: activeSheet.material || 'mdf',
    sheet: {
      width: activeSheet.width,
      height: activeSheet.height,
      hasGrain: !!activeSheet.hasGrain,
      grainOrientation: activeSheet.grainOrientation === 'horizontal' ? 'horizontal' : 'vertical',
    },
    pieces,
    result,
    displayUnit,
    locale,
  };
}
