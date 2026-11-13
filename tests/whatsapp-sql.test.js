const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  effectivePrivileges,
  livePolicies,
  parseTableGrants,
  splitStatements,
  tablesWithRlsEnabled,
} = require('./helpers/sql-inspect');

// Migration 015 backs the WhatsApp bot (src/app/api/whatsapp/webhook). Both
// tables are written and read by the webhook route with the service role only:
// no client role may touch them, so there is no policy and no client grant.
//
// No Postgres is reachable from this environment, so the assertions are on the
// statements the database will receive, replayed in file order.

const MIGRATION = 'supabase/migrations/015_whatsapp_bot.sql';
const sql = fs.readFileSync(path.resolve(__dirname, '..', MIGRATION), 'utf8');
const statements = splitStatements(sql).map((statement) => statement.replace(/\s+/g, ' ').trim());

const TABLES = ['public.whatsapp_contacts', 'public.whatsapp_messages'];
const SEQUENCE = 'public.whatsapp_messages_id_seq';
const CLIENT_ROLES = ['anon', 'authenticated'];

const createStatement = (table) =>
  statements.find((statement) => statement.toLowerCase().startsWith(`create table if not exists ${table} (`));

test('both tables are created idempotently', () => {
  for (const table of TABLES) {
    assert.ok(createStatement(table), `${table} must be created with CREATE TABLE IF NOT EXISTS`);
  }
  assert.ok(
    !statements.some((statement) => /^CREATE TABLE (?!IF NOT EXISTS)/i.test(statement)),
    'every CREATE TABLE must carry IF NOT EXISTS so the migration can be re-run'
  );
});

test('whatsapp_contacts is keyed by wa_id and constrains the language', () => {
  const create = createStatement('public.whatsapp_contacts');
  assert.match(create, /\bwa_id\s+TEXT\s+PRIMARY KEY\b/i);
  assert.match(create, /\blang\s+TEXT\s+NOT NULL\s+DEFAULT\s+'fr'\s+CHECK\s*\(\s*lang\s+IN\s*\(\s*'fr'\s*,\s*'ar'\s*\)\s*\)/i);
  for (const column of ['profile_name TEXT', 'greeted_at TIMESTAMPTZ', 'handoff_until TIMESTAMPTZ', 'referral JSONB']) {
    assert.ok(create.includes(column) && !new RegExp(`${column} NOT NULL`, 'i').test(create), `${column} must be nullable`);
  }
  assert.match(create, /\bcreated_at\s+TIMESTAMPTZ\s+NOT NULL\s+DEFAULT\s+now\(\)/i);
  assert.match(create, /\bupdated_at\s+TIMESTAMPTZ\s+NOT NULL\s+DEFAULT\s+now\(\)/i);
});

test('whatsapp_messages dedupes on wamid and cascades from its contact', () => {
  const create = createStatement('public.whatsapp_messages');
  assert.match(create, /\bid\s+BIGSERIAL\s+PRIMARY KEY\b/i);
  assert.match(create, /\bwamid\s+TEXT\s+UNIQUE\b/i, 'wamid must be UNIQUE: Meta redelivers webhooks');
  assert.match(
    create,
    /\bwa_id\s+TEXT\s+NOT NULL\s+REFERENCES\s+public\.whatsapp_contacts\s*\(\s*wa_id\s*\)\s+ON DELETE CASCADE\b/i
  );
  assert.match(create, /\bdirection\s+TEXT\s+NOT NULL\s+CHECK\s*\(\s*direction\s+IN\s*\(\s*'user'\s*,\s*'bot'\s*,\s*'human'\s*\)\s*\)/i);
  assert.match(create, /\bkind\s+TEXT\s+NOT NULL\b/i);
  assert.match(create, /\bbody\s+TEXT\b(?!\s+NOT NULL)/i);
  assert.match(create, /\bcreated_at\s+TIMESTAMPTZ\s+NOT NULL\s+DEFAULT\s+now\(\)/i);
});

test('the conversation index serves the newest-first history read', () => {
  const index = statements.find((statement) => /^CREATE INDEX IF NOT EXISTS whatsapp_messages_wa_id_created_at_idx\b/i.test(statement));
  assert.ok(index, 'whatsapp_messages_wa_id_created_at_idx must be created idempotently');
  assert.match(index, /ON public\.whatsapp_messages\s*\(\s*wa_id\s*,\s*created_at DESC\s*\)/i);
});

test('row-level security is on for both tables and no policy exists', () => {
  const enabled = tablesWithRlsEnabled(sql);
  for (const table of TABLES) {
    assert.ok(enabled.has(table), `${table} must be under row-level security`);
  }
  assert.ok(!/\bCREATE\s+POLICY\b/i.test(sql), 'no CREATE POLICY: the service role bypasses RLS and clients get nothing');
  assert.deepEqual(livePolicies(sql), []);
});

test('client roles hold no privilege on either table and service_role holds everything', () => {
  for (const table of TABLES) {
    for (const role of CLIENT_ROLES) {
      assert.deepEqual(effectivePrivileges(sql, table, role), {}, `${role} must hold no privilege on ${table}`);
    }
    const service = effectivePrivileges(sql, table, 'service_role');
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      assert.equal(service[privilege], true, `service_role must hold ${privilege} on ${table}`);
    }
  }
});

test('the revokes name PUBLIC, anon and authenticated and come before the grants', () => {
  const grants = parseTableGrants(sql);
  for (const table of TABLES) {
    const forTable = grants.filter((grant) => grant.table === table);
    const revoke = forTable.find((grant) => grant.action === 'REVOKE');
    assert.ok(revoke, `${table} needs a REVOKE`);
    assert.deepEqual(revoke.privileges, [{ privilege: 'ALL', columns: null }]);
    assert.deepEqual([...revoke.roles].sort(), ['anon', 'authenticated', 'public']);
    assert.equal(forTable.findIndex((grant) => grant.action === 'REVOKE'), 0, 'the revoke must precede the service_role grant');
    const grant = forTable.find((grant) => grant.action === 'GRANT');
    assert.ok(grant, `${table} needs a GRANT`);
    assert.deepEqual(grant.roles, ['service_role']);
  }
});

test('the bigserial sequence is locked down the same way', () => {
  const sequenceStatements = statements.filter((statement) => /\bON SEQUENCE\b/i.test(statement));
  const revoke = sequenceStatements.find((statement) => /^REVOKE\b/i.test(statement));
  const grant = sequenceStatements.find((statement) => /^GRANT\b/i.test(statement));

  assert.ok(revoke, 'the sequence needs a REVOKE');
  assert.equal(revoke.toUpperCase(), `REVOKE ALL ON SEQUENCE ${SEQUENCE} FROM PUBLIC, ANON, AUTHENTICATED`.toUpperCase());
  assert.ok(grant, 'the sequence needs a GRANT');
  assert.equal(grant.toUpperCase(), `GRANT ALL ON SEQUENCE ${SEQUENCE} TO SERVICE_ROLE`.toUpperCase());
  assert.ok(sequenceStatements.indexOf(revoke) < sequenceStatements.indexOf(grant));
});

test('the migration is additive: no credit function is touched, nothing is dropped', () => {
  for (const name of ['add_credits', 'consume_credit', 'ensure_profile']) {
    assert.ok(!sql.includes(name), `${name} must not be mentioned: this migration is unrelated to credits`);
  }
  assert.ok(!/\bDROP\s+(TABLE|COLUMN|FUNCTION)\b/i.test(sql), 'no destructive statement');
  assert.ok(!/\bFULL_DATABASE_SETUP\b/.test(sql));
});
