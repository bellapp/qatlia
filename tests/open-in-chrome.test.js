const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

// Owner, 27/11/2026: a plan link opened from WhatsApp shows the site in
// WhatsApp's own browser, where Google sign-in lists none of the phone's
// accounts. On Android, « Continuer avec Google » first reopens the plan link
// in Chrome.

const WHATSAPP_WEBVIEW = 'Mozilla/5.0 (Linux; Android 14; SM-A146P Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.6778.135 Mobile Safari/537.36';
const WHATSAPP_NAMED = 'Mozilla/5.0 (Linux; Android 13; Redmi Note 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 WhatsApp/2.24.25';
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';

function load() {
  return loadTsModule('src/lib/open-in-chrome.ts');
}

function readSource(relativePath) {
  return fs.readFileSync(path.resolve(relativePath), 'utf8');
}

test('an Android in-app browser is told apart from Chrome and from an iPhone', () => {
  const { isAndroidInAppBrowser } = load();
  assert.equal(isAndroidInAppBrowser(WHATSAPP_WEBVIEW), true);
  assert.equal(isAndroidInAppBrowser(WHATSAPP_NAMED), true);
  assert.equal(isAndroidInAppBrowser(ANDROID_CHROME), false);
  assert.equal(isAndroidInAppBrowser(IPHONE), false);
});

test('the plan link opens in Chrome through an Android intent', () => {
  const { chromeIntentUrl } = load();
  assert.equal(
    chromeIntentUrl('https://qatlia.ma/w/nx5p7dsx9b'),
    'intent://qatlia.ma/w/nx5p7dsx9b#Intent;scheme=https;package=com.android.chrome;end',
  );
  assert.equal(chromeIntentUrl('http://localhost:3000/w/nx5p7dsx9b'), null, 'https pages only');
  assert.equal(chromeIntentUrl('not a url'), null);
});

test('Google first goes to Chrome only from an Android in-app browser opened on a plan link', () => {
  const { chromeHandoff } = load();
  const base = { userAgent: WHATSAPP_WEBVIEW, origin: 'https://qatlia.ma', photoCode: 'nx5p7dsx9b', storeApp: false };

  assert.equal(chromeHandoff(base), 'intent://qatlia.ma/w/nx5p7dsx9b#Intent;scheme=https;package=com.android.chrome;end');
  assert.equal(chromeHandoff({ ...base, userAgent: ANDROID_CHROME }), null, 'already in Chrome');
  assert.equal(chromeHandoff({ ...base, userAgent: IPHONE }), null, 'iPhone unchanged');
  assert.equal(chromeHandoff({ ...base, storeApp: true }), null, 'the Play Store app signs in inside the app');
  assert.equal(chromeHandoff({ ...base, photoCode: null }), null, 'no plan link: nothing to reopen');
  assert.equal(chromeHandoff({ ...base, photoCode: 'not/a-code' }), null);
});

test('the plan link page remembers its code for the tab, and the Google button uses it', () => {
  const opener = readSource('src/app/(site)/w/[code]/OpenInAtelier.tsx');
  const modal = readSource('src/components/AuthModal.tsx');

  assert.match(opener, /sessionStorage\.setItem\(PHOTO_CODE_SESSION_KEY, code\)/);
  assert.match(modal, /chromeHandoff\(\{/);
  assert.match(modal, /setTimeout\([\s\S]*CHROME_HANDOFF_MS\)/, 'Chrome not opened: the sign-in goes on here');
});
