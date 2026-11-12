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
import { MAX_GEOMETRY } from '@/lib/cutting/optimize-schema';
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
}

export const PRESET_COLUMNS = 'id, user_id, name, height, width, material, color, has_grain, grain_orientation, created_at';

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
});

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
  };
}

/** Writes need the service role; without it the account store is "not ready". */
export function createPresetsDb(): SupabaseClient | null {
  const config = getSupabaseAdminConfig();
  return config ? createAdminClient(config.url, config.serviceRoleKey) : null;
}

/** True when the table does not exist yet (migration 011 not applied). */
export function isMissingTableError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === 'PGRST205' || error.code === '42P01') return true;
  return /schema cache|could not find the table|relation .* does not exist/i.test(error.message || '');
}
