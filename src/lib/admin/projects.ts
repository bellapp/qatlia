/**
 * A saved project as the back office shows it.
 *
 * `options_json` is written by the browser (see src/app/api/projects/route.ts
 * and src/lib/projects/persistence-payload.ts), so every field is read
 * defensively: a malformed project must never break a client's page.
 *
 * Pure module: safe to import from a client component or a plain Node test.
 */

export interface ProjectRow {
  id: string;
  name: string | null;
  material: string | null;
  sheet_width: number | string | null;
  sheet_height: number | string | null;
  created_at: string;
  options_json: unknown;
}

export interface ProjectSummary {
  id: string;
  name: string;
  material: string;
  sheetWidth: number;
  sheetHeight: number;
  createdAt: string;
  pieceCount: number;
  sheetsUsed: number | null;
  wastePercentage: number | null;
  /** A data:image/ URL of the scanned cut list, or null. */
  scanThumb: string | null;
  pdfGeneratedAt: string | null;
  /** Whether a quotation was saved — its content (the client's own customers and prices) is not shown. */
  hasQuotation: boolean;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

function finiteNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function pieceCount(pieces: unknown): number {
  if (!Array.isArray(pieces)) return 0;
  let total = 0;
  for (const piece of pieces) {
    const record = asRecord(piece);
    if (!record) continue;
    const quantity = finiteNumber(record.quantity);
    total += quantity !== null && quantity >= 1 ? Math.floor(quantity) : 1;
  }
  return total;
}

export function summarizeProject(row: ProjectRow): ProjectSummary {
  const options = asRecord(row.options_json) ?? {};
  const result = asRecord(options.result);
  const scanThumb = typeof options.scanThumb === 'string' && options.scanThumb.startsWith('data:image/') ? options.scanThumb : null;
  const pdfGeneratedAt = typeof options.pdfGeneratedAt === 'string' ? options.pdfGeneratedAt : null;

  return {
    id: row.id,
    name: typeof row.name === 'string' && row.name.trim() !== '' ? row.name : 'Sans nom',
    material: typeof row.material === 'string' && row.material.trim() !== '' ? row.material : '—',
    sheetWidth: finiteNumber(row.sheet_width) ?? 0,
    sheetHeight: finiteNumber(row.sheet_height) ?? 0,
    createdAt: row.created_at,
    pieceCount: pieceCount(options.pieces),
    sheetsUsed: result ? finiteNumber(result.sheetsUsed) : null,
    wastePercentage: result ? finiteNumber(result.wastePercentage) : null,
    scanThumb,
    pdfGeneratedAt,
    hasQuotation: asRecord(options.quotation) !== null,
  };
}
