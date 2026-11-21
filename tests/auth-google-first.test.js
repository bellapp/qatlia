const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

// Signing up with Google needs no password and no email to confirm. Since the
// WhatsApp ad, most email sign-ups never came back from the confirmation email,
// while every Google one was active at once (owner, 21/11/2026): sign-up leads
// with Google and folds the email form until it is asked for.

const ROOT = path.resolve(__dirname, '..');
const SURFACES = ['src/components/AuthModal.tsx', 'src/app/(site)/auth/login/page.tsx'];

for (const file of SURFACES) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');

  test(`${file}: the email form is folded on sign-up and shown on sign-in`, () => {
    assert.match(source, /const showEmailForm = isLogin \|\| emailOpen;/);
    assert.match(source, /useState\(false\);\s*\r?\n\s*const showEmailForm/);
    assert.match(source, /\{showEmailForm && \(\s*\r?\n\s*<form onSubmit=\{handleAuth\}/);
    assert.match(source, /\{!showEmailForm && \(/);
    assert.match(source, /onClick=\{\(\) => setEmailOpen\(true\)\}/);
    assert.match(source, /t\('auth\.useEmail'\)/);
  });

  test(`${file}: Google comes first, as the main button, with its hint on sign-up`, () => {
    const google = source.indexOf('onClick={handleOAuthGoogle}');
    const form = source.indexOf('<form onSubmit={handleAuth}');
    assert.ok(google > 0 && google < form, 'the Google button comes before the email form');
    const button = source.slice(google, source.indexOf('</button>', google));
    assert.match(button, /border-brand-400/);
    assert.match(button, /font-black text-base/);
    assert.match(source, /\{!isLogin && <p[^>]*>\{t\('auth\.googleHint'\)\}<\/p>\}/);
  });
}

test('the Google hint and the email link are written in every locale', () => {
  const ARABIC = /[؀-ۿ]/;
  const load = (locale) => loadTsModule(path.join(ROOT, `src/i18n/messages/${locale}.ts`))[locale];
  const fr = load('fr').auth;
  const en = load('en').auth;
  const ar = load('ar').auth;
  assert.equal(fr.googleHint, 'En un clic, sans mot de passe ni e-mail à confirmer.');
  assert.equal(fr.useEmail, 'Utiliser mon adresse e-mail');
  assert.equal(en.googleHint, 'One tap, no password, no email to confirm.');
  assert.equal(en.useEmail, 'Use my email address');
  assert.match(ar.googleHint, ARABIC);
  assert.match(ar.useEmail, ARABIC);
});
