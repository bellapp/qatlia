const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');
const { effectivePrivileges, livePolicies, splitStatements, tablesWithRlsEnabled } = require('./helpers/sql-inspect');

// Migration 018 backs the scan groups: one paid photo read opens a group of
// MAX_SCANS_PER_ANALYSIS reads for ANALYSIS_WINDOW_HOURS (spec 2026-11-17,
// several cut-list sheets per project). Only /api/vision touches it, with the
// service role. No Postgres is reachable here: the assertions are on the
// statements the database will receive.

const MIGRATION = 'supabase/migrations/018_scan_groups.sql';
const sql = fs.readFileSync(path.resolve(__dirname, '..', MIGRATION), 'utf8');
const statements = splitStatements(sql).map((statement) => statement.replace(/\s+/g, ' ').trim());
const policy = () => loadTsModule('src/lib/billing/policy.ts');

const TABLE = 'public.scan_groups';
const FUNCTIONS = [
  'public.open_scan_group(UUID)',
  'public.scan_group_has_room(UUID, UUID)',
  'public.claim_scan_read(UUID, UUID)',
];

const functionBody = (name) =>
  statements.find((statement) => new RegExp(`^CREATE OR REPLACE FUNCTION public\\.${name}\\(`, 'i').test(statement));

test('the scan groups table is created idempotently, owned by a profile', () => {
  const create = statements.find((statement) => statement.toLowerCase().startsWith(`create table if not exists ${TABLE} (`));
  assert.ok(create, 'scan_groups must be created with CREATE TABLE IF NOT EXISTS');
  assert.match(create, /\buser_id\s+UUID\s+NOT NULL\s+REFERENCES\s+public\.profiles\s*\(\s*id\s*\)\s+ON DELETE CASCADE/i);
  assert.match(create, /\breads_used\s+INT(EGER)?\s+NOT NULL\s+DEFAULT\s+1\b/i);
  assert.match(create, /\bcreated_at\s+TIMESTAMPTZ\s+NOT NULL\s+DEFAULT\s+now\(\)/i);
});

test('no client role can read or write scan groups', () => {
  assert.ok(tablesWithRlsEnabled(sql).has(TABLE), 'RLS must be enabled');
  assert.equal(livePolicies(sql).filter((policyRow) => policyRow.table === TABLE).length, 0, 'no policy: service role only');
  for (const role of ['anon', 'authenticated']) {
    assert.deepEqual(effectivePrivileges(sql, TABLE, role), {}, `${role} must have no privilege on ${TABLE}`);
  }
});

test('the three functions are replaceable, definer-run and executable by the service role only', () => {
  for (const signature of FUNCTIONS) {
    const name = signature.slice('public.'.length, signature.indexOf('('));
    const body = functionBody(name);
    assert.ok(body, `${name} must be created with CREATE OR REPLACE`);
    assert.match(body, /SECURITY DEFINER/i, `${name} must run as definer`);
    assert.match(body, /SET search_path = public, pg_temp/i, `${name} must pin its search_path`);
    const escaped = signature.replace(/[().]/g, '\\$&').replace(/\s+/g, '\\s*');
    assert.ok(
      statements.some((s) => new RegExp(`^REVOKE ALL ON FUNCTION ${escaped} FROM PUBLIC, anon, authenticated$`, 'i').test(s)),
      `${signature} must be revoked from client roles`
    );
    assert.ok(
      statements.some((s) => new RegExp(`^GRANT EXECUTE ON FUNCTION ${escaped} TO service_role$`, 'i').test(s)),
      `${signature} must be granted to service_role`
    );
  }
});

test('the SQL limits are the ones the policy states', () => {
  const { MAX_SCANS_PER_ANALYSIS, ANALYSIS_WINDOW_HOURS } = policy();
  assert.equal(MAX_SCANS_PER_ANALYSIS, 4);
  for (const name of ['scan_group_has_room', 'claim_scan_read']) {
    const body = functionBody(name);
    assert.match(body, new RegExp(`reads_used < ${MAX_SCANS_PER_ANALYSIS}\\b`), `${name} must cap reads at ${MAX_SCANS_PER_ANALYSIS}`);
    assert.match(body, new RegExp(`interval '${ANALYSIS_WINDOW_HOURS} hours'`, 'i'), `${name} must use the ${ANALYSIS_WINDOW_HOURS} h window`);
    assert.match(body, /user_id = p_user_id/, `${name} must only see the caller's own groups`);
  }
  assert.match(functionBody('open_scan_group'), /INSERT INTO public\.scan_groups \(user_id\) VALUES \(p_user_id\) RETURNING id/i);
  assert.match(sql, new RegExp(`CHECK \\(reads_used BETWEEN 1 AND ${MAX_SCANS_PER_ANALYSIS}\\)`, 'i'));
});

test('claiming a read is one conditional update, so two racing reads cannot both win', () => {
  const body = functionBody('claim_scan_read');
  assert.match(body, /UPDATE public\.scan_groups SET reads_used = reads_used \+ 1/i);
  assert.match(body, /RETURNING reads_used/i);
  assert.ok(!/SELECT[^;]*FROM public\.scan_groups/i.test(body), 'no read-then-write: the UPDATE is the decision');
});
