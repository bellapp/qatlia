const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { effectivePrivileges, livePolicies, splitStatements, tablesWithRlsEnabled } = require('./helpers/sql-inspect');

// Migration 019 backs the WhatsApp photo reading (plan 2026-11-19, Task 3):
// one row per photo read, written by the webhook with the service role only.

const MIGRATION = 'supabase/migrations/019_whatsapp_photo_reads.sql';
const sql = fs.readFileSync(path.resolve(__dirname, '..', MIGRATION), 'utf8');
const statements = splitStatements(sql).map((s) => s.replace(/\s+/g, ' ').trim());
const TABLE = 'public.whatsapp_photo_reads';
const create = statements.find((s) => s.toLowerCase().startsWith(`create table if not exists ${TABLE} (`));

test('the table is created idempotently with its columns', () => {
  assert.ok(create, 'CREATE TABLE IF NOT EXISTS public.whatsapp_photo_reads');
  assert.match(create, /\bid\s+UUID\s+PRIMARY KEY\s+DEFAULT\s+gen_random_uuid\(\)/i);
  assert.match(create, /\bwa_id\s+TEXT\s+NOT NULL\s+REFERENCES\s+public\.whatsapp_contacts\s*\(\s*wa_id\s*\)\s+ON DELETE CASCADE/i);
  assert.match(create, /\bstatus\s+TEXT\s+NOT NULL\s+CHECK\s*\(\s*status\s+IN\s*\(\s*'reading'\s*,\s*'ok'\s*,\s*'failed'\s*\)\s*\)/i);
  assert.match(create, /\bcode\s+TEXT\s+UNIQUE\b/i);
  for (const column of ['pieces JSONB', 'sheet JSONB', 'summary JSONB', 'expires_at TIMESTAMPTZ', 'opened_at TIMESTAMPTZ']) {
    assert.ok(create.includes(column) && !create.includes(`${column} NOT NULL`), `${column} nullable`);
  }
  assert.match(create, /\bcreated_at\s+TIMESTAMPTZ\s+NOT NULL\s+DEFAULT\s+now\(\)/i);
});

test('one reading or successful read per number, enforced by a partial unique index', () => {
  const index = statements.find((s) => /^CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_photo_reads_one_per_number\b/i.test(s));
  assert.ok(index);
  assert.match(index, /ON public\.whatsapp_photo_reads\s*\(\s*wa_id\s*\)\s+WHERE\s+status\s+IN\s*\(\s*'reading'\s*,\s*'ok'\s*\)/i);
  assert.ok(statements.some((s) => /^CREATE INDEX IF NOT EXISTS whatsapp_photo_reads_created_at_idx ON public\.whatsapp_photo_reads\s*\(\s*created_at\s*\)/i.test(s)));
});

test('RLS on, no policy, client roles hold nothing, service_role everything', () => {
  assert.ok(tablesWithRlsEnabled(sql).has(TABLE));
  assert.equal(livePolicies(sql).filter((p) => p.table === TABLE).length, 0);
  for (const role of ['anon', 'authenticated']) assert.deepEqual(effectivePrivileges(sql, TABLE, role), {});
  const service = effectivePrivileges(sql, TABLE, 'service_role');
  for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) assert.equal(service[privilege], true);
});

test('additive only', () => {
  assert.ok(!/\bDROP\s+(TABLE|COLUMN|FUNCTION|INDEX)\b/i.test(sql));
  for (const name of ['add_credits', 'consume_credit', 'ensure_profile']) assert.ok(!sql.includes(name));
});
