const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

// Owner decision, 2026-11-18: a price changed on the panel page did not reach
// the panel in use in the atelier, and the quote kept the old one. Back in the
// atelier, a line under the price offers the new one; the artisan keeps the
// say over a price they typed on purpose.

const { savedPriceChange } = loadTsModule('src/lib/panel-preset-rules.ts');

const IN_USE = { height: 244, width: 122, material: 'mdf', color: 'Blanc', pricePerSheet: 450 };
const SAVED = { id: 'p-1', name: 'MDF blanc', height: 244, width: 122, material: 'mdf', color: 'blanc', pricePerSheet: 500 };

test('the saved panel in use now has another price: it is offered', () => {
  assert.deepEqual(savedPriceChange(IN_USE, [SAVED]), { name: 'MDF blanc', price: 500 });
});

test('a saved price the panel in use already has is nothing to offer', () => {
  assert.equal(savedPriceChange(IN_USE, [{ ...SAVED, pricePerSheet: 450 }]), null);
});

test('a price given on the page to a panel used at the catalog price is offered', () => {
  const { pricePerSheet: _price, ...atCatalogPrice } = IN_USE;
  void _price;

  assert.deepEqual(savedPriceChange(atCatalogPrice, [SAVED]), { name: 'MDF blanc', price: 500 });
});

test('a saved panel with no price, or another panel, offers nothing', () => {
  const { pricePerSheet: _price, ...withoutPrice } = SAVED;
  void _price;

  assert.equal(savedPriceChange(IN_USE, [withoutPrice]), null, 'no price: the one in use stays');
  assert.equal(savedPriceChange(IN_USE, [{ ...SAVED, color: 'Noyer' }]), null, 'another colour is another panel');
  assert.equal(savedPriceChange(IN_USE, [{ ...SAVED, width: 61 }]), null);
  assert.equal(savedPriceChange(IN_USE, []), null);
});

test('a price the store would never hold is not offered', () => {
  for (const price of [NaN, -1, Infinity, 2_000_000, '500']) {
    assert.equal(savedPriceChange(IN_USE, [{ ...SAVED, pricePerSheet: price }]), null, String(price));
  }
});

// The atelier, read as text: the page needs a session to run.

const atelier = fs.readFileSync(path.resolve('src/app/(site)/atelier/page.tsx'), 'utf8');

test('the atelier offers the new price of the panel in use, in sheet mode', () => {
  assert.match(atelier, /const savedPrice = cutMode === '2d' && presetsReady \? savedPriceChange\(activeSheet, savedPresets\) : null;/, 'only once the list in use is read');
  assert.match(atelier, /t\('atelier\.stock\.savedPriceChanged', \{ name: savedPrice\.name, price: n\(savedPrice\.price\) \}\)/);
});

test('applying the new price reprices the plan on screen, as the price field does', () => {
  const start = atelier.indexOf('const applySavedPrice = () => {');
  const apply = atelier.slice(start, atelier.indexOf('\n  };', start));

  assert.match(apply, /const nextSheet: Sheet = \{ \.\.\.activeSheet, pricePerSheet: savedPrice\.price \};/);
  assert.match(apply, /setSheets\(\[nextSheet\]\);\s*repriceResult\(\{ sheet: nextSheet \}\);/);
});

test('keeping the current price hides the offer until a price changes again', () => {
  assert.match(atelier, /const savedPriceKey = savedPrice \? `\$\{savedPrice\.name\}:\$\{savedPrice\.price\}:\$\{activeSheet\.pricePerSheet \?\? ''\}` : null;/);
  assert.match(atelier, /\{savedPrice && keptPriceKey !== savedPriceKey \? \(/);
  assert.match(atelier, /onClick=\{\(\) => setKeptPriceKey\(savedPriceKey\)\}/);
});

test('the offer is written in the three languages', () => {
  for (const locale of ['fr', 'en', 'ar']) {
    const messages = loadTsModule(`src/i18n/messages/${locale}.ts`)[locale].atelier.stock;
    for (const key of ['savedPriceChanged', 'applySavedPrice', 'keepPrice']) {
      assert.equal(typeof messages[key], 'string', `${locale} ${key}`);
    }
    assert.match(messages.savedPriceChanged, /\{name\}[^]*\{price\}[^]*\{currency\}|\{name\}[^]*\{currency\}[^]*\{price\}|\{price\}[^]*\{name\}/, `${locale} keeps the blanks`);
  }
  const fr = loadTsModule('src/i18n/messages/fr.ts').fr.atelier.stock;
  assert.equal(fr.savedPriceChanged, 'Le prix de « {name} » est maintenant de {price} {currency}.');
  assert.equal(fr.applySavedPrice, 'Appliquer ce prix');
  assert.equal(fr.keepPrice, 'Garder le prix actuel');
});
