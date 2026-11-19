const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// Owner request, 2026-11-19 (preview of PR #80): in the atelier, the panel
// picked stays shown, and « Sauvegarder » saves only what is new or changed:
// a panel of the list that was changed (price, colour, name…) is updated, a
// new one is added, one already in the list as it is greys the button out.

const { listPanelFor, saveActionFor } = loadTsModule('src/lib/atelier-panel-choice.ts');

const WHITE = { id: 'a1', name: '031 Blanc lisse 18 mm', height: 280, width: 207, material: 'melamine', color: 'Blanc lisse / Polaire', pricePerSheet: 530 };
const OAK = { id: 'a2', name: 'Chêne 38H / 208 18 mm', height: 280, width: 207, material: 'melamine', color: 'Bois clair naturel', hasGrain: true, grainOrientation: 'vertical', pricePerSheet: 720 };
const LIST = [WHITE, OAK];
const card = (preset, extra = {}) => {
  const { id: _id, ...panel } = preset;
  void _id;
  return { ...panel, ...extra };
};

test('the panel picked is the one shown, while its size is kept', () => {
  assert.equal(listPanelFor(card(WHITE), LIST, 'a1'), WHITE);
  assert.equal(listPanelFor(card(WHITE, { color: 'Blanc', pricePerSheet: 500 }), LIST, 'a1'), WHITE, 'colour and price changed: still that panel');
  assert.equal(listPanelFor(card(WHITE, { height: 244, width: 122 }), LIST, 'a1'), undefined, 'another size: a new panel');
});

test('without a pick, the card shows the panel of the list it is the same as', () => {
  assert.equal(listPanelFor(card(OAK, { name: '' }), LIST, null), OAK);
  assert.equal(listPanelFor(card(OAK, { name: '', color: 'Chêne foncé' }), LIST, null), undefined);
  assert.equal(listPanelFor(card(WHITE), LIST, 'gone'), WHITE, 'a removed pick falls back on the same panel');
});

test('a panel of the list kept as it is has nothing to save', () => {
  assert.deepEqual(saveActionFor(card(WHITE), LIST, 'a1'), { kind: 'saved', target: WHITE });
  assert.deepEqual(saveActionFor(card(WHITE, { name: '' }), LIST, null), { kind: 'saved', target: WHITE }, 'no name typed is no change');
  assert.deepEqual(saveActionFor(card(WHITE, { color: ' blanc lisse / polaire ' }), LIST, 'a1').kind, 'saved', 'same colour, written otherwise');
});

test('a panel of the list changed is updated, whole', () => {
  for (const change of [{ pricePerSheet: 500 }, { pricePerSheet: undefined }, { color: 'Blanc mat' }, { name: 'Blanc atelier' }, { material: 'mdf' }, { hasGrain: true, grainOrientation: 'vertical' }]) {
    const action = saveActionFor(card(WHITE, change), LIST, 'a1');
    assert.equal(action.kind, 'update', JSON.stringify(change));
    assert.equal(action.target, WHITE);
  }
});

test('the panel sent for an update keeps the list’s name when none is typed', () => {
  const action = saveActionFor(card(WHITE, { name: '  ', pricePerSheet: 500 }), LIST, 'a1');

  assert.equal(action.kind, 'update');
  assert.equal(action.preset.name, '031 Blanc lisse 18 mm');
  assert.equal(action.preset.pricePerSheet, 500);
  assert.equal('id' in action.preset, false);
});

test('a panel the list does not have is added', () => {
  assert.deepEqual(saveActionFor(card(WHITE, { height: 244, width: 122 }), LIST, 'a1').kind, 'add');
  assert.deepEqual(saveActionFor(card(WHITE, { color: 'Rouge' }), LIST, null).kind, 'add');
  assert.deepEqual(saveActionFor(card(WHITE), [], null).kind, 'add');
});

test('the price on the card is the one being typed, once it reads as a price', () => {
  const { typedPanelPrice } = loadTsModule('src/lib/atelier-panel-choice.ts');

  assert.equal(typedPanelPrice('500', 530), 500);
  assert.equal(typedPanelPrice(' 512,5 ', 530), 512.5);
  assert.equal(typedPanelPrice('', 530), undefined, 'cleared');
  assert.equal(typedPanelPrice('abc', 530), 530, 'not a price yet: the panel keeps its own');
  assert.equal(typedPanelPrice('-3', undefined), undefined);
});
