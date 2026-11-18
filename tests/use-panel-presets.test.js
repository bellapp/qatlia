const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The list of panels the artisan works with, shared by the panel page (and, in
// a later lot, the atelier). The hook needs a browser and a session, so its
// text is read; what it decides is tested in the modules it calls.

const source = fs.readFileSync(path.resolve('src/lib/use-panel-presets.ts'), 'utf8');

/** The body of one of the hook's functions, from its name to the next one. */
function body(name) {
  const start = source.indexOf(`const ${name} = `);
  assert.ok(start > 0, `the hook has ${name}`);
  const next = source.slice(start + 1).search(/\n  const [a-z]+ = (async )?\(/);
  return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next);
}

test('the hook runs in the browser only', () => {
  assert.match(source, /^'use client';/);
});

test('the list loads as the atelier loads it: device first, then the account, with the one-time import', () => {
  assert.match(source, /loadSavedPresets\(\)/);
  assert.match(source, /await fetchAccountPresets\(\)/);
  assert.match(source, /await importDevicePresetsOnce\(user\.id\)/);
  assert.match(source, /setSource\('account'\)/);
});

test('adding looks for the same panel before writing anything', () => {
  const add = body('add');
  const check = add.indexOf('findDuplicatePreset(preset, presets)');

  assert.ok(check > 0);
  assert.ok(check < add.indexOf('createAccountPresets('), 'before the account write');
  assert.ok(check < add.indexOf('savePreset('), 'before the device write');
});

test('every write goes to the account or to the device, as the list was read', () => {
  for (const [name, account, device] of [
    ['add', 'createAccountPresets(', 'savePreset('],
    ['update', 'updateAccountPreset(', 'updateDevicePreset('],
    ['remove', 'deleteAccountPreset(', 'deletePreset('],
  ]) {
    const fn = body(name);
    assert.match(fn, /source === 'account'/, `${name} chooses by source`);
    assert.ok(fn.includes(account), `${name} writes to the account`);
    assert.ok(fn.includes(device), `${name} writes to the device`);
  }
});

test('the device list refuses a panel past its cap instead of dropping the oldest', () => {
  assert.match(body('add'), /loadSavedPresets\(\)\.length >= DEVICE_PRESET_CAP/);
});

// Owner request, 2026-11-18: signed out, the catalogue is copied into the
// device list, in the currency shown, once the session is known to be absent.

test('signed out, the catalogue is copied once into the device list', () => {
  assert.match(source, /const \{ currency \} = useCurrency\(\);/);
  assert.match(source, /if \(!ready \|\| signedIn \|\| !currency\) return;/);
  assert.match(source, /if \(copyCatalogToDeviceOnce\(currency\)\) setPresets\(loadSavedPresets\(\)\);/);
  assert.match(source, /\}, \[ready, signedIn, currency\]\);/);
});
