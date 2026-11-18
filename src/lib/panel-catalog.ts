/**
 * The catalogue of panels copied once into each artisan's own list (owner
 * request, 2026-11-18): the melamine boards Moroccan workshops cut most, in
 * the 280 × 207 format. Once copied, they are the artisan's panels like any
 * other: price, colour, size and name change on the panel page, and a panel
 * removed there never comes back.
 *
 * Prices are dirham figures (the middle of the owner's ranges, rounded to
 * 10 DH), converted for a euro or dollar account at the catalogue rate, like
 * every catalogue price (see catalogPriceIn).
 *
 * Pure module, no browser access: shared by the account route and the device
 * list.
 */
import { APP_CURRENCIES, catalogPriceIn, type AppCurrency } from '@/lib/currency';
import { findDuplicatePreset, type PanelPresetAttributes } from '@/lib/panel-preset-rules';
import type { NewPanelPreset, PanelPreset } from '@/lib/panel-presets';

/** Raised when the catalogue changes enough to be offered again (a new flag). */
export const PANEL_CATALOG_VERSION = 1;

interface CatalogPanel extends NewPanelPreset {
  id: string;
  /** Price of one panel, dirhams. */
  priceMad: number;
}

// « Sens obligatoire » in the owner's list: grain along the 280 cm length,
// which the optimizer calls vertical (along the panel's height). « Rotation
// libre »: no grain, pieces may turn.
const ALONG_LENGTH = { hasGrain: true, grainOrientation: 'vertical' } as const;
const panel = (id: string, name: string, color: string, priceMad: number, grain: Partial<typeof ALONG_LENGTH> = {}): CatalogPanel => ({
  id: `cat-${id}`,
  name,
  height: 280,
  width: 207,
  material: 'melamine',
  color,
  ...grain,
  priceMad,
});

export const PANEL_CATALOG: readonly CatalogPanel[] = [
  panel('031', '031 Blanc lisse 18 mm', 'Blanc lisse / Polaire', 530),
  panel('044', '044 Gris perle 18 mm', 'Gris perle / Gris clair', 600),
  panel('071', '071 / 075 Gris anthracite 18 mm', 'Gris anthracite / Foncé', 630),
  panel('090', '090 / 190 Noir 18 mm', 'Noir mat ou granité', 660),
  panel('011', '011 / 101 Blanc brillant 18 mm', 'Blanc brillant (High Gloss)', 1080),
  panel('rahli', 'Rahli (رحلي) 18 mm', 'Brun rougeâtre / Acajou', 690, ALONG_LENGTH),
  panel('chene', 'Chêne 38H / 208 18 mm', 'Bois clair naturel', 720, ALONG_LENGTH),
  panel('noyer', 'Noyer (Nogal) 18 mm', 'Bois brun foncé', 740, ALONG_LENGTH),
  panel('frene', 'Frêne / Hêtre 18 mm', 'Bois clair rosé ou blanc', 680, ALONG_LENGTH),
  panel('beton', 'Effet Béton / Pierre 18 mm', 'Gris marbré ou spatulé', 720),
  panel('tissu', 'Effet Tissu / Lin 18 mm', 'Beige / Gris texturé', 670),
];

/** The catalogue as panels priced in `currency`, with their stable ids (for the panel page's shortcuts). */
export function catalogPresetsFor(currency: AppCurrency): PanelPreset[] {
  return PANEL_CATALOG.map(({ priceMad, ...preset }) => ({ ...preset, pricePerSheet: catalogPriceIn(priceMad, currency) }));
}

/**
 * The catalogue panels an artisan does not have yet (same panel by the usual
 * rule: size, material, colour, grain; the name does not count), as new
 * panels of theirs, at most `room` of them.
 */
export function missingCatalogPanels(existing: readonly PanelPresetAttributes[], currency: AppCurrency, room: number): NewPanelPreset[] {
  if (room <= 0) return [];
  return catalogPresetsFor(currency)
    .filter((preset) => !findDuplicatePreset(preset, existing))
    .slice(0, room)
    .map(({ id: _id, builtIn: _builtIn, ...preset }) => {
      void _id;
      void _builtIn;
      return preset;
    });
}

/**
 * True for a panel still exactly as the catalogue gave it: same panel, same
 * name, and the catalogue price in one of the currencies. A panel the
 * artisan changed in any way is theirs.
 */
export function isUntouchedCatalogPanel(preset: PanelPresetAttributes & { name: string; pricePerSheet?: number | null }): boolean {
  return PANEL_CATALOG.some(
    (entry) =>
      entry.name === preset.name &&
      !!findDuplicatePreset(preset, [entry]) &&
      APP_CURRENCIES.some((currency) => catalogPriceIn(entry.priceMad, currency) === preset.pricePerSheet)
  );
}
