import type { Piece, Sheet, OptimizationResult, MaterialType } from '@/lib/cutting/binpacking';

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
}

/**
 * Builds the exact JSON body sent to /api/export-pdf.
 * Pure function so it can be unit-tested without touching auth/network.
 */
export function buildPdfPayload(
  projectName: string,
  activeSheet: Sheet,
  pieces: Piece[],
  result: OptimizationResult
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
  };
}
