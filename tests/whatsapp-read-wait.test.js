const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');
const { stubModule } = require('./helpers/stub-module');

// A text or voice note sent while the number's photo is read waits for the
// read (Minuisr Aluminium, 23/11/2026: asked for his sheet one second after
// his plan went out), within the route's time.

const state = { running: [], calls: [], error: null };
stubModule('@/lib/whatsapp/photo-store', {
  photoReadRunning: async (db, waId, now) => {
    state.calls.push({ waId, now });
    if (state.error) throw state.error;
    return state.running.length > 1 ? state.running.shift() : state.running[0];
  },
});

const { waitForPhotoRead, READ_WAIT_UNTIL_MS, READ_POLL_MS } = loadTsModule('src/lib/whatsapp/read-wait.ts');

const WA = '212600000001';
const RECEIVED = new Date('2026-11-23T20:16:17Z');

/** A fake clock that the fake sleep moves forward. */
function timing(startMs) {
  let now = startMs;
  const slept = [];
  return {
    clock: () => now,
    sleep: async (ms) => {
      slept.push(ms);
      now += ms;
    },
    slept,
  };
}

function reset(running) {
  state.running = running;
  state.calls = [];
  state.error = null;
}

test('the wait ends at 20 s after the message, polling every 1.5 s', () => {
  assert.equal(READ_WAIT_UNTIL_MS, 20_000);
  assert.equal(READ_POLL_MS, 1_500);
});

test('no read running : none, without waiting', async () => {
  reset([false]);
  const t = timing(RECEIVED.getTime() + 4000);
  assert.equal(await waitForPhotoRead({}, WA, RECEIVED, t), 'none');
  assert.deepEqual(t.slept, []);
  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0].waId, WA);
});

test('a read that ends while waiting : done', async () => {
  reset([true, true, false]);
  const t = timing(RECEIVED.getTime() + 4000);
  assert.equal(await waitForPhotoRead({}, WA, RECEIVED, t), 'done');
  assert.deepEqual(t.slept, [1500, 1500]);
});

test('a read still running 20 s after the message : running', async () => {
  reset([true]);
  const t = timing(RECEIVED.getTime() + 4000);
  assert.equal(await waitForPhotoRead({}, WA, RECEIVED, t), 'running');
  const waited = t.slept.reduce((a, b) => a + b, 0);
  assert.ok(t.clock() - RECEIVED.getTime() <= 20_000, 'never past 20 s');
  assert.ok(waited >= 14_000);
});

test('a failing lookup : none, the answer goes out as before', async () => {
  reset([true]);
  state.error = new Error('db down');
  const original = console.error;
  console.error = () => {};
  try {
    assert.equal(await waitForPhotoRead({}, WA, RECEIVED, timing(RECEIVED.getTime())), 'none');
  } finally {
    console.error = original;
  }
});

test('a lookup failing during the wait : done, the answer goes out', async () => {
  reset([true]);
  let calls = 0;
  const original = console.error;
  console.error = () => {};
  const t = timing(RECEIVED.getTime());
  const sleep = async (ms) => {
    await t.sleep(ms);
    calls++;
    if (calls === 1) state.error = new Error('db down');
  };
  try {
    assert.equal(await waitForPhotoRead({}, WA, RECEIVED, { clock: t.clock, sleep }), 'done');
  } finally {
    console.error = original;
  }
});
