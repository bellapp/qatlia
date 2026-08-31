/**
 * A small, dependency-free reader for the SQL migrations.
 *
 * No Postgres is available in this environment (see the Task 5 report), so the
 * privilege guarantees are asserted by *replaying* the GRANT/REVOKE statements
 * of a migration in order and computing the privileges a role is actually left
 * with. That is strictly stronger than grepping for a REVOKE line: a later
 * `GRANT ALL ... TO authenticated` would silently undo the lockdown, and this
 * replay catches it because it models the same last-writer-wins semantics
 * Postgres uses.
 *
 * It is a reader, not an emulator: it does not evaluate policies or execute
 * anything. Its assertions are about the text the database will be given.
 */

const ALL_TABLE_PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];

/**
 * Split a script into statements, honouring `$tag$ ... $tag$` dollar quoting so
 * that the semicolons inside a plpgsql function body do not split it, and
 * dropping `--` line comments so commented-out SQL is never treated as real.
 */
function splitStatements(sql) {
  const statements = [];
  let current = '';
  let dollarTag = null;
  let i = 0;

  while (i < sql.length) {
    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) {
        current += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      current += sql[i];
      i += 1;
      continue;
    }

    if (sql.startsWith('--', i)) {
      const newline = sql.indexOf('\n', i);
      i = newline === -1 ? sql.length : newline;
      current += ' ';
      continue;
    }

    if (sql[i] === "'") {
      const end = sql.indexOf("'", i + 1);
      const stop = end === -1 ? sql.length : end + 1;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }

    const openingTag = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(i));
    if (openingTag) {
      dollarTag = openingTag[0];
      current += dollarTag;
      i += dollarTag.length;
      continue;
    }

    if (sql[i] === ';') {
      statements.push(current.trim());
      current = '';
      i += 1;
      continue;
    }

    current += sql[i];
    i += 1;
  }

  if (current.trim()) statements.push(current.trim());
  return statements.filter(Boolean);
}

const normalize = (text) => text.replace(/\s+/g, ' ').trim();
const stripQuotes = (name) => name.trim().replace(/"/g, '').toLowerCase();

/** `SELECT, INSERT (id, email), UPDATE (email)` -> structured privilege list. */
function parsePrivileges(blob) {
  const privileges = [];
  const pattern = /\b(ALL(?:\s+PRIVILEGES)?|SELECT|INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER)\b\s*(?:\(([^)]*)\))?/gi;
  let match;
  while ((match = pattern.exec(blob)) !== null) {
    privileges.push({
      privilege: /^ALL/i.test(match[1]) ? 'ALL' : match[1].toUpperCase(),
      columns: match[2] ? match[2].split(',').map(stripQuotes) : null,
    });
  }
  return privileges;
}

function parseRoles(blob) {
  return blob
    .split(',')
    .map((role) => stripQuotes(role.replace(/\bCASCADE\b|\bRESTRICT\b|\bGRANT OPTION FOR\b/gi, '')))
    .filter(Boolean);
}

/**
 * Table-level GRANT/REVOKE statements, in file order. Function-, schema- and
 * sequence-scoped grants are ignored; `ON ALL TABLES IN SCHEMA public` is
 * reported with the wildcard target `ALL TABLES`.
 */
function parseTableGrants(sql) {
  const grants = [];

  for (const statement of splitStatements(sql)) {
    const flat = normalize(statement);
    if (!/^(GRANT|REVOKE)\b/i.test(flat)) continue;
    if (/\bON\s+(FUNCTION|SCHEMA|SEQUENCE|DATABASE|ROUTINE|ALL FUNCTIONS|ALL SEQUENCES)\b/i.test(flat)) continue;

    const wildcard = /^(GRANT|REVOKE)\s+([\s\S]+?)\s+ON\s+ALL\s+TABLES\s+IN\s+SCHEMA\s+\S+\s+(?:TO|FROM)\s+([\s\S]+)$/i.exec(flat);
    const specific = /^(GRANT|REVOKE)\s+([\s\S]+?)\s+ON\s+(?:TABLE\s+)?([A-Za-z0-9_."]+)\s+(?:TO|FROM)\s+([\s\S]+)$/i.exec(flat);
    const parsed = wildcard || specific;
    if (!parsed) continue;

    grants.push({
      action: parsed[1].toUpperCase(),
      privileges: parsePrivileges(parsed[2]),
      table: wildcard ? 'ALL TABLES' : stripQuotes(parsed[3]),
      roles: parseRoles(wildcard ? parsed[3] : parsed[4]),
      statement: flat,
    });
  }

  return grants;
}

const tableMatches = (target, table) =>
  target === 'ALL TABLES' || target === table || target === table.replace(/^public\./, '');

/**
 * Replay every GRANT/REVOKE in order and report what `role` is left holding on
 * `table`.
 *
 * Returns a map of privilege -> true (whole table) | string[] (column list).
 * A privilege that is absent from the map cannot be exercised at all.
 */
function effectivePrivileges(sql, table, role) {
  const wanted = stripQuotes(table);
  const wantedRole = stripQuotes(role);
  const state = new Map();

  const applyGrant = ({ privilege, columns }) => {
    const targets = privilege === 'ALL' ? ALL_TABLE_PRIVILEGES : [privilege];
    for (const name of targets) {
      const existing = state.get(name);
      if (existing === true || columns === null) {
        state.set(name, true);
      } else {
        state.set(name, [...new Set([...(existing || []), ...columns])].sort());
      }
    }
  };

  const applyRevoke = ({ privilege, columns }) => {
    const targets = privilege === 'ALL' ? ALL_TABLE_PRIVILEGES : [privilege];
    for (const name of targets) {
      if (columns === null) {
        state.delete(name);
        continue;
      }
      const existing = state.get(name);
      if (existing === true || existing === undefined) {
        // Revoking named columns of a whole-table grant is not something these
        // migrations do; treat it conservatively as leaving the grant intact.
        continue;
      }
      const remaining = existing.filter((column) => !columns.includes(column));
      if (remaining.length === 0) state.delete(name);
      else state.set(name, remaining);
    }
  };

  for (const grant of parseTableGrants(sql)) {
    if (!tableMatches(grant.table, wanted)) continue;
    const roles = grant.roles.includes('public') ? [...grant.roles, wantedRole] : grant.roles;
    if (!roles.includes(wantedRole)) continue;
    for (const privilege of grant.privileges) {
      if (grant.action === 'GRANT') applyGrant(privilege);
      else applyRevoke(privilege);
    }
  }

  return Object.fromEntries(state);
}

/** Every `CREATE POLICY` in the script, with its command, roles and table. */
function parsePolicies(sql) {
  const policies = [];

  for (const statement of splitStatements(sql)) {
    const flat = normalize(statement);
    const match = /^CREATE\s+POLICY\s+("([^"]+)"|[A-Za-z0-9_]+)\s+ON\s+([A-Za-z0-9_."]+)([\s\S]*)$/i.exec(flat);
    if (!match) continue;

    const rest = match[4] || '';
    const command = /\bFOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b/i.exec(rest);
    const roles = /\bTO\s+([A-Za-z0-9_," ]+?)(?=\s+(?:USING|WITH CHECK)\b|$)/i.exec(rest);

    policies.push({
      name: match[2] || match[1],
      table: stripQuotes(match[3]),
      // Postgres defaults an omitted FOR clause to ALL.
      command: command ? command[1].toUpperCase() : 'ALL',
      // An omitted TO clause defaults to PUBLIC, which includes authenticated.
      roles: roles ? parseRoles(roles[1]) : ['public'],
      statement: flat,
    });
  }

  return policies;
}

/** Tables the script explicitly puts under row-level security. */
function tablesWithRlsEnabled(sql) {
  const tables = new Set();
  for (const statement of splitStatements(sql)) {
    const match = /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([A-Za-z0-9_."]+)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY$/i.exec(
      normalize(statement)
    );
    if (match) tables.add(stripQuotes(match[1]));
  }
  return tables;
}

/** Policy names the script drops, keyed by table. */
function droppedPolicies(sql) {
  const dropped = [];
  for (const statement of splitStatements(sql)) {
    const match = /^DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?("([^"]+)"|[A-Za-z0-9_]+)\s+ON\s+([A-Za-z0-9_."]+)$/i.exec(
      normalize(statement)
    );
    if (match) dropped.push({ name: match[2] || match[1], table: stripQuotes(match[3]) });
  }
  return dropped;
}

/**
 * The policies a script leaves in place, resolved by walking DROP/CREATE in
 * file order. Idempotent migrations drop a policy immediately before creating
 * it, so only the *last* mention of a name decides whether it is live.
 */
function livePolicies(sql) {
  const live = new Map();

  for (const statement of splitStatements(sql)) {
    const flat = normalize(statement);

    const drop = /^DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?("([^"]+)"|[A-Za-z0-9_]+)\s+ON\s+([A-Za-z0-9_."]+)$/i.exec(flat);
    if (drop) {
      live.delete(`${stripQuotes(drop[3])}:${drop[2] || drop[1]}`);
      continue;
    }

    const [created] = parsePolicies(statement);
    if (created) live.set(`${created.table}:${created.name}`, created);
  }

  return [...live.values()];
}

module.exports = {
  splitStatements,
  livePolicies,
  parseTableGrants,
  parsePolicies,
  parsePrivileges,
  effectivePrivileges,
  tablesWithRlsEnabled,
  droppedPolicies,
};
