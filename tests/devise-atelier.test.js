const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// One currency for the whole account (user decision, 2026-11-15): the atelier,
// the cut-plan PDF and the quote are priced in it. The catalog prices are
// dirham figures, converted at a fixed rate for a euro or dollar account
// (1 € = 10.8 DH, 1 $ = 10 DH); prices the artisan typed are never converted.

test('a dirham catalog price converts at the fixed rate, to the cent', () => {
  const { catalogPriceIn } = loadTsModule('src/lib/currency.ts');
  assert.equal(catalogPriceIn(120, 'MAD'), 120);
  assert.equal(catalogPriceIn(120, 'EUR'), 11.11);
  assert.equal(catalogPriceIn(120, 'USD'), 12);
  assert.equal(catalogPriceIn(8, 'EUR'), 0.74);
  assert.equal(catalogPriceIn(120, undefined), 120, 'no currency: dirhams');
});

test('catalog panel and edge prices follow the account currency; own prices stay as typed', () => {
  const { catalogPanelPrice, edgePricePerM, sheetPricing } = loadTsModule('src/lib/cutting/binpacking.ts');
  const mad = catalogPanelPrice('mdf', 278, 208);
  assert.equal(catalogPanelPrice('mdf', 278, 208, 'MAD'), mad);
  assert.equal(catalogPanelPrice('mdf', 278, 208, 'EUR'), Math.round((mad / 10.8) * 100) / 100);
  assert.equal(catalogPanelPrice('mdf', 278, 208, 'USD'), Math.round((mad / 10) * 100) / 100);

  assert.equal(edgePricePerM('white', undefined, 'EUR'), 0.74);
  assert.equal(edgePricePerM('white', undefined, 'USD'), 0.8);
  assert.equal(edgePricePerM('white', 2.5, 'EUR'), 2.5, 'an own price is not converted');
  assert.equal(edgePricePerM('none', undefined, 'EUR'), 0);

  const sheet = { material: 'mdf', width: 278, height: 208 };
  assert.deepEqual(sheetPricing(sheet, undefined, 'EUR'), { mode: 'per_sheet', value: catalogPanelPrice('mdf', 278, 208, 'EUR') });
  assert.deepEqual(sheetPricing({ ...sheet, pricePerSheet: 45 }, undefined, 'EUR'), { mode: 'per_sheet', value: 45 });
});

test('an optimization priced in euros uses the converted catalog prices', () => {
  const { optimizeCutting2D, catalogPanelPrice, edgePricePerM } = loadTsModule('src/lib/cutting/binpacking.ts');
  const sheets = [{ id: 's0', width: 278, height: 208, kerf: 0, margin: 0, material: 'mdf', quantity: 5 }];
  const pieces = [{ id: 'p1', name: 'Côté', width: 60, height: 80, quantity: 2, edges: { top: true, color: 'white' } }];

  const eur = optimizeCutting2D(pieces, sheets, { currency: 'EUR' });
  const mad = optimizeCutting2D(pieces, sheets, {});
  assert.equal(eur.costingInput.material.sheets[0].pricing.value, catalogPanelPrice('mdf', 278, 208, 'EUR'));
  assert.equal(mad.costingInput.material.sheets[0].pricing.value, catalogPanelPrice('mdf', 278, 208));
  assert.equal(eur.costingInput.edge.segments[0].pricePerMeter, edgePricePerM('white', undefined, 'EUR'));
  assert.ok(eur.costBreakdown.subtotal < mad.costBreakdown.subtotal);
});

test('repricing after a price change keeps the account currency', () => {
  const { optimizeCutting2D, repriceCostingInput, catalogPanelPrice } = loadTsModule('src/lib/cutting/binpacking.ts');
  const sheet = { id: 's0', width: 278, height: 208, kerf: 0, margin: 0, material: 'mdf', quantity: 5 };
  const result = optimizeCutting2D([{ id: 'p1', width: 60, height: 80, quantity: 1 }], [sheet], { currency: 'USD' });
  const repriced = repriceCostingInput(result.costingInput, { sheet, currency: 'USD' });
  assert.equal(repriced.material.sheets[0].pricing.value, catalogPanelPrice('mdf', 278, 208, 'USD'));
});

test('the workshop strings carry the account currency, never a hardcoded MAD', () => {
  const { translate, catalogs } = loadTsModule('src/i18n/index.ts');
  for (const locale of ['fr', 'en', 'ar']) {
    assert.equal(translate(locale, 'atelier.cost.amount', { value: '12,50', currency: 'EUR' }), '12,50 EUR');
    assert.equal(translate(locale, 'atelier.cost.currency', { currency: 'USD' }), 'USD');
    const workshop = JSON.stringify([catalogs[locale].atelier, catalogs[locale].options, catalogs[locale].quotation]);
    assert.ok(!/\bMAD\b/.test(workshop), `${locale}: a workshop string still says MAD`);
  }
});

test('the cut-plan PDF and the quote label their amounts in the account currency', () => {
  const { pdfCatalogFor } = loadTsModule('src/lib/exports/pdf-catalog.ts');
  const { quotationCatalogFor } = loadTsModule('src/lib/exports/quotation-catalog.ts');
  const { formatExportMoney } = loadTsModule('src/lib/exports/currency-labels.ts');

  assert.equal(pdfCatalogFor('fr').currencyLabel, 'Devise : MAD');
  assert.equal(pdfCatalogFor('fr', 'EUR').currencyLabel, 'Devise : EUR');
  assert.match(pdfCatalogFor('ar', 'USD').recap.financialHeader, /USD/);
  assert.match(pdfCatalogFor('ar', 'EUR').recap.title, /باليورو/);
  assert.match(pdfCatalogFor('ar').recap.title, /بالدرهم/);
  assert.equal(quotationCatalogFor('fr', 'EUR').totalLabel, 'TOTAL À PAYER (EUR)');
  assert.equal(quotationCatalogFor('ar', 'USD').taxLabel(20).includes('(USD)'), true);
  assert.equal(quotationCatalogFor('fr').totalLabel, 'TOTAL À PAYER (MAD)');
  assert.equal(formatExportMoney(1234.5, 'EUR'), '1234,50 EUR');
});

test('the export payloads carry the currency, dirhams when an older page sends none', () => {
  const { ExportSchema } = loadTsModule('src/lib/exports/pdf-schema.ts');
  const { QuotationRequestSchema } = loadTsModule('src/lib/quotation.ts');
  const shape = ExportSchema.shape ?? ExportSchema._def?.schema?.shape;
  assert.equal(shape.currency.parse(undefined), 'MAD');
  assert.equal(shape.currency.parse('EUR'), 'EUR');
  assert.throws(() => shape.currency.parse('GBP'));
  const qShape = QuotationRequestSchema.shape;
  assert.equal(qShape.currency.parse(undefined), 'MAD');
  assert.equal(qShape.currency.parse('USD'), 'USD');
});

test('the amount in words names the account currency', () => {
  const { amountInWords } = loadTsModule('src/lib/quotation.ts');
  assert.equal(amountInWords(1, 'fr'), 'un dirham');
  assert.equal(amountInWords(2, 'fr', 'EUR'), 'deux euros');
  assert.equal(amountInWords(1_000_000, 'fr', 'EUR'), "un million d'euros");
  assert.equal(amountInWords(1_000_000, 'fr'), 'un million de dirhams');
  assert.equal(amountInWords(1.01, 'fr', 'USD'), 'un dollar et un cent');
  assert.equal(amountInWords(12.5, 'fr', 'USD'), 'douze dollars et cinquante cents');
  assert.match(amountInWords(5, 'ar', 'EUR'), /يورو/);
  assert.match(amountInWords(5, 'ar', 'USD'), /دولارات/);
  assert.match(amountInWords(2.02, 'ar', 'USD'), /دولاران.*سنتان/);
  assert.match(amountInWords(5, 'ar'), /دراهم/);
});
