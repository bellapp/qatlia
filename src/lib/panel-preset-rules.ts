/**
 * What makes two saved stock panels "the same panel".
 *
 * An artisan stocks several boards of one size: white and walnut MDF at
 * 244 × 122, a grained and a plain one, MDF and plywood. They are all
 * distinct panels. A preset is a duplicate only when every physical attribute
 * matches: dimensions, material, colour/décor and grain (with its direction).
 * The name is ignored, because a renamed copy is still the same board.
 *
 * Pure module, no 'use client': shared by the atelier (device presets) and
 * `/api/panel-presets` (account presets), so both refuse the same duplicates.
 */

export type GrainOrientation = 'vertical' | 'horizontal';

export interface PanelPresetAttributes {
  /** Canonical cm, same convention as the rest of the geometry state. */
  height: number;
  width: number;
  material?: string | null;
  /** Free-text colour or décor (« Blanc », « Noyer »…). */
  color?: string | null;
  hasGrain?: boolean | null;
  grainOrientation?: GrainOrientation | null;
}

export const PRESET_COLOR_MAX_CHARS = 60;

/** Trimmed colour, compared case-insensitively; blank means "no colour". */
export function normalizePresetColor(color: string | null | undefined): string {
  return typeof color === 'string' ? color.trim().replace(/\s+/g, ' ').toLowerCase() : '';
}

/** The grain a preset actually carries: a direction only when it is grained. */
export function presetGrainKey(preset: Pick<PanelPresetAttributes, 'hasGrain' | 'grainOrientation'>): string {
  if (!preset.hasGrain) return 'none';
  return preset.grainOrientation === 'horizontal' ? 'horizontal' : 'vertical';
}

export function isSamePanel(a: PanelPresetAttributes, b: PanelPresetAttributes): boolean {
  return (
    Math.abs(a.height - b.height) < 1e-6 &&
    Math.abs(a.width - b.width) < 1e-6 &&
    (a.material || 'mdf').toLowerCase() === (b.material || 'mdf').toLowerCase() &&
    normalizePresetColor(a.color) === normalizePresetColor(b.color) &&
    presetGrainKey(a) === presetGrainKey(b)
  );
}

/** The already-saved preset this one would duplicate, if any. */
export function findDuplicatePreset<T extends PanelPresetAttributes>(
  preset: PanelPresetAttributes,
  saved: readonly T[],
): T | undefined {
  return saved.find((candidate) => isSamePanel(candidate, preset));
}
