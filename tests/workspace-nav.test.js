const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { renderComponent, loadComponentModule } = require('./helpers/render-component');
const { loadTsModule } = require('./helpers/load-ts-module');

// Owner request, 2026-11-17: the app reads as a few screens (atelier, history,
// then the panel list) joined by one bar, the same on each of them. The bar
// only leads to screens: nothing in it acts on the job on screen.

const SOURCE = 'src/components/WorkspaceNav.tsx';
const KEYS = ['aria', 'atelier', 'atelierShort', 'history', 'historyShort', 'panels', 'panelsShort'];

const { translate } = loadTsModule('src/i18n/index.ts');

function render(props, locale = 'fr') {
  return renderComponent(SOURCE, 'WorkspaceNav', props, locale);
}

/** The opening tag and the content of every link of the bar, in order. */
function links(html) {
  return [...html.matchAll(/<a\b([^>]*)>(.*?)<\/a>/g)].map(([, attributes, content]) => ({
    href: /href="([^"]*)"/.exec(attributes)?.[1],
    current: /aria-current="page"/.test(attributes),
    content,
  }));
}

test('the screen on display is the one marked as current', () => {
  const onHistory = links(render({ current: 'history' }));
  assert.equal(onHistory.find((link) => link.href === '/history').current, true);
  assert.equal(onHistory.find((link) => link.href === '/atelier').current, false);

  const onAtelier = links(render({ current: 'atelier' }));
  assert.equal(onAtelier.find((link) => link.href === '/atelier').current, true);
  assert.equal(onAtelier.find((link) => link.href === '/history').current, false);
});

test('the links come in the order of the entries, the atelier first', () => {
  const { WORKSPACE_ENTRIES } = loadComponentModule(SOURCE);
  const hrefs = WORKSPACE_ENTRIES.map((entry) => entry.href);

  assert.deepEqual(hrefs.slice(0, 2), ['/atelier', '/history']);
  assert.deepEqual(links(render({ current: 'atelier' })).map((link) => link.href), hrefs);
});

test('each link carries its full name, and a short one for a narrow screen', () => {
  const { WORKSPACE_ENTRIES } = loadComponentModule(SOURCE);
  const rendered = links(render({ current: 'atelier' }));

  WORKSPACE_ENTRIES.forEach((entry, index) => {
    const full = translate('fr', entry.label);
    const short = translate('fr', entry.shortLabel);
    assert.match(rendered[index].content, new RegExp(`<span class="hidden sm:inline">${full}</span>`));
    assert.match(rendered[index].content, new RegExp(`<span class="sm:hidden">${short}</span>`));
  });
  assert.match(rendered[0].content, />Atelier débitage</);
  assert.match(rendered[1].content, />Historique des débits</);
});

test('the bar is a named navigation that holds links only', () => {
  const html = render({ current: 'atelier' });

  assert.match(html, /^<nav aria-label="Écrans de l’application"/);
  assert.equal(html.includes('<button'), false, 'nothing in the bar acts on the job');
});

test('what a page adds to the bar comes after the last link, at its end', () => {
  const html = render({ current: 'atelier', children: React.createElement('span', { id: 'figures' }, '244 × 122') });
  const lastLink = html.lastIndexOf('</a>');
  const slot = html.indexOf('ms-auto');

  assert.ok(slot > lastLink, 'the slot follows the links');
  assert.ok(html.indexOf('id="figures"') > slot, 'the page content sits in the slot');
  assert.equal(render({ current: 'atelier' }).includes('ms-auto'), false, 'no empty slot without content');
});

test('the page sets the width of the row, so the bar lines up with its content', () => {
  const html = render({ current: 'history', className: 'max-w-6xl mx-auto px-4 sm:px-8' });

  assert.match(html, /<div class="max-w-6xl mx-auto px-4 sm:px-8">/);
});

test('the bar speaks the language of the visitor', () => {
  assert.match(render({ current: 'atelier' }, 'en'), />Cutting workshop</);
  assert.match(render({ current: 'atelier' }, 'ar'), />ورشة التقطيع</);
});

test('every name of the bar is written in the three languages', () => {
  for (const key of KEYS) {
    const french = translate('fr', `workspaceNav.${key}`);
    assert.notEqual(french, `workspaceNav.${key}`, `fr has ${key}`);
    for (const locale of ['en', 'ar']) {
      assert.notEqual(translate(locale, `workspaceNav.${key}`), french, `${locale} translates ${key}`);
    }
  }
  assert.equal(translate('fr', 'workspaceNav.panels'), 'Configuration des panneaux');
  assert.equal(translate('fr', 'workspaceNav.panelsShort'), 'Panneaux');
});
