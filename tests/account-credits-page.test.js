const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// « Mon compte » opened on the credits, which confused artisans (user report,
// 2026-11-23): the balance and its movements live on their own page, and the
// account page keeps the settings only.

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const account = read('src/app/(site)/account/page.tsx');
const usage = read('src/app/(site)/account/credits/page.tsx');
const menu = read('src/components/AccountMenu.tsx');

test('the account page no longer carries the credit movements', () => {
  assert.doesNotMatch(account, /api\/credits\/history/);
  assert.doesNotMatch(account, /id="credits"/);
  for (const id of ['entreprise', 'currency', 'password']) assert.match(account, new RegExp(`id="${id}"`));
});

test('the credits usage page shows the balance, the movements and the buy button', () => {
  assert.match(usage, /api\/credits\/history/);
  assert.match(usage, /t\('accountPage\.creditsRemaining'\)/);
  assert.match(usage, /t\('account\.buyCredits'\)/);
  assert.match(usage, /redirect=\/account\/credits/);
});

test('the menu keeps the credit entries together, apart from the account ones', () => {
  const order = ['href="/credits"', 'href="/account/credits"', 'my-1 border-t border-studio-border', 'href="/account"', 'href="/account#password"'].map(
    (needle) => menu.indexOf(needle)
  );
  assert.ok(order.every((i) => i > 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test('nothing points at the former credits anchor', () => {
  const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const stale = walk(path.join(__dirname, '..', 'src')).filter((f) => /\.tsx?$/.test(f) && /\/account#credits/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(stale, []);
});
