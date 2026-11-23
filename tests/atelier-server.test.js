const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');
const { stubModule } = require('./helpers/stub-module');

// Task 2 — the `ateliers` table seen from the server: service role only, never
// a throw, every query scoped to one user id, and a bad logo never costs the
// customer their business.

const UUID = '11111111-2222-4333-8444-555555555555';
const OTHER_UUID = '99999999-2222-4333-8444-555555555555';

// 1x1 transparent PNG, base64.
const PNG_LOGO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
// Passes the string schema, but the bytes are not a PNG.
const CORRUPT_LOGO = 'data:image/png;base64,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const state = {
  rows: new Map(), // user_id -> row
  fromCalls: [],
  eqCalls: [],
  upsertCalls: [],
  selectResult: null, // forces select to return this instead of the stored row
  sessionClientCalls: 0,
  user: null,
  getUserThrows: false,
  clientThrows: false,
  upsertError: null,
};

function resetState() {
  state.rows = new Map();
  state.fromCalls = [];
  state.eqCalls = [];
  state.upsertCalls = [];
  state.selectResult = null;
  state.sessionClientCalls = 0;
  state.user = null;
  state.getUserThrows = false;
  state.clientThrows = false;
  state.upsertError = null;
}

function atelierTable() {
  return {
    select: () => ({
      eq: (column, value) => {
        state.eqCalls.push({ column, value });
        return {
          maybeSingle: async () => {
            if (state.selectResult) return state.selectResult;
            return { data: state.rows.get(value) ?? null, error: null };
          },
        };
      },
    }),
    upsert: async (row, options) => {
      state.upsertCalls.push({ row, options });
      if (state.upsertError) return { error: state.upsertError };
      const existing = state.rows.get(row.user_id);
      if (existing && options && options.ignoreDuplicates) return { error: null };
      state.rows.set(row.user_id, { ...(existing || {}), ...row });
      return { error: null };
    },
  };
}

stubModule('@supabase/supabase-js', {
  createClient: () => {
    if (state.clientThrows) throw new Error('boom');
    return {
      from: (table) => {
        state.fromCalls.push(table);
        if (table === 'ateliers') return atelierTable();
        throw new Error(`unexpected table: ${table}`);
      },
    };
  },
});
stubModule('@/lib/supabase/server', {
  createClient: () => {
    state.sessionClientCalls += 1;
    return {
      auth: {
        getUser: async () => {
          if (state.getUserThrows) throw new Error('cookies() outside a request scope');
          return { data: { user: state.user }, error: null };
        },
      },
    };
  },
});

const { readAtelier, saveAtelier, atelierForCurrentRequest } = loadTsModule('src/lib/atelier-server.ts');

const ENV_KEYS = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'NODE_ENV'];
const CONFIGURED = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://real.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'sbsvc_real',
};

function withEnv(overrides, fn) {
  const saved = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) process.env[key] = value;
  }
  const restore = () => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  };
  const result = fn();
  return result && typeof result.then === 'function' ? result.finally(restore) : (restore(), result);
}

const FULL = {
  name: 'Atelier Alami',
  address: '12 rue des Artisans, Fès',
  phone: '0661 00 00 00',
  email: 'contact@alami.ma',
  ice: '001234567000089',
  taxId: '12345678',
};

test('readAtelier without the service role is null and never builds a client', async () => {
  resetState();
  await withEnv({}, async () => {
    assert.equal(await readAtelier(UUID), null);
  });
  assert.deepEqual(state.fromCalls, []);
});

test('saveAtelier then readAtelier returns the same business, taxId mapped', async () => {
  resetState();
  await withEnv(CONFIGURED, async () => {
    assert.equal(await saveAtelier(UUID, { ...FULL, logoDataUrl: PNG_LOGO }), true);
    const row = state.rows.get(UUID);
    assert.equal(row.tax_id, '12345678');
    assert.equal(row.logo_data_url, PNG_LOGO);
    assert.match(row.updated_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(await readAtelier(UUID), { ...FULL, logoDataUrl: PNG_LOGO });
  });
  assert.equal(state.upsertCalls[0].options.onConflict, 'user_id');
});

test('saveAtelier without the service role is false', async () => {
  resetState();
  await withEnv({}, async () => {
    assert.equal(await saveAtelier(UUID, { name: 'X' }), false);
  });
  assert.deepEqual(state.fromCalls, []);
});

test('readAtelier is null when the table is missing (migration not applied)', async () => {
  resetState();
  state.selectResult = { data: null, error: { message: 'relation "ateliers" does not exist' } };
  await withEnv(CONFIGURED, async () => {
    assert.equal(await readAtelier(UUID), null);
  });
});

test('readAtelier is null when there is no row; both calls survive a throwing client', async () => {
  resetState();
  await withEnv(CONFIGURED, async () => {
    assert.equal(await readAtelier(UUID), null);
    state.clientThrows = true;
    assert.equal(await readAtelier(UUID), null);
    assert.equal(await saveAtelier(UUID, { name: 'X' }), false);
  });
});

test('saveAtelier is false when the upsert reports an error', async () => {
  resetState();
  state.upsertError = { message: 'permission denied' };
  await withEnv(CONFIGURED, async () => {
    assert.equal(await saveAtelier(UUID, { name: 'X' }), false);
  });
  assert.equal(state.rows.size, 0);
});

test('every query is filtered on the user id', async () => {
  resetState();
  state.rows.set(OTHER_UUID, { user_id: OTHER_UUID, name: 'Other business' });
  await withEnv(CONFIGURED, async () => {
    await saveAtelier(UUID, { name: 'Mine' });
    const mine = await readAtelier(UUID);
    assert.equal(mine.name, 'Mine');
  });
  assert.deepEqual(state.eqCalls, [{ column: 'user_id', value: UUID }]);
  assert.equal(state.upsertCalls[0].row.user_id, UUID);
});

test('saveAtelier leaves the logo column out when logoDataUrl is absent, and clears it with null', async () => {
  resetState();
  await withEnv(CONFIGURED, async () => {
    await saveAtelier(UUID, { name: 'A', logoDataUrl: PNG_LOGO });
    await saveAtelier(UUID, { name: 'A2' });
    assert.equal('logo_data_url' in state.upsertCalls[1].row, false);
    assert.equal(state.rows.get(UUID).logo_data_url, PNG_LOGO);

    await saveAtelier(UUID, { name: 'A3', logoDataUrl: null });
    assert.equal(state.upsertCalls[2].row.logo_data_url, null);
    assert.equal(state.rows.get(UUID).logo_data_url, null);
    assert.equal('logoDataUrl' in (await readAtelier(UUID)), false);
  });
});

test('saveAtelier writes empty optional fields as NULL and reads them back absent', async () => {
  resetState();
  await withEnv(CONFIGURED, async () => {
    await saveAtelier(UUID, { name: 'A', address: '', phone: '', email: '', ice: '', taxId: '' });
    const row = state.upsertCalls[0].row;
    for (const column of ['address', 'phone', 'email', 'ice', 'tax_id']) assert.equal(row[column], null, column);
    assert.deepEqual(await readAtelier(UUID), { name: 'A' });
  });
});

test('createOnly passes ignoreDuplicates and never overwrites an existing row', async () => {
  resetState();
  await withEnv(CONFIGURED, async () => {
    await saveAtelier(UUID, { name: 'First' });
    assert.equal(await saveAtelier(UUID, { name: 'Second' }, { createOnly: true }), true);
    assert.equal(state.upsertCalls[1].options.ignoreDuplicates, true);
    assert.equal((await readAtelier(UUID)).name, 'First');
    assert.notEqual(state.upsertCalls[0].options.ignoreDuplicates, true);
  });
});

test('a corrupt logo is dropped, the business stays', async () => {
  resetState();
  state.rows.set(UUID, { user_id: UUID, name: 'Atelier Alami', phone: '0661', tax_id: '42', logo_data_url: CORRUPT_LOGO });
  await withEnv(CONFIGURED, async () => {
    const atelier = await readAtelier(UUID);
    assert.deepEqual(atelier, { name: 'Atelier Alami', phone: '0661', taxId: '42' });
    assert.equal('logoDataUrl' in atelier, false);
  });
});

test('a row whose text part is invalid is null', async () => {
  resetState();
  state.rows.set(UUID, { user_id: UUID, name: '   ', logo_data_url: PNG_LOGO });
  await withEnv(CONFIGURED, async () => {
    assert.equal(await readAtelier(UUID), null);
  });
});

test('atelierForCurrentRequest without the service role is null and never touches the session client', async () => {
  resetState();
  await withEnv({}, async () => {
    assert.equal(await atelierForCurrentRequest(), null);
  });
  assert.equal(state.sessionClientCalls, 0);
});

test('atelierForCurrentRequest reads the signed-in user business', async () => {
  resetState();
  state.user = { id: UUID };
  state.rows.set(UUID, { user_id: UUID, name: 'Mine' });
  state.rows.set(OTHER_UUID, { user_id: OTHER_UUID, name: 'Other' });
  await withEnv(CONFIGURED, async () => {
    assert.deepEqual(await atelierForCurrentRequest(), { name: 'Mine' });
  });
});

test('atelierForCurrentRequest is null without a user, and when getUser throws', async () => {
  resetState();
  await withEnv(CONFIGURED, async () => {
    assert.equal(await atelierForCurrentRequest(), null);
    state.getUserThrows = true;
    assert.equal(await atelierForCurrentRequest(), null);
  });
  assert.deepEqual(state.fromCalls, []);
});
