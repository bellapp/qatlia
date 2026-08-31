const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// Task 8 — the FR/AR label catalog for the generated quotation PDF, mirroring
// src/lib/exports/pdf-catalog.ts's "French sets the shape" pattern but scoped
// to the two locales the quotation document is ever rendered in.

function loadCatalog() {
  return loadTsModule('src/lib/exports/quotation-catalog.ts');
}

function leafPaths(node, prefix = '') {
  return Object.entries(node).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'function') return [path]; // parameterized label
    if (typeof value === 'string') return [path];
    if (value && typeof value === 'object') return leafPaths(value, path);
    return [];
  });
}

test('quotationCatalogs exposes exactly fr and ar (never en — the PDF is FR/AR only)', () => {
  const { quotationCatalogs } = loadCatalog();
  assert.deepEqual(Object.keys(quotationCatalogs).sort(), ['ar', 'fr']);
});

test('the ar catalog has exactly the same leaf keys as the fr catalog (no missing/extra key)', () => {
  const { quotationCatalogs } = loadCatalog();
  const frPaths = leafPaths(quotationCatalogs.fr).sort();
  const arPaths = leafPaths(quotationCatalogs.ar).sort();
  assert.deepEqual(arPaths, frPaths);
});

test('every ar leaf string actually contains Arabic script (no leftover French/English placeholder)', () => {
  const { quotationCatalogs } = loadCatalog();
  const ARABIC = /[؀-ۿ]/;
  // ICE/IF are Moroccan business-registry acronyms, kept verbatim in every
  // locale exactly like the "MAD" currency code — not a missed translation.
  const ACRONYM_KEYS = new Set(['iceLabel', 'taxIdLabel']);
  for (const path of leafPaths(quotationCatalogs.ar)) {
    if (ACRONYM_KEYS.has(path)) continue;
    const segments = path.split('.');
    let node = quotationCatalogs.ar;
    for (const s of segments) node = node[s];
    if (typeof node === 'function') continue; // parameterized — checked via a sample call below
    assert.match(node, ARABIC, `ar.${path} must contain Arabic script, got "${node}"`);
  }
});

test('quotationCatalogFor falls back to fr for an unsupported locale rather than throwing', () => {
  const { quotationCatalogFor } = loadCatalog();
  assert.equal(quotationCatalogFor('en'), quotationCatalogFor('fr'));
});

test('quotationCatalogFor resolves ar independently of fr', () => {
  const { quotationCatalogFor } = loadCatalog();
  assert.notEqual(quotationCatalogFor('ar').documentTitle, quotationCatalogFor('fr').documentTitle);
});

// ─── Task 8 remediation — items 1/2: panels/pieces detail table + pagination
// labels must exist and be parameterized functions, not hardcoded strings ──

test('both catalogs expose panels/pieces detail-table section titles and column labels', () => {
  const { quotationCatalogs } = loadCatalog();
  for (const locale of ['fr', 'ar']) {
    const cat = quotationCatalogs[locale];
    assert.equal(typeof cat.panelsTitle, 'string');
    assert.equal(typeof cat.piecesTitle, 'string');
    assert.equal(typeof cat.panelsColumnRef, 'string');
    assert.equal(typeof cat.panelsColumnMaterial, 'string');
    assert.equal(typeof cat.panelsColumnDimension, 'string');
    assert.equal(typeof cat.panelsColumnQuantity, 'string');
    assert.equal(typeof cat.piecesColumnNumber, 'string');
    assert.equal(typeof cat.piecesColumnName, 'string');
    assert.equal(typeof cat.piecesColumnDimension, 'string');
    assert.equal(typeof cat.piecesColumnQuantity, 'string');
    assert.equal(typeof cat.piecesColumnEdge, 'string');
  }
});

test('both catalogs expose a parameterized pageIndicator(page, total)', () => {
  const { quotationCatalogs } = loadCatalog();
  assert.equal(quotationCatalogs.fr.pageIndicator(1, 3), 'Page 1 / 3');
  assert.match(quotationCatalogs.ar.pageIndicator(1, 3), /1.*3|3.*1/);
  assert.notEqual(quotationCatalogs.ar.pageIndicator(2, 5), quotationCatalogs.fr.pageIndicator(2, 5));
});

test('MAD (the currency code) is never translated in either catalog', () => {
  const { quotationCatalogs } = loadCatalog();
  for (const locale of ['fr', 'ar']) {
    const source = JSON.stringify(quotationCatalogs[locale]);
    assert.doesNotMatch(source, /درهم مغربي|درهم مغربى/, `${locale} catalog must use the "MAD" code, not a translated currency name, for consistency with the rest of the app`);
  }
});
