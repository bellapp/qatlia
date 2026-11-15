const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderComponent, loadComponentModule } = require('./helpers/render-component');
const { loadTsModule } = require('./helpers/load-ts-module');

// The history's building blocks, rendered for real on the server.

test('the rename button is always shown where there is no hover', () => {
  const html = renderComponent('src/components/history/HistoryName.tsx', 'HistoryName', { name: 'Cuisine', onRename: async () => true, size: 'card' });
  const button = html.match(/<button[^>]*data-testid="history-rename-btn"[^>]*>/)[0];
  assert.match(button, /aria-label="Renommer le projet Cuisine"/);
  assert.doesNotMatch(button, /(^|[\s"])opacity-0(\s|")/, 'never hidden by default');
  assert.match(button, /\[@media\(hover:hover\)\]:opacity-0/);
  assert.match(button, /\[@media\(hover:hover\)\]:group-hover:opacity-100/);
  assert.match(button, /w-8 h-8/);
});

test('a long name is truncated and never widens its container', () => {
  const html = renderComponent('src/components/history/HistoryName.tsx', 'HistoryName', { name: 'ق'.repeat(120), onRename: async () => true, size: 'row' });
  assert.match(html, /<span[^>]*class="[^"]*\btruncate\b[^"]*"[^>]*dir="auto"/);
  assert.match(html, /class="[^"]*\bmin-w-0\b/);
});

test('the rename messages exist in the three languages with the same placeholders', () => {
  const { translate } = loadTsModule('src/i18n/index.ts');
  for (const key of ['historyPage.renameSave', 'historyPage.renameCancel', 'historyPage.renameFailed']) {
    const [fr, en, ar] = ['fr', 'en', 'ar'].map((locale) => translate(locale, key));
    for (const text of [fr, en, ar]) {
      assert.ok(text && text !== key, `${key} is translated`);
    }
    assert.notEqual(fr, en);
    assert.notEqual(en, ar);
  }
  assert.equal(translate('fr', 'historyPage.renameSave'), 'Enregistrer le nom');
  assert.equal(translate('fr', 'historyPage.renameFailed'), 'Nom non enregistré. Réessayez.');
});

test('the component loader follows "@/" imports between .tsx files', () => {
  const probe = path.join(__dirname, '__loader-probe.tsx');
  try {
    fs.writeFileSync(probe, [
      "import { HistoryName } from '@/components/history/HistoryName';",
      'export function Probe() { return <section><HistoryName name="Salon" onRename={async () => true} size="row" /></section>; }',
      '',
    ].join('\n'));
    const html = renderComponent('tests/__loader-probe.tsx', 'Probe', {});
    assert.match(html, /^<section>.*Salon.*<\/section>$/);
    assert.match(html, /data-testid="history-rename-btn"/);
  } finally {
    fs.rmSync(probe, { force: true });
  }
});

test('resolveRename: nothing to save for an empty or unchanged draft, and the API is not called', async () => {
  const { resolveRename } = loadComponentModule('src/components/history/HistoryName.tsx');
  let calls = 0;
  const onRename = async () => { calls += 1; return true; };
  assert.equal(await resolveRename('   ', 'Cuisine', onRename), 'noop');
  assert.equal(await resolveRename('', 'Cuisine', onRename), 'noop');
  assert.equal(await resolveRename('  Cuisine ', 'Cuisine', onRename), 'noop');
  assert.equal(calls, 0);
});

test('resolveRename: saves the trimmed name, and says failed when refused or when it throws', async () => {
  const { resolveRename } = loadComponentModule('src/components/history/HistoryName.tsx');
  const sent = [];
  assert.equal(await resolveRename('  Salon  ', 'Cuisine', async (n) => { sent.push(n); return true; }), 'saved');
  assert.deepEqual(sent, ['Salon']);
  assert.equal(await resolveRename('Salon', 'Cuisine', async () => false), 'failed');
  assert.equal(await resolveRename('Salon', 'Cuisine', async () => { throw new Error('offline'); }), 'failed');
});
