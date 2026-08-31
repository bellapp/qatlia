const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// Task 8 — persists the artisan's own company identity and the last-used
// client identity locally (never server-side on their own — the server only
// ever stores what's merged into a project's options_json, see the route
// tests). Mirrors src/lib/units.ts's injected-storage pattern so behaviour
// is asserted without touching real localStorage/SSR.

function loadStore() {
  return loadTsModule('src/lib/quotation-local-store.ts');
}

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    _map: map,
  };
}

test('readStoredCompanyIdentity returns null when nothing was ever saved', () => {
  const { readStoredCompanyIdentity } = loadStore();
  assert.equal(readStoredCompanyIdentity(fakeStorage()), null);
});

test('readStoredCompanyIdentity returns null when storage is unavailable', () => {
  const { readStoredCompanyIdentity } = loadStore();
  assert.equal(readStoredCompanyIdentity(null), null);
  assert.equal(readStoredCompanyIdentity(undefined), null);
});

test('writeStoredCompanyIdentity then readStoredCompanyIdentity round-trips the exact value', () => {
  const { readStoredCompanyIdentity, writeStoredCompanyIdentity } = loadStore();
  const storage = fakeStorage();
  const company = { name: 'Atelier Karim', address: '12 Rue Ibn Sina', ice: '001234567000089' };
  writeStoredCompanyIdentity(storage, company);
  assert.deepEqual(readStoredCompanyIdentity(storage), company);
});

test('readStoredCompanyIdentity returns null for corrupted JSON instead of throwing', () => {
  const { readStoredCompanyIdentity } = loadStore();
  const storage = fakeStorage();
  storage.setItem('qatlia_quotation_company_v1', '{not json');
  assert.equal(readStoredCompanyIdentity(storage), null);
});

test('readStoredCompanyIdentity returns null for a value that is not a valid CompanyIdentity shape', () => {
  const { readStoredCompanyIdentity } = loadStore();
  const storage = fakeStorage();
  storage.setItem('qatlia_quotation_company_v1', JSON.stringify({ notName: 'x' }));
  assert.equal(readStoredCompanyIdentity(storage), null);
});

test('writeStoredCompanyIdentity silently no-ops when storage is unavailable', () => {
  const { writeStoredCompanyIdentity } = loadStore();
  assert.doesNotThrow(() => writeStoredCompanyIdentity(null, { name: 'X' }));
});

// ─── No client PII is ever persisted locally (Task 8 remediation — item 7).
// Only the artisan's own company identity is remembered on-device; the
// client's identity is either empty on every open, or comes back from a
// server-owned project's options_json (see /api/projects/[id] and
// QuotationDialog) — never from localStorage. ─────────────────────────────

test('the module exposes no client-identity persistence API at all', () => {
  const mod = loadStore();
  assert.equal(mod.readStoredClientIdentity, undefined);
  assert.equal(mod.writeStoredClientIdentity, undefined);
});

test('the module never touches a client-identity storage key', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'src/lib/quotation-local-store.ts'), 'utf8');
  assert.doesNotMatch(source, /qatlia_quotation_client/i, 'no client-identity storage key may remain');
  assert.doesNotMatch(source, /ClientIdentity/, 'no client-identity type/schema may remain referenced');
});

test('writing a company identity never writes anything under a client-identity key', () => {
  const { writeStoredCompanyIdentity } = loadStore();
  const storage = fakeStorage();
  writeStoredCompanyIdentity(storage, { name: 'Atelier Karim' });
  for (const key of storage._map.keys()) {
    assert.doesNotMatch(key, /client/i, `unexpected client-identity key persisted: ${key}`);
  }
});

test('storage.setItem throwing (quota, private mode) is swallowed rather than crashing the caller', () => {
  const { writeStoredCompanyIdentity } = loadStore();
  const throwingStorage = {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  };
  assert.doesNotThrow(() => writeStoredCompanyIdentity(throwingStorage, { name: 'X' }));
});
