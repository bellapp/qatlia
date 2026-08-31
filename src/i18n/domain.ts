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
import type { PackId } from '@/lib/billing/catalog';

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

/** Short form of the same labels, for the badges of the history cards. */
export const MATERIAL_BADGE_KEYS: Record<MaterialType, TranslationKey> = {
  mdf: 'materials.badge.mdf',
  melamine: 'materials.badge.melamine',
  chene: 'materials.badge.chene',
  contreplaques: 'materials.badge.contreplaques',
  'stratifié': 'materials.badge.stratifie',
  medium: 'materials.badge.medium',
  aluminium: 'materials.badge.aluminium',
  verre: 'materials.badge.verre',
};

/**
 * A saved project carries whatever material value was current when it was
 * saved, so a legacy or unknown value degrades to MDF rather than rendering the
 * raw payload string on the card.
 */
export function materialBadgeKey(material: string | null | undefined): TranslationKey {
  return MATERIAL_BADGE_KEYS[material as MaterialType] ?? MATERIAL_BADGE_KEYS.mdf;
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

/**
 * Customer-facing copy for each machine-readable code returned by
 * `/api/credits/checkout`. Same contract as the vision route: the payload keeps
 * its stable codes (and its French message for non-browser callers), and the
 * buyer reads their own language instead of Stripe's or Supabase's wording.
 */
export const CHECKOUT_ERROR_KEYS: Record<string, TranslationKey> = {
  AUTH_REQUIRED: 'creditsPage.errors.authRequired',
  INVALID_PACK_SELECTION: 'creditsPage.errors.invalidSelection',
  PAYMENT_UNAVAILABLE: 'creditsPage.errors.unavailable',
  PAYMENT_CONFIGURATION_ERROR: 'creditsPage.errors.unavailable',
  CHECKOUT_FAILED: 'creditsPage.errors.generic',
};

export function checkoutErrorKey(code: unknown): TranslationKey {
  return (typeof code === 'string' && CHECKOUT_ERROR_KEYS[code]) || 'creditsPage.errors.generic';
}

/**
 * Wording for one credit pack. The figures are never here: the MAD price and
 * the monthly allowance stay in `src/lib/billing/catalog.ts` and are
 * interpolated as `{price}` / `{count}`, so a translation cannot change what is
 * sold or what is charged.
 */
export interface CreditPackLabelKeys {
  name: TranslationKey;
  description: TranslationKey;
  badge: TranslationKey;
  /** Recurring packs only; `null` for the one-off packs, which state no renewal. */
  renewalNote: TranslationKey | null;
}

export const CREDIT_PACK_LABEL_KEYS: Record<PackId, CreditPackLabelKeys> = {
  starter: {
    name: 'billing.packs.starter.name',
    description: 'billing.packs.starter.description',
    badge: 'billing.packs.starter.badge',
    renewalNote: null,
  },
  standard: {
    name: 'billing.packs.standard.name',
    description: 'billing.packs.standard.description',
    badge: 'billing.packs.standard.badge',
    renewalNote: null,
  },
  pro: {
    name: 'billing.packs.pro.name',
    description: 'billing.packs.pro.description',
    badge: 'billing.packs.pro.badge',
    renewalNote: null,
  },
  atelier_max: {
    name: 'billing.packs.atelierMax.name',
    description: 'billing.packs.atelierMax.description',
    badge: 'billing.packs.atelierMax.badge',
    renewalNote: 'billing.packs.atelierMax.renewal',
  },
};

/**
 * A pack id that is no longer sold (or is not a pack id at all) degrades to the
 * entry-level pack's copy rather than rendering a raw id. Resolving a retired id
 * to the pack it became is the billing catalog's job (`normalizePackId`).
 */
export function creditPackLabelKeys(id: string | null | undefined): CreditPackLabelKeys {
  return CREDIT_PACK_LABEL_KEYS[id as PackId] ?? CREDIT_PACK_LABEL_KEYS.starter;
}
