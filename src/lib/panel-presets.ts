'use client';

/**
 * Panel presets: predefined stock panels plus artisan-saved ones.
 *
 * A signed-in artisan's presets live in their account (`/api/panel-presets`,
 * table `panel_presets`), so they follow them to any device. An anonymous
 * visitor's presets stay in localStorage, and that device list is also the
 * fallback while the account store is unreachable or not yet set up.
 *
 * What counts as a duplicate is decided in `./panel-preset-rules`, shared
 * with the API route.
 */

import { findDuplicatePreset, type GrainOrientation, type PanelPresetAttributes } from './panel-preset-rules';

export { findDuplicatePreset };

export interface PanelPreset extends PanelPresetAttributes {
  id: string;
  name: string;
  material?: string;
  color?: string;
  hasGrain?: boolean;
  grainOrientation?: GrainOrientation;
  /** What the artisan pays for one such panel, MAD. Absent: catalog price per m². */
  pricePerSheet?: number;
  builtIn?: boolean;
}

export type NewPanelPreset = Omit<PanelPreset, 'id' | 'builtIn'>;

const STORAGE_KEY = 'qatlia-panel-presets';
/** Set once a user's device presets have been copied into their account. */
const IMPORTED_KEY_PREFIX = 'qatlia-panel-presets-imported:';

/** Common Moroccan workshop stock sizes (cm) — editable, not authoritative. */
export const BUILT_IN_PRESETS: PanelPreset[] = [
  { id: 'bi-244x122', name: 'Grand panneau 244 × 122', height: 244, width: 122, material: 'mdf', builtIn: true },
  { id: 'bi-210x100', name: 'Panneau 210 × 100', height: 210, width: 100, material: 'mdf', builtIn: true },
  { id: 'bi-200x100', name: 'Panneau 200 × 100', height: 200, width: 100, material: 'mdf', builtIn: true },
  { id: 'bi-183x122', name: 'Contreplaqué 183 × 122', height: 183, width: 122, material: 'contreplaques', builtIn: true },
  { id: 'bi-122x61', name: 'Demi-panneau 122 × 61', height: 122, width: 61, material: 'mdf', builtIn: true },
];

/** The attributes worth storing, without blanks: an empty colour is no colour,
 *  and a direction only exists on a grained panel. */
function cleanPreset(preset: NewPanelPreset): NewPanelPreset {
  const color = typeof preset.color === 'string' ? preset.color.trim() : '';
  return {
    name: preset.name,
    height: preset.height,
    width: preset.width,
    ...(preset.material ? { material: preset.material } : {}),
    ...(color ? { color } : {}),
    ...(preset.hasGrain ? { hasGrain: true, grainOrientation: preset.grainOrientation === 'horizontal' ? 'horizontal' : 'vertical' } : {}),
    ...(isPanelPrice(preset.pricePerSheet) ? { pricePerSheet: Math.round(preset.pricePerSheet * 100) / 100 } : {}),
  };
}

/** A usable panel price: finite, from 0 to 1 000 000 MAD. */
export function isPanelPrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000;
}

// ─── Device presets (anonymous use, and fallback) ───────────────────────────

export function loadSavedPresets(): PanelPreset[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (p: unknown): p is PanelPreset =>
          typeof p === 'object' && p !== null &&
          typeof (p as PanelPreset).name === 'string' &&
          typeof (p as PanelPreset).height === 'number' &&
          typeof (p as PanelPreset).width === 'number' &&
          (p as PanelPreset).height > 0 && (p as PanelPreset).width > 0,
      )
      // Presets saved before 'plywood' was corrected to the catalog id.
      .map((p) => ({ ...p, material: p.material === 'plywood' ? 'contreplaques' : p.material, builtIn: false }));
  } catch {
    return [];
  }
}

export function savePreset(preset: NewPanelPreset): PanelPreset {
  const saved = loadSavedPresets();
  const entry: PanelPreset = {
    ...cleanPreset(preset),
    id: `p-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
    builtIn: false,
  };
  saved.push(entry);
  // Soft cap: 40 user presets keeps localStorage tiny and the dropdown usable.
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved.slice(-40)));
  return entry;
}

/** Sets (or, with null, clears) the price of a preset saved on this device. */
export function setDevicePresetPrice(id: string, pricePerSheet: number | null): PanelPreset | null {
  const saved = loadSavedPresets();
  let updated: PanelPreset | null = null;
  const next = saved.map((p) => {
    if (p.id !== id) return p;
    const { pricePerSheet: _previous, ...rest } = p;
    void _previous;
    updated = pricePerSheet === null ? rest : { ...rest, pricePerSheet: Math.round(pricePerSheet * 100) / 100 };
    return updated;
  });
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return updated;
}

export function deletePreset(id: string): void {
  const saved = loadSavedPresets().filter((p) => p.id !== id);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
}

// ─── Account presets (signed-in artisans) ───────────────────────────────────

/**
 * The account's presets, or null when the device list must be used instead:
 * signed out, account store not set up yet, or unreachable.
 */
export async function fetchAccountPresets(): Promise<PanelPreset[] | null> {
  try {
    const res = await fetch('/api/panel-presets', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.success || data.note === 'cloud_not_ready' || !Array.isArray(data.presets)) return null;
    return data.presets as PanelPreset[];
  } catch {
    return null;
  }
}

export type AccountPresetsResult =
  | { ok: true; created: PanelPreset[]; duplicates: Array<{ name: string; existingName: string }> }
  | { ok: false; error: 'PRESET_LIMIT' | 'FAILED' };

export async function createAccountPresets(presets: NewPanelPreset[]): Promise<AccountPresetsResult> {
  try {
    const res = await fetch('/api/panel-presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ presets: presets.map(cleanPreset) }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.success) {
      return { ok: true, created: data.created || [], duplicates: data.duplicates || [] };
    }
    return { ok: false, error: data?.error === 'PRESET_LIMIT' ? 'PRESET_LIMIT' : 'FAILED' };
  } catch {
    return { ok: false, error: 'FAILED' };
  }
}

/** Sets (or, with null, clears) the price of an account preset; the updated preset, or null. */
export async function setAccountPresetPrice(id: string, pricePerSheet: number | null): Promise<PanelPreset | null> {
  try {
    const res = await fetch(`/api/panel-presets/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pricePerSheet }),
    });
    const data = await res.json().catch(() => null);
    return res.ok && data?.success && data.preset ? (data.preset as PanelPreset) : null;
  } catch {
    return null;
  }
}

export async function deleteAccountPreset(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/panel-presets/${encodeURIComponent(id)}`, { method: 'DELETE' });
    // Already gone counts as deleted: the list just has to stop showing it.
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

/**
 * Copies this device's presets into the account, once per user. The flag is
 * only set after the server accepted them, so presets saved on the device
 * while the account store was unavailable are still copied later. The device
 * copy is never deleted; the server's duplicate check absorbs any overlap
 * (another device, a second run).
 */
export async function importDevicePresetsOnce(userId: string): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const flagKey = `${IMPORTED_KEY_PREFIX}${userId}`;
  try {
    if (window.localStorage.getItem(flagKey)) return false;
  } catch {
    return false;
  }
  const device = loadSavedPresets();
  if (device.length > 0) {
    const result = await createAccountPresets(device.map(cleanPreset));
    if (!result.ok) return false;
  }
  try {
    window.localStorage.setItem(flagKey, new Date().toISOString());
  } catch {
    /* the import simply runs again next time; duplicates are skipped */
  }
  return device.length > 0;
}
