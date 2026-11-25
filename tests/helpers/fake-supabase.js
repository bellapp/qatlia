/**
 * A small in-memory stand-in for the Supabase JS client, for back office tests.
 *
 * `state.tables[name]` is what a query on that table resolves to (an array, a
 * single row, or null), or a function of the recorded call returning one of
 * those; `state.tableErrors[name]` makes it fail instead.
 * Filters are recorded but not applied — a test seeds exactly the rows the
 * code under test should receive. Every call is recorded for assertions.
 */
function createFakeSupabase() {
  const state = {
    tables: {},
    tableErrors: {},
    rpcResult: () => ({ data: null, error: null }),
    rpcCalls: [],
    fromCalls: [],
    authUser: null,
    authError: null,
  };

  function table(name) {
    const call = { table: name, ops: [] };
    state.fromCalls.push(call);
    const result = (mode) => {
      // An error, or a function of the recorded call returning one (or null), e.g. a failing insert only.
      const failure = typeof state.tableErrors[name] === 'function' ? state.tableErrors[name](call) : state.tableErrors[name];
      if (failure) return { data: null, error: failure };
      // A function seeds per-query answers, e.g. a lookup that finds nothing
      // followed by an insert that returns the new row.
      const seeded = state.tables[name];
      const value = typeof seeded === 'function' ? seeded(call) : seeded;
      if (mode === 'single') {
        const row = Array.isArray(value) ? value[0] ?? null : value ?? null;
        return { data: row, error: null };
      }
      if (value === undefined || value === null) return { data: mode === 'many' ? [] : null, error: null };
      return { data: Array.isArray(value) ? value : [value], error: null };
    };
    let mode = 'many';
    const chain = {};
    for (const op of ['select', 'eq', 'neq', 'in', 'or', 'like', 'ilike', 'order', 'limit', 'range', 'gte', 'lte', 'lt', 'gt', 'is', 'not', 'filter']) {
      chain[op] = (...args) => {
        call.ops.push([op, args]);
        return chain;
      };
    }
    for (const op of ['insert', 'upsert', 'update', 'delete']) {
      chain[op] = (...args) => {
        call.ops.push([op, args]);
        return chain;
      };
    }
    chain.maybeSingle = () => {
      mode = 'single';
      return Promise.resolve(result(mode));
    };
    chain.single = chain.maybeSingle;
    chain.then = (resolve, reject) => Promise.resolve(result(mode)).then(resolve, reject);
    return chain;
  }

  const client = {
    from: table,
    rpc: (name, args) => {
      state.rpcCalls.push({ name, args });
      return Promise.resolve(state.rpcResult(name, args));
    },
    auth: {
      admin: {
        getUserById: async (id) => {
          state.rpcCalls.push({ name: 'auth.getUserById', args: { id } });
          if (state.authError) return { data: { user: null }, error: state.authError };
          return { data: { user: state.authUser && state.authUser.id === id ? state.authUser : null }, error: null };
        },
        deleteUser: async (id) => {
          state.rpcCalls.push({ name: 'auth.deleteUser', args: { id } });
          if (state.deleteError) return { data: { user: null }, error: state.deleteError };
          return { data: { user: state.authUser }, error: null };
        },
      },
    },
    // Storage: `state.storage[bucket]` lists the file names in any folder;
    // `state.storageError` makes every call fail.
    storage: {
      from: (bucket) => ({
        list: async (folder, options) => {
          state.rpcCalls.push({ name: 'storage.list', args: { bucket, folder, options } });
          if (state.storageError) return { data: null, error: state.storageError };
          return { data: (state.storage?.[bucket] ?? []).map((name) => ({ name })), error: null };
        },
        createSignedUrl: async (path, expiresIn) => {
          state.rpcCalls.push({ name: 'storage.createSignedUrl', args: { bucket, path, expiresIn } });
          if (state.storageError) return { data: null, error: state.storageError };
          return { data: { signedUrl: `https://signed.test/${bucket}/${path}?ttl=${expiresIn}` }, error: null };
        },
        remove: async (paths) => {
          state.rpcCalls.push({ name: 'storage.remove', args: { bucket, paths } });
          if (state.storageError) return { data: null, error: state.storageError };
          return { data: paths.map((name) => ({ name })), error: null };
        },
      }),
    },
  };

  /** Ops recorded on one table, e.g. ops('admin_client_notes', 'upsert'). */
  const ops = (tableName, opName) =>
    state.fromCalls.filter((c) => c.table === tableName).flatMap((c) => c.ops.filter(([op]) => op === opName).map(([, args]) => args));

  return { client, state, ops };
}

module.exports = { createFakeSupabase };
