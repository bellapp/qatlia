const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  effectivePrivileges,
  parsePolicies,
  parseTableGrants,
  tablesWithRlsEnabled,
  droppedPolicies,
  livePolicies,
  splitStatements,
} = require('./helpers/sql-inspect');

// P0 Task 5 blocker #1 — the credit balance must not be client-writable.
//
// Migrations 001/004 shipped `CREATE POLICY ... FOR ALL USING (auth.uid() = id)`
// on profiles plus a blanket `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES
// TO authenticated`. Together those let any signed-in browser session run
//
//     update profiles set credits = 999999 where id = auth.uid();
//     insert into credit_transactions (user_id, amount, ...) values (...);
//
// straight through PostgREST with the anon key, which makes the whole paid
// ledger decorative. The lockdown below has to survive being applied *after*
// those earlier migrations, so these tests replay the grants in file order
// rather than grepping for a REVOKE line.
//
// No Postgres is reachable from this environment, so nothing here claims to
// have executed SQL — the assertions are on the statements the database will
// receive, computed with the same last-writer-wins ordering Postgres applies.

const PROJECT_ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8');

const MIGRATION_005 = 'supabase/migrations/005_credit_policy.sql';
const FULL_SETUP = 'supabase/migrations/FULL_DATABASE_SETUP.sql';

// FULL_DATABASE_SETUP is a standalone script: it must contain the lockdown on
// its own. Migration 005 is applied on top of 001-004, so its lockdown is
// evaluated against the union of the earlier grants it has to override.
const SCRIPTS = {
  [MIGRATION_005]: () =>
    ['001_initial_schema.sql', '004_create_public_schema.sql', '005_credit_policy.sql']
      .map((file) => read(`supabase/migrations/${file}`))
      .join('\n'),
  [FULL_SETUP]: () => read(FULL_SETUP),
};

const CLIENT_ROLES = ['authenticated', 'anon'];
const WRITE_PRIVILEGES = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'];
const CREDIT_TABLES = ['public.profiles', 'public.credit_transactions'];

/** The credit-table policies still standing once the whole script has run. */
const survivingPolicies = (sql) => livePolicies(sql).filter((policy) => CREDIT_TABLES.includes(policy.table));

// ---------------------------------------------------------------------------
// profiles.credits is unreachable for a client role
// ---------------------------------------------------------------------------

for (const [label, load] of Object.entries(SCRIPTS)) {
  test(`${label}: no client role can write profiles.credits`, () => {
    const sql = load();

    for (const role of CLIENT_ROLES) {
      const privileges = effectivePrivileges(sql, 'public.profiles', role);

      for (const privilege of WRITE_PRIVILEGES) {
        const held = privileges[privilege];
        if (held === undefined) continue;
        assert.notEqual(
          held,
          true,
          `${role} must not hold whole-table ${privilege} on profiles (that includes credits)`
        );
        assert.ok(
          !held.includes('credits'),
          `${role} must not hold ${privilege} on profiles.credits — got columns [${held.join(', ')}]`
        );
      }
    }
  });

  test(`${label}: authenticated keeps only column-scoped profile self-service`, () => {
    const sql = load();
    const privileges = effectivePrivileges(sql, 'public.profiles', 'authenticated');

    assert.equal(privileges.SELECT, true, 'a user must still be able to read their own profile row');
    assert.equal(privileges.DELETE, undefined, 'a user must not be able to delete their profile to reset credits');

    // The app only ever writes id/email/full_name (src/app/api/projects/route.ts
    // upsert) and locale is a declared user preference in the schema. Anything
    // outside that set is not self-service and must not be granted.
    const ALLOWED_SELF_SERVICE = ['email', 'full_name', 'id', 'locale'];
    for (const privilege of ['INSERT', 'UPDATE']) {
      const held = privileges[privilege];
      if (held === undefined) continue;
      assert.notEqual(held, true, `${privilege} on profiles must be column-scoped, not whole-table`);
      for (const column of held) {
        assert.ok(
          ALLOWED_SELF_SERVICE.includes(column),
          `profiles.${column} is not a self-service field and must not be granted (${privilege})`
        );
      }
    }
  });

  test(`${label}: anon holds no privilege at all on profiles or the ledger`, () => {
    const sql = load();

    for (const table of ['public.profiles', 'public.credit_transactions']) {
      assert.deepEqual(
        effectivePrivileges(sql, table, 'anon'),
        {},
        `anon must hold no privilege on ${table}`
      );
    }
  });

  // -------------------------------------------------------------------------
  // credit_transactions is append-only, and only by the service role
  // -------------------------------------------------------------------------

  test(`${label}: no client role can INSERT/UPDATE/DELETE credit_transactions`, () => {
    const sql = load();

    for (const role of CLIENT_ROLES) {
      const privileges = effectivePrivileges(sql, 'public.credit_transactions', role);
      for (const privilege of WRITE_PRIVILEGES) {
        assert.equal(
          privileges[privilege],
          undefined,
          `${role} must hold no ${privilege} on credit_transactions — the ledger is written by SECURITY DEFINER functions only`
        );
      }
    }
  });

  test(`${label}: authenticated may read its own ledger`, () => {
    const sql = load();
    const privileges = effectivePrivileges(sql, 'public.credit_transactions', 'authenticated');

    assert.equal(privileges.SELECT, true, '/api/credits/history renders the user\'s own transactions');
  });

  test(`${label}: service_role retains full access so the RPCs keep working`, () => {
    const sql = load();

    for (const table of ['public.profiles', 'public.credit_transactions']) {
      const privileges = effectivePrivileges(sql, table, 'service_role');
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE']) {
        assert.equal(privileges[privilege], true, `service_role must retain ${privilege} on ${table}`);
      }
    }
  });

  // -------------------------------------------------------------------------
  // RLS policies
  // -------------------------------------------------------------------------

  test(`${label}: RLS is enabled on profiles and credit_transactions`, () => {
    const sql = load();
    const enabled = tablesWithRlsEnabled(sql);

    assert.ok(enabled.has('public.profiles'), 'profiles must be under row-level security');
    assert.ok(enabled.has('public.credit_transactions'), 'credit_transactions must be under row-level security');
  });

  test(`${label}: the permissive legacy FOR ALL policies are dropped`, () => {
    const sql = load();
    const dropped = droppedPolicies(sql).filter(
      (policy) => policy.table === 'public.profiles' || policy.table === 'public.credit_transactions'
    );
    const names = dropped.map((policy) => policy.name);

    for (const legacy of [
      'Users can view own profile',
      'Users can view and edit own profile',
      'Users can view own transactions',
    ]) {
      assert.ok(names.includes(legacy), `the legacy policy "${legacy}" must be dropped by name`);
    }
  });

  test(`${label}: the surviving policies grant reads only, never a blanket FOR ALL`, () => {
    const sql = load();
    const surviving = survivingPolicies(sql);

    for (const policy of surviving) {
      assert.notEqual(
        policy.command,
        'ALL',
        `policy "${policy.name}" on ${policy.table} is FOR ALL, which re-opens UPDATE on credits`
      );
    }

    const ledgerPolicies = surviving.filter((policy) => policy.table === 'public.credit_transactions');
    assert.ok(ledgerPolicies.length > 0, 'the ledger needs at least a SELECT-own policy');
    for (const policy of ledgerPolicies) {
      assert.equal(
        policy.command,
        'SELECT',
        `credit_transactions policy "${policy.name}" must be SELECT-only; writes belong to the service role`
      );
    }
  });

  test(`${label}: profile policies scope every command to the caller's own row`, () => {
    const sql = load();
    const profilePolicies = survivingPolicies(sql).filter((policy) => policy.table === 'public.profiles');

    assert.ok(profilePolicies.length > 0, 'profiles needs at least a SELECT-own policy');

    for (const policy of profilePolicies) {
      assert.match(
        policy.statement,
        /auth\.uid\(\) = id/i,
        `policy "${policy.name}" must restrict rows to the caller`
      );
      if (policy.command === 'INSERT' || policy.command === 'UPDATE') {
        assert.match(
          policy.statement,
          /WITH CHECK/i,
          `policy "${policy.name}" writes rows and must carry a WITH CHECK, or a user could move a row to another id`
        );
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Ordering — the lockdown has to come last to actually take effect
// ---------------------------------------------------------------------------

test('the lockdown revokes come after every blanket grant that would undo them', () => {
  const sql = SCRIPTS[MIGRATION_005]();
  const grants = parseTableGrants(sql);

  const lastBlanketGrant = grants.reduce(
    (last, grant, index) =>
      grant.action === 'GRANT' &&
      grant.roles.includes('authenticated') &&
      grant.privileges.some((p) => p.privilege === 'ALL' || (WRITE_PRIVILEGES.includes(p.privilege) && p.columns === null))
        ? index
        : last,
    -1
  );

  const lastRevoke = grants.reduce(
    (last, grant, index) =>
      grant.action === 'REVOKE' && grant.roles.includes('authenticated') ? index : last,
    -1
  );

  assert.ok(lastRevoke > -1, 'the migration must revoke the inherited blanket grants');
  assert.ok(
    lastRevoke > lastBlanketGrant,
    'a blanket GRANT to authenticated appears after the last REVOKE, so the lockdown would be undone'
  );
});

test('the two scripts express the same lockdown for the credit tables', () => {
  const fromMigration = SCRIPTS[MIGRATION_005]();
  const fromFullSetup = SCRIPTS[FULL_SETUP]();

  for (const table of ['public.profiles', 'public.credit_transactions']) {
    for (const role of ['authenticated', 'anon']) {
      assert.deepEqual(
        effectivePrivileges(fromFullSetup, table, role),
        effectivePrivileges(fromMigration, table, role),
        `${role} must end up with identical privileges on ${table} whichever script was run`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// The helper itself — an inspector that silently matches nothing would make
// every assertion above vacuously pass.
// ---------------------------------------------------------------------------

test('the SQL reader does not split statements inside a plpgsql body', () => {
  const statements = splitStatements(read(MIGRATION_005));
  const consumeCredit = statements.filter((statement) =>
    /CREATE OR REPLACE FUNCTION public\.consume_credit/i.test(statement)
  );

  assert.equal(consumeCredit.length, 1, 'consume_credit must be read as a single statement, not split on its inner semicolons');
  assert.match(consumeCredit[0], /RETURN jsonb_build_object\('success', true/);
});

test('the SQL reader detects a blanket grant and a column-scoped grant differently', () => {
  const blanket = effectivePrivileges('GRANT UPDATE ON public.profiles TO authenticated;', 'public.profiles', 'authenticated');
  const scoped = effectivePrivileges(
    'GRANT UPDATE (email, full_name) ON public.profiles TO authenticated;',
    'public.profiles',
    'authenticated'
  );
  const revoked = effectivePrivileges(
    'GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated; REVOKE ALL ON public.profiles FROM authenticated;',
    'public.profiles',
    'authenticated'
  );

  assert.equal(blanket.UPDATE, true);
  assert.deepEqual(scoped.UPDATE, ['email', 'full_name']);
  assert.deepEqual(revoked, {}, 'a later REVOKE ALL must win over an earlier blanket grant');
});

test('the SQL reader ignores commented-out statements', () => {
  const privileges = effectivePrivileges(
    '-- GRANT ALL ON public.profiles TO authenticated;\nGRANT SELECT ON public.profiles TO authenticated;',
    'public.profiles',
    'authenticated'
  );

  assert.deepEqual(privileges, { SELECT: true });
});

test('the SQL reader resolves a policy that is dropped and re-created in the same script', () => {
  const live = livePolicies(
    'CREATE POLICY "p" ON public.profiles FOR ALL USING (true);\n' +
      'DROP POLICY IF EXISTS "p" ON public.profiles;\n' +
      'CREATE POLICY "p" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);\n' +
      'CREATE POLICY "gone" ON public.profiles FOR ALL USING (true);\n' +
      'DROP POLICY IF EXISTS "gone" ON public.profiles;'
  );

  assert.deepEqual(
    live.map((policy) => [policy.name, policy.command]),
    [['p', 'SELECT']],
    'the last mention of a policy name decides whether it is live, and with which command'
  );
});

test('the SQL reader reads a policy command and defaults an omitted FOR clause to ALL', () => {
  const policies = parsePolicies(
    'CREATE POLICY "p1" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);\n' +
      'CREATE POLICY "p2" ON public.profiles USING (auth.uid() = id);'
  );

  assert.equal(policies.length, 2);
  assert.equal(policies[0].command, 'SELECT');
  assert.deepEqual(policies[0].roles, ['authenticated']);
  assert.equal(policies[1].command, 'ALL', 'an omitted FOR clause means FOR ALL and must not be read as harmless');
});
