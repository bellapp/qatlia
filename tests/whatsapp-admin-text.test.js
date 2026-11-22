const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The owner answers prospects by hand through the bot (22/11/2026): a text to
// a phone number or to a business-scoped id (a user with a username, whom the
// YCloud inbox could not reach from the bot's side), admin only, logged.
const ROOT = path.resolve(__dirname, '..');

test('the back office sends a text to a number or a business-scoped id, signed in as admin only', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src/app/api/admin/whatsapp/text/route.ts'), 'utf8');
  assert.match(source, /authorizeAdminRequest\(req\)/);
  assert.match(source, /body: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(1024\)/);
  assert.match(source, /isBusinessScopedId\(/);
  assert.ok(source.includes('/^\\d{8,15}$/'), 'a phone number is digits only');
  assert.match(source, /sendText\(config, to, body\)/);
  assert.match(source, /recordOutbound\(db, \{ waId: to, wamid, direction: 'human', kind: 'admin_text', body \}\)/);
});
