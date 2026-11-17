const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// User request, 2026-11-16 and 17: the bar under the header looked like tabs
// to other screens, while "Matériaux" and "Réglages de coupe" only scrolled
// the same page, the second one to a folded block under the pieces. The
// settings now sit on the main screen, in the card of the panel they apply
// to, and the left column reads in the order of the work: the scan, the
// pieces it gave, the panel they are cut from, then the run.

const page = fs.readFileSync(path.resolve('src/app/(site)/atelier/page.tsx'), 'utf8');
const panel = fs.readFileSync(path.resolve('src/components/OptionsPanel.tsx'), 'utf8');

/** Where each block of the left column starts. */
function leftColumn() {
  const at = (marker) => {
    const index = page.indexOf(marker);
    assert.ok(index > 0, `the atelier has ${marker}`);
    return index;
  };
  return {
    scan: at('Quick Actions: Hero Cards'),
    scanPreview: at('<ScanSheets'),
    pieces: at('<PiecesManager'),
    stock: at('id="stock-card"'),
    blade: at('part="blade"'),
    rest: at('part="rest"'),
    run: at('Primary CTA Button'),
  };
}

test('the pieces come right after the scan, ahead of the panel', () => {
  const { scan, scanPreview, pieces, stock, run } = leftColumn();

  assert.ok(scan < scanPreview && scanPreview < pieces, 'the pieces follow the scanned sheet');
  assert.ok(pieces < stock, 'the panel comes after the pieces');
  assert.ok(stock < run, 'the run closes the column');
});

test('the blade and the edge margin are set in the card of the panel', () => {
  const { stock, blade, rest, run } = leftColumn();

  assert.ok(stock < blade && blade < rest && rest < run, 'both parts of the settings are in the panel card');
  const settings = page.slice(page.lastIndexOf('<div', page.indexOf('id="cut-settings"')), blade);
  assert.ok(settings.includes('id="cut-settings"'), 'the settings have their place in the card');
  assert.ok(settings.includes("t('atelier.advanced.title')"), 'they are named');
});

test('the blade and the margin show without unfolding anything', () => {
  const { blade } = leftColumn();
  const toggle = page.indexOf('aria-controls="advanced-cutting-options"');
  const folded = page.indexOf('id="advanced-cutting-options"');

  assert.ok(toggle > 0 && folded > 0, 'the rarer settings still unfold');
  assert.ok(blade < toggle, 'the blade and the margin are ahead of the fold');
  assert.ok(page.indexOf('part="rest"') > folded, 'the rarer settings are the folded ones');
  assert.equal(page.match(/<OptionsPanel\b/g).length, 2, 'the settings are shown in two parts, once each');
});

test('the settings panel can show its two parts apart', () => {
  assert.match(panel, /part\?: 'blade' \| 'rest';/);
  // The blade part is the kerf and the edge margin; the rest is all the others.
  const kerf = panel.indexOf("t('options.kerf.title')");
  const margin = panel.indexOf("t('options.margin.title')");
  const priority = panel.indexOf("t('options.priority.tooltip')");
  const bladeGuard = panel.indexOf("{part !== 'rest' && (");
  const restGuard = panel.indexOf("{part !== 'blade' && (");

  assert.ok(bladeGuard > 0 && restGuard > 0, 'each part has its guard');
  assert.ok(bladeGuard < kerf && kerf < margin && margin < restGuard, 'the kerf and the margin are the blade part');
  assert.ok(restGuard < priority, 'the goal, the switches and the prices are the rest');
});

test('the bar no longer carries entries that only scroll the page', () => {
  for (const gone of ['navOptimization', 'navMaterials', 'navCutSettings', 'href="#plan-top"', 'href="#stock-card"', 'openAdvancedOptions']) {
    assert.equal(page.includes(gone), false, `${gone} is gone`);
  }
  for (const locale of ['fr', 'en', 'ar']) {
    const messages = fs.readFileSync(path.resolve(`src/i18n/messages/${locale}.ts`), 'utf8');
    assert.doesNotMatch(messages, /navOptimization|navMaterials|navCutSettings/, `${locale} keeps no label for them`);
  }
});

test('the blade figure of the bar leads to the blade setting', () => {
  const chip = page.indexOf("t('options.kerf.chip'");
  assert.ok(chip > 0);
  const tag = page.slice(page.lastIndexOf('<a', chip), chip);

  assert.ok(tag.startsWith('<a'), 'the figure is a link');
  assert.ok(tag.includes('href="#cut-settings"'));
  // The sticky header and bar cover the top of the page: the target clears them.
  const target = page.slice(page.lastIndexOf('<div', page.indexOf('id="cut-settings"')), page.indexOf('>', page.indexOf('id="cut-settings"')));
  assert.match(target, /scroll-mt-/);
});

test('the fold and the settings are named in the three languages', () => {
  for (const [locale, title, toggle] of [
    ['fr', 'Réglages de coupe', 'Plus de réglages'],
    ['en', 'Cutting settings', 'More settings'],
    ['ar', 'إعدادات القطع', 'إعدادات أخرى'],
  ]) {
    const messages = fs.readFileSync(path.resolve(`src/i18n/messages/${locale}.ts`), 'utf8');
    assert.ok(messages.includes(`title: '${title}',\n`) || messages.includes(`title: '${title}',\r\n`), `${locale} names the settings`);
    assert.ok(messages.includes(`toggle: '${toggle}',`), `${locale} names the fold`);
  }
});
