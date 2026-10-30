const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// One credit buys a complete analysis: the pass a paid scan (or a paid first
// optimization) hands out keeps re-optimizations free for the window, and
// nothing else may.

const UUID = '11111111-2222-4333-8444-555555555555';
const OTHER_UUID = '99999999-8888-4777-8666-555555555555';
const SECRET = 'sbsvc_real';
const HOUR = 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

const load = () => ({
  ...loadTsModule('src/lib/billing/analysis-pass.ts'),
  ...loadTsModule('src/lib/billing/policy.ts'),
});

test('a fresh pass covers its own user for the whole window, then expires', () => {
  const { issueAnalysisPass, verifyAnalysisPass, ANALYSIS_WINDOW_HOURS } = load();
  const pass = issueAnalysisPass(SECRET, UUID, NOW);

  assert.equal(verifyAnalysisPass(SECRET, pass, UUID, NOW), true);
  assert.equal(verifyAnalysisPass(SECRET, pass, UUID, NOW + ANALYSIS_WINDOW_HOURS * HOUR - 1), true);
  assert.equal(verifyAnalysisPass(SECRET, pass, UUID, NOW + ANALYSIS_WINDOW_HOURS * HOUR), false);
});

test('a pass covers nobody else, and nothing signed with another secret', () => {
  const { issueAnalysisPass, verifyAnalysisPass } = load();
  const pass = issueAnalysisPass(SECRET, UUID, NOW);

  assert.equal(verifyAnalysisPass(SECRET, pass, OTHER_UUID, NOW), false);
  assert.equal(verifyAnalysisPass('another_secret', pass, UUID, NOW), false);
  assert.equal(verifyAnalysisPass(null, pass, UUID, NOW), false, 'no secret configured means every run is charged');
});

test('a tampered or malformed pass is refused', () => {
  const { issueAnalysisPass, verifyAnalysisPass, ANALYSIS_WINDOW_HOURS } = load();
  const pass = issueAnalysisPass(SECRET, UUID, NOW);
  const [user, expires, signature] = pass.split('.');

  // Pushing the expiry out invalidates the signature…
  assert.equal(verifyAnalysisPass(SECRET, `${user}.${Number(expires) + HOUR}.${signature}`, UUID, NOW), false);
  // …and no pass, even a genuinely signed one, may claim more than one window.
  const longLived = issueAnalysisPass(SECRET, UUID, NOW + 10 * ANALYSIS_WINDOW_HOURS * HOUR);
  assert.equal(verifyAnalysisPass(SECRET, longLived, UUID, NOW), false);

  for (const junk of [undefined, null, 42, '', 'a.b', `${pass}.extra`, 'x'.repeat(300)]) {
    assert.equal(verifyAnalysisPass(SECRET, junk, UUID, NOW), false, `${String(junk).slice(0, 20)} must be refused`);
  }
});

test('issuing never throws: without a secret or a real user it just yields no pass', () => {
  const { issueAnalysisPass } = load();

  assert.equal(issueAnalysisPass(null, UUID, NOW), null);
  assert.equal(issueAnalysisPass('', UUID, NOW), null);
  assert.equal(issueAnalysisPass(SECRET, 'anonymous', NOW), null);
});

test('the pass secret is the service-role key, absent when it is', () => {
  const { analysisPassSecret } = load();

  assert.equal(analysisPassSecret({ SUPABASE_SERVICE_ROLE_KEY: ' sbsvc_real ' }), 'sbsvc_real');
  assert.equal(analysisPassSecret({}), null);
  assert.equal(analysisPassSecret({ SUPABASE_SERVICE_ROLE_KEY: '  ' }), null);
});
