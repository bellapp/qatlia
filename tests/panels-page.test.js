const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderComponent, loadComponentModule } = require('./helpers/render-component');
const { loadTsModule } = require('./helpers/load-ts-module');

// Owner request, 2026-11-17: a third screen, « Configuration des panneaux »,
// where the artisan keeps the list of panels they work with. The atelier still
// takes a panel typed by hand; the list is a shortcut.

const read = (file) => fs.readFileSync(path.resolve(file), 'utf8');
const { translate } = loadTsModule('src/i18n/index.ts');
const { EMPTY_PANEL_FORM, panelToForm } = loadTsModule('src/lib/panel-form.ts');

const ROW = 'src/components/panels/PanelRow.tsx';
const FORM = 'src/components/panels/PanelForm.tsx';
const PAGE = 'src/app/(site)/panels/page.tsx';

const OAK = { id: 'p-2', name: 'Chêne clair', height: 280, width: 207, material: 'contreplaques', color: 'Chêne', hasGrain: true, grainOrientation: 'horizontal', pricePerSheet: 540 };
const noop = () => {};

// ─── The bar ────────────────────────────────────────────────────────────────

test('the bar leads to the panel page, third and last', () => {
  const { WORKSPACE_ENTRIES } = loadComponentModule('src/components/WorkspaceNav.tsx');

  assert.deepEqual(WORKSPACE_ENTRIES.map((entry) => entry.href), ['/atelier', '/history', '/panels']);
  const html = renderComponent('src/components/WorkspaceNav.tsx', 'WorkspaceNav', { current: 'panels' });
  assert.match(html, /aria-current="page"[^>]*href="\/panels"/);
  assert.match(html, />Configuration des panneaux</);
  assert.match(html, />Panneaux</);
});

// ─── One panel of the list ──────────────────────────────────────────────────

test('a panel of the list shows what tells it apart, its size in the unit asked', () => {
  const html = renderComponent(ROW, 'PanelRow', { preset: OAK, unit: 'mm', confirmingDelete: false, onEdit: noop, onDelete: noop });

  assert.match(html, /<[a-z0-9]+ dir="auto" class="[^"]*truncate[^"]*"[^>]*>Chêne clair</, 'the name, cut short when too long');
  assert.match(html, /<span dir="ltr"[^>]*>2800\.0 × 2070\.0 mm<\/span>/);
  assert.match(html, />Contreplaqué/);
  assert.match(html, />Chêne</);
  assert.match(html, />Ramage horizontal</);
  assert.match(html, />540 \{currency\}</, 'the price, in the account currency');
});

test('a panel without colour, grain or price shows none of them', () => {
  const html = renderComponent(ROW, 'PanelRow', { preset: { id: 'p-1', name: 'MDF', height: 244, width: 122, material: 'mdf' }, unit: 'cm', confirmingDelete: false, onEdit: noop, onDelete: noop });

  assert.equal(html.includes('Ramage'), false);
  assert.equal(html.includes('{currency}'), false);
});

test('each panel can be edited and removed, the buttons naming it', () => {
  const html = renderComponent(ROW, 'PanelRow', { preset: OAK, unit: 'cm', confirmingDelete: false, onEdit: noop, onDelete: noop });

  assert.match(html, /<button type="button" aria-label="Modifier Chêne clair"[^>]*>[\s\S]*?Modifier<\/span><\/button>/);
  assert.match(html, /<button type="button" aria-label="Supprimer Chêne clair"[^>]*>[\s\S]*?Supprimer<\/span><\/button>/);
});

test('a row can be shown with its buttons waiting', () => {
  const html = renderComponent(ROW, 'PanelRow', { preset: OAK, unit: 'cm', confirmingDelete: false, disabled: true, onEdit: noop, onDelete: noop });

  assert.equal((html.match(/<button[^>]* disabled=""/g) || []).length, 2);
});

test('a panel of the list is a heading under the list heading', () => {
  assert.match(renderComponent(ROW, 'PanelRow', { preset: OAK, unit: 'cm', confirmingDelete: false, onEdit: noop, onDelete: noop }), /<h4 dir="auto"/);
});

test('removing asks once: the second click confirms', () => {
  const html = renderComponent(ROW, 'PanelRow', { preset: OAK, unit: 'cm', confirmingDelete: true, onEdit: noop, onDelete: noop });

  assert.match(html, /aria-label="Confirmer la suppression de Chêne clair"[^>]*>[\s\S]*?Supprimer ce panneau \?/);
});

// ─── The form ───────────────────────────────────────────────────────────────

function renderForm(props = {}) {
  return renderComponent(FORM, 'PanelForm', {
    idPrefix: 'add',
    initial: EMPTY_PANEL_FORM,
    unit: 'cm',
    submitLabel: 'Ajouter à ma liste',
    busy: false,
    error: null,
    onSubmit: noop,
    ...props,
  });
}

test('every field of the form has its label', () => {
  const html = renderForm();
  const ids = [...html.matchAll(/<(?:input|select)[^>]*\sid="([^"]+)"/g)].map(([, id]) => id);

  assert.ok(ids.length >= 7, `fields: ${ids.join(', ')}`);
  for (const id of ids) assert.match(html, new RegExp(`<label[^>]*for="${id}"`), `${id} has a label`);
});

test('the form keeps the name and the colour within what the account stores', () => {
  const html = renderForm();

  assert.match(html, /id="add-name"[^>]*maxLength="80"|maxLength="80"[^>]*id="add-name"/);
  assert.match(html, /id="add-color"[^>]*maxLength="60"|maxLength="60"[^>]*id="add-color"/);
});

test('the grain direction only shows on a grained panel', () => {
  assert.equal(renderForm().includes('Ramage horizontal'), false);
  assert.match(renderForm({ initial: { ...EMPTY_PANEL_FORM, hasGrain: true } }), /Ramage horizontal/);
});

test('a panel opened for editing fills the form, in the unit asked', () => {
  const html = renderForm({ idPrefix: 'edit', initial: panelToForm(OAK, 'mm'), unit: 'mm', submitLabel: 'Enregistrer', onCancel: noop });

  assert.match(html, /value="Chêne clair"/);
  assert.match(html, /value="2800"/);
  assert.match(html, /<option value="contreplaques" selected="">/);
  assert.match(html, />Hauteur \(Y\) — mm</);
  assert.match(html, />Annuler</);
});

test('a material the stock list does not offer still shows on a panel that has it', () => {
  assert.match(renderForm({ initial: { ...EMPTY_PANEL_FORM, material: 'melamine' } }), /<option value="melamine" selected="">/);
});

test('the catalogue panels are offered as shortcuts when adding, by name', () => {
  const { catalogPresetsFor } = loadTsModule('src/lib/panel-catalog.ts');
  const catalogue = catalogPresetsFor('MAD');
  const html = renderForm({ shortcuts: catalogue });

  assert.match(html, />Catalogue QatliA</);
  for (const preset of catalogue) {
    assert.ok(html.includes(`aria-label="Préremplir avec ${preset.name}"`), preset.name);
    assert.ok(html.includes(`>${preset.name}</span>`), `${preset.name} named on its button`);
  }
  assert.equal(renderForm().includes('Catalogue QatliA'), false, 'none when editing');
});

test('a refusal from the list is said in the form', () => {
  assert.match(renderForm({ error: 'Déjà enregistré.' }), /role="alert"[^>]*>Déjà enregistré\./);
});

// ─── The page ───────────────────────────────────────────────────────────────

test('the page shows the shared bar, the list hook and the unit the artisan chose', () => {
  const page = read(PAGE);

  assert.match(page, /^'use client';/);
  assert.match(page, /<WorkspaceNav current="panels" className="max-w-6xl mx-auto px-4 sm:px-8" \/>/);
  assert.match(page, /usePanelPresets\(\)/);
  assert.match(page, /readStoredDisplayUnit\(window\.localStorage\)/);
  assert.match(page, /writeStoredDisplayUnit\(window\.localStorage, /);
  assert.match(page, /shortcuts=\{catalogPresetsFor\(currency\)\}/);
  assert.equal(page.includes('BUILT_IN_PRESETS'), false);
});

test('removing a panel asks a second click, which expires', () => {
  const page = read(PAGE);

  assert.match(page, /const \[confirmingDeleteId, setConfirmingDeleteId\] = useState<string \| null>\(null\);/);
  assert.match(page, /if \(confirmingDeleteId !== id\) \{\s*setConfirmingDeleteId\(id\);/);
  assert.match(page, /window\.setTimeout\(\(\) => setConfirmingDeleteId/);
});

test('signing in from the page comes back to it', () => {
  assert.match(read(PAGE), /href="\/auth\/login\?redirect=\/panels"/);
});

test('the panel page is kept out of search engines', () => {
  assert.ok(loadTsModule('src/lib/seo.ts').PRIVATE_ROUTES.includes('/panels'));
});

test('the atelier and the page offer the same stock materials', () => {
  const { STOCK_MATERIAL_VALUES } = loadTsModule('src/lib/panel-form.ts');

  assert.deepEqual([...STOCK_MATERIAL_VALUES], ['mdf', 'melamine', 'aluminium', 'verre', 'contreplaques'], 'the catalogue’s melamine among them');
  const atelier = read('src/app/(site)/atelier/page.tsx');
  assert.equal(atelier.includes("const STOCK_MATERIAL_VALUES"), false, 'one list, shared');
  assert.match(atelier, /import \{[^}]*STOCK_MATERIAL_VALUES[^}]*\} from '@\/lib\/panel-form';/);
});

// ─── The words ──────────────────────────────────────────────────────────────

const flatten = (value, prefix = '') =>
  Object.entries(value).flatMap(([key, inner]) =>
    typeof inner === 'string' ? [[`${prefix}${key}`, inner]] : flatten(inner, `${prefix}${key}.`)
  );
const catalogs = Object.fromEntries(
  ['fr', 'en', 'ar'].map((locale) => [locale, Object.fromEntries(flatten(loadTsModule(`src/i18n/messages/${locale}.ts`)[locale].panelsPage ?? {}))])
);
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map(([, name]) => name).sort();

test('every word of the page exists in the three languages, with the same blanks', () => {
  const keys = Object.keys(catalogs.fr);
  assert.ok(keys.length >= 20, `panelsPage has ${keys.length} keys`);
  for (const locale of ['en', 'ar']) {
    assert.deepEqual(Object.keys(catalogs[locale]).sort(), [...keys].sort(), `${locale} has the same keys`);
    for (const key of keys) {
      assert.deepEqual(placeholders(catalogs[locale][key]), placeholders(catalogs.fr[key]), `${locale} ${key}`);
      assert.notEqual(catalogs[locale][key], catalogs.fr[key], `${locale} translates ${key}`);
    }
  }
  for (const [key, text] of Object.entries(catalogs.ar)) {
    assert.match(text, /[؀-ۿ]/, `ar ${key} is written in Arabic`);
  }
  assert.equal(catalogs.fr.heading, 'Configuration des panneaux');
  assert.equal(catalogs.fr.subtitle, 'La liste des panneaux avec lesquels vous travaillez. Vous les retrouvez dans l’atelier, au moment de choisir le panneau d’un débit.');
});

test('the page asks the same question in French before it removes a panel', () => {
  assert.equal(translate('fr', 'panelsPage.confirmDelete'), 'Supprimer ce panneau ?');
  assert.equal(translate('fr', 'panelsPage.empty'), 'Aucun panneau enregistré. Ajoutez le premier : vous n’aurez plus à ressaisir ses dimensions.');
  assert.equal(translate('fr', 'panelsPage.deviceNote'), 'Cette liste est gardée sur cet appareil. Connectez-vous pour la retrouver partout.');
});

// Review, 2026-11-17.

test('signed in with the account out of reach, the page says so and writes nothing', () => {
  const page = read(PAGE);

  assert.match(page, /const accountOutOfReach = ready && signedIn && source === 'device';/);
  assert.match(page, /\{accountOutOfReach \? \(/);
  assert.match(page, /t\('panelsPage\.accountUnreachable'\)/);
  assert.match(page, /const locked = !ready \|\| accountOutOfReach;/);
  assert.match(page, /busy=\{adding \|\| locked\}/, 'the add form waits');
  assert.match(page, /disabled=\{locked\}/, 'and so do the rows');
  assert.equal(translate('fr', 'panelsPage.accountUnreachable'), 'Votre compte ne répond pas pour l’instant. Rechargez la page dans un moment pour modifier votre liste.');
});

test('what happened is said on screen, where the artisan is looking', () => {
  const page = read(PAGE);

  assert.equal(page.includes('className="sr-only">{notice}'), false, 'not for screen readers only');
  assert.match(page, /<p role="status" aria-live="polite"[^>]*>\{notice\.where === 'add' \? notice\.text : ''\}<\/p>/, 'under the add form');
  assert.match(page, /<p role="status" aria-live="polite"[^>]*>\{notice\.where === 'list' \? notice\.text : ''\}<\/p>/, 'above the list');
  assert.match(page, /setNotice\(\{ where: 'list', text: t\(removed \? 'atelier\.stock\.presetDeleted' : 'panelsPage\.deleteFailed'\), tone: removed \? 'success' : 'warning' \}\);/);
});

test('a whole-panel edit that fails unexpectedly still answers as the route does', () => {
  assert.match(read('src/app/api/panel-presets/[id]/route.ts'), /return await updateWholePreset\(user\.id, id, raw\);/);
});

test('melamine is called melamine, whatever its colour', () => {
  assert.equal(translate('fr', 'materials.melamine'), 'Mélaminé');
  assert.equal(translate('en', 'materials.melamine'), 'Melamine');
  assert.equal(translate('ar', 'materials.melamine'), 'ميلامين');
  const { getMaterialDef } = loadTsModule('src/lib/cutting/binpacking.ts');
  assert.equal(getMaterialDef('melamine').label, 'Mélaminé', 'in the PDF too');
});
