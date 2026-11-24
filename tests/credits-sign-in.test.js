const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// A customer who opens /credits signed out (a link received on WhatsApp) and
// picks a pack: the page used to answer « Connectez-vous » at the top of the
// page, with nothing to press and out of sight on a phone. It now opens the
// sign-in page, which comes back to /credits.

const read = (file) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
const page = read('src/app/(site)/credits/page.tsx');
const between = (start, end) => {
  const from = page.indexOf(start);
  return page.slice(from, page.indexOf(end, from));
};

test('both ways to buy open the sign-in page when the server asks for an account', () => {
  const handlers = {
    card: between('const handleCheckout =', '// Manual payment: create'),
    manual: between('const handleManualOrder =', '// The currency the packs'),
  };
  for (const [name, source] of Object.entries(handlers)) {
    const asked = source.indexOf("data?.error === 'AUTH_REQUIRED'");
    assert.ok(asked > 0, `${name}: handles AUTH_REQUIRED`);
    assert.match(source.slice(asked, asked + 160), /router\.push\(SIGN_IN_AND_BACK\);\s*return;/, name);
    assert.ok(asked < source.lastIndexOf('checkoutErrorKey('), `${name}: before the error message`);
  }
});

test('the sign-in page comes back to the purchase page', () => {
  assert.match(page, /const SIGN_IN_AND_BACK = '\/auth\/login\?redirect=\/credits';/);
  const login = read('src/app/(site)/auth/login/page.tsx');
  assert.match(login, /searchParams\?\.get\('redirect'\) \|\| '\/atelier'/);
});

test('the routes answer AUTH_REQUIRED to a signed-out buyer', () => {
  for (const route of ['checkout', 'manual']) {
    assert.match(read(`src/app/api/credits/${route}/route.ts`), /error: 'AUTH_REQUIRED'[\s\S]{0,160}status: 401/, route);
  }
});
