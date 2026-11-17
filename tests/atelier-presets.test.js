const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Owner request, 2026-11-17: the list of panels is managed on its own page.
// In the atelier the list stays a shortcut: the artisan still picks one, saves
// the panel just typed, or types a panel by hand (owner's answer: « Oui »).

const read = (file) => fs.readFileSync(path.resolve(file), 'utf8');
const atelier = read('src/app/(site)/atelier/page.tsx');

/** The panel card, from its opening to the cut settings it ends with. */
function stockCard() {
  const start = atelier.indexOf('id="stock-card"');
  const end = atelier.indexOf('id="cut-settings"', start);
  assert.ok(start > 0 && end > start, 'the atelier has its panel card');
  return atelier.slice(start, end);
}

test('the panel card leads to the panel page, even when no panel is saved yet', () => {
  const card = stockCard();
  const link = card.indexOf('<Link href="/panels"');

  assert.ok(link > 0, 'a link to the panel page');
  assert.ok(card.slice(link, card.indexOf('</Link>', link)).includes("t('atelier.stock.managePresets')"));
  const before = card.slice(Math.max(0, link - 120), link);
  assert.equal(/savedPresets\.length > 0 &&\s*\(?\s*$/.test(before), false, 'not hidden behind a saved panel');
});

test('the folded list of the card is gone: the page manages the list', () => {
  for (const gone of ['data-testid="preset-manager"', 'isPresetManageOpen', 'handlePresetPrice', 'handleDeletePreset']) {
    assert.equal(atelier.includes(gone), false, gone);
  }
});

test('the atelier reads the list where the panel page does', () => {
  assert.match(atelier, /usePanelPresets\(\)/);
  for (const gone of ['fetchAccountPresets', 'importDevicePresetsOnce', 'createAccountPresets', 'setAccountPresetPrice', 'setDevicePresetPrice', 'deleteAccountPreset']) {
    assert.equal(atelier.includes(gone), false, gone);
  }
});

test('saving the panel just typed goes through the shared list', () => {
  const save = atelier.slice(atelier.indexOf('const handleSavePreset = async'), atelier.indexOf('const presetDetails'));

  assert.match(save, /await addPreset\(preset\)/);
  assert.equal(save.includes('savePreset('), false, 'no write of its own');
});

test('picking a panel, saving it, and typing one by hand all stay in the card', () => {
  const card = stockCard();

  assert.match(card, /aria-label=\{t\('atelier\.stock\.presetAria'\)\}/, 'the panel picker');
  assert.match(card, /onClick=\{\(\) => void handleSavePreset\(\)\}/, 'Sauvegarder');
  assert.match(card, /id="preset-name-input"/, 'the name to save it under');
  assert.match(card, /aria-label=\{t\('atelier\.stock\.heightAria'/, 'the height');
  assert.match(card, /aria-label=\{t\(cutMode === '1d' \? 'atelier\.stock\.lengthAria' : 'atelier\.stock\.widthAria'/, 'the width');
  assert.match(card, /aria-label=\{t\('atelier\.stock\.materialAria'\)\}/, 'the material');
});

test('the link says where it leads, in the three languages', () => {
  for (const [locale, words] of [['fr', 'Gérer mes panneaux'], ['en', 'Manage my panels'], ['ar', 'إدارة ألواحي']]) {
    assert.ok(read(`src/i18n/messages/${locale}.ts`).includes(`managePresets: '${words}',`), locale);
  }
});
