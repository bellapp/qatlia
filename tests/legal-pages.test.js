const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// The terms, privacy policy and refund policy Creem reviews before it approves
// a live store. tsc guarantees key parity between the three catalogs; these
// tests guard what it cannot see:
//
//  * every document is reachable: a page per route, listed in the sitemap and
//    linked from the landing footer and the credits page;
//  * the prose was translated, and the Arabic is written in Arabic script;
//  * figures (refund window, free credits, credit costs, contact) come from the
//    code through placeholders, never typed into a locale.

const PROJECT_ROOT = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relPath), 'utf8');
}

function flatten(node, prefix = '', target = {}) {
  for (const [key, value] of Object.entries(node)) {
    const dotted = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') flatten(value, dotted, target);
    else target[dotted] = value;
  }
  return target;
}

const legal = loadTsModule(path.join(PROJECT_ROOT, 'src/lib/legal.ts'));
const { catalogs, translate } = loadTsModule(path.join(PROJECT_ROOT, 'src/i18n/index.ts'));
const policy = loadTsModule(path.join(PROJECT_ROOT, 'src/lib/billing/policy.ts'));
const support = loadTsModule(path.join(PROJECT_ROOT, 'src/lib/support.ts'));
const seo = loadTsModule(path.join(PROJECT_ROOT, 'src/lib/seo.ts'));

test('each legal document has a page, a sitemap entry and a footer link', () => {
  const landing = read('src/app/landing-page.tsx');
  for (const doc of legal.LEGAL_DOCS) {
    const route = legal.LEGAL_ROUTES[doc];
    const pageFile = path.join('src/app/(site)', route, 'page.tsx');
    assert.ok(fs.existsSync(path.join(PROJECT_ROOT, pageFile)), `${pageFile} is missing`);
    assert.match(read(pageFile), new RegExp(`doc="${doc}"`), `${pageFile} renders the wrong document`);
    assert.ok(seo.PUBLIC_ROUTES.includes(route), `${route} is not in the sitemap`);
    assert.ok(!seo.PRIVATE_ROUTES.some((p) => route.startsWith(p)), `${route} is hidden from crawlers`);
    assert.ok(landing.includes(`href="${route}"`), `the landing footer does not link ${route}`);
  }
});

test('the credits page links the legal documents next to the pay buttons', () => {
  const source = read('src/app/(site)/credits/page.tsx');
  assert.match(source, /legal\.checkoutNotice/);
  assert.match(source, /LEGAL_DOCS\.map/);
});

test('every legal document has sections with a title and a body in every locale', () => {
  for (const doc of legal.LEGAL_DOCS) {
    const keys = legal.legalSectionKeys(doc);
    assert.ok(keys.length >= 5, `${doc} has only ${keys.length} sections`);
    for (const [locale, catalog] of Object.entries(catalogs)) {
      assert.deepEqual(Object.keys(catalog.legal[doc].sections), keys, `${locale}.legal.${doc} sections drifted`);
      for (const key of keys) {
        assert.ok(catalog.legal[doc].sections[key].title.trim(), `${locale}.legal.${doc}.${key} has no title`);
        assert.ok(catalog.legal[doc].sections[key].body.trim(), `${locale}.legal.${doc}.${key} has no body`);
      }
    }
  }
});

test('no legal string is left in French in the English or Arabic catalog', () => {
  const french = flatten(catalogs.fr.legal);
  const arabicLetter = /[؀-ۿ]/;
  for (const locale of ['en', 'ar']) {
    const flat = flatten(catalogs[locale].legal);
    for (const [key, value] of Object.entries(french)) {
      assert.notEqual(flat[key], value, `legal.${key} was never translated into "${locale}"`);
      if (locale === 'ar') assert.match(flat[key], arabicLetter, `ar.legal.${key} contains no Arabic script`);
    }
  }
});

test('legal copy quotes figures and contacts through placeholders, never as typed values', () => {
  const typed = [
    support.SUPPORT_EMAIL,
    support.SUPPORT_WHATSAPP,
    new RegExp(`\\b${policy.SIGNUP_FREE_CREDITS}\\b`),
    new RegExp(`\\b${legal.REFUND_WINDOW_DAYS} (jours|days|أيام)`),
  ];
  for (const [locale, catalog] of Object.entries(catalogs)) {
    for (const [key, value] of Object.entries(flatten(catalog.legal))) {
      for (const needle of typed) {
        const found = typeof needle === 'string' ? value.includes(needle) : needle.test(value);
        assert.ok(!found, `${locale}.legal.${key} hardcodes ${needle}`);
      }
    }
  }
});

test('the rendered refund policy states the window and free credits the code applies', () => {
  const vars = legal.legalVars();
  assert.equal(vars.days, legal.REFUND_WINDOW_DAYS);
  assert.equal(vars.freeCredits, policy.SIGNUP_FREE_CREDITS);
  assert.equal(vars.email, support.SUPPORT_EMAIL);

  for (const locale of Object.keys(catalogs)) {
    const principle = translate(locale, 'legal.refund.sections.s1.body', vars);
    assert.ok(principle.includes(String(legal.REFUND_WINDOW_DAYS)), `${locale} refund principle omits the window`);
    assert.ok(!/\{\w+\}/.test(principle), `${locale} refund principle left a placeholder unresolved`);
    const credits = translate(locale, 'legal.terms.sections.s4.body', vars);
    assert.ok(credits.includes(String(policy.VISION_CREDIT_COST)), `${locale} terms omit the photo-analysis cost`);
    assert.ok(!/\{\w+\}/.test(credits), `${locale} credit terms left a placeholder unresolved`);
  }
});

test('legal pages are titled in French for crawlers and canonical to their own route', () => {
  for (const doc of legal.LEGAL_DOCS) {
    const meta = legal.legalMetadata(doc);
    assert.match(meta.title, /QatliA$/);
    assert.equal(meta.alternates.canonical, legal.LEGAL_ROUTES[doc]);
    assert.ok(meta.description.length > 20);
  }
});
