const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderComponent } = require('./helpers/render-component');

// In the quote dialog the artisan's own business sat as six editable fields
// right above the client's — same labels (Adresse, Téléphone, Email), easy to
// fill the wrong one (user report, 2026-11-23). When the account already has
// its business, the dialog shows it as a read-only card; the fields only
// appear while the account has none.

const LOGO = 'data:image/png;base64,iVBORw0KGgo=';
const render = (props, locale) =>
  renderComponent('src/components/QuotationCompanyCard.tsx', 'QuotationCompanyCard', props, locale);

test('the card shows the business as text, with no input to fill', () => {
  const html = render({
    company: { name: 'Menuiserie Benali', phone: '0612345678', address: '12 rue Atlas, Fès', email: 'contact@benali.ma', ice: '001234567000089' },
    logoDataUrl: LOGO,
  });
  assert.doesNotMatch(html, /<input/);
  assert.match(html, /Menuiserie Benali/);
  assert.match(html, /0612345678/);
  assert.match(html, /12 rue Atlas, Fès/);
  assert.match(html, /contact@benali\.ma/);
  assert.match(html, /001234567000089/);
  assert.match(html, new RegExp(`<img[^>]*src="${LOGO.replace(/[+/.]/g, '\\$&')}"`));
});

test('the card links to the account business page in a new tab', () => {
  const html = render({ company: { name: 'Menuiserie Benali' } });
  assert.match(html, /href="\/account#entreprise"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /Modifier mon entreprise/);
  assert.match(html, /en haut du devis/);
});

test('without a logo the card draws no image', () => {
  assert.doesNotMatch(render({ company: { name: 'Menuiserie Benali' } }), /<img/);
});

test('the card speaks the artisan language', () => {
  assert.match(render({ company: { name: 'نجارة بنعلي' } }, 'ar'), /تعديل مؤسستي/);
});

test('the dialog shows the card for an account business and the fields otherwise', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/components/QuotationDialog.tsx'), 'utf8');
  assert.match(source, /<QuotationCompanyCard\b/);
  assert.match(source, /companyFromAccount \?/, 'the card and the fields must be switched on the account business');
  assert.match(source, /setCompanyFromAccount\(resolved\.fromAccount\)/);
  // A business saved in the other tab reaches the open dialog.
  assert.match(source, /addEventListener\('focus'/);
});
