const test = require('node:test');
const assert = require('node:assert/strict');
const { renderComponent } = require('./helpers/render-component');

// The scan zone of the atelier once sheets are read (spec 2026-11-17),
// server-rendered with the real catalogs: the app cannot start locally.

const SOURCE = 'src/components/ScanSheets.tsx';
const THUMB = 'data:image/jpeg;base64,/9j/AAAA';
const render = (props, locale = 'fr') =>
  renderComponent(SOURCE, 'ScanSheets', { max: 4, onOpen: () => {}, onRemove: () => {}, ...props }, locale);

test('nothing is shown before the first sheet', () => {
  assert.equal(render({ sheets: [] }), '');
});

test('each sheet has its thumbnail, its number, its piece count and a remove button', () => {
  const html = render({ sheets: [{ src: THUMB, pieceCount: 23 }, { src: null, pieceCount: 1 }] });
  assert.match(html, /data-testid="scan-sheets-count"[^>]*>2 \/ 4</);
  assert.match(html, /Fiches lues/);
  assert.match(html, /Fiche 1/);
  assert.match(html, /Fiche 2/);
  assert.match(html, /23 cotes extraites/);
  assert.match(html, /1 cote extraite/);
  assert.match(html, /data-testid="atelier-scan-preview"/, 'sheet 1 keeps the test id the e2e specs use');
  assert.match(html, /data-testid="atelier-scan-preview-2"/);
  assert.match(html, /aria-label="Retirer la fiche 2"/);
  assert.equal((html.match(/<img /g) || []).length, 1, 'a sheet without a thumbnail shows an empty frame');
  assert.doesNotMatch(html, /scan-sheets-full/);
});

test('at 4 sheets of 4 the zone says so', () => {
  const sheets = Array.from({ length: 4 }, () => ({ src: THUMB, pieceCount: 2 }));
  const html = render({ sheets });
  assert.match(html, /4 fiches sur 4\. Retirez-en une ou commencez un nouveau débit\./);
});

test('the zone reads in English and Arabic too', () => {
  const sheets = [{ src: THUMB, pieceCount: 3 }];
  assert.match(render({ sheets }, 'en'), /Sheet 1/);
  assert.match(render({ sheets }, 'ar'), /الورقة 1/);
});
