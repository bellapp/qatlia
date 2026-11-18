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

// Review, 2026-11-18: the card wrote to the device list while a signed-in
// artisan's account was out of reach, as the panel page refuses to; the panel
// then vanished on the next visit, once the account list was back.

const handleSave = () => atelier.slice(atelier.indexOf('const handleSavePreset = async'), atelier.indexOf('const presetDetails'));

test('saving waits for the list, and never while the account is out of reach', () => {
  assert.match(atelier, /const \{ presets: savedPresets, add: addPreset, ready: presetsReady, signedIn: presetsSignedIn, source: presetsSource \} = usePanelPresets\(\);/);
  const save = handleSave();
  const guard = save.indexOf("if (presetsSignedIn && presetsSource === 'device') {");
  assert.ok(guard > 0, 'the guard exists');
  assert.ok(guard < save.indexOf('await addPreset(preset)'), 'before any write');
  assert.match(save.slice(guard), /^[^]*?setPresetFeedback\(\{ tone: 'warning', text: t\('panelsPage\.accountUnreachable'\) \}\);\s*return;/);
});

test('the save button waits for the list and for a save under way', () => {
  const card = stockCard();
  const button = card.slice(card.lastIndexOf('<button', card.indexOf('onClick={() => void handleSavePreset()}')), card.indexOf('</button>', card.indexOf('onClick={() => void handleSavePreset()}')));

  assert.match(button, /disabled=\{!presetsReady \|\| isSavingPreset\}/);
  assert.match(handleSave(), /setIsSavingPreset\(true\);[^]*finally \{\s*setIsSavingPreset\(false\);\s*\}/);
});

test('each refusal says its own reason', () => {
  const save = handleSave();

  assert.match(save, /saved\.error === 'DUPLICATE'\s*\? t\('atelier\.stock\.presetDuplicate', \{ name: saved\.existingName \?\? '' \}\)/);
  assert.match(save, /t\(saved\.error === 'LIMIT' \? 'atelier\.stock\.presetLimit' : 'atelier\.stock\.presetSaveFailed'\)/);
});

// Owner request, 2026-11-18: the standard sizes are no longer a fixed group of
// their own. The catalogue is copied into the artisan's list, and the picker
// shows that list only.

test('the panel picker shows the artisan’s list only', () => {
  const card = stockCard();

  assert.equal(atelier.includes('BUILT_IN_PRESETS'), false);
  assert.equal(card.includes('presetBuiltIn'), false, 'no standard sizes group');
  assert.match(atelier, /const allPresets = savedPresets;/);
  for (const locale of ['fr', 'en', 'ar']) {
    assert.equal(read(`src/i18n/messages/${locale}.ts`).includes('presetBuiltIn'), false, locale);
  }
});
