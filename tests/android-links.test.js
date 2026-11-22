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
// Read from the signed build with `apksigner verify --print-certs`.
const UPLOAD_KEY_SHA256 = '7F:F0:F2:42:C1:81:D2:3F:2C:96:04:75:00:75:8A:E0:B4:63:1F:3E:7A:C7:AE:29:DB:76:9E:41:29:3F:E9:12';

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

test('qatlia.ma vouches for the app, so it opens without an address bar', () => {
  const links = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/.well-known/assetlinks.json'), 'utf8'));
  assert.equal(links.length, 1);
  const [{ relation, target }] = links;
  assert.deepEqual(relation, ['delegate_permission/common.handle_all_urls']);
  assert.equal(target.namespace, 'android_app');
  assert.equal(target.package_name, 'com.qatlia.app');
  // The upload key signs what we send to Play; Play signs what phones install.
  assert.ok(target.sha256_cert_fingerprints.includes(UPLOAD_KEY_SHA256), 'upload key');
  for (const fp of target.sha256_cert_fingerprints) {
    assert.match(fp, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/, fp);
  }
});

test('the committed Android manifest carries the retouch', () => {
  const xml = fs.readFileSync(MANIFEST, 'utf8');
  assert.deepEqual(pathsOf(xml), ['/atelier', '/history', '/account', '/panels']);
});
