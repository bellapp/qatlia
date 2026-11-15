const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Meta checks qatlia.ma for this tag before it trusts the QatliA business
// portfolio (needed to add the WhatsApp bot's phone number). Both root layouts
// spread sharedMetadata, so the tag must live there and no layout may override it.
const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('the shared metadata carries the Meta domain verification tag', () => {
  const shell = read('src/app/site-shell.ts');
  assert.match(shell, /verification:\s*\{\s*other:\s*\{\s*"facebook-domain-verification":\s*"w739k3ckib7axcvs2dho307xo7djgs"/);
});

test('neither root layout overrides the verification metadata', () => {
  for (const layout of ['src/app/(site)/layout.tsx', 'src/app/(ar)/layout.tsx']) {
    assert.ok(read(layout).includes('...sharedMetadata'), layout);
    assert.ok(!read(layout).includes('verification'), layout);
  }
});
