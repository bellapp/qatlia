const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

const { AtelierSchema, resolveQuotationCompany, companyOf } = loadTsModule('src/lib/atelier.ts');

// 1x1 transparent PNG, base64.
const PNG_LOGO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('AtelierSchema accepts a bare name', () => {
  assert.equal(AtelierSchema.safeParse({ name: 'Menuiserie Benali' }).success, true);
});

test('AtelierSchema accepts a null or valid logo', () => {
  assert.equal(AtelierSchema.safeParse({ name: 'X', logoDataUrl: null }).success, true);
  assert.equal(AtelierSchema.safeParse({ name: 'X', logoDataUrl: PNG_LOGO }).success, true);
});

test('AtelierSchema rejects an unknown field', () => {
  assert.equal(AtelierSchema.safeParse({ name: 'X', color: 'red' }).success, false);
});

test('AtelierSchema rejects an SVG logo', () => {
  const svg = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
  assert.equal(AtelierSchema.safeParse({ name: 'X', logoDataUrl: svg }).success, false);
});

test('AtelierSchema rejects a missing name', () => {
  assert.equal(AtelierSchema.safeParse({}).success, false);
});

test('companyOf drops the logo', () => {
  assert.deepEqual(companyOf({ name: 'X', phone: '0600', logoDataUrl: PNG_LOGO }), { name: 'X', phone: '0600' });
});

test('resolveQuotationCompany prefers the account, with its logo', () => {
  const result = resolveQuotationCompany({
    account: { name: 'Compte', logoDataUrl: PNG_LOGO },
    project: { name: 'Projet' },
    local: { name: 'Local' },
  });
  assert.deepEqual(result, { company: { name: 'Compte' }, logoDataUrl: PNG_LOGO, fromAccount: true });
});

test('resolveQuotationCompany from an account without a logo has no logoDataUrl', () => {
  const result = resolveQuotationCompany({ account: { name: 'Compte', logoDataUrl: null }, project: null, local: null });
  assert.equal(result.fromAccount, true);
  assert.equal(result.logoDataUrl, undefined);
  assert.deepEqual(result.company, { name: 'Compte' });
});

test('resolveQuotationCompany falls back to the project, without any logo', () => {
  const result = resolveQuotationCompany({ account: null, project: { name: 'Projet' }, local: { name: 'Local' } });
  assert.deepEqual(result, { company: { name: 'Projet' }, fromAccount: false });
  assert.equal('logoDataUrl' in result, false);
});

test('resolveQuotationCompany uses the local company last', () => {
  const result = resolveQuotationCompany({ account: null, project: null, local: { name: 'Local' } });
  assert.deepEqual(result, { company: { name: 'Local' }, fromAccount: false });
});

test('resolveQuotationCompany returns no company when nothing exists', () => {
  assert.deepEqual(resolveQuotationCompany({ account: null, project: null, local: null }), {
    company: null,
    fromAccount: false,
  });
});
