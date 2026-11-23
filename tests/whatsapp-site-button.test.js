const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

// The WhatsApp button of the site (spec 2026-11-23): mounted once for every
// page, floating where nothing is being worked on, in the bar of the work
// pages, never over a dialog nor over the keyboard.

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
const component = read('src/components/WhatsAppContact.tsx');

test('the floating button is mounted once, for every page of both layouts', () => {
  const shell = read('src/components/ClientShell.tsx');
  assert.match(shell, /<WhatsAppFloating\s*\/>/);
  for (const layout of ['src/app/(site)/layout.tsx', 'src/app/(ar)/layout.tsx']) {
    assert.match(read(layout), /<ClientShell/, layout);
  }
});

test('the floating button sits under the dialogs, at the end side, above the phone bar', () => {
  const floating = component.slice(component.indexOf('export function WhatsAppFloating'));
  const className = floating.match(/className="([^"]*)"/)[1];
  for (const token of ['fixed', 'z-40', 'end-4', 'rounded-full', 'bg-[#25D366]', 'print:hidden']) {
    assert.ok(className.split(/\s+/).includes(token), token);
  }
  assert.match(className, /bottom-\[calc\([^\]]*env\(safe-area-inset-bottom\)\)\]/);
});

test('each button shows only where the page says so', () => {
  assert.match(component, /placementFor\(/);
  assert.match(component, /usePathname\(\)/);
  assert.match(component, /placement\.kind !== 'floating'/);
  assert.match(component, /placement\.kind !== 'header'/);
});

test('the floating button steps aside while the person types', () => {
  assert.match(component, /'focusin'/);
  assert.match(component, /'focusout'/);
  assert.match(component, /INPUT|TEXTAREA|SELECT/);
});

test('the links open WhatsApp in a new tab, safely, with a label in every language', () => {
  const links = component.match(/<a\b[\s\S]*?>/g) ?? [];
  assert.equal(links.length, 2);
  for (const link of links) {
    assert.match(link, /href=\{whatsappLink\(placement\.topic, locale\)\}/);
    assert.match(link, /target="_blank"/);
    assert.match(link, /rel="noopener noreferrer"/);
    assert.match(link, /aria-label=\{t\('support\.whatsappButton'\)\}/);
  }
  for (const locale of ['fr', 'en', 'ar']) {
    const messages = loadTsModule(path.resolve(__dirname, '..', `src/i18n/messages/${locale}.ts`))[locale];
    assert.equal(typeof messages.support.whatsappButton, 'string', locale);
  }
});

test('the bar of the work pages carries the header button', () => {
  const nav = read('src/components/WorkspaceNav.tsx');
  assert.match(nav, /<WhatsAppHeaderButton\s*\/>/);
  // Only on the work screens, so the bar keeps no empty slot elsewhere.
  assert.match(nav, /placementFor\(usePathname\(\) \?\? '\/'\)\.kind === 'header'/);
  assert.match(nav, /\{children \|\| contact \?/);
});
