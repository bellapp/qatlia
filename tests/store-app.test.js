const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

// The site knows it runs inside the Play Store app and then sells nothing
// (spec 2026-11-14, lot 1). The head script and the pure function must agree.

const storeApp = loadTsModule(path.resolve(__dirname, '..', 'src/lib/store-app.ts'));
const KEY = storeApp.STORE_APP_STORAGE_KEY;

/** Runs the head script against a fake page and reports what it did. */
function runScript({ url, referrer = '', stored = null, storageThrows = false }) {
  const { pathname, search } = new URL(url, 'https://qatlia.ma');
  const attrs = {};
  const store = stored === null ? {} : { [KEY]: stored };
  let replaced = null;
  const blocked = () => { throw new Error('blocked'); };
  const sessionStorage = {
    getItem: (k) => (storageThrows ? blocked() : k in store ? store[k] : null),
    setItem: (k, v) => { if (storageThrows) blocked(); store[k] = v; },
  };
  const window = { location: { pathname, search, replace: (to) => { replaced = to; } }, sessionStorage };
  const document = { referrer, documentElement: { setAttribute: (k, v) => { attrs[k] = v; } } };
  vm.runInNewContext(storeApp.storeAppInitScript, { window, document, URLSearchParams });
  return { attrs, store, replaced };
}

const IN_APP = [
  { url: '/atelier?app=android' },
  { url: '/atelier?utm_source=x&app=android' },
  { url: '/atelier', referrer: 'android-app://com.qatlia.app' },
  { url: '/atelier', referrer: 'android-app://com.qatlia.app/' },
  { url: '/history', stored: 'android' },
];

const IN_BROWSER = [
  { url: '/atelier' },
  { url: '/atelier', referrer: 'android-app://com.google.android.gm/' },
  { url: '/atelier', referrer: 'android-app://com.qatlia.app.evil/' },
  { url: '/atelier', referrer: 'https://qatlia.ma/atelier?app=android' },
  { url: '/atelier?app=ios' },
  { url: '/atelier?app=' },
  { url: '/atelier?application=android' },
  { url: '/atelier', stored: 'ios' },
];

const inputOf = ({ url, referrer = '', stored = null }) => ({
  search: new URL(url, 'https://qatlia.ma').search, referrer, stored,
});

test('the app is recognised by its parameter, its exact referrer, or the tab memory', () => {
  for (const page of IN_APP) {
    assert.equal(storeApp.detectStoreApp(inputOf(page)), true, JSON.stringify(page));
    const { attrs, store } = runScript(page);
    assert.equal(attrs['data-app'], 'android', JSON.stringify(page));
    assert.equal(store[KEY], 'android', 'remembered for the rest of the tab');
  }
});

test('a browser visit is left alone, including one opened from another Android app', () => {
  for (const page of IN_BROWSER) {
    assert.equal(storeApp.detectStoreApp(inputOf(page)), false, JSON.stringify(page));
    const { attrs, store, replaced } = runScript(page);
    assert.deepEqual(attrs, {}, JSON.stringify(page));
    assert.equal(store[KEY], page.stored ?? undefined);
    assert.equal(replaced, null);
  }
});

test('the purchase and landing pages lead elsewhere, their neighbours do not', () => {
  const cases = {
    '/': '/atelier', '/ar': '/atelier', '/ar/': '/atelier',
    '/credits': '/account', '/credits/': '/account', '/credits/success': '/account',
    '/atelier': null, '/account': null, '/credits-old': null, '/refund': null, '/w/abc': null,
  };
  for (const [from, to] of Object.entries(cases)) {
    assert.equal(storeApp.storeAppRedirect(from), to, from);
  }
});

test('in the app, the script leaves a purchase page before it paints', () => {
  const leaving = runScript({ url: '/credits?pack=artisan&app=android' });
  assert.equal(leaving.replaced, '/account');
  assert.equal('data-app-leaving' in leaving.attrs, true);

  const staying = runScript({ url: '/atelier?app=android' });
  assert.equal(staying.replaced, null);
  assert.equal('data-app-leaving' in staying.attrs, false);

  assert.equal(runScript({ url: '/credits' }).replaced, null, 'a browser keeps its purchase page');
});

test('a browser that refuses sessionStorage still gets the mode for this page', () => {
  const { attrs } = runScript({ url: '/atelier?app=android', storageThrows: true });
  assert.equal(attrs['data-app'], 'android');
});

test('the mode never reaches a cookie or localStorage', () => {
  assert.equal(/localStorage|cookie/i.test(storeApp.storeAppInitScript), false);
});

test('the mode survives React stripping the attribute off <html>', () => {
  // A hydration error makes React client-render <html> and drop every attribute
  // the head script set; the window flag keeps the answer.
  const { window } = (() => {
    const attrs = {};
    const w = { location: { pathname: '/atelier', search: '?app=android', replace() {} }, sessionStorage: { getItem: () => null, setItem() {} } };
    const d = { referrer: '', documentElement: { setAttribute: (k, v) => { attrs[k] = v; } } };
    vm.runInNewContext(storeApp.storeAppInitScript, { window: w, document: d, URLSearchParams });
    return { window: w };
  })();
  assert.equal(window[storeApp.STORE_APP_WINDOW_FLAG], 'android');

  const saved = { window: global.window, document: global.document };
  try {
    global.document = { documentElement: { getAttribute: () => null } };
    global.window = { [storeApp.STORE_APP_WINDOW_FLAG]: 'android' };
    assert.equal(storeApp.isStoreAppDocument(), true, 'flag set, attribute gone');
    global.window = {};
    assert.equal(storeApp.isStoreAppDocument(), false, 'a browser page');
  } finally {
    global.window = saved.window;
    global.document = saved.document;
  }
});

test('without sessionStorage, leaving a purchase page keeps the app parameter', () => {
  const { replaced } = runScript({ url: '/credits?app=android', storageThrows: true });
  assert.equal(replaced, '/account?app=android');
  assert.equal(runScript({ url: '/credits?app=android' }).replaced, '/account', 'remembered: clean address');
});

test('signing out in the app leads to the sign-in page, not to an atelier that looks signed in', () => {
  assert.equal(storeApp.storeAppSignOutPath(true), '/auth/login');
  assert.equal(storeApp.storeAppSignOutPath(false), '/', 'a browser keeps the landing');
  assert.equal(storeApp.storeAppRedirect(storeApp.storeAppSignOutPath(true)), null, 'nothing reroutes it');
});
