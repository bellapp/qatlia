const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// src/i18n is the single catalog for the app. French is the reference locale:
// every other locale is typed against it, so a missing or extra key is a
// compile error. These tests guard the things the type system cannot see —
// empty strings, drifting `{placeholders}`, and the runtime lookup/fallback
// behaviour that `t()` in LocaleProvider is a thin wrapper around.

function loadI18n() {
  return loadTsModule('src/i18n/index.ts');
}

function flatten(node, prefix = '', target = {}) {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') flatten(value, path, target);
    else target[path] = value;
  }
  return target;
}

function placeholdersOf(value) {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

test('the catalog exposes exactly the three supported locales, French first and default', () => {
  const { LOCALES, DEFAULT_LOCALE, catalogs } = loadI18n();
  assert.deepEqual([...LOCALES], ['fr', 'en', 'ar']);
  assert.equal(DEFAULT_LOCALE, 'fr');
  assert.deepEqual(Object.keys(catalogs).sort(), ['ar', 'en', 'fr']);
});

test('every locale has exactly the same dotted keys as the French reference', () => {
  const { LOCALES, catalogs } = loadI18n();
  const reference = Object.keys(flatten(catalogs.fr)).sort();
  assert.ok(reference.length > 30, 'the landing page catalog should be substantial');

  for (const locale of LOCALES) {
    const keys = Object.keys(flatten(catalogs[locale])).sort();
    assert.deepEqual(keys, reference, `locale "${locale}" drifted from the French key set`);
  }
});

test('no catalog entry is empty or whitespace-only in any locale', () => {
  const { LOCALES, catalogs } = loadI18n();
  for (const locale of LOCALES) {
    for (const [key, value] of Object.entries(flatten(catalogs[locale]))) {
      assert.equal(typeof value, 'string', `${locale}.${key} is not a string`);
      assert.notEqual(value.trim(), '', `${locale}.${key} is empty`);
    }
  }
});

test('every key carries the same {placeholders} in every locale', () => {
  const { LOCALES, catalogs } = loadI18n();
  const reference = flatten(catalogs.fr);

  for (const locale of LOCALES) {
    const flat = flatten(catalogs[locale]);
    for (const [key, value] of Object.entries(reference)) {
      assert.deepEqual(
        placeholdersOf(flat[key]),
        placeholdersOf(value),
        `placeholders drifted for "${key}" in "${locale}"`
      );
    }
  }
});

test('the billing promise survives translation: free optimisation/exports and 5 vision credits', () => {
  const { catalogs } = loadI18n();
  // The counts live in the placeholder, so no locale can quietly promise a
  // different number of free analyses.
  assert.deepEqual(placeholdersOf(catalogs.fr.hero.note), ['count']);
  assert.deepEqual(placeholdersOf(catalogs.fr.finalCta.body), ['count']);
  assert.match(catalogs.fr.hero.note, /gratuits/i);
  assert.match(catalogs.en.hero.note, /free/i);
  assert.match(catalogs.en.finalCta.body, /free/i);
});

test('translate resolves a dotted key in the requested locale', () => {
  const { translate, catalogs } = loadI18n();
  assert.equal(translate('fr', 'nav.login'), catalogs.fr.nav.login);
  assert.equal(translate('en', 'nav.login'), catalogs.en.nav.login);
  assert.equal(translate('ar', 'nav.login'), catalogs.ar.nav.login);
  assert.equal(translate('fr', 'stats.waste.label'), catalogs.fr.stats.waste.label);
});

test('translate substitutes every occurrence of a {var} placeholder', () => {
  const { translate } = loadI18n();
  const rendered = translate('fr', 'hero.note', { count: 5 });
  assert.ok(!rendered.includes('{count}'), 'placeholder was left unresolved');
  assert.ok(rendered.includes('5'), 'the interpolated value is missing');
});

test('translate leaves a placeholder intact when no value is supplied for it', () => {
  const { translate } = loadI18n();
  // A caller that forgets a variable must get a visible, greppable token back
  // rather than an empty gap in the sentence.
  assert.ok(translate('fr', 'hero.note').includes('{count}'));
});

test('an unknown key falls back to the French value rather than leaking the key', () => {
  const { translate, catalogs } = loadI18n();
  const original = catalogs.ar.footer.tagline;
  delete catalogs.ar.footer.tagline;
  try {
    assert.equal(translate('ar', 'footer.tagline'), catalogs.fr.footer.tagline);
  } finally {
    catalogs.ar.footer.tagline = original;
  }
});

test('a key that exists in no locale returns the key itself as a last resort', () => {
  const { translate } = loadI18n();
  assert.equal(translate('en', 'nope.not.here'), 'nope.not.here');
  // A path that lands on a group rather than a leaf must not stringify an object.
  assert.equal(translate('en', 'stats'), 'stats');
});

test('isLocale accepts only fr/en/ar and dirFor marks Arabic as right-to-left', () => {
  const { isLocale, dirFor } = loadI18n();
  assert.equal(isLocale('fr'), true);
  assert.equal(isLocale('en'), true);
  assert.equal(isLocale('ar'), true);
  assert.equal(isLocale('de'), false);
  assert.equal(isLocale(null), false);
  assert.equal(isLocale('fr-FR'), false);
  assert.equal(dirFor('ar'), 'rtl');
  assert.equal(dirFor('fr'), 'ltr');
  assert.equal(dirFor('en'), 'ltr');
});

test('the early-init script only ever accepts the three allowed locale codes', () => {
  const { localeInitScript, LOCALE_STORAGE_KEY, LOCALE_COOKIE_NAME } = loadI18n();
  assert.equal(LOCALE_STORAGE_KEY, 'qatlia-locale');
  assert.equal(LOCALE_COOKIE_NAME, 'qatlia-locale');
  assert.ok(localeInitScript.includes('["fr","en","ar"]'), 'allow-list is not inlined verbatim');
  assert.ok(localeInitScript.includes(LOCALE_STORAGE_KEY));
  // No script-closing sequence and no dynamic evaluation may reach the DOM.
  assert.ok(!/<\/script/i.test(localeInitScript));
  assert.ok(!/\beval\b|new Function/.test(localeInitScript));
});
