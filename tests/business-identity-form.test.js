const test = require('node:test');
const assert = require('node:assert/strict');
const { renderComponent } = require('./helpers/render-component');
const { loadTsModule } = require('./helpers/load-ts-module');

// « Mon entreprise » on the account page: while the saved business loads the
// form must not take typing (the load would overwrite it), and every input
// carries the limit the server enforces.

const { QUOTATION_TEXT_LIMITS } = loadTsModule('src/lib/quotation.ts');

const html = () => renderComponent('src/components/BusinessIdentityForm.tsx', 'BusinessIdentityForm', {});
const tagsOf = (markup, name) => [...markup.matchAll(new RegExp(`<${name}[ >][^>]*>`, 'g'))].map((m) => m[0]);

test('while the saved business loads, every input and the logo button are disabled', () => {
  const markup = html();
  const inputs = tagsOf(markup, 'input').filter((tag) => !/type="file"/.test(tag));
  assert.equal(inputs.length, 6);
  for (const tag of inputs) assert.match(tag, /\bdisabled=""/, tag);

  const choose = tagsOf(markup, 'button').find((tag) => /type="button"/.test(tag));
  assert.match(choose, /\bdisabled=""/);
});

test('every input carries the maximum length the server accepts', () => {
  const inputs = tagsOf(html(), 'input').filter((tag) => !/type="file"/.test(tag));
  const limits = inputs.map((tag) => Number(/maxLength="(\d+)"/.exec(tag)?.[1]));
  const { shortText, addressText, phoneText } = QUOTATION_TEXT_LIMITS;
  // Shown order: name, phone, address, email, ICE, tax id.
  assert.deepEqual(limits, [shortText, phoneText, addressText, shortText, phoneText, phoneText]);
});
