const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Owner request, 2026-11-17: the bar under the header is the same on every
// screen and only leads from one screen to another. The quotation entry, greyed
// until a plan existed and a double of the button under the plan, leaves it;
// so do the second ways to the history and back to the atelier.

const read = (file) => fs.readFileSync(path.resolve(file), 'utf8');
const atelier = read('src/app/(site)/atelier/page.tsx');
const history = read('src/app/(site)/history/page.tsx');

/** How many times `needle` appears in `text`. */
const count = (text, needle) => text.split(needle).length - 1;

/** What the atelier puts inside the shared bar. */
function atelierBar() {
  const start = atelier.indexOf('<WorkspaceNav current="atelier"');
  const end = atelier.indexOf('</WorkspaceNav>', start);
  assert.ok(start > 0 && end > start, 'the atelier renders the shared bar with content of its own');
  return atelier.slice(start, end);
}

test('the atelier shows the shared bar right under its header, outside the page content', () => {
  const header = atelier.indexOf('</header>');
  const bar = atelier.indexOf('<WorkspaceNav current="atelier"');
  const main = atelier.indexOf('<main ');

  assert.ok(header > 0 && bar > header && main > bar, 'header, then the bar, then the content');
  assert.equal(count(atelier, '<nav'), 0, 'the atelier no longer builds a bar of its own');
});

test('the atelier bar holds no action and the atelier no second way to the history', () => {
  assert.equal(atelier.includes('atelier.sidebar'), false);
  assert.equal(atelier.includes('navQuotation'), false);
  assert.equal(atelier.includes('href="/history"'), false, 'the shared bar is the way to the history');
  assert.equal(atelierBar().includes('<button'), false);
});

test('the machine figures stay at the end of the atelier bar', () => {
  const bar = atelierBar();

  assert.ok(bar.includes('Machine setup figures'));
  assert.ok(bar.includes('formatDisplayValue(activeSheet.height, displayUnit)'), 'the panel size');
  assert.ok(bar.includes('href="#cut-settings"'), 'the blade chip leads to where the blade is set');
  assert.equal(bar.includes('ms-auto'), false, 'the bar itself pushes them to its end');
});

test('the quotation opens from one place, the button under the plan', () => {
  assert.equal(count(atelier, 'setIsQuotationDialogOpen(true)'), 1);
  assert.ok(atelier.indexOf('setIsQuotationDialogOpen(true)') > atelier.indexOf('</WorkspaceNav>'));
});

test('the history shows the shared bar and no longer a way back of its own', () => {
  const header = history.indexOf('</header>');
  const bar = history.indexOf('<WorkspaceNav current="history"');
  const main = history.indexOf('<main ');

  assert.ok(header > 0 && bar > header && main > bar, 'header, then the bar, then the content');
  assert.equal(history.includes('historyPage.backToAtelier'), false);
  assert.equal(history.includes('href="/atelier"'), false, 'the shared bar is the way back');
});

test('the catalogs no longer name the entries the bar lost', () => {
  for (const locale of ['fr', 'en', 'ar']) {
    const messages = read(`src/i18n/messages/${locale}.ts`);
    assert.equal(messages.includes('navQuotation'), false, `${locale} drops the quotation entry`);
    assert.equal(messages.includes('navHistory'), false, `${locale} drops the old history entry`);
    assert.equal(messages.includes('sidebar: {'), false, `${locale} drops the old bar`);
  }
});
