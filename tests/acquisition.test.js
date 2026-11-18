const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// Where a visitor came from (the WhatsApp bot tags its links), kept until
// sign-up so sign-ups can be counted by source (analysis of 2026-11-18).

const {
  ACQUISITION_KEY,
  ACQUISITION_TTL_MS,
  parseAcquisition,
  loadAcquisition,
  rememberAcquisition,
  signupMetadata,
} = loadTsModule('src/lib/acquisition.ts');

const NOW = Date.UTC(2026, 10, 18, 12, 0, 0);

function memoryStore({ failWrites = false, failReads = false } = {}) {
  const data = new Map();
  return {
    data,
    getItem: (key) => {
      if (failReads) throw new Error('SecurityError');
      return data.has(key) ? data.get(key) : null;
    },
    setItem: (key, value) => {
      if (failWrites) throw new Error('QuotaExceededError');
      data.set(key, String(value));
    },
    removeItem: (key) => data.delete(key),
  };
}

test('parseAcquisition reads the utm tags into user_metadata keys', () => {
  assert.deepEqual(parseAcquisition('?utm_source=WhatsApp&utm_medium=bot&utm_campaign=ctwa&x=1', NOW), {
    tags: { signup_source: 'whatsapp', signup_medium: 'bot', signup_campaign: 'ctwa' },
    at: NOW,
  });
  assert.deepEqual(parseAcquisition('utm_source=whatsapp', NOW), { tags: { signup_source: 'whatsapp' }, at: NOW });
});

test('parseAcquisition ignores a visit without a usable source, and values that are not plain tokens', () => {
  assert.equal(parseAcquisition('', NOW), null);
  assert.equal(parseAcquisition('?utm_medium=bot', NOW), null);
  assert.equal(parseAcquisition('?utm_source=%3Cscript%3E', NOW), null);
  assert.equal(parseAcquisition(`?utm_source=${'a'.repeat(65)}`, NOW), null);
  assert.deepEqual(parseAcquisition('?utm_source=whatsapp&utm_campaign=a%20b', NOW).tags, { signup_source: 'whatsapp' });
});

test('the first tagged visit is kept; a later one does not overwrite it until it expires', () => {
  const store = memoryStore();
  rememberAcquisition(store, '?utm_source=whatsapp', NOW);
  rememberAcquisition(store, '?utm_source=facebook', NOW + 1000);
  assert.deepEqual(signupMetadata(store, NOW + 2000), { signup_source: 'whatsapp' });

  const later = NOW + ACQUISITION_TTL_MS + 1;
  assert.equal(loadAcquisition(store, later), null);
  rememberAcquisition(store, '?utm_source=facebook', later);
  assert.deepEqual(signupMetadata(store, later), { signup_source: 'facebook' });
});

test('an untagged visit changes nothing', () => {
  const store = memoryStore();
  rememberAcquisition(store, '?page=2', NOW);
  assert.equal(store.data.size, 0);
  assert.deepEqual(signupMetadata(store, NOW), {});
});

test('a corrupt or tampered record is ignored', () => {
  const store = memoryStore();
  for (const raw of ['not json', '{"at":"x","tags":{}}', JSON.stringify({ at: NOW, tags: { signup_source: '<b>' } })]) {
    store.data.set(ACQUISITION_KEY, raw);
    assert.deepEqual(signupMetadata(store, NOW), {}, raw);
  }
  store.data.set(ACQUISITION_KEY, JSON.stringify({ at: NOW, tags: { signup_source: 'whatsapp', role: 'admin' } }));
  assert.deepEqual(signupMetadata(store, NOW), { signup_source: 'whatsapp' }, 'unknown keys never reach the account');
});

test('blocked storage never throws', () => {
  assert.doesNotThrow(() => rememberAcquisition(memoryStore({ failWrites: true }), '?utm_source=whatsapp', NOW));
  assert.deepEqual(signupMetadata(memoryStore({ failReads: true }), NOW), {});
});
