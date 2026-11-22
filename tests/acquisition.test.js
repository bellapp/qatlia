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

// --- Google sign-up: the cookie copy and the callback rule -----------------------

const {
  ACQUISITION_COOKIE,
  NEW_ACCOUNT_WINDOW_MS,
  acquisitionCookie,
  parseAcquisitionCookie,
  tagsForNewAccount,
} = loadTsModule('src/lib/acquisition.ts');

test('the cookie carries the remembered tags until the visit expires', () => {
  const visit = { tags: { signup_source: 'whatsapp', signup_campaign: 'ctwa' }, at: NOW - 1000 };
  const cookie = acquisitionCookie(visit, NOW, true);
  assert.match(cookie, new RegExp(`^${ACQUISITION_COOKIE}=`));
  assert.match(cookie, /Path=\/; Max-Age=\d+; SameSite=Lax; Secure$/);
  assert.equal(Number(/Max-Age=(\d+)/.exec(cookie)[1]), Math.floor((ACQUISITION_TTL_MS - 1000) / 1000));
  assert.doesNotMatch(acquisitionCookie(visit, NOW, false), /Secure/);

  // What the browser sends back is read like a query string.
  const sent = `theme=dark; ${cookie.split(';')[0]}; other=1`;
  assert.deepEqual(parseAcquisitionCookie(sent), { signup_source: 'whatsapp', signup_campaign: 'ctwa' });
});

test('a missing, foreign or tampered cookie gives no tags', () => {
  assert.deepEqual(parseAcquisitionCookie(null), {});
  assert.deepEqual(parseAcquisitionCookie('theme=dark'), {});
  assert.deepEqual(parseAcquisitionCookie(`${ACQUISITION_COOKIE}=%E0%A4%A`), {});
  assert.deepEqual(parseAcquisitionCookie(`${ACQUISITION_COOKIE}=${encodeURIComponent('utm_source=<b>')}`), {});
  assert.deepEqual(
    parseAcquisitionCookie(`${ACQUISITION_COOKIE}=${encodeURIComponent('utm_source=whatsapp&role=admin')}`),
    { signup_source: 'whatsapp' },
  );
});

test('only an account created moments ago, without a source yet, is tagged', () => {
  const tags = { signup_source: 'whatsapp' };
  const created = (msAgo) => new Date(NOW - msAgo).toISOString();
  assert.deepEqual(tagsForNewAccount({ created_at: created(30 * 1000), user_metadata: { full_name: 'K' } }, tags, NOW), tags);
  // An older account signing in again keeps its first source (or none).
  assert.equal(tagsForNewAccount({ created_at: created(NEW_ACCOUNT_WINDOW_MS + 1), user_metadata: {} }, tags, NOW), null);
  assert.equal(
    tagsForNewAccount({ created_at: created(1000), user_metadata: { signup_source: 'facebook' } }, tags, NOW),
    null,
  );
  assert.equal(tagsForNewAccount({ created_at: created(1000), user_metadata: {} }, {}, NOW), null);
  assert.equal(tagsForNewAccount(null, tags, NOW), null);
  assert.equal(tagsForNewAccount({ created_at: 'not a date' }, tags, NOW), null);
});

// Owner, 22/11/2026: link the account to the WhatsApp number it came from. The
// photo link qatlia.ma/w/<code> is personal: its code points at the number in
// whatsapp_photo_reads. The code goes with the sign-up as `whatsapp_code`.
test('a photo link visit carries its code into the sign-up', () => {
  const { photoLinkTracking } = loadTsModule('src/lib/whatsapp/photo-summary.ts');
  const store = memoryStore();
  rememberAcquisition(store, photoLinkTracking('k7m2qx9dab'), NOW);
  assert.deepEqual(signupMetadata(store, NOW + 1000), {
    signup_source: 'whatsapp',
    signup_medium: 'bot',
    signup_campaign: 'photo',
    whatsapp_code: 'k7m2qx9dab',
  });
});

test('the source stays the first visit, the WhatsApp code is the last photo link opened', () => {
  const { photoLinkTracking } = loadTsModule('src/lib/whatsapp/photo-summary.ts');
  const store = memoryStore();
  rememberAcquisition(store, '?utm_source=whatsapp&utm_campaign=greeting', NOW);
  rememberAcquisition(store, photoLinkTracking('k7m2qx9dab'), NOW + 1000);
  rememberAcquisition(store, photoLinkTracking('abcdefghjk'), NOW + 2000);
  assert.deepEqual(signupMetadata(store, NOW + 3000), {
    signup_source: 'whatsapp',
    signup_campaign: 'greeting',
    whatsapp_code: 'abcdefghjk',
  });
});

test('the Google sign-up cookie carries the WhatsApp code too', () => {
  const visit = { tags: { signup_source: 'whatsapp', whatsapp_code: 'k7m2qx9dab' }, at: NOW - 1000 };
  const sent = acquisitionCookie(visit, NOW, true).split(';')[0];
  assert.deepEqual(parseAcquisitionCookie(sent), { signup_source: 'whatsapp', whatsapp_code: 'k7m2qx9dab' });
});
