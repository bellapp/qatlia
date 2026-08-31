const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { loadTsModule } = require('./helpers/load-ts-module');

// Slice 2 of the localization work makes the core workshop (/atelier and the
// components it renders) genuinely multilingual. tsc already guarantees key
// parity between the three catalogs; these tests guard what it cannot see:
//
//  * that the workshop copy was actually translated, not copy-pasted from
//    French into `en`/`ar`,
//  * that every fixed domain enum (material, optimization goal, edge-banding
//    preset, pricing mode, vision API error code) still maps to a real
//    translation key, so a new enum value can never render a raw value,
//  * that units, currency and the billing promise survive translation,
//  * that plural groups stay complete in every locale.

const PROJECT_ROOT = path.resolve(__dirname, '..');

/** Every catalog group added for the workshop surface. */
const WORKSHOP_GROUPS = [
  'common',
  'materials',
  'atelier',
  'pieces',
  'options',
  'emptyState',
  'tour',
  'account',
  'auth',
];

/**
 * Keys whose value is a format token, a currency code, an SI unit symbol or an
 * example address rather than prose. Those must stay byte-identical in every
 * locale — translating "MAD" or "mm" would change what the figure next to them
 * means.
 */
const SHARED_TOKENS = new Set([
  'atelier.exports.json',
  'atelier.exports.png',
  'atelier.exports.dxf',
  'atelier.cost.currency',
  'atelier.cost.amount',
  'atelier.cutOrder.number',
  'pieces.columns.number',
  'pieces.edgeBanding.price',
  'options.kerf.unit',
  'options.kerf.scaleMax',
  'options.pricing.stockPerM2',
  'auth.emailPlaceholder',
  // Pure composition template: both halves are themselves translated.
  'pieces.import.summary',
  // Industry abbreviation, printed the same on a Moroccan panel in any language.
  'materials.badge.mdf',
]);

/**
 * French and English words that legitimately coincide (an aluminium is an
 * aluminium, H is H for hauteur and for height). Listed explicitly so a real
 * untranslated string can never hide among them.
 */
const IDENTICAL_IN_ENGLISH = new Set([
  ...SHARED_TOKENS,
  'materials.aluminium',
  'materials.badge.aluminium',
  'atelier.cost.total',
  'atelier.cutOrder.rotation',
  'emptyState.step1',
  'pieces.counts',
  'pieces.edge.bottomShort',
  'pieces.quickAdd.heightLabel',
]);

function loadI18n() {
  return loadTsModule(path.join(PROJECT_ROOT, 'src/i18n/index.ts'));
}

function loadDomain() {
  return loadTsModule(path.join(PROJECT_ROOT, 'src/i18n/domain.ts'));
}

function loadBinpacking() {
  return loadTsModule(path.join(PROJECT_ROOT, 'src/lib/cutting/binpacking.ts'));
}

const AUTH_MODAL_PATH = path.join(PROJECT_ROOT, 'src/components/AuthModal.tsx');

/**
 * `authErrorKey` is a pure function that happens to live next to the component
 * that uses it. `loadTsModule` only compiles `.ts`, so the JSX is transpiled
 * here and every import is stubbed: nothing but the mapping table runs, and the
 * test needs neither React nor a Supabase client.
 */
function loadAuthErrorMapper() {
  const source = fs.readFileSync(AUTH_MODAL_PATH, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
    fileName: AUTH_MODAL_PATH,
  });

  const stubs = {
    react: {},
    'lucide-react': {},
    '@/lib/supabase/client': {},
    '@/components/QatlIALogo': {},
    '@/components/LocaleProvider': {},
  };
  const mod = new Module.Module(AUTH_MODAL_PATH, module);
  mod.filename = AUTH_MODAL_PATH;
  mod.paths = Module._nodeModulePaths(path.dirname(AUTH_MODAL_PATH));
  mod.require = (request) => {
    if (request in stubs) return stubs[request];
    throw new Error(`AuthModal gained an unstubbed runtime import: ${request}`);
  };
  mod._compile(outputText, AUTH_MODAL_PATH);
  return mod.exports;
}

function flatten(node, prefix = '', target = {}) {
  for (const [key, value] of Object.entries(node)) {
    const dotted = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') flatten(value, dotted, target);
    else target[dotted] = value;
  }
  return target;
}

function workshopEntries(catalog) {
  const flat = flatten(catalog);
  return Object.entries(flat).filter(([key]) => WORKSHOP_GROUPS.includes(key.split('.')[0]));
}

test('the workshop surface has its own catalog groups in every locale', () => {
  const { LOCALES, catalogs } = loadI18n();
  for (const locale of LOCALES) {
    for (const group of WORKSHOP_GROUPS) {
      assert.ok(catalogs[locale][group], `locale "${locale}" is missing the "${group}" group`);
    }
  }
  assert.ok(
    workshopEntries(catalogs.fr).length > 150,
    'the workshop catalog should cover the whole atelier surface'
  );
});

test('no workshop string is left in French in the English or Arabic catalog', () => {
  const { catalogs } = loadI18n();
  for (const locale of ['en', 'ar']) {
    const allowed = locale === 'en' ? IDENTICAL_IN_ENGLISH : SHARED_TOKENS;
    const flat = flatten(catalogs[locale]);
    for (const [key, french] of workshopEntries(catalogs.fr)) {
      if (allowed.has(key)) {
        assert.equal(flat[key], french, `"${key}" must stay identical to the French value`);
        continue;
      }
      assert.notEqual(flat[key], french, `"${key}" was never translated into "${locale}"`);
    }
  }
});

test('every Arabic workshop string is actually written in Arabic script', () => {
  const { catalogs } = loadI18n();
  const arabicLetter = /[؀-ۿ]/;
  for (const [key] of workshopEntries(catalogs.fr)) {
    if (SHARED_TOKENS.has(key)) continue;
    const value = flatten(catalogs.ar)[key];
    assert.match(value, arabicLetter, `ar.${key} contains no Arabic script: "${value}"`);
  }
});

test('dimension and unit copy keeps the unit as a placeholder instead of hardcoding cm', () => {
  const { LOCALES, catalogs } = loadI18n();
  const unitKeys = [
    'atelier.stock.heightLabel',
    'atelier.stock.widthLabel',
    'atelier.stock.lengthLabel',
    'atelier.stock.heightAria',
    'atelier.stock.widthAria',
    'atelier.stock.lengthAria',
    'atelier.cutOrder.dimensions',
    'pieces.columns.dimensions',
    'pieces.row.heightAria',
    'pieces.row.widthAria',
    'pieces.quickAdd.heightLabel',
    'pieces.quickAdd.widthLabel',
    'pieces.feedback.invalidDimensions',
  ];
  for (const locale of LOCALES) {
    const flat = flatten(catalogs[locale]);
    for (const key of unitKeys) {
      assert.ok(flat[key], `${locale}.${key} is missing`);
      assert.ok(flat[key].includes('{unit}'), `${locale}.${key} must interpolate {unit}, got "${flat[key]}"`);
      assert.ok(!/\bcm\b/.test(flat[key]), `${locale}.${key} hardcodes a unit: "${flat[key]}"`);
    }
    // The kerf badge is the one place a unit is fixed by the domain (mm), and
    // it must stay the SI symbol in every locale.
    assert.equal(flat['options.kerf.unit'], 'mm');
  }
});

test('the MAD billing copy survives translation and never hardcodes the credit count', () => {
  const { LOCALES, catalogs } = loadI18n();
  for (const locale of LOCALES) {
    const flat = flatten(catalogs[locale]);
    assert.equal(flat['atelier.cost.currency'], 'MAD');
    assert.ok(flat['atelier.cost.amount'].includes('MAD'));
    for (const key of ['auth.defaultSubtitle', 'auth.perk', 'auth.switchToSignup']) {
      assert.ok(flat[key].includes('{count}'), `${locale}.${key} must interpolate the credit count`);
      assert.ok(!/\d/.test(flat[key]), `${locale}.${key} hardcodes a number: "${flat[key]}"`);
    }
  }
});

test('every plural group offers both a one and a many form in every locale', () => {
  const { LOCALES, catalogs } = loadI18n();
  const reference = flatten(catalogs.fr);
  const pluralBases = Object.keys(reference)
    .filter((key) => key.endsWith('.one'))
    .map((key) => key.slice(0, -'.one'.length));

  assert.ok(pluralBases.length >= 5, 'the workshop copy should use plural groups');

  for (const locale of LOCALES) {
    const flat = flatten(catalogs[locale]);
    for (const base of pluralBases) {
      assert.equal(typeof flat[`${base}.one`], 'string', `${locale}.${base}.one is missing`);
      assert.equal(typeof flat[`${base}.many`], 'string', `${locale}.${base}.many is missing`);
      assert.ok(flat[`${base}.one`].includes('{count}'), `${locale}.${base}.one must show the count`);
      assert.ok(flat[`${base}.many`].includes('{count}'), `${locale}.${base}.many must show the count`);
    }
  }
});

test('pluralForm follows each locale rule, French keeping zero singular', () => {
  const { pluralForm } = loadI18n();
  assert.equal(pluralForm('fr', 0), 'one');
  assert.equal(pluralForm('fr', 1), 'one');
  assert.equal(pluralForm('fr', 2), 'many');
  assert.equal(pluralForm('en', 0), 'many');
  assert.equal(pluralForm('en', 1), 'one');
  assert.equal(pluralForm('en', 5), 'many');
  assert.equal(pluralForm('ar', 0), 'many');
  assert.equal(pluralForm('ar', 1), 'one');
  assert.equal(pluralForm('ar', 3), 'many');
});

test('translatePlural picks the form and interpolates the count', () => {
  const { translatePlural, catalogs } = loadI18n();
  assert.equal(translatePlural('fr', 'atelier.cutOrder.count', 1), '1 pièce');
  assert.equal(
    translatePlural('fr', 'atelier.cutOrder.count', 7),
    catalogs.fr.atelier.cutOrder.count.many.replace('{count}', '7')
  );
  assert.equal(
    translatePlural('en', 'atelier.cutOrder.count', 1),
    catalogs.en.atelier.cutOrder.count.one.replace('{count}', '1')
  );
  // Extra variables are still interpolated alongside the count.
  assert.equal(
    translatePlural('fr', 'pieces.template.added', 6, { template: 'Bibliothèque' }),
    '6 pièces ajoutées depuis Bibliothèque.'
  );
});

test('the French import summary keeps its exact wording after translation', () => {
  const { translate, translatePlural } = loadI18n();
  const summary = translate('fr', 'pieces.import.summary', {
    imported: translatePlural('fr', 'pieces.import.importedCount', 2),
    ignored: translatePlural('fr', 'pieces.import.ignoredCount', 0),
  });
  assert.equal(summary, '2 pièces importées · 0 ligne ignorée');
});

test('formatNumber renders Moroccan Arabic with Western digits, never Arabic-Indic', () => {
  const { formatNumber } = loadI18n();
  const arabic = formatNumber('ar', 1234.5);
  assert.match(arabic, /1.?234/, `ar-MA should use Western digits, got "${arabic}"`);
  assert.ok(!/[٠-٩۰-۹]/.test(arabic), `ar-MA leaked Arabic-Indic digits: "${arabic}"`);
  assert.match(formatNumber('en', 1234.5), /1,234\.5/);
  assert.match(formatNumber('fr', 1234.5), /1\s?234,5/u);
  // A non-finite figure must never reach the customer as "NaN".
  assert.equal(formatNumber('fr', Number.NaN), '—');
  assert.equal(formatNumber('fr', Number.POSITIVE_INFINITY), '—');
});

test('every material type in the library maps to a translated label', () => {
  const { MATERIAL_LABEL_KEYS, materialLabelKey } = loadDomain();
  const { MATERIAL_LIBRARY } = loadBinpacking();
  const { LOCALES, translate } = loadI18n();

  assert.deepEqual(
    Object.keys(MATERIAL_LABEL_KEYS).sort(),
    MATERIAL_LIBRARY.map((material) => material.type).sort()
  );
  for (const material of MATERIAL_LIBRARY) {
    const key = materialLabelKey(material.type);
    for (const locale of LOCALES) {
      assert.notEqual(translate(locale, key), key, `${locale} has no label for material "${material.type}"`);
    }
  }
  // An unknown value never renders a raw payload string.
  assert.equal(materialLabelKey('not-a-material'), MATERIAL_LABEL_KEYS.mdf);
});

test('every optimization goal the optimizer supports maps to a translated label', () => {
  const { OPTIMIZATION_PRIORITY_LABEL_KEYS } = loadDomain();
  const { OPTIMIZATION_PRIORITY_VALUES } = loadBinpacking();
  const { LOCALES, translate } = loadI18n();

  assert.deepEqual(
    Object.keys(OPTIMIZATION_PRIORITY_LABEL_KEYS).sort(),
    [...OPTIMIZATION_PRIORITY_VALUES].sort()
  );
  for (const value of OPTIMIZATION_PRIORITY_VALUES) {
    for (const locale of LOCALES) {
      const key = OPTIMIZATION_PRIORITY_LABEL_KEYS[value];
      assert.notEqual(translate(locale, key), key, `${locale} has no label for goal "${value}"`);
    }
  }
});

test('every edge-banding preset maps to a translated label', () => {
  const { EDGE_BANDING_LABEL_KEYS, edgeBandingLabelKey } = loadDomain();
  const { EDGEBANDING_PRESETS } = loadBinpacking();
  const { LOCALES, translate } = loadI18n();

  assert.deepEqual(
    Object.keys(EDGE_BANDING_LABEL_KEYS).sort(),
    EDGEBANDING_PRESETS.map((preset) => preset.id).sort()
  );
  for (const preset of EDGEBANDING_PRESETS) {
    for (const locale of LOCALES) {
      const key = edgeBandingLabelKey(preset.id);
      assert.notEqual(translate(locale, key), key, `${locale} has no label for preset "${preset.id}"`);
    }
  }
  assert.equal(edgeBandingLabelKey('unknown-preset'), EDGE_BANDING_LABEL_KEYS.none);
});

test('pricing modes and edge sides map to translated labels', () => {
  const { LABOR_PRICING_MODE_KEYS, STOCK_PRICING_MODE_KEYS, EDGE_SIDE_KEYS } = loadDomain();
  const { LOCALES, translate } = loadI18n();

  assert.deepEqual(Object.keys(LABOR_PRICING_MODE_KEYS).sort(), ['fixed', 'per_meter']);
  assert.deepEqual(Object.keys(STOCK_PRICING_MODE_KEYS).sort(), ['per_m2', 'per_sheet']);
  assert.deepEqual(Object.keys(EDGE_SIDE_KEYS).sort(), ['bottom', 'left', 'right', 'top']);

  const allKeys = [
    ...Object.values(LABOR_PRICING_MODE_KEYS),
    ...Object.values(STOCK_PRICING_MODE_KEYS),
    ...Object.values(EDGE_SIDE_KEYS).flatMap((side) => [side.label, side.short]),
  ];
  for (const key of allKeys) {
    for (const locale of LOCALES) {
      assert.notEqual(translate(locale, key), key, `${locale} has no label for "${key}"`);
    }
  }
});

test('every vision API error code the route can return has translated copy', () => {
  const { VISION_ERROR_KEYS, visionErrorKey } = loadDomain();
  const { LOCALES, translate } = loadI18n();

  const routeSource = fs.readFileSync(path.join(PROJECT_ROOT, 'src/app/api/vision/route.ts'), 'utf8');
  const codes = [...routeSource.matchAll(/error: '([A-Z_]+)'/g)].map((match) => match[1]);
  assert.ok(codes.length >= 8, 'the vision route should still return machine-readable error codes');

  for (const code of new Set(codes)) {
    assert.ok(VISION_ERROR_KEYS[code], `no localized copy for vision error code "${code}"`);
    for (const locale of LOCALES) {
      assert.notEqual(translate(locale, VISION_ERROR_KEYS[code]), VISION_ERROR_KEYS[code]);
    }
  }
  // An unknown/new server code degrades to the generic message, never to a raw code.
  assert.equal(visionErrorKey('SOMETHING_NEW'), 'atelier.visionError.generic');
  assert.equal(visionErrorKey(undefined), 'atelier.visionError.generic');
});

test('the guided tour translates its own buttons and step counter', () => {
  const { LOCALES, catalogs, translate } = loadI18n();
  for (const locale of LOCALES) {
    const flat = flatten(catalogs[locale]);
    for (const key of ['tour.next', 'tour.previous', 'tour.done']) {
      assert.ok(flat[key] && flat[key].trim().length > 0, `${locale}.${key} is missing`);
    }
    // The step numbers belong to driver.js, which counts the steps itself: the
    // copy must interpolate them instead of spelling "of 4" out.
    const progress = flat['tour.progress'];
    assert.ok(progress.includes('{current}'), `${locale}.tour.progress must interpolate {current}`);
    assert.ok(progress.includes('{total}'), `${locale}.tour.progress must interpolate {total}`);
    assert.ok(!/\d/.test(progress), `${locale}.tour.progress hardcodes a step number: "${progress}"`);
    // Rendered with driver.js' own token syntax, the counter survives intact.
    const rendered = translate(locale, 'tour.progress', { current: '{{current}}', total: '{{total}}' });
    assert.ok(rendered.includes('{{current}}') && rendered.includes('{{total}}'));
  }
});

test('the tour component configures every driver.js label from the catalog', () => {
  const source = fs.readFileSync(path.join(PROJECT_ROOT, 'src/components/OnboardingTour.tsx'), 'utf8');
  for (const option of ['nextBtnText', 'prevBtnText', 'doneBtnText', 'progressText']) {
    assert.match(source, new RegExp(`${option}:\\s*t\\(`), `${option} is not resolved from the catalog`);
  }
});

test('every Supabase auth failure an artisan can hit maps to localized copy', () => {
  const { authErrorKey } = loadAuthErrorMapper();
  const { LOCALES, translate, catalogs } = loadI18n();

  // Message wordings and codes GoTrue has shipped for each failure.
  const cases = [
    [{ message: 'Invalid login credentials' }, 'auth.errors.invalidCredentials'],
    [{ message: 'Invalid email or password' }, 'auth.errors.invalidCredentials'],
    [{ code: 'invalid_credentials' }, 'auth.errors.invalidCredentials'],
    [{ message: 'User already registered' }, 'auth.errors.alreadyRegistered'],
    [{ message: 'A user with this email address has already been registered' }, 'auth.errors.alreadyRegistered'],
    [{ code: 'user_already_exists' }, 'auth.errors.alreadyRegistered'],
    [{ code: 'email_exists' }, 'auth.errors.alreadyRegistered'],
    [{ message: 'Email not confirmed' }, 'auth.errors.emailNotConfirmed'],
    [{ code: 'email_not_confirmed' }, 'auth.errors.emailNotConfirmed'],
    [{ message: 'Password should be at least 6 characters.' }, 'auth.errors.weakPassword'],
    [{ message: 'Password is too short' }, 'auth.errors.weakPassword'],
    [{ code: 'weak_password', message: 'Password should contain at least one character of each' }, 'auth.errors.weakPassword'],
    [{ message: 'Email rate limit exceeded' }, 'auth.errors.rateLimited'],
    [{ message: 'For security purposes, you can only request this after 47 seconds.' }, 'auth.errors.rateLimited'],
    [{ code: 'over_request_rate_limit' }, 'auth.errors.rateLimited'],
    // Throttling is recognisable from the status alone, whatever the wording.
    [{ status: 429, message: 'Request failed' }, 'auth.errors.rateLimited'],
  ];

  for (const [error, expected] of cases) {
    assert.equal(authErrorKey(error), expected, `mapped ${JSON.stringify(error)} to the wrong key`);
    for (const locale of LOCALES) {
      const copy = translate(locale, expected, { min: 6 });
      assert.notEqual(copy, expected, `${locale} has no copy for "${expected}"`);
      assert.ok(!copy.includes('{min}'), `${locale}.${expected} left {min} uninterpolated`);
    }
  }
  // The password rule is interpolated, so the catalog can never promise a
  // different minimum than the input enforces.
  assert.match(flatten(catalogs.fr)['auth.errors.weakPassword'], /\{min\}/);
});

test('an unrecognised auth error falls back to localized copy, never to the upstream English', () => {
  const { authErrorKey } = loadAuthErrorMapper();
  const { LOCALES, translate } = loadI18n();

  const unknown = [
    new Error('Database error saving new user'),
    { message: 'Something the SDK has not shipped yet' },
    { code: 'brand_new_code' },
    'plain string failure',
    null,
    undefined,
    42,
  ];
  for (const error of unknown) {
    assert.equal(authErrorKey(error), 'auth.genericError');
    // The OAuth path passes its own fallback rather than the form's.
    assert.equal(authErrorKey(error, 'auth.googleError'), 'auth.googleError');
  }

  // The component may only ever render a translated key: no upstream message,
  // however tempting, may reach the banner.
  const source = fs.readFileSync(AUTH_MODAL_PATH, 'utf8');
  const banner = [...source.matchAll(/setErrorMsg\(([^\n]*)\)[;,]/g)].map((match) => match[1]);
  assert.ok(banner.length >= 2, 'the auth modal should still write to its error banner');
  for (const argument of banner) {
    assert.ok(
      argument === 'null' || argument.startsWith('t('),
      `the error banner is given untranslated copy: setErrorMsg(${argument})`
    );
  }
  assert.ok(
    !/\berr\.message\b|\berror\.message\b/.test(source),
    'AuthModal must not render the raw upstream error message'
  );

  for (const locale of LOCALES) {
    assert.notEqual(translate(locale, 'auth.genericError'), 'auth.genericError');
    assert.notEqual(translate(locale, 'auth.googleError'), 'auth.googleError');
  }
});

test('the email field is named by real copy, not by the sample address', () => {
  const { LOCALES, catalogs } = loadI18n();
  for (const locale of LOCALES) {
    const flat = flatten(catalogs[locale]);
    assert.ok(flat['auth.emailLabel'], `${locale}.auth.emailLabel is missing`);
    assert.notEqual(
      flat['auth.emailLabel'],
      flat['auth.emailPlaceholder'],
      `${locale} names the email field with its sample address`
    );
    assert.ok(!flat['auth.emailLabel'].includes('@'), `${locale}.auth.emailLabel looks like an address`);
  }
  const source = fs.readFileSync(AUTH_MODAL_PATH, 'utf8');
  assert.match(source, /aria-label=\{t\('auth\.emailLabel'\)\}/);
});

test('the auth modal is a labelled, dismissible dialog', () => {
  const source = fs.readFileSync(AUTH_MODAL_PATH, 'utf8');
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  // The heading carries the id the dialog is labelled by.
  assert.match(source, /aria-labelledby=\{headingId\}/);
  assert.match(source, /<h2 id=\{headingId\}/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /previouslyFocused\?\.focus\(\)/);
  // Focus handling must stay typed: `any` would hide a missing HTMLElement guard.
  assert.ok(!/\bany\b/.test(source.replace(/\bcompany\b/g, '')), 'AuthModal must not use `any`');
});
