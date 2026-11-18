const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// Owner request, 2026-11-18: the five fixed standard sizes give way to a real
// catalogue of melamine panels, copied once into each artisan's own list, where
// they change price, colour or size to their needs. Prices are the middle of
// the owner's ranges, rounded to 10 DH; only the 280 × 207 format is kept.

const { PANEL_CATALOG, PANEL_CATALOG_VERSION, catalogPresetsFor, missingCatalogPanels } = loadTsModule('src/lib/panel-catalog.ts');
const { isSamePanel } = loadTsModule('src/lib/panel-preset-rules.ts');
const { PresetInputSchema } = loadTsModule('src/lib/panel-presets-store.ts');

const EXPECTED = [
  ['031 Blanc lisse 18 mm', 'Blanc lisse / Polaire', false, 530],
  ['044 Gris perle 18 mm', 'Gris perle / Gris clair', false, 600],
  ['071 / 075 Gris anthracite 18 mm', 'Gris anthracite / Foncé', false, 630],
  ['090 / 190 Noir 18 mm', 'Noir mat ou granité', false, 660],
  ['011 / 101 Blanc brillant 18 mm', 'Blanc brillant (High Gloss)', false, 1080],
  ['Rahli (رحلي) 18 mm', 'Brun rougeâtre / Acajou', true, 690],
  ['Chêne 38H / 208 18 mm', 'Bois clair naturel', true, 720],
  ['Noyer (Nogal) 18 mm', 'Bois brun foncé', true, 740],
  ['Frêne / Hêtre 18 mm', 'Bois clair rosé ou blanc', true, 680],
  ['Effet Béton / Pierre 18 mm', 'Gris marbré ou spatulé', false, 720],
  ['Effet Tissu / Lin 18 mm', 'Beige / Gris texturé', false, 670],
];

test('the catalogue is the eleven melamine panels of the owner, in 280 × 207', () => {
  assert.equal(PANEL_CATALOG_VERSION, 1);
  assert.deepEqual(
    PANEL_CATALOG.map((p) => [p.name, p.color, !!p.hasGrain, p.priceMad]),
    EXPECTED
  );
  for (const panel of PANEL_CATALOG) {
    assert.equal(panel.height, 280, panel.name);
    assert.equal(panel.width, 207, panel.name);
    assert.equal(panel.material, 'melamine', panel.name);
  }
});

test('a grained panel keeps its grain along the 280 cm length', () => {
  for (const panel of PANEL_CATALOG.filter((p) => p.hasGrain)) {
    assert.equal(panel.grainOrientation, 'vertical', `${panel.name}: vertical is along the height`);
  }
  for (const panel of PANEL_CATALOG.filter((p) => !p.hasGrain)) {
    assert.equal(panel.grainOrientation, undefined, `${panel.name}: free rotation`);
  }
});

test('no two panels of the catalogue are the same panel, and the account accepts each one', () => {
  PANEL_CATALOG.forEach((a, i) => PANEL_CATALOG.slice(i + 1).forEach((b) => assert.equal(isSamePanel(a, b), false, `${a.name} / ${b.name}`)));
  for (const preset of catalogPresetsFor('MAD')) {
    assert.equal(PresetInputSchema.safeParse(preset).success, true, preset.name);
  }
});

test('the prices are in dirhams for a dirham account, converted for the others', () => {
  const mad = catalogPresetsFor('MAD');
  assert.deepEqual(mad.map((p) => p.pricePerSheet), EXPECTED.map(([, , , price]) => price));
  assert.equal('priceMad' in mad[0], false, 'a preset carries its price only once');

  const eur = catalogPresetsFor('EUR');
  assert.equal(eur[0].pricePerSheet, 49.07, '530 DH at the catalogue rate');
  assert.equal(catalogPresetsFor('USD')[0].pricePerSheet, 53);
});

test('a catalogue preset has a stable id, so a shortcut can name it', () => {
  const ids = catalogPresetsFor('MAD').map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => id.startsWith('cat-')));
});

test('only the panels an artisan does not have yet are copied', () => {
  const own = [{ height: 280, width: 207, material: 'melamine', color: 'blanc lisse / polaire', hasGrain: false }];

  const missing = missingCatalogPanels(own, 'MAD', 100);
  assert.equal(missing.length, 10);
  assert.equal(missing.some((p) => p.name.startsWith('031')), false, 'same panel, other case: already there');
  assert.equal('id' in missing[0], false, 'a new panel of the artisan, not a catalogue entry');
});

test('the copy stops where the list is full', () => {
  assert.equal(missingCatalogPanels([], 'MAD', 3).length, 3);
  assert.deepEqual(missingCatalogPanels([], 'MAD', 0), []);
  assert.deepEqual(missingCatalogPanels([], 'MAD', -2), []);
});

test('an untouched catalogue panel is recognised, a changed one is not', () => {
  const { catalogPresetsFor, isUntouchedCatalogPanel } = loadTsModule('src/lib/panel-catalog.ts');
  const [white] = catalogPresetsFor('MAD');
  const [whiteUsd] = catalogPresetsFor('USD');

  assert.equal(isUntouchedCatalogPanel({ ...white, id: 'p-1' }), true);
  assert.equal(isUntouchedCatalogPanel(whiteUsd), true, 'priced in another currency');
  assert.equal(isUntouchedCatalogPanel({ ...white, name: 'Blanc atelier' }), false, 'renamed');
  assert.equal(isUntouchedCatalogPanel({ ...white, pricePerSheet: 500 }), false, 'repriced');
  assert.equal(isUntouchedCatalogPanel({ ...white, pricePerSheet: undefined }), false, 'price cleared');
  assert.equal(isUntouchedCatalogPanel({ ...white, color: 'Blanc' }), false, 'recoloured');
  assert.equal(isUntouchedCatalogPanel({ ...white, height: 244, width: 122 }), false, 'resized');
});
