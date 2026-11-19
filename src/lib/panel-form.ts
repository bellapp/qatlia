/**
 * The form of the panel page (« Configuration des panneaux »): what the
 * artisan types, in their display unit, and the panel it gives.
 *
 * The bounds are the account store's (PresetInputSchema in
 * panel-presets-store.ts): a panel accepted here is one the store accepts and
 * the optimizer can cut. Pure module, no browser access.
 */
import { MATERIAL_TYPE_VALUES, type MaterialType } from '@/lib/cutting/binpacking';
import { MAX_GEOMETRY } from '@/lib/cutting/optimize-schema';
import { PRESET_COLOR_MAX_CHARS, type GrainOrientation } from '@/lib/panel-preset-rules';
import { PANEL_CATALOG } from '@/lib/panel-catalog';
import { isPanelPrice, type NewPanelPreset, type PanelPreset } from '@/lib/panel-presets';
import { fromCanonicalCm, parseDisplayInputToCanonical, type DisplayUnit } from '@/lib/units';

export const PANEL_NAME_MAX_CHARS = 80;

/**
 * The stock materials offered when choosing a panel, in the atelier and on the
 * panel page. These are the stable `MaterialType` payload values: the optimizer,
 * `/api/optimize` and every saved project carry them verbatim; only their
 * labels come from the catalog.
 */
export const STOCK_MATERIAL_VALUES: readonly MaterialType[] = ['mdf', 'melamine', 'aluminium', 'verre', 'contreplaques'];

export interface PanelFormValues {
  name: string;
  height: string;
  width: string;
  material: string;
  color: string;
  hasGrain: boolean;
  grainOrientation: GrainOrientation;
  price: string;
}

export type PanelFormError = 'name' | 'height' | 'width' | 'price';

export const EMPTY_PANEL_FORM: PanelFormValues = {
  name: '',
  height: '',
  width: '',
  material: 'mdf',
  color: '',
  hasGrain: false,
  grainOrientation: 'vertical',
  price: '',
};

/** A number typed by hand: a decimal comma reads as a decimal point. */
const typed = (value: string) => value.trim().replace(',', '.');

/** A saved panel, as the form shows it in `unit`. */
export function panelToForm(preset: PanelPreset, unit: DisplayUnit): PanelFormValues {
  return {
    name: preset.name,
    height: String(fromCanonicalCm(preset.height, unit)),
    width: String(fromCanonicalCm(preset.width, unit)),
    material: preset.material || 'mdf',
    color: preset.color ?? '',
    hasGrain: preset.hasGrain === true,
    grainOrientation: preset.grainOrientation === 'horizontal' ? 'horizontal' : 'vertical',
    price: isPanelPrice(preset.pricePerSheet) ? String(preset.pricePerSheet) : '',
  };
}

function dimension(value: string, unit: DisplayUnit): number | null {
  const cm = parseDisplayInputToCanonical(typed(value), unit);
  return cm !== null && cm > 0 && cm <= MAX_GEOMETRY ? cm : null;
}

/** Dimensions typed in `unit` come back in canonical cm; a blank price is no price. */
export function parsePanelForm(
  values: PanelFormValues,
  unit: DisplayUnit
): { ok: true; preset: NewPanelPreset } | { ok: false; errors: PanelFormError[] } {
  const errors: PanelFormError[] = [];
  const name = values.name.trim();
  if (!name || name.length > PANEL_NAME_MAX_CHARS) errors.push('name');
  const height = dimension(values.height, unit);
  if (height === null) errors.push('height');
  const width = dimension(values.width, unit);
  if (width === null) errors.push('width');
  const priceText = typed(values.price);
  const price = priceText === '' ? null : Number(priceText);
  if (price !== null && !isPanelPrice(price)) errors.push('price');
  if (errors.length > 0 || height === null || width === null) return { ok: false, errors };

  const color = values.color.trim().replace(/\s+/g, ' ').slice(0, PRESET_COLOR_MAX_CHARS);
  const material = (MATERIAL_TYPE_VALUES as readonly string[]).includes(values.material) ? values.material : 'mdf';
  return {
    ok: true,
    preset: {
      name,
      height,
      width,
      material,
      ...(color ? { color } : {}),
      ...(values.hasGrain ? { hasGrain: true, grainOrientation: values.grainOrientation } : {}),
      ...(price !== null ? { pricePerSheet: price } : {}),
    },
  };
}

/**
 * The add form after a catalogue panel is clicked: all of it (size, material,
 * colour, grain, price), and its name while the artisan has not typed one (a
 * name another catalogue panel put there is replaced too, never one the
 * artisan typed).
 */
export function applyShortcut(values: PanelFormValues, preset: PanelPreset, unit: DisplayUnit): PanelFormValues {
  const name = values.name.trim();
  const nameIsOurs = name === '' || PANEL_CATALOG.some((panel) => panel.name === name);
  return { ...panelToForm(preset, unit), name: nameIsOurs ? preset.name : values.name };
}
