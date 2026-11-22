const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The Android app only opens links to the pages that do not sell (spec
// 2026-11-14, lot 2): a qatlia.ma/credits link received on WhatsApp stays in
// the browser, where buying remains possible. Bubblewrap intercepts the whole
// domain, so its AndroidManifest.xml is retouched after every update.

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'mobile/android/scripts/restrict-links.js');
const MANIFEST = path.join(ROOT, 'mobile/android/app/src/main/AndroidManifest.xml');

const BUBBLEWRAP_FILTER = `
            <intent-filter android:autoVerify="true">
                <action android:name="android.intent.action.VIEW"/>
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE"/>
                <data android:scheme="https"
                    android:host="@string/hostName"

                />
            </intent-filter>
`;

const pathsOf = (xml) => [...xml.matchAll(/android:pathPrefix="([^"]+)"/g)].map((m) => m[1]);

test('only the pages that do not sell open in the app', () => {
  const { restrictLinks, APP_LINK_PATHS } = require(SCRIPT);
  assert.deepEqual(APP_LINK_PATHS, ['/atelier', '/history', '/account', '/panels']);
  const out = restrictLinks(BUBBLEWRAP_FILTER);
  assert.deepEqual(pathsOf(out), APP_LINK_PATHS);
  assert.match(out, /android:autoVerify="true"/, 'still verified against assetlinks.json');
  assert.match(out, /android:scheme="https"\s+android:host="@string\/hostName"\s*\/>/);
});

test('running the retouch twice changes nothing', () => {
  const { restrictLinks } = require(SCRIPT);
  const once = restrictLinks(BUBBLEWRAP_FILTER);
  assert.equal(restrictLinks(once), once);
});

test('a manifest without the expected filter is refused, not silently left open', () => {
  const { restrictLinks } = require(SCRIPT);
  assert.throws(() => restrictLinks('<manifest></manifest>'), /intent-filter/);
});

test('the committed Android manifest carries the retouch', () => {
  const xml = fs.readFileSync(MANIFEST, 'utf8');
  assert.deepEqual(pathsOf(xml), ['/atelier', '/history', '/account', '/panels']);
});
