const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The store-app mode has to be in place before the first paint, on both root
// layouts, and has to follow in-app navigations (spec 2026-11-14, lot 1).

const read = (file) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');

test('both root layouts run the store-app script first in the body', () => {
  for (const file of ['src/app/(site)/layout.tsx', 'src/app/(ar)/layout.tsx']) {
    const source = read(file);
    const body = source.indexOf('<body');
    const script = source.indexOf('__html: storeAppInitScript');
    const shell = source.indexOf('<ClientShell');
    assert.ok(body > 0 && script > body && script < shell, `${file}: script between <body> and the shell`);
  }
  const site = read('src/app/(site)/layout.tsx');
  assert.ok(site.indexOf('__html: storeAppInitScript') < site.indexOf('__html: localeInitScript'), 'before the locale script');
});

test('the stylesheet hides what sells in the app, and a page the script is leaving', () => {
  const css = read('src/app/globals.css');
  assert.match(css, /html\[data-app\] \[data-sells\]\s*\{\s*display:\s*none\s*!important;\s*\}/);
  assert.match(css, /html\[data-app-leaving\] body\s*\{\s*visibility:\s*hidden;\s*\}/);
});

test('the hook reads the document and answers false on the server', () => {
  const hook = read('src/components/useStoreApp.ts');
  assert.match(hook, /^'use client';/);
  assert.match(hook, /useSyncExternalStore\(/);
  assert.match(hook, /isStoreAppDocument/);
  assert.match(hook, /\(\) => false/);
});

test('the guard sends in-app navigations away and shows nothing meanwhile', () => {
  const guard = read('src/components/StoreAppGuard.tsx');
  assert.match(guard, /useStoreApp\(\)/);
  assert.match(guard, /storeAppRedirect\(/);
  assert.match(guard, /router\.replace\(/);
  assert.match(guard, /return target \? null : /);

  const shell = read('src/components/ClientShell.tsx');
  assert.match(shell, /<StoreAppGuard>\{children\}<\/StoreAppGuard>/);
});

test('the guard puts the attribute back if React stripped it', () => {
  const guard = read('src/components/StoreAppGuard.tsx');
  assert.match(guard, /if \(inApp\) document\.documentElement\.setAttribute\('data-app', STORE_APP_VALUE\);/);
});
