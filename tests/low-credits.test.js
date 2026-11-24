const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');
const { renderComponent } = require('./helpers/render-component');

// Nothing told an artisan the credits were running out before zero, and the
// photo error at zero had no way to buy (user request, 2026-11-24). The
// threshold is the user's: 5 under 100 credits, 10 % from 100.

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const { lowCreditsThreshold, creditLevel, OPTIMIZE_CREDIT_COST } = loadTsModule('src/lib/billing/policy.ts');
const { readStartBalance } = loadTsModule('src/lib/billing/start-balance.ts');
const { readDismissed, writeDismissed } = loadTsModule('src/lib/low-credits-dismissal.ts');

const banner = (props, locale) => renderComponent('src/components/LowCreditsBanner.tsx', 'LowCreditsBanner', props, locale);

test('the threshold is 5 under 100 credits and 10 % from 100', () => {
  for (const start of [null, 0, 20, 30, 80, 99]) assert.equal(lowCreditsThreshold(start), 5, String(start));
  assert.equal(lowCreditsThreshold(100), 10);
  assert.equal(lowCreditsThreshold(200), 20);
  assert.equal(lowCreditsThreshold(201), 21);
  assert.equal(lowCreditsThreshold(400), 40);
});

test('the level follows the balance and the starting balance', () => {
  assert.equal(creditLevel(null, 200), 'unknown');
  assert.equal(creditLevel(0, 200), 'empty');
  assert.equal(creditLevel(0, undefined), 'empty');
  assert.equal(creditLevel(20, 200), 'low');
  assert.equal(creditLevel(21, 200), 'ok');
  assert.equal(creditLevel(5, 80), 'low');
  assert.equal(creditLevel(6, 80), 'ok');
  assert.equal(creditLevel(6, null), 'ok');
});

test('while the starting balance is being read, only a balance low for everyone is low', () => {
  assert.equal(creditLevel(5, undefined), 'low');
  assert.equal(creditLevel(6, undefined), 'unknown');
});

/** Records the filters of the one query and answers `result`. */
function fakeClient(result, session = { user: { id: 'u1' } }) {
  const calls = [];
  const query = new Proxy({}, {
    get: (_, name) => {
      if (name === 'then') return (resolve) => resolve(result);
      return (...args) => { calls.push([name, ...args]); return query; };
    },
  });
  return {
    calls,
    auth: { getSession: async () => ({ data: { session } }) },
    from: (table) => { calls.push(['from', table]); return query; },
  };
}

test('the starting balance is the one right after the last credits added', async () => {
  const client = fakeClient({ data: [{ balance_after: 210 }], error: null });
  assert.equal(await readStartBalance(client), 210);
  const has = (...call) => assert.ok(client.calls.some((c) => JSON.stringify(c) === JSON.stringify(call)), JSON.stringify(call));
  has('from', 'credit_transactions');
  has('eq', 'user_id', 'u1');
  // A failed run gives its credit back as a positive movement: not an addition.
  has('gt', 'amount', OPTIMIZE_CREDIT_COST);
  has('order', 'created_at', { ascending: false });
  has('limit', 1);
});

test('an unreadable starting balance is unknown, never invented', async () => {
  assert.equal(await readStartBalance(fakeClient({ data: [], error: null })), null);
  assert.equal(await readStartBalance(fakeClient({ data: [{ balance_after: null }], error: null })), null);
  assert.equal(await readStartBalance(fakeClient({ data: null, error: { message: 'x' } })), null);
  assert.equal(await readStartBalance(fakeClient({ data: [], error: null }, null)), null);
});

test('the closed message is remembered, and a blocked storage breaks nothing', () => {
  const store = new Map();
  const storage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  };
  assert.equal(readDismissed(() => storage), false);
  writeDismissed(() => storage, true);
  assert.equal(readDismissed(() => storage), true);
  writeDismissed(() => storage, false);
  assert.equal(readDismissed(() => storage), false);
  const blocked = () => { throw new Error('blocked'); };
  assert.equal(readDismissed(blocked), false);
  assert.doesNotThrow(() => writeDismissed(blocked, true));
});

test('the low message gives the figure, the buy button and a way to close it', () => {
  const html = banner({ balance: 5, level: 'low', dismissible: true });
  assert.match(html, /Il vous reste 5 crédits\./);
  assert.match(html, /Acheter des crédits/);
  assert.match(html, /aria-label="Fermer"/);
  assert.match(banner({ balance: 1, level: 'low', dismissible: true }), /Il vous reste 1 crédit\./);
  assert.doesNotMatch(banner({ balance: 5, level: 'low' }), /aria-label="Fermer"/);
});

test('the empty message cannot be closed and never says the artisan is blocked', () => {
  const html = banner({ balance: 0, level: 'empty', dismissible: true });
  assert.match(html, /Vous n’avez plus de crédits\./);
  assert.match(html, /Acheter des crédits/);
  assert.doesNotMatch(html, /aria-label="Fermer"/);
});

test('nothing shows while credits are fine or unknown', () => {
  assert.equal(banner({ balance: 50, level: 'ok', dismissible: true }), '');
  assert.equal(banner({ balance: null, level: 'unknown', dismissible: true }), '');
});

test('the message speaks every language and hides its buy link in the app', () => {
  assert.match(banner({ balance: 5, level: 'low' }, 'en'), /You have 5 credits left\./);
  assert.match(banner({ balance: 5, level: 'low' }, 'ar'), /الأرصدة المتبقية: 5/);
  const link = banner({ balance: 5, level: 'low' }).match(/<a [^>]*href="\/credits"[^>]*>/)[0];
  assert.match(link, /data-sells/);
});

test('every balance badge follows the level', () => {
  for (const screen of ['atelier', 'account', 'history', 'panels']) {
    const source = read(`src/app/(site)/${screen}/page.tsx`);
    assert.match(source, /useCreditLevel\(/, screen);
    assert.match(source, /CREDIT_BADGE_TONES\[creditLevel\]/, screen);
  }
});

test('the message is in the atelier, where it closes, and on the credits usage page', () => {
  assert.match(read('src/app/(site)/atelier/page.tsx'), /<LowCreditsBanner balance=\{userCredits\} level=\{creditLevel\} dismissible \/>/);
  assert.match(read('src/app/(site)/account/credits/page.tsx'), /<LowCreditsBanner balance=\{credits\} level=\{creditLevel\} \/>/);
});

test('at zero, both refusals of the atelier offer to buy and refresh the balance', () => {
  const source = read('src/app/(site)/atelier/page.tsx');
  const photo = source.slice(source.indexOf('{visionError && ('));
  assert.match(photo.slice(0, 1200), /visionError === 'atelier\.visionError\.insufficientCredits'[\s\S]*?href="\/credits"[\s\S]*?data-sells=""[\s\S]*?account\.buyCredits/);
  const run = source.slice(source.indexOf("{optimizeError && ("));
  assert.match(run.slice(0, 900), /href="\/credits" data-sells=""[\s\S]*?account\.buyCredits/);
  assert.match(source, /res\.status === 402\) \{\s*if \(typeof data\?\.creditsRemaining === 'number'\) setUserCredits\(data\.creditsRemaining\);/);
});
