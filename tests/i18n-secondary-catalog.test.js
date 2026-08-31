const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { loadTsModule } = require('./helpers/load-ts-module');

// Slice 3 of the localization work covers the surfaces around the workshop:
// buying credits, the payment return page, the project history, the account
// space and the standalone sign-in page. tsc guarantees key parity between the
// three catalogs; these tests guard what it cannot see:
//
//  * that the copy was actually translated instead of copy-pasted from French,
//  * that the billing catalog (MAD amounts, credit counts, pack ids) is the
//    single source of truth and the catalog only carries its wording,
//  * that no provider error — Stripe route code or Supabase auth message —
//    can reach the customer unlocalized,
//  * that the five pages hold no hardcoded copy, no hardcoded `fr-FR` date
//    format and no physical (left/right) spacing that would break in Arabic.

const PROJECT_ROOT = path.resolve(__dirname, '..');

/** Every catalog group added for the secondary surfaces. */
const SECONDARY_GROUPS = ['billing', 'creditsPage', 'creditsSuccess', 'historyPage', 'accountPage', 'loginPage'];

const PAGES = {
  credits: 'src/app/credits/page.tsx',
  creditsSuccess: 'src/app/credits/success/page.tsx',
  history: 'src/app/history/page.tsx',
  account: 'src/app/account/page.tsx',
  login: 'src/app/auth/login/page.tsx',
};

/**
 * Keys whose value is a currency symbol or a pure amount template rather than
 * prose. Translating "DH" would change what the figure beside it means, so
 * these must stay byte-identical in every locale.
 */
const SHARED_TOKENS = new Set([
  'creditsPage.currency',
  // Amount + currency only: the pack's own name carries the wording.
  'billing.packs.starter.badge',
  // Pure geometry: two figures, the multiplication sign and an SI symbol.
  'historyPage.sheetSize',
]);

/** French and English strings that legitimately coincide. */
const IDENTICAL_IN_ENGLISH = new Set([...SHARED_TOKENS, 'historyPage.piecesValue']);

function loadI18n() {
  return loadTsModule(path.join(PROJECT_ROOT, 'src/i18n/index.ts'));
}

function loadDomain() {
  return loadTsModule(path.join(PROJECT_ROOT, 'src/i18n/domain.ts'));
}

function loadBillingCatalog() {
  return loadTsModule(path.join(PROJECT_ROOT, 'src/lib/billing/catalog.ts'));
}

function readPage(key) {
  return fs.readFileSync(path.join(PROJECT_ROOT, PAGES[key]), 'utf8');
}

/**
 * Page source with every comment removed, so a scan for leftover French copy
 * reads only what the customer can actually see. JSX is lowered to
 * `React.createElement` calls, which is what drops `{/* … *\/}` nodes too.
 */
function readPageCode(key) {
  const filePath = path.join(PROJECT_ROOT, PAGES[key]);
  return ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React,
      removeComments: true,
    },
    fileName: filePath,
  }).outputText;
}

function flatten(node, prefix = '', target = {}) {
  for (const [key, value] of Object.entries(node)) {
    const dotted = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') flatten(value, dotted, target);
    else target[dotted] = value;
  }
  return target;
}

function secondaryEntries(catalog) {
  return Object.entries(flatten(catalog)).filter(([key]) => SECONDARY_GROUPS.includes(key.split('.')[0]));
}

test('every secondary surface has its own catalog group in every locale', () => {
  const { LOCALES, catalogs } = loadI18n();
  for (const locale of LOCALES) {
    for (const group of SECONDARY_GROUPS) {
      assert.ok(catalogs[locale][group], `locale "${locale}" is missing the "${group}" group`);
    }
  }
  assert.ok(
    secondaryEntries(catalogs.fr).length > 60,
    'the secondary catalog should cover credits, history, account and sign-in'
  );
});

test('no secondary string is left in French in the English or Arabic catalog', () => {
  const { catalogs } = loadI18n();
  for (const locale of ['en', 'ar']) {
    const allowed = locale === 'en' ? IDENTICAL_IN_ENGLISH : SHARED_TOKENS;
    const flat = flatten(catalogs[locale]);
    for (const [key, french] of secondaryEntries(catalogs.fr)) {
      if (allowed.has(key)) {
        assert.equal(flat[key], french, `"${key}" must stay identical to the French value`);
        continue;
      }
      assert.notEqual(flat[key], french, `"${key}" was never translated into "${locale}"`);
    }
  }
});

test('every Arabic secondary string is actually written in Arabic script', () => {
  const { catalogs } = loadI18n();
  const arabicLetter = /[؀-ۿ]/;
  const flat = flatten(catalogs.ar);
  for (const [key] of secondaryEntries(catalogs.fr)) {
    if (SHARED_TOKENS.has(key)) continue;
    assert.match(flat[key], arabicLetter, `ar.${key} contains no Arabic script: "${flat[key]}"`);
  }
});

test('every credit pack sold maps to translated name, description, badge and renewal copy', () => {
  const { CREDIT_PACK_LABEL_KEYS, creditPackLabelKeys } = loadDomain();
  const { CREDIT_PACKS, PACK_IDS } = loadBillingCatalog();
  const { LOCALES, translate } = loadI18n();

  assert.deepEqual(Object.keys(CREDIT_PACK_LABEL_KEYS).sort(), [...PACK_IDS].sort());

  for (const id of PACK_IDS) {
    const pack = CREDIT_PACKS[id];
    const keys = creditPackLabelKeys(id);
    for (const locale of LOCALES) {
      for (const field of ['name', 'description', 'badge']) {
        const copy = translate(locale, keys[field], { count: pack.credits, price: pack.priceMAD });
        assert.notEqual(copy, keys[field], `${locale} has no ${field} for pack "${id}"`);
        assert.ok(!/\{\w+\}/.test(copy), `${locale}.${keys[field]} left a placeholder unresolved: "${copy}"`);
      }
      if (pack.renewalNote) {
        assert.ok(keys.renewalNote, `pack "${id}" renews monthly but has no renewal key`);
        const copy = translate(locale, keys.renewalNote, { count: pack.credits });
        assert.notEqual(copy, keys.renewalNote, `${locale} has no renewal copy for pack "${id}"`);
      } else {
        assert.equal(keys.renewalNote, null, `pack "${id}" does not renew but carries renewal copy`);
      }
    }
  }
  // An id this build does not sell degrades to the entry-level pack rather than
  // rendering a raw payload value.
  assert.deepEqual(creditPackLabelKeys('unlimited'), CREDIT_PACK_LABEL_KEYS.starter);
  assert.deepEqual(creditPackLabelKeys(undefined), CREDIT_PACK_LABEL_KEYS.starter);
});

test('the French pack copy still reads exactly as the billing catalog states it', () => {
  const { creditPackLabelKeys } = loadDomain();
  const { CREDIT_PACKS, PACK_IDS } = loadBillingCatalog();
  const { translate } = loadI18n();

  for (const id of PACK_IDS) {
    const pack = CREDIT_PACKS[id];
    const keys = creditPackLabelKeys(id);
    const vars = { count: pack.credits, price: pack.priceMAD };
    assert.equal(translate('fr', keys.name, vars), pack.name, `pack "${id}" was renamed by the catalog`);
    assert.equal(translate('fr', keys.description, vars), pack.description, `pack "${id}" description drifted`);
    assert.equal(translate('fr', keys.badge, vars), pack.badge, `pack "${id}" badge drifted`);
    if (pack.renewalNote) {
      assert.equal(translate('fr', keys.renewalNote, vars), pack.renewalNote, `pack "${id}" renewal note drifted`);
    }
  }
});

test('pack copy interpolates MAD amounts and credit counts instead of hardcoding them', () => {
  const { CREDIT_PACK_LABEL_KEYS } = loadDomain();
  const { CREDIT_PACKS, PACK_IDS } = loadBillingCatalog();
  const { LOCALES, catalogs } = loadI18n();

  for (const locale of LOCALES) {
    const flat = flatten(catalogs[locale]);
    for (const id of PACK_IDS) {
      const keys = CREDIT_PACK_LABEL_KEYS[id];
      // A badge always states the price, and states it as a placeholder.
      assert.ok(flat[keys.badge].includes('{price}'), `${locale}.${keys.badge} must interpolate the price`);
      const pack = CREDIT_PACKS[id];
      // The monthly allowance is the ledger's figure, never a number typed into
      // a translation: no locale may promise a different number of analyses.
      for (const key of [keys.description, keys.renewalNote].filter(Boolean)) {
        const value = flat[key];
        assert.ok(
          !new RegExp(`\\b${pack.credits}\\b`).test(value),
          `${locale}.${key} hardcodes the credit count: "${value}"`
        );
        assert.ok(
          !new RegExp(`\\b${pack.priceMAD}\\b`).test(value),
          `${locale}.${key} hardcodes the price: "${value}"`
        );
      }
    }
  }
});

test('the credits page renders pack copy from the catalog, never a hardcoded name', () => {
  const source = readPage('credits');
  assert.match(source, /creditPackLabelKeys/, 'the credits page must resolve pack copy through the domain map');
  const { CREDIT_PACKS, PACK_IDS } = loadBillingCatalog();
  for (const id of PACK_IDS) {
    assert.ok(!source.includes(CREDIT_PACKS[id].name), `the credits page hardcodes the "${id}" pack name`);
  }
  // The amounts and credit counts still come from the billing catalog.
  assert.match(source, /CREDIT_PACKS/);
  assert.match(source, /priceMAD/);
});

test('every checkout error code the route can return has localized copy', () => {
  const { CHECKOUT_ERROR_KEYS, checkoutErrorKey } = loadDomain();
  const { LOCALES, translate } = loadI18n();

  const routeSource = fs.readFileSync(
    path.join(PROJECT_ROOT, 'src/app/api/credits/checkout/route.ts'),
    'utf8'
  );
  const codes = [...routeSource.matchAll(/error: '([A-Z_]+)'/g)].map((match) => match[1]);
  assert.ok(codes.length >= 4, 'the checkout route should still return machine-readable error codes');

  for (const code of new Set(codes)) {
    assert.ok(CHECKOUT_ERROR_KEYS[code], `no localized copy for checkout error code "${code}"`);
    for (const locale of LOCALES) {
      const key = CHECKOUT_ERROR_KEYS[code];
      assert.notEqual(translate(locale, key), key, `${locale} has no copy for "${key}"`);
    }
  }
  // A code this build does not know about degrades to the generic message.
  assert.equal(checkoutErrorKey('SOMETHING_NEW'), 'creditsPage.errors.generic');
  assert.equal(checkoutErrorKey(undefined), 'creditsPage.errors.generic');
  assert.equal(checkoutErrorKey(null), 'creditsPage.errors.generic');
});

test('the credits page never renders the payment provider message', () => {
  const source = readPage('credits');
  const banner = [...source.matchAll(/setCheckoutError\(([\s\S]*?)\);/g)].map((match) => match[1].trim());
  assert.ok(banner.length >= 2, 'the credits page should still write to its error banner');
  for (const argument of banner) {
    assert.ok(
      argument === 'null' || argument.startsWith('t('),
      `the error banner is given untranslated copy: setCheckoutError(${argument})`
    );
  }
  assert.ok(!/data\.message/.test(source), 'the credits page must not render the upstream payment message');
  assert.ok(!/\bany\b/.test(source), 'the credits page must not use `any`');
});

test('the account page maps password failures to localized copy, never the Supabase message', () => {
  const source = readPage('account');
  assert.match(source, /authErrorKey\(/, 'the account page must map auth errors through authErrorKey');
  assert.ok(
    !/error\.message|err\.message/.test(source),
    'the account page must not render the raw Supabase error message'
  );
  const banner = [...source.matchAll(/setPwdErr\(([\s\S]*?)\);/g)].map((match) => match[1].trim());
  assert.ok(banner.length >= 3, 'the account page should still write to its password error banner');
  for (const argument of banner) {
    assert.ok(
      argument === 'null' || argument.startsWith('t('),
      `the password banner is given untranslated copy: setPwdErr(${argument})`
    );
  }
});

test('the account password rule states the same minimum the input enforces', () => {
  const { LOCALES, catalogs } = loadI18n();
  for (const locale of LOCALES) {
    const value = flatten(catalogs[locale])['accountPage.errors.tooShort'];
    assert.ok(value.includes('{min}'), `${locale}.accountPage.errors.tooShort must interpolate {min}`);
    assert.ok(!/\d/.test(value), `${locale}.accountPage.errors.tooShort hardcodes a length: "${value}"`);
  }
});

test('the sign-in page maps every auth failure to localized copy', () => {
  const source = readPage('login');
  assert.match(source, /authErrorKey\(/, 'the sign-in page must map auth errors through authErrorKey');
  assert.ok(
    !/err\.message|error\.message/.test(source),
    'the sign-in page must not render the raw Supabase error message'
  );
  const banner = [...source.matchAll(/setErrorMsg\(([\s\S]*?)\);/g)].map((match) => match[1].trim());
  assert.ok(banner.length >= 2, 'the sign-in page should still write to its error banner');
  for (const argument of banner) {
    assert.ok(
      argument === 'null' || argument.startsWith('t('),
      `the error banner is given untranslated copy: setErrorMsg(${argument})`
    );
  }
});

test('a persisted ledger description survives, while its fallback label is translated', () => {
  const { LOCALES, translate } = loadI18n();
  const source = readPage('account');
  // The description written into the ledger is the customer's own record: it is
  // rendered verbatim, and only the fallback for a row without one is localized.
  assert.match(source, /tx\.description \|\| t\(/, 'the ledger description must be preferred over the fallback');
  for (const locale of LOCALES) {
    for (const key of ['accountPage.txDebit', 'accountPage.txCredit']) {
      assert.notEqual(translate(locale, key), key, `${locale} has no fallback label for "${key}"`);
    }
  }
});

test('every history sync note is localized copy resolved from the catalog', () => {
  const { LOCALES, translate } = loadI18n();
  const source = readPage('history');
  const notes = [...source.matchAll(/setSyncNote\(([\s\S]*?)\);/g)].map((match) => match[1].trim());
  assert.ok(notes.length >= 4, 'the history page should still report its sync state');
  // The note is held as a catalog key and resolved at render time, so switching
  // language re-translates a note that is already on screen.
  for (const argument of notes) {
    assert.ok(
      argument === 'null' || /^(?:missingTable \?\s*)?'historyPage\.sync\./.test(argument),
      `the sync note is given untranslated copy: setSyncNote(${argument})`
    );
  }
  assert.match(source, /\{t\(syncNote\)\}/, 'the sync note must be translated where it is rendered');
  for (const locale of LOCALES) {
    for (const key of [
      'historyPage.sync.localOnly',
      'historyPage.sync.cloudDisabled',
      'historyPage.sync.cloudUnavailable',
      'historyPage.sync.offline',
    ]) {
      assert.notEqual(translate(locale, key), key, `${locale} has no copy for "${key}"`);
    }
  }
});

test('every material a saved project can carry has a short badge label', () => {
  const { MATERIAL_BADGE_KEYS, materialBadgeKey, MATERIAL_LABEL_KEYS } = loadDomain();
  const { LOCALES, translate } = loadI18n();

  assert.deepEqual(Object.keys(MATERIAL_BADGE_KEYS).sort(), Object.keys(MATERIAL_LABEL_KEYS).sort());
  for (const material of Object.keys(MATERIAL_BADGE_KEYS)) {
    for (const locale of LOCALES) {
      const key = materialBadgeKey(material);
      assert.notEqual(translate(locale, key), key, `${locale} has no badge for material "${material}"`);
    }
  }
  // A legacy or unknown material value degrades to the library's first entry.
  assert.equal(materialBadgeKey('not-a-material'), MATERIAL_BADGE_KEYS.mdf);
  assert.equal(materialBadgeKey(null), MATERIAL_BADGE_KEYS.mdf);
});

test('formatDateTime formats in the active locale and never renders an invalid date', () => {
  const { formatDateTime } = loadI18n();
  const options = { day: 'numeric', month: 'short', year: 'numeric' };
  const iso = '2026-03-14T09:05:00.000Z';

  const fr = formatDateTime('fr', iso, options);
  const en = formatDateTime('en', iso, options);
  const ar = formatDateTime('ar', iso, options);

  assert.notEqual(fr, en, 'French and English dates should not be formatted identically');
  assert.match(fr, /2026/);
  assert.match(en, /2026/);
  // Morocco writes figures with Western digits, whatever ICU data ships.
  assert.match(ar, /2026/, `ar-MA should use Western digits, got "${ar}"`);
  assert.ok(!/[٠-٩۰-۹]/.test(ar), `ar-MA leaked Arabic-Indic digits: "${ar}"`);

  // A malformed timestamp must never reach the customer as "Invalid Date".
  assert.equal(formatDateTime('fr', 'not-a-date', options), '—');
  assert.equal(formatDateTime('fr', Number.NaN, options), '—');
});

test('no secondary page formats a date with a hardcoded locale', () => {
  for (const key of Object.keys(PAGES)) {
    const source = readPage(key);
    assert.ok(!/toLocaleDateString\(|toLocaleString\(/.test(source), `${PAGES[key]} formats a date itself`);
    assert.ok(!/'fr-FR'|"fr-FR"/.test(source), `${PAGES[key]} hardcodes the fr-FR locale`);
  }
});

test('no secondary page holds hardcoded French copy any more', () => {
  // Every visible string now comes from the catalog, so no accented Latin letter
  // and no typographic apostrophe may survive in the page code.
  const french = /[À-ÖØ-öø-ÿ’œŒ]/;
  for (const key of Object.keys(PAGES)) {
    const code = readPageCode(key);
    const offenders = code
      .split('\n')
      .map((line, index) => [index + 1, line])
      .filter(([, line]) => french.test(line));
    assert.deepEqual(offenders, [], `${PAGES[key]} still holds hardcoded copy`);
  }
});

test('every secondary page uses logical spacing so Arabic mirrors correctly', () => {
  // `left-1/2` paired with `-translate-x-1/2` centres in both directions, so it
  // is the one physical offset that stays correct under `dir="rtl"`.
  const physical = /\b(?:ml|mr|pl|pr)-[\d.]+|\b(?:left|right)-(?!1\/2\b)[\w./]+|\btext-(?:left|right)\b/g;
  for (const key of Object.keys(PAGES)) {
    const source = readPage(key);
    assert.deepEqual(source.match(physical) ?? [], [], `${PAGES[key]} uses physical spacing`);
  }
});

test('email and figures are pinned to LTR on the pages that show them', () => {
  for (const key of ['credits', 'history', 'account']) {
    assert.match(readPage(key), /dir="ltr"/, `${PAGES[key]} must pin its figures to LTR`);
  }
  // The email address is a Latin identifier wherever it is shown.
  assert.match(readPage('login'), /dir="ltr"/);
});

test('every secondary page reads its copy from the locale context', () => {
  for (const key of Object.keys(PAGES)) {
    const source = readPage(key);
    assert.match(source, /useLocale\(\)/, `${PAGES[key]} does not use the locale context`);
  }
});
