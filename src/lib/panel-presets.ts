'use client';

/**
 * Panel presets: the stock panels the artisan works with. The catalogue they
 * start from is copied into their list (see ./panel-catalog).
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
import { PANEL_CATALOG_VERSION, isUntouchedCatalogPanel, missingCatalogPanels } from './panel-catalog';
import type { AppCurrency } from './currency';

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
/** Set once the panel catalogue was copied into this device's list. */
const CATALOG_COPIED_KEY = `qatlia-panel-catalog-v${PANEL_CATALOG_VERSION}`;
/** The device list's cap: keeps localStorage tiny and the dropdown usable. */
export const DEVICE_PRESET_CAP = 40;
/** Set once a user's device presets have been copied into their account. */
const IMPORTED_KEY_PREFIX = 'qatlia-panel-presets-imported:';

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
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved.slice(-DEVICE_PRESET_CAP)));
  return entry;
}

/**
 * Copies the panel catalogue (./panel-catalog) into this device's list once:
 * the panels not there yet, within the device cap, priced in `currency`.
 * True when panels were added. A device that had it never gets it back,
 * whatever was removed since. Never throws.
 */
export function copyCatalogToDeviceOnce(currency: AppCurrency): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.localStorage.getItem(CATALOG_COPIED_KEY)) return false;
    const saved = loadSavedPresets();
    const added: PanelPreset[] = missingCatalogPanels(saved, currency, DEVICE_PRESET_CAP - saved.length).map((preset, index) => ({
      ...cleanPreset(preset),
      id: `p-${Date.now()}-${index}-${Math.floor(Math.random() * 1e4)}`,
      builtIn: false,
    }));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...saved, ...added]));
    window.localStorage.setItem(CATALOG_COPIED_KEY, '1');
    return added.length > 0;
  } catch {
    return false;
  }
}

export type PresetUpdateResult =
  | { ok: true; preset: PanelPreset }
  | { ok: false; error: 'DUPLICATE'; existingName: string }
  | { ok: false; error: 'FAILED' };

/**
 * Edits a panel of the device list as a whole, in its place. A panel made
 * identical to another one of the list is refused with the other's name.
 */
export function updateDevicePreset(id: string, preset: NewPanelPreset): PresetUpdateResult {
  const saved = loadSavedPresets();
  if (!saved.some((p) => p.id === id)) return { ok: false, error: 'FAILED' };
  const duplicate = findDuplicatePreset(preset, saved.filter((p) => p.id !== id));
  if (duplicate) return { ok: false, error: 'DUPLICATE', existingName: duplicate.name };
  const updated: PanelPreset = { ...cleanPreset(preset), id, builtIn: false };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved.map((p) => (p.id === id ? updated : p))));
  } catch {
    return { ok: false, error: 'FAILED' };
  }
  return { ok: true, preset: updated };
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

/** Edits an account panel as a whole (every attribute, the price included). */
export async function updateAccountPreset(id: string, preset: NewPanelPreset): Promise<PresetUpdateResult> {
  try {
    const res = await fetch(`/api/panel-presets/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cleanPreset(preset)),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.success && data.preset) return { ok: true, preset: data.preset as PanelPreset };
    if (res.status === 409 && data?.error === 'DUPLICATE_PRESET' && typeof data.existingName === 'string') {
      return { ok: false, error: 'DUPLICATE', existingName: data.existingName };
    }
    return { ok: false, error: 'FAILED' };
  } catch {
    return { ok: false, error: 'FAILED' };
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
 *
 * Catalogue panels left as the catalogue gave them are not sent: the account
 * has its own copy of the catalogue (GET /api/panel-presets), and one that
 * removed some must not get them back from a new device. True when panels
 * were sent.
 */
export async function importDevicePresetsOnce(userId: string): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const flagKey = `${IMPORTED_KEY_PREFIX}${userId}`;
  try {
    if (window.localStorage.getItem(flagKey)) return false;
  } catch {
    return false;
  }
  const device = loadSavedPresets().filter((preset) => !isUntouchedCatalogPanel(preset));
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
