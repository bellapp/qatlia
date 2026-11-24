const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// In the Play Store app nothing may lead to a purchase (spec 2026-11-14, lot 1).
// /panels gained a link to /credits between the design and the build: this
// sweep is what catches the next one.

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

/** Pages that are redirected as a whole in the app, and the back office. */
const NOT_SWEPT = ['src/app/landing-page.tsx', 'src/app/(site)/credits/', 'src/app/(site)/admin/'];

function walk(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return walk(rel);
    return rel.endsWith('.tsx') ? [rel] : [];
  });
}

/** The opening tag around `index`: from its `<` to the first `>` that is not an arrow's. */
function tagAround(source, index) {
  const start = source.lastIndexOf('<', index);
  const end = index + source.slice(index).search(/[^=]>/) + 2;
  return source.slice(start, end);
}

test('every way to the purchase or refund page is hidden or rerouted in the app', () => {
  const swept = [...walk('src/app'), ...walk('src/components')].filter(
    (file) => !NOT_SWEPT.some((skip) => file.startsWith(skip))
  );
  const loose = [];
  for (const file of swept) {
    const source = read(file);
    // Any quote, then the page, then a quote or the start of a path, query or hash:
    // /credits?pack=…, /credits#…, /credits/success and template strings count too.
    for (const match of source.matchAll(/(['"`])\/(credits|refund)(?=[/?#'"`])/g)) {
      const tag = tagAround(source, match.index);
      if (!/data-sells|inApp \?/.test(tag)) loose.push(`${file}: ${tag.replace(/\s+/g, ' ').slice(0, 90)}`);
    }
  }
  assert.deepEqual(loose, []);
});

test('the balance badge of each screen leads to the credits usage page in the app', () => {
  const screens = ['atelier', 'account', 'history', 'panels'].map((s) => `src/app/(site)/${s}/page.tsx`);
  for (const file of screens) {
    const source = read(file);
    assert.match(source, /const inApp = useStoreApp\(\);/, file);
    assert.match(source, /href=\{inApp \? '\/account\/credits' : '\/credits'\}/, file);
  }
});

test('the buy entry, the top-up links and the refund link carry the hidden mark', () => {
  const marked = (source, needle) => /data-sells/.test(tagAround(source, source.indexOf(needle)));
  const menu = read('src/components/AccountMenu.tsx');
  assert.ok(marked(menu, 'href="/credits"'), 'account menu: buy credits');
  const usage = read('src/app/(site)/account/credits/page.tsx');
  assert.ok(marked(usage, 'href="/credits"'), 'credits usage page: buy credits');
  const atelier = read('src/app/(site)/atelier/page.tsx');
  assert.ok(marked(atelier, '<a href="/credits"'), 'atelier: recharge after an optimisation refused');
  assert.match(read('src/components/LegalPage.tsx'), /data-sells=\{other === 'refund' \? '' : undefined\}/);
});

test('support, the balance history and the free credits stay', () => {
  const menu = read('src/components/AccountMenu.tsx');
  const support = menu.indexOf('supportWhatsAppUrl(t(');
  assert.ok(support > 0 && !/data-sells/.test(tagAround(menu, support)));
  assert.equal(/data-sells/.test(tagAround(menu, menu.indexOf('href="/account/credits"'))), false);
});

const { loadTsModule } = require('./helpers/load-ts-module');

test('in the app, some messages take their own wording, in every locale', () => {
  const { storeAppCopyKey } = loadTsModule(path.join(ROOT, 'src/lib/store-app.ts'));
  assert.equal(storeAppCopyKey('atelier.visionError.insufficientCredits', true), 'atelier.visionError.insufficientCreditsApp');
  assert.equal(storeAppCopyKey('accountPage.currencyHint', true), 'accountPage.currencyHintApp');
  assert.equal(storeAppCopyKey('atelier.visionError.insufficientCredits', false), 'atelier.visionError.insufficientCredits');
  assert.equal(storeAppCopyKey('atelier.visionError.network', true), 'atelier.visionError.network');

  const load = (locale) => loadTsModule(path.join(ROOT, `src/i18n/messages/${locale}.ts`))[locale];
  const [fr, en, ar] = ['fr', 'en', 'ar'].map(load);
  assert.equal(
    fr.accountPage.currencyHintApp,
    'Vos chiffrages, devis et PDF sont dans cette devise. Elle a été choisie selon votre pays ; vous pouvez la changer. Les prix que vous avez enregistrés ne sont pas convertis.'
  );
  assert.equal(
    en.accountPage.currencyHintApp,
    'Your costings, quotes and PDFs use this currency. It was chosen from your country; you can change it. Prices you have saved are not converted.'
  );
  assert.equal(
    ar.accountPage.currencyHintApp,
    'تقديراتك وعروض الأسعار وملفات PDF بهذه العملة. اختيرت حسب بلدك، ويمكنك تغييرها. الأسعار التي حفظتها لا تُحوَّل.'
  );

  assert.match(read('src/app/(site)/atelier/page.tsx'), /t\(storeAppCopyKey\(visionError, inApp\), \{ max: MAX_SCAN_SHEETS \}\)/);
  assert.match(read('src/app/(site)/account/page.tsx'), /t\(storeAppCopyKey\('accountPage\.currencyHint', inApp\)\)/);
});

// Google lets an app that sells nothing say where to buy, in words and without
// a direct link (« Head to our website to purchase more »,
// support.google.com/googleplay/android-developer/answer/10281818).
test('out of credits, the app says where to buy them, as plain text', () => {
  const { storeAppCopyKey } = loadTsModule(path.join(ROOT, 'src/lib/store-app.ts'));
  assert.equal(storeAppCopyKey('atelier.optimize.noCredits', true), 'atelier.optimize.noCreditsApp');
  assert.equal(storeAppCopyKey('atelier.optimize.noCredits', false), 'atelier.optimize.noCredits');

  const expected = {
    fr: 'Vous n’avez plus de crédits. Vous pouvez en acheter sur notre site qatlia.ma.',
    en: 'You have no credits left. You can buy some on our website, qatlia.ma.',
    ar: 'نفدت أرصدتك. يمكنك شراء الأرصدة من موقعنا qatlia.ma.',
  };
  for (const [locale, text] of Object.entries(expected)) {
    const messages = loadTsModule(path.join(ROOT, `src/i18n/messages/${locale}.ts`))[locale];
    assert.equal(messages.atelier.visionError.insufficientCreditsApp, text, locale);
    assert.equal(messages.atelier.optimize.noCreditsApp, text, locale);
    assert.doesNotMatch(text, /https?:|[/]/, 'no address to follow');
  }

  const atelier = read('src/app/(site)/atelier/page.tsx');
  assert.match(atelier, /setOptimizeError\(t\(storeAppCopyKey\('atelier\.optimize\.noCredits', isStoreAppDocument\(\)\)\)\)/);
  // The recharge link goes with the site's message only, never beside the app's.
  assert.match(atelier, /optimizeError === t\('atelier\.optimize\.noCredits'\)\) && \(\s*<a href="[/]credits" data-sells=""/);
});
