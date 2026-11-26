const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { splitStatements, tablesWithRlsEnabled, effectivePrivileges, livePolicies } = require('./helpers/sql-inspect');
const { loadTsModule } = require('./helpers/load-ts-module');

// The back office migrations (plan 2026-11-12). No Postgres is reachable here,
// so these assert the statements the database will receive: every admin
// object is closed to the client roles, every admin function is a
// SECURITY DEFINER with a pinned search_path, and the existing credit
// functions are never redefined.

const PROJECT_ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(PROJECT_ROOT, 'supabase/migrations', file), 'utf8');
const flat = (sql) => splitStatements(sql).map((s) => s.replace(/\s+/g, ' ').trim());

const { LEDGER_KEY_PREFIXES } = loadTsModule('src/lib/admin/ledger.ts');

function assertClosedTable(sql, table) {
  assert.ok(tablesWithRlsEnabled(sql).has(table), `${table} must have RLS enabled`);
  assert.deepEqual(
    livePolicies(sql).filter((p) => p.table === table),
    [],
    `${table} must have no policy: every client-role command is denied`
  );
  for (const role of ['anon', 'authenticated']) {
    assert.deepEqual(effectivePrivileges(sql, table, role), {}, `${role} must hold no privilege on ${table}`);
  }
}

function assertServiceRoleFunction(sql, name, signature) {
  const statements = flat(sql);
  const fn = statements.find((s) => new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\b`, 'i').test(s));
  assert.ok(fn, `${name} must be defined`);
  assert.match(fn, /SECURITY DEFINER/i);
  assert.match(fn, /SET search_path = public, pg_temp/i);
  const escaped = signature.replace(/[()]/g, '\\$&');
  assert.ok(
    statements.some((s) => new RegExp(`^REVOKE ALL ON FUNCTION public\\.${name}${escaped} FROM PUBLIC, anon, authenticated$`, 'i').test(s)),
    `${name} must be revoked from PUBLIC, anon, authenticated`
  );
  assert.ok(
    statements.some((s) => new RegExp(`^GRANT EXECUTE ON FUNCTION public\\.${name}${escaped} TO service_role$`, 'i').test(s)),
    `${name} must be executable by service_role`
  );
  assert.ok(
    !statements.some((s) => new RegExp(`^GRANT .*${name}.* TO .*(anon|authenticated|public)`, 'i').test(s)),
    `${name} must not be granted to a client role`
  );
}

function assertNoExistingFunctionTouched(sql) {
  assert.doesNotMatch(sql, /FUNCTION public\.(add_credits|consume_credit|ensure_profile|handle_new_user)\b/i);
}

// ─── 012 ────────────────────────────────────────────────────────────────────

const SQL_012 = read('012_admin_clients.sql');

test('012 : admin_client_notes est fermée aux rôles clients', () => {
  assertClosedTable(SQL_012, 'public.admin_client_notes');
});

test('012 : admin_client_list est SECURITY DEFINER, search_path figé, service_role seul', () => {
  assertServiceRoleFunction(SQL_012, 'admin_client_list', '(TEXT, TEXT, TEXT, INT, INT)');
});

test('012 : admin_client_list est en LANGUAGE sql (pas de masquage par les colonnes de sortie)', () => {
  const fn = flat(SQL_012).find((s) => /CREATE OR REPLACE FUNCTION public\.admin_client_list/i.test(s));
  assert.match(fn, /LANGUAGE sql/i);
  assert.doesNotMatch(fn, /LANGUAGE plpgsql/i);
});

test('012 : le SQL classe les paiements avec les mêmes préfixes que ledger.ts', () => {
  for (const key of ['manual', 'creem', 'stripe']) {
    assert.ok(SQL_012.includes(`'${LEDGER_KEY_PREFIXES[key]}%'`), `missing prefix ${LEDGER_KEY_PREFIXES[key]}`);
  }
});

test('012 : chaque clé de tri a son propre CASE (pas de types mélangés)', () => {
  const fn = flat(SQL_012).find((s) => /CREATE OR REPLACE FUNCTION public\.admin_client_list/i.test(s));
  for (const sort of ['last_activity_desc', 'credits_asc', 'credits_desc', 'paid_desc', 'scans_desc']) {
    assert.match(fn, new RegExp(`CASE WHEN p_sort = '${sort}' THEN f\\.\\w+ END`));
  }
});

test('012 : aucune exécution de SQL dynamique, aucune fonction existante modifiée', () => {
  assert.doesNotMatch(SQL_012, /\bEXECUTE\s+(format|')/i);
  assertNoExistingFunctionTouched(SQL_012);
});

// ─── 013 ────────────────────────────────────────────────────────────────────

const SQL_013 = read('013_admin_payments.sql');

test('013 : admin_audit_log est fermée aux rôles clients', () => {
  assertClosedTable(SQL_013, 'public.admin_audit_log');
});

test('013 : admin_kpis est SECURITY DEFINER, search_path figé, service_role seul, fuseau Casablanca', () => {
  assertServiceRoleFunction(SQL_013, 'admin_kpis', '()');
  assert.ok(SQL_013.includes("'Africa/Casablanca'"));
});

test('013 : le grand livre reste sans écriture pour les rôles clients après 013', () => {
  const replay = ['001_initial_schema.sql', '004_create_public_schema.sql', '005_credit_policy.sql', '013_admin_payments.sql']
    .map(read)
    .join('\n');
  for (const role of ['anon', 'authenticated']) {
    const privileges = effectivePrivileges(replay, 'public.credit_transactions', role);
    for (const write of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
      assert.equal(privileges[write], undefined, `${role} must not hold ${write} on credit_transactions`);
    }
  }
});

test('013 : colonnes ajoutées sans toucher aux fonctions existantes', () => {
  assert.match(SQL_013, /ADD COLUMN IF NOT EXISTS amount_paid NUMERIC\(10,2\)/i);
  assert.match(SQL_013, /ADD COLUMN IF NOT EXISTS currency\s+TEXT/i);
  assertNoExistingFunctionTouched(SQL_013);
});

// ─── 014 ────────────────────────────────────────────────────────────────────

const SQL_014 = read('014_admin_actions.sql');

test('014 : admin_adjust_credits est SECURITY DEFINER, search_path figé, service_role seul', () => {
  assertServiceRoleFunction(SQL_014, 'admin_adjust_credits', '(UUID, INT, TEXT)');
});

test('014 : verrou, clé idempotente admin:, refus du solde négatif', () => {
  const fn = flat(SQL_014).find((s) => /CREATE OR REPLACE FUNCTION public\.admin_adjust_credits/i.test(s));
  assert.match(fn, /FOR UPDATE/);
  assert.ok(fn.includes(`'${LEDGER_KEY_PREFIXES.admin}'`));
  assert.match(fn, /ON CONFLICT \(stripe_payment_id\)/);
  assert.match(fn, /'INSUFFICIENT_CREDITS'/);
  assert.match(fn, /'INVALID_DELTA'/);
  assertNoExistingFunctionTouched(SQL_014);
});

// ─── 021 ────────────────────────────────────────────────────────────────────

const SQL_021 = read('021_admin_client_phones.sql');
const { CLIENT_SORTS } = loadTsModule('src/lib/admin/clients.ts');
const fn021 = () => flat(SQL_021).find((s) => /CREATE OR REPLACE FUNCTION public\.admin_client_list/i.test(s));

test('021 : admin_client_list garde sa signature, SECURITY DEFINER, service_role seul, LANGUAGE sql', () => {
  assertServiceRoleFunction(SQL_021, 'admin_client_list', '(TEXT, TEXT, TEXT, INT, INT)');
  assert.match(fn021(), /LANGUAGE sql/i);
  // Dropped first: the result gains two columns.
  const statements = flat(SQL_021);
  const drop = statements.findIndex((s) => /^DROP FUNCTION IF EXISTS public\.admin_client_list\(TEXT, TEXT, TEXT, INT, INT\)$/i.test(s));
  assert.ok(drop >= 0 && drop < statements.indexOf(fn021()));
});

test('021 : chaque tri de CLIENT_SORTS a son propre CASE (sauf le tri par défaut)', () => {
  const fn = fn021();
  for (const sort of CLIENT_SORTS.filter((s) => s !== 'created_desc')) {
    assert.match(fn, new RegExp(`CASE WHEN p_sort = '${sort}' THEN [^;]+? END (ASC|DESC) NULLS LAST`), `missing CASE for ${sort}`);
  }
  assert.match(fn, /f\.signed_up_at DESC NULLS LAST,\s*f\.user_id/);
});

test('021 : numéros WhatsApp et entreprise renvoyés et cherchés par leurs chiffres', () => {
  const fn = fn021();
  assert.match(fn, /whatsapp\s+TEXT,\s*atelier_phone\s+TEXT,\s*total_count\s+BIGINT/i);
  assert.match(fn, /LEFT JOIN public\.whatsapp_photo_reads wr ON wr\.code = \(u\.raw_user_meta_data->>'whatsapp_code'\)/);
  assert.match(fn, /LEFT JOIN public\.ateliers a ON a\.user_id = u\.id/);
  // 00212 / 212 / 0 removed from the term, at least 6 digits left.
  assert.ok(fn.includes("'^(00212|212|00|0)'"));
  assert.match(fn, /\) >= 6/);
  for (const column of ['b.phone', 'b.whatsapp', 'b.atelier_phone']) {
    assert.ok(fn.includes(`regexp_replace(COALESCE(${column}, ''), '\\D', '', 'g') LIKE '%' || s.phone_core || '%'`), column);
  }
});

test('021 : rien d’autre n’est touché, aucun SQL dynamique', () => {
  assert.doesNotMatch(SQL_021, /\bEXECUTE\s+(format|')/i);
  assert.doesNotMatch(SQL_021, /\b(CREATE|ALTER|DROP) TABLE\b/i);
  assertNoExistingFunctionTouched(SQL_021);
  assert.match(SQL_021, /REQUIRES 019 \(whatsapp_photo_reads\) and 020 \(ateliers\)/);
});

module.exports = { assertClosedTable, assertServiceRoleFunction, assertNoExistingFunctionTouched, read, flat };
