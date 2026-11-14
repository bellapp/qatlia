/**
 * Server side of the account panel presets: the table row shape, its mapping
 * to what the atelier reads, and the validation of what a client may store.
 *
 * Shared by `/api/panel-presets` and `/api/panel-presets/[id]`, which may only
 * export route handlers themselves.
 */

import { z } from 'zod';
import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminConfig } from '@/lib/billing/config';
import { MATERIAL_TYPE_VALUES } from '@/lib/cutting/binpacking';
import { MAX_GEOMETRY, MAX_UNIT_PRICE } from '@/lib/cutting/optimize-schema';
import { PRESET_COLOR_MAX_CHARS, type GrainOrientation } from '@/lib/panel-preset-rules';

/** Enough for any workshop's stock, small enough to keep the dropdown usable. */
export const MAX_PRESETS_PER_USER = 100;
/** One request carries at most this many presets (the device list's own cap). */
export const MAX_PRESETS_PER_REQUEST = 40;

export interface PanelPresetRow {
  id: string;
  user_id: string;
  name: string;
  height: number | string;
  width: number | string;
  material: string;
  color: string | null;
  has_grain: boolean;
  grain_orientation: GrainOrientation | null;
  /** MAD per panel (migration 015); absent when that migration is not applied yet. */
  price_per_sheet?: number | string | null;
  created_at?: string;
}

/** What the atelier receives: the client `PanelPreset` shape. */
export interface AccountPanelPreset {
  id: string;
  name: string;
  height: number;
  width: number;
  material: string;
  color?: string;
  hasGrain?: boolean;
  grainOrientation?: GrainOrientation;
  pricePerSheet?: number;
}

/** The columns before migration 015, read while it is not applied yet. */
export const LEGACY_PRESET_COLUMNS = 'id, user_id, name, height, width, material, color, has_grain, grain_orientation, created_at';
export const PRESET_COLUMNS = `${LEGACY_PRESET_COLUMNS}, price_per_sheet`;

export function toAccountPreset(row: PanelPresetRow): AccountPanelPreset {
  return {
    id: row.id,
    name: row.name,
    // Coerced: a numeric column can come back from PostgREST as a string.
    height: Number(row.height),
    width: Number(row.width),
    material: row.material,
    ...(row.color ? { color: row.color } : {}),
    ...(row.has_grain ? { hasGrain: true, grainOrientation: row.grain_orientation === 'horizontal' ? 'horizontal' : 'vertical' } : {}),
    // NUMERIC comes back from PostgREST as a string.
    ...(row.price_per_sheet !== null && row.price_per_sheet !== undefined && Number.isFinite(Number(row.price_per_sheet))
      ? { pricePerSheet: Number(row.price_per_sheet) }
      : {}),
  };
}

// Same bounds and materials as the optimizer's SheetSchema, so a preset can
// never describe a panel that optimization would then reject.
export const PresetInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  height: z.number().finite().positive().max(MAX_GEOMETRY),
  width: z.number().finite().positive().max(MAX_GEOMETRY),
  material: z.enum(MATERIAL_TYPE_VALUES).optional(),
  color: z.string().max(PRESET_COLOR_MAX_CHARS).nullable().optional(),
  hasGrain: z.boolean().nullable().optional(),
  grainOrientation: z.enum(['vertical', 'horizontal']).nullable().optional(),
  /** MAD per panel; null or absent: the catalog price per m² applies. */
  pricePerSheet: z.number().finite().min(0).max(MAX_UNIT_PRICE).nullable().optional(),
});

/** A panel price as stored: whole cents, like the NUMERIC(12,2) column. */
export function toStoredPrice(value: number): number {
  return Math.round(value * 100) / 100;
}

export type PresetInput = z.infer<typeof PresetInputSchema>;

/** The row to insert: blank colour stored as NULL, direction only when grained. */
export function toPresetRow(userId: string, input: PresetInput): Omit<PanelPresetRow, 'id' | 'created_at'> {
  const color = input.color?.trim().replace(/\s+/g, ' ') || null;
  const hasGrain = input.hasGrain === true;
  return {
    user_id: userId,
    name: input.name,
    height: input.height,
    width: input.width,
    material: input.material || 'mdf',
    color,
    has_grain: hasGrain,
    grain_orientation: hasGrain ? (input.grainOrientation === 'horizontal' ? 'horizontal' : 'vertical') : null,
    // Only sent when set, so a save without a price still works before migration 015.
    ...(typeof input.pricePerSheet === 'number' ? { price_per_sheet: toStoredPrice(input.pricePerSheet) } : {}),
  };
}

/** Writes need the service role; without it the account store is "not ready". */
export function createPresetsDb(): SupabaseClient | null {
  const config = getSupabaseAdminConfig();
  return config ? createAdminClient(config.url, config.serviceRoleKey) : null;
}

/** True when a column does not exist yet (migration 015 not applied). */
export function isMissingColumnError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === '42703' || error.code === 'PGRST204') return true;
  return /column .* does not exist|could not find the .* column/i.test(error.message || '');
}

/**
 * The artisan's presets, oldest first. Before migration 015 the price column
 * does not exist: the presets are then read without it rather than lost.
 */
export async function selectUserPresets(db: SupabaseClient, userId: string) {
  const query = (columns: string) =>
    db.from('panel_presets').select(columns).eq('user_id', userId).order('created_at', { ascending: true });
  const first = await query(PRESET_COLUMNS);
  if (!first.error || !isMissingColumnError(first.error)) return first;
  return query(LEGACY_PRESET_COLUMNS);
}

/** True when the table does not exist yet (migration 011 not applied). */
export function isMissingTableError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === 'PGRST205' || error.code === '42P01') return true;
  return /schema cache|could not find the table|relation .* does not exist/i.test(error.message || '');
}
