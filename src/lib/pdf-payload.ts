import type { Piece, Sheet, OptimizationResult, MaterialType } from '@/lib/cutting/binpacking';
import { DEFAULT_DISPLAY_UNIT, type DisplayUnit } from '@/lib/units';

export interface PdfPayloadSheet {
  width: number;
  height: number;
  material: MaterialType | string;
}

export interface PdfExportPayload {
  projectName: string;
  sheet: PdfPayloadSheet;
  pieces: Piece[];
  result: OptimizationResult;
  /**
   * The unit the artisan had selected for display at export time. All
   * geometry above (sheet/pieces/result) stays canonical cm; this field only
   * tells /api/export-pdf which unit to use when labeling dimensions.
   */
  displayUnit: DisplayUnit;
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
  displayUnit: DisplayUnit = DEFAULT_DISPLAY_UNIT
): PdfExportPayload {
  return {
    projectName,
    sheet: {
      width: activeSheet.width,
      height: activeSheet.height,
      material: activeSheet.material || 'mdf',
    },
    pieces,
    result,
    displayUnit,
  };
}
