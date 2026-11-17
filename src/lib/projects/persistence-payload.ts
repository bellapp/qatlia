/**
 * Pure builder for the exact payload atelier.persistProject saves — both to
 * local history (`options_json`) and to `/api/projects`. It never
 * recomputes cost or pricing: `result.costBreakdown` and
 * `options.stockPricingOverrides`/`laborPricing` are forwarded verbatim
 * (same references, not deep clones), so a saved project always matches the
 * plan screen it was generated from, byte-for-byte.
 */
import type { Sheet, Piece, OptimizationResult, OptimizationOptions } from '@/lib/cutting/binpacking';
import {
  type DisplayUnit,
  type ProjectUnitPersistenceMetadata,
  buildProjectUnitPersistenceMetadata,
} from '@/lib/units';
import type { ScanSheet } from './scan-sheets';

export interface PersistedProjectPayloadInput {
  name: string;
  /** The artisan's own project name when set (undefined = auto-name). */
  projectName?: string;
  /** The project's cut-list sheets, in order: thumbnail and kept-image path of each. */
  scans?: ScanSheet[];
  /** The scan group the sheets were read in (see src/lib/billing/scan-group.ts). */
  scanGroup?: string | null;
  /** ISO timestamp of the last PDF export for this project (optional). */
  pdfGeneratedAt?: string | null;
  sheets: Sheet[];
  sheet: Sheet;
  pieces: Piece[];
  options: OptimizationOptions;
  result: OptimizationResult;
  /**
   * The artisan's display unit at save time, and whether this record still
   * traces back to a legacy (pre-metadata) save. Geometry above always
   * stays canonical cm — see `buildProjectUnitPersistenceMetadata`.
   */
  displayUnit: DisplayUnit;
  migratedFromLegacyUnit: boolean;
}

export interface PersistedProjectPayload extends ProjectUnitPersistenceMetadata {
  name: string;
  /** Present only when the artisan named the project themselves. */
  projectName?: string;
  scans?: ScanSheet[];
  scanGroup?: string;
  pdfGeneratedAt?: string | null;
  sheets: Sheet[];
  sheet: Sheet;
  pieces: Piece[];
  options: OptimizationOptions;
  result: OptimizationResult;
}

/**
 * Builds the full persisted-project payload. Pure and side-effect free so
 * it can be unit-tested without a UI, sessionStorage, or network call.
 */
export function buildPersistedProjectPayload(
  input: PersistedProjectPayloadInput
): PersistedProjectPayload {
  return {
    name: input.name,
    ...(input.projectName?.trim() ? { projectName: input.projectName.trim() } : {}),
    ...(input.scans && input.scans.length > 0 ? { scans: input.scans } : {}),
    ...(input.scanGroup ? { scanGroup: input.scanGroup } : {}),
    ...(input.pdfGeneratedAt ? { pdfGeneratedAt: input.pdfGeneratedAt } : {}),
    sheets: input.sheets,
    sheet: input.sheet,
    pieces: input.pieces,
    options: input.options,
    result: input.result,
    ...buildProjectUnitPersistenceMetadata(input.displayUnit, input.migratedFromLegacyUnit),
  };
}
