'use client';

/**
 * Panel presets: predefined stock panels plus artisan-saved ones.
 * Persisted in localStorage (device-local by design, like the piece catalog) —
 * no Supabase table, no auth requirement, works for anonymous workshop use.
 */

export interface PanelPreset {
  id: string;
  name: string;
  /** Canonical cm, same convention as the rest of the geometry state. */
  height: number;
  width: number;
  material?: string;
  builtIn?: boolean;
}

const STORAGE_KEY = 'qatlia-panel-presets';

/** Common Moroccan workshop stock sizes (cm) — editable, not authoritative. */
export const BUILT_IN_PRESETS: PanelPreset[] = [
  { id: 'bi-244x122', name: 'Grand panneau 244 × 122', height: 244, width: 122, material: 'mdf', builtIn: true },
  { id: 'bi-210x100', name: 'Panneau 210 × 100', height: 210, width: 100, material: 'mdf', builtIn: true },
  { id: 'bi-200x100', name: 'Panneau 200 × 100', height: 200, width: 100, material: 'mdf', builtIn: true },
  { id: 'bi-183x122', name: 'Contreplaqué 183 × 122', height: 183, width: 122, material: 'plywood', builtIn: true },
  { id: 'bi-122x61', name: 'Demi-panneau 122 × 61', height: 122, width: 61, material: 'mdf', builtIn: true },
];

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
      .map((p) => ({ ...p, builtIn: false }));
  } catch {
    return [];
  }
}

export function savePreset(preset: Omit<PanelPreset, 'id' | 'builtIn'>): PanelPreset {
  const saved = loadSavedPresets();
  const entry: PanelPreset = {
    ...preset,
    id: `p-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
    builtIn: false,
  };
  saved.push(entry);
  // Soft cap: 40 user presets keeps localStorage tiny and the dropdown usable.
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved.slice(-40)));
  return entry;
}

export function deletePreset(id: string): void {
  const saved = loadSavedPresets().filter((p) => p.id !== id);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
}
