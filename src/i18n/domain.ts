/**
 * Bridges the app's fixed domain enums to the catalog.
 *
 * The values on the left of every map are the stable ones — they are what the
 * optimizer computes with, what `/api/optimize` validates, what a saved project
 * carries, and what `/api/vision` returns as a machine-readable error code.
 * Only the labels on the right are ever translated, so switching locale can
 * never change a payload.
 *
 * Every import here is type-only, so this module has no runtime dependency on
 * the optimizer or the costing engine.
 */
import type { TranslationKey } from './index';
import type { MaterialType, OptimizationPriority } from '@/lib/cutting/binpacking';
import type { LaborPricing, StockPricing } from '@/lib/costing';

/** Display label for every material in `MATERIAL_LIBRARY`. */
export const MATERIAL_LABEL_KEYS: Record<MaterialType, TranslationKey> = {
  mdf: 'materials.mdf',
  melamine: 'materials.melamine',
  chene: 'materials.chene',
  contreplaques: 'materials.contreplaques',
  'stratifié': 'materials.stratifie',
  medium: 'materials.medium',
  aluminium: 'materials.aluminium',
  verre: 'materials.verre',
};

/** MDF is the library's first entry, so an unknown value degrades to it rather than rendering raw. */
export function materialLabelKey(material: string | null | undefined): TranslationKey {
  return MATERIAL_LABEL_KEYS[material as MaterialType] ?? MATERIAL_LABEL_KEYS.mdf;
}

/** Display label for every value of `OPTIMIZATION_PRIORITY_VALUES`. */
export const OPTIMIZATION_PRIORITY_LABEL_KEYS: Record<OptimizationPriority, TranslationKey> = {
  linear_guillotine: 'options.priority.linearGuillotine',
  min_waste: 'options.priority.minWaste',
  min_sheets: 'options.priority.minSheets',
  balanced: 'options.priority.balanced',
};

/** The ids carried by `EDGEBANDING_PRESETS`; the pricing lives with the presets, not here. */
export type EdgeBandingPresetId = 'none' | 'white' | 'beech' | 'oak' | 'grey' | 'black' | 'walnut';

export const EDGE_BANDING_LABEL_KEYS: Record<EdgeBandingPresetId, TranslationKey> = {
  none: 'pieces.edgeBanding.none',
  white: 'pieces.edgeBanding.white',
  beech: 'pieces.edgeBanding.beech',
  oak: 'pieces.edgeBanding.oak',
  grey: 'pieces.edgeBanding.grey',
  black: 'pieces.edgeBanding.black',
  walnut: 'pieces.edgeBanding.walnut',
};

export function edgeBandingLabelKey(presetId: string | null | undefined): TranslationKey {
  return EDGE_BANDING_LABEL_KEYS[presetId as EdgeBandingPresetId] ?? EDGE_BANDING_LABEL_KEYS.none;
}

export const LABOR_PRICING_MODE_KEYS: Record<LaborPricing['mode'], TranslationKey> = {
  fixed: 'options.pricing.laborFixed',
  per_meter: 'options.pricing.laborPerMeter',
};

export const STOCK_PRICING_MODE_KEYS: Record<StockPricing['mode'], TranslationKey> = {
  per_m2: 'options.pricing.stockPerM2',
  per_sheet: 'options.pricing.stockPerSheet',
};

export type EdgeSide = 'left' | 'right' | 'top' | 'bottom';

/** Full name (tooltips) and one/two-character badge (the edge toggles) per side. */
export const EDGE_SIDE_KEYS: Record<EdgeSide, { label: TranslationKey; short: TranslationKey }> = {
  left: { label: 'pieces.edge.left', short: 'pieces.edge.leftShort' },
  right: { label: 'pieces.edge.right', short: 'pieces.edge.rightShort' },
  top: { label: 'pieces.edge.top', short: 'pieces.edge.topShort' },
  bottom: { label: 'pieces.edge.bottom', short: 'pieces.edge.bottomShort' },
};

/**
 * Customer-facing copy for each machine-readable code returned by
 * `/api/vision`. The route keeps answering in French for non-browser callers;
 * the workshop shows the artisan's own language instead, keyed off the code so
 * the two can never drift apart silently.
 */
export const VISION_ERROR_KEYS: Record<string, TranslationKey> = {
  AUTH_REQUIRED: 'atelier.visionError.authRequired',
  INVALID_INPUT: 'atelier.visionError.invalidInput',
  RATE_LIMITED: 'atelier.visionError.rateLimited',
  VISION_UNAVAILABLE: 'atelier.visionError.visionUnavailable',
  CREDIT_LEDGER_UNAVAILABLE: 'atelier.visionError.creditLedgerUnavailable',
  INSUFFICIENT_CREDITS: 'atelier.visionError.insufficientCredits',
  AI_RATE_LIMIT: 'atelier.visionError.aiRateLimit',
  AI_SERVICE_ERROR: 'atelier.visionError.aiServiceError',
  AI_PARSE_ERROR: 'atelier.visionError.aiParseError',
  VISION_PROCESSING_FAILED: 'atelier.visionError.processingFailed',
};

/** A code this build does not know about degrades to the generic message, never to the raw code. */
export function visionErrorKey(code: unknown): TranslationKey {
  return (typeof code === 'string' && VISION_ERROR_KEYS[code]) || 'atelier.visionError.generic';
}
