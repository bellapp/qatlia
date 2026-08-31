const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// pdfCatalogFor() is the single source of every label /api/export-pdf draws.
// It must offer the exact same set of keys in fr/en/ar (enforced at compile
// time by src/lib/exports/pdf-catalog.ts's `PdfCatalog` type — these tests
// pin the *runtime* contract other code actually calls into).

function load() {
  return loadTsModule('src/lib/exports/pdf-catalog.ts');
}

// Walks an object tree and collects every leaf's dotted path, treating a
// function leaf as terminal (its parameters aren't part of the "shape").
function leafPaths(node, prefix = '') {
  if (typeof node === 'function' || typeof node !== 'object' || node === null) {
    return [prefix];
  }
  return Object.keys(node)
    .sort()
    .flatMap((key) => leafPaths(node[key], prefix ? `${prefix}.${key}` : key));
}

test('fr, en and ar expose the exact same set of leaf keys', () => {
  const { pdfCatalogs } = load();
  const frKeys = leafPaths(pdfCatalogs.fr);
  const enKeys = leafPaths(pdfCatalogs.en);
  const arKeys = leafPaths(pdfCatalogs.ar);

  assert.deepEqual(enKeys, frKeys, 'en catalog must have exactly the fr catalog\'s keys, no more, no less');
  assert.deepEqual(arKeys, frKeys, 'ar catalog must have exactly the fr catalog\'s keys, no more, no less');
});

test('every leaf is either a non-empty string or a function, in all three locales', () => {
  const { pdfCatalogs } = load();
  for (const locale of ['fr', 'en', 'ar']) {
    for (const path of leafPaths(pdfCatalogs[locale])) {
      const segments = path.split('.');
      let node = pdfCatalogs[locale];
      for (const seg of segments) node = node[seg];
      assert.ok(
        typeof node === 'function' || (typeof node === 'string' && node.length > 0),
        `${locale}.${path} must be a non-empty string or a function, got ${JSON.stringify(node)}`
      );
    }
  }
});

test('pdfCatalogFor returns the matching locale catalog, and falls back to fr for an unknown locale', () => {
  const { pdfCatalogFor, pdfCatalogs } = load();
  assert.equal(pdfCatalogFor('fr'), pdfCatalogs.fr);
  assert.equal(pdfCatalogFor('en'), pdfCatalogs.en);
  assert.equal(pdfCatalogFor('ar'), pdfCatalogs.ar);
  assert.equal(pdfCatalogFor('xx'), pdfCatalogs.fr);
});

test('the ar catalog\'s brand and currency labels keep "MAD" untranslated, matching the app-wide convention', () => {
  const { pdfCatalogs } = load();
  assert.match(pdfCatalogs.ar.currencyLabel, /MAD/);
  assert.match(pdfCatalogs.ar.recap.financialHeader, /MAD/);
});

test('the ar catalog\'s string leaves actually contain Arabic-script characters (not left untranslated as fr/en copies)', () => {
  const { pdfCatalogs } = load();
  const ARABIC = /[؀-ۿ]/;
  // "brand" is the product name (QatlIA Pro 2026) -- a proper noun, never
  // translated in any locale, exactly like the "MAD" currency code (see the
  // module doc comment in pdf-catalog.ts).
  const UNTRANSLATED = new Set(['brand']);
  for (const path of leafPaths(pdfCatalogs.ar)) {
    if (UNTRANSLATED.has(path)) continue;
    const segments = path.split('.');
    let node = pdfCatalogs.ar;
    for (const seg of segments) node = node[seg];
    if (typeof node !== 'string') continue; // functions checked via sample calls below
    assert.match(node, ARABIC, `ar.${path} ("${node}") must contain Arabic script`);
  }
  // Spot-check a couple of the function leaves too, since a template literal
  // hides its Arabic text behind Function.prototype.toString() otherwise.
  assert.match(pdfCatalogs.ar.schema.multipleSamples(3), ARABIC);
  assert.match(pdfCatalogs.ar.cuttingList.columnDimension('cm'), ARABIC);
});

test('parameterized labels interpolate their arguments correctly in every locale', () => {
  const { pdfCatalogs } = load();
  for (const locale of ['fr', 'en', 'ar']) {
    const c = pdfCatalogs[locale];
    assert.match(c.pageIndicator(2, 5), /2/);
    assert.match(c.pageIndicator(2, 5), /5/);
    assert.match(c.cuttingList.columnDimension('mm'), /mm/);
    assert.match(c.schema.multipleSamples(7), /7/);
    const header = c.schema.header(1, 3, 'MDF', '200.0 × 100.0 cm', c.schema.uniqueSample);
    assert.match(header, /1/);
    assert.match(header, /3/);
    assert.match(header, /MDF/);
    assert.match(header, /200\.0 × 100\.0 cm/);
  }
});
