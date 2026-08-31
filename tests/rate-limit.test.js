const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// P0 Task 5 blocker #6 — a per-user brake on /api/vision.
//
// The credit ledger already bounds what a user can *spend*, but nothing bounded
// how fast an authenticated account could drive the upstream vision model. The
// limiter below is deliberately small in scope: it takes its clock and its
// store by injection so its behaviour is asserted deterministically rather than
// by sleeping, and it makes no distributed guarantee (see the module doc and
// the last test in this file).

const MINUTE = 60_000;

function fakeClock(start = 1_700_000_000_000) {
  let current = start;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
  };
}

function limiter(overrides = {}) {
  const { createRateLimiter } = loadTsModule('src/lib/rate-limit.ts');
  const clock = fakeClock();
  return {
    clock,
    instance: createRateLimiter({ limit: 3, windowMs: MINUTE, now: clock.now, ...overrides }),
  };
}

test('requests up to the limit are allowed and report the remaining allowance', () => {
  const { instance } = limiter();

  assert.deepEqual(
    [instance.check('user-a'), instance.check('user-a'), instance.check('user-a')].map((d) => [d.allowed, d.remaining]),
    [
      [true, 2],
      [true, 1],
      [true, 0],
    ]
  );
});

test('the request past the limit is denied with a positive Retry-After', () => {
  const { instance } = limiter();

  for (let i = 0; i < 3; i += 1) instance.check('user-a');
  const denied = instance.check('user-a');

  assert.equal(denied.allowed, false);
  assert.equal(denied.remaining, 0);
  assert.equal(denied.limit, 3);
  assert.ok(denied.retryAfterSeconds > 0, 'a denied caller must be told when to come back');
  assert.ok(Number.isInteger(denied.retryAfterSeconds), 'Retry-After is expressed in whole seconds');
  assert.equal(denied.retryAfterSeconds, 60);
});

test('a denied request does not itself consume allowance, so the window still drains', () => {
  const { instance, clock } = limiter();

  for (let i = 0; i < 3; i += 1) instance.check('user-a');
  clock.advance(MINUTE / 2);
  assert.equal(instance.check('user-a').allowed, false);
  assert.equal(instance.check('user-a').retryAfterSeconds, 30, 'the wait must shrink as the window slides, not reset');

  clock.advance(MINUTE / 2 + 1);
  assert.equal(instance.check('user-a').allowed, true, 'the oldest hits have aged out of the window');
});

test('the window slides rather than resetting in fixed blocks', () => {
  const { instance, clock } = limiter();

  instance.check('user-a');
  clock.advance(MINUTE - 1_000);
  instance.check('user-a');
  instance.check('user-a');
  assert.equal(instance.check('user-a').allowed, false, 'three hits are still inside the window');

  // Only the first hit has aged out, so exactly one slot frees up.
  clock.advance(2_000);
  assert.equal(instance.check('user-a').allowed, true);
  assert.equal(instance.check('user-a').allowed, false);
});

test('keys are independent, so one user cannot lock out another', () => {
  const { instance } = limiter();

  for (let i = 0; i < 4; i += 1) instance.check('noisy');
  assert.equal(instance.check('noisy').allowed, false);
  assert.equal(instance.check('quiet').allowed, true);
});

test('the limiter never reads the ambient clock', () => {
  const { createRateLimiter } = loadTsModule('src/lib/rate-limit.ts');
  const originalNow = Date.now;
  Date.now = () => {
    throw new Error('the injected clock must be used');
  };
  try {
    const instance = createRateLimiter({ limit: 1, windowMs: MINUTE, now: () => 0 });
    assert.equal(instance.check('k').allowed, true);
    assert.equal(instance.check('k').allowed, false);
  } finally {
    Date.now = originalNow;
  }
});

test('entries for idle keys are pruned so the store does not grow without bound', () => {
  const { instance, clock } = limiter();

  for (let i = 0; i < 500; i += 1) instance.check(`user-${i}`);
  assert.equal(instance.size(), 500);

  clock.advance(MINUTE + 1);
  instance.check('user-fresh');

  assert.equal(instance.size(), 1, 'keys whose whole window has elapsed must be dropped');
});

test('a hard key cap evicts rather than letting the map grow unbounded under key-space abuse', () => {
  const { instance } = limiter({ maxKeys: 10 });

  for (let i = 0; i < 50; i += 1) instance.check(`user-${i}`);

  assert.ok(instance.size() <= 10, `the store must stay within maxKeys, got ${instance.size()}`);
  assert.equal(instance.check('user-49').allowed, true, 'the limiter stays functional after eviction');
});

test('invalid configuration is rejected instead of silently disabling the limit', () => {
  const { createRateLimiter } = loadTsModule('src/lib/rate-limit.ts');

  assert.throws(() => createRateLimiter({ limit: 0, windowMs: MINUTE }), /INVALID_RATE_LIMIT/);
  assert.throws(() => createRateLimiter({ limit: -1, windowMs: MINUTE }), /INVALID_RATE_LIMIT/);
  assert.throws(() => createRateLimiter({ limit: 3, windowMs: 0 }), /INVALID_RATE_LIMIT/);
  assert.throws(() => createRateLimiter({ limit: 1.5, windowMs: MINUTE }), /INVALID_RATE_LIMIT/);
});

test('the Vision limit is a documented, conservative constant', () => {
  const { VISION_RATE_LIMIT } = loadTsModule('src/lib/rate-limit.ts');

  assert.ok(Number.isInteger(VISION_RATE_LIMIT.limit));
  assert.ok(VISION_RATE_LIMIT.limit > 0 && VISION_RATE_LIMIT.limit <= 30, 'a per-user burst cap, not a free-for-all');
  assert.ok(VISION_RATE_LIMIT.windowMs >= 30_000, 'the window must be long enough to actually bound a burst');
});

test('the module states its instance-local limitation rather than implying a global quota', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'src/lib/rate-limit.ts'), 'utf8');

  // A source contract on purpose: the honest scope of an in-process counter is
  // the thing most likely to be forgotten when someone later scales the
  // deployment past one instance and assumes this is a real quota.
  const docComment = source.slice(0, source.indexOf('*/'));

  assert.match(docComment, /single Node process|per instance|each instance/i, 'the scope must be stated up front');
  assert.match(docComment, /serverless|multi-instance/i, 'the deployment shape that breaks the assumption must be named');
  assert.match(docComment, /credit ledger/i, 'the doc must point at what actually bounds spend');
});
