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

// The two views of the list: cards, or a table that becomes a compact list on
// a phone. Both are fed the same rows, built by the real `toHistoryRow`.

const TINY_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/';

function savedResult() {
  const { optimizeCutting2D, DEFAULT_STOCK_SHEET, OPTIONS_DEFAULTS } = loadTsModule('src/lib/cutting/binpacking.ts');
  const pieces = [{ id: 'a', name: 'Côté', height: 70, width: 40, quantity: 3 }];
  return JSON.parse(JSON.stringify(optimizeCutting2D(pieces, [DEFAULT_STOCK_SHEET], OPTIONS_DEFAULTS)));
}

const { toHistoryRow } = loadTsModule('src/lib/projects/history-row.ts');

const fullRow = toHistoryRow({
  id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d', name: 'Cuisine Alami', material: 'mdf',
  sheet_width: 206, sheet_height: 279, created_at: '2026-11-13T18:40:00.000Z',
  options_json: { pieces: [{ quantity: 3 }], result: savedResult(), scanThumb: TINY_JPEG, pdfGeneratedAt: '2026-11-13T18:45:00.000Z' },
});

const legacyRow = toHistoryRow({
  id: 'optimize_1699999999999', name: 'Ancien placard', material: 'mdf',
  sheet_width: 206, sheet_height: 279, created_at: '2023-11-14T22:13:19.999Z', options_json: undefined,
});

function listProps(rows) {
  return { rows, onOpen: () => {}, onRename: async () => true, onDownloadPdf: () => {}, onViewScan: () => {} };
}

test('both views show the same projects, each with its open action', () => {
  for (const [file, name] of [['HistoryCards', 'HistoryCards'], ['HistoryTable', 'HistoryTable']]) {
    const html = renderComponent(`src/components/history/${file}.tsx`, name, listProps([fullRow, legacyRow]));
    assert.equal((html.match(/data-testid="history-open"/g) || []).length, 2);
    assert.match(html, /aria-label="Ouvrir Cuisine Alami"/);
  }
});

test('an old project shows dashes instead of invented figures', () => {
  const html = renderComponent('src/components/history/HistoryTable.tsx', 'HistoryTable', listProps([legacyRow]));
  assert.doesNotMatch(html, />0%</);
  assert.match(html, /data-col="waste"[^>]*>—</);
  assert.doesNotMatch(html, /data-testid="history-pdf"/);
  assert.doesNotMatch(html, /data-testid="history-scan"/);
});

test('the table is a real table from 640px and a compact list below', () => {
  const html = renderComponent('src/components/history/HistoryTable.tsx', 'HistoryTable', listProps([fullRow]));
  assert.match(html, /<table[^>]*class="[^"]*\bhidden sm:table\b/);
  assert.match(html, /<ul[^>]*data-testid="history-compact"[^>]*class="[^"]*\bsm:hidden\b/);
  assert.equal((html.match(/<th[\s>]/g) || []).length, 9);
});

test('the toggle says which view is on', () => {
  const html = renderComponent('src/components/history/HistoryViewToggle.tsx', 'HistoryViewToggle', { view: 'table', onChange: () => {} });
  assert.match(html, /aria-label="Tableau"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*aria-label="Tableau"/);
  assert.match(html, /aria-label="Cartes"[^>]*aria-pressed="false"|aria-pressed="false"[^>]*aria-label="Cartes"/);
});

test('a full project offers its scan and its PDF in both views, and its figures', () => {
  for (const [file, name] of [['HistoryCards', 'HistoryCards'], ['HistoryTable', 'HistoryTable']]) {
    const html = renderComponent(`src/components/history/${file}.tsx`, name, listProps([fullRow]));
    assert.equal((html.match(/data-testid="history-scan"/g) || []).length, 1, `${name}: one scan control`);
    assert.equal((html.match(/data-testid="history-pdf"/g) || []).length, 1, `${name}: one PDF button`);
    assert.match(html, /aria-label="Voir la fiche scannée de Cuisine Alami"/);
    assert.match(html, new RegExp(`>${fullRow.wastePercentage.toLocaleString('fr-FR', { maximumFractionDigits: 1 }).replace(/\s/g, '\s')}%<`));
  }
  assert.ok(fullRow.wastePercentage > 0, 'the fixture has a real waste figure');
});

test('the old project in the cards also shows dashes, and no scan or PDF', () => {
  const html = renderComponent('src/components/history/HistoryCards.tsx', 'HistoryCards', listProps([legacyRow]));
  assert.doesNotMatch(html, />0%</);
  assert.match(html, /data-col="waste"[^>]*>—</);
  assert.match(html, /data-col="pieces"[^>]*>—</);
  assert.doesNotMatch(html, /data-testid="history-pdf"/);
  assert.doesNotMatch(html, /data-testid="history-scan"/);
});

test('the open and PDF buttons are at least 40px high, the compact open button 40px square', () => {
  const cards = renderComponent('src/components/history/HistoryCards.tsx', 'HistoryCards', listProps([fullRow]));
  for (const id of ['history-open', 'history-pdf']) {
    const button = cards.match(new RegExp(`<button[^>]*data-testid="${id}"[^>]*>`))[0];
    assert.match(button, /\bmin-h-10\b/, `card ${id}`);
  }
  assert.match(cards.match(/<button[^>]*data-testid="history-open"[^>]*>/)[0], /\bw-full sm:w-auto\b/, 'open is full width on a phone');
  const table = renderComponent('src/components/history/HistoryTable.tsx', 'HistoryTable', listProps([fullRow]));
  const compactOpen = table.match(/<button[^>]*data-testid="history-open-compact"[^>]*>/)[0];
  assert.match(compactOpen, /\bw-10 h-10\b/);
  assert.match(compactOpen, /aria-label="Ouvrir Cuisine Alami"/);
});

test('the material and panel columns give way under 1024px', () => {
  const html = renderComponent('src/components/history/HistoryTable.tsx', 'HistoryTable', listProps([fullRow]));
  for (const col of ['material', 'panel']) {
    const cells = html.match(new RegExp(`<t[hd][^>]*data-col="${col}"[^>]*>`, 'g'));
    assert.equal(cells.length, 2, `${col}: one header, one cell`);
    for (const cell of cells) assert.match(cell, /\bhidden lg:table-cell\b/);
  }
});

test('the view names exist in the three languages', () => {
  const { translate } = loadTsModule('src/i18n/index.ts');
  assert.deepEqual(['fr', 'en', 'ar'].map((l) => translate(l, 'historyPage.view.cards')), ['Cartes', 'Cards', 'بطاقات']);
  assert.deepEqual(['fr', 'en', 'ar'].map((l) => translate(l, 'historyPage.view.table')), ['Tableau', 'Table', 'جدول']);
  const html = renderComponent('src/components/history/HistoryViewToggle.tsx', 'HistoryViewToggle', { view: 'cards', onChange: () => {} }, 'ar');
  assert.match(html, /aria-label="بطاقات"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*aria-label="بطاقات"/);
});

test('an old project with no saved data still opens from the history', () => {
  const page = fs.readFileSync(path.resolve('src/app/(site)/history/page.tsx'), 'utf8');
  const load = page.slice(page.indexOf('const handleLoadProject'), page.indexOf('const handleDownloadPdf'));
  assert.ok(load.length > 0);
  assert.doesNotMatch(load, /if \(project\?\.options_json\)/, 'no data is not a reason to do nothing');
  assert.match(load, /if \(project\) \{/);
  assert.match(load, /project\.options_json\?\.projectName/);
  assert.match(load, /: project\.options_json \?\? \{\};/);
  assert.match(load, /window\.location\.href = '\/atelier'/);
});
