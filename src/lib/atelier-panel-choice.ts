/**
 * The atelier's panel card against the artisan's list (owner request,
 * 2026-11-19): which panel of the list the card shows, and what
 * « Sauvegarder » does with the panel on the card.
 *
 * - A panel picked from the list stays shown while its size is kept; its
 *   price, colour, material, grain or name may change, it is still that panel.
 * - Without a pick (or once the size changed), the card shows the panel of the
 *   list it is the same as (size, material, colour, grain), if any.
 * - That panel, changed, is updated; kept as it is, there is nothing to save;
 *   without one, the card's panel is added.
 *
 * Pure module: shared by the atelier and its tests.
 */
import { findDuplicatePreset, isSamePanel } from './panel-preset-rules';
import { isPanelPrice, type NewPanelPreset, type PanelPreset } from './panel-presets';

export type SaveAction =
  | { kind: 'add' }
  | { kind: 'saved'; target: PanelPreset }
  | { kind: 'update'; target: PanelPreset; preset: NewPanelPreset };

/** The panel of the list the card stands for, if any. */
export function listPanelFor(card: NewPanelPreset, presets: readonly PanelPreset[], pickedId: string | null): PanelPreset | undefined {
  const picked = pickedId ? presets.find((preset) => preset.id === pickedId) : undefined;
  if (picked && Math.abs(picked.height - card.height) < 1e-6 && Math.abs(picked.width - card.width) < 1e-6) return picked;
  return findDuplicatePreset(card, presets);
}

/** What « Sauvegarder » does with the card's panel. A card without a name keeps the list's name. */
export function saveActionFor(card: NewPanelPreset, presets: readonly PanelPreset[], pickedId: string | null): SaveAction {
  const target = listPanelFor(card, presets, pickedId);
  if (!target) return { kind: 'add' };
  const name = card.name.trim() || target.name;
  const unchanged = name === target.name && isSamePanel(card, target) && (card.pricePerSheet ?? null) === (target.pricePerSheet ?? null);
  if (unchanged) return { kind: 'saved', target };
  return { kind: 'update', target, preset: { ...card, name } };
}

/**
 * The card's price while it is being typed (committed on blur): '' clears it,
 * a price reads as one, anything else leaves the panel its own.
 */
export function typedPanelPrice(draft: string, committed: number | undefined): number | undefined {
  const text = draft.trim().replace(',', '.');
  if (text === '') return undefined;
  const price = Number(text);
  return isPanelPrice(price) ? price : committed;
}
