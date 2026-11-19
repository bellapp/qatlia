const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// PR #80, 2026-11-18: `next build` refused `GET(req?: Request)` ("not a valid
// type for the function's first argument") while tsc passed, and the Vercel
// deployment failed. A route handler takes its request as a plain argument,
// or none at all.

function routes(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return routes(full);
    return /^route\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

test('no route handler takes an optional request', () => {
  const files = routes(path.resolve('src/app'));
  assert.ok(files.length > 10, 'the routes are found');
  const optional = files.filter((file) => /export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(\s*\w+\s*\?/.test(fs.readFileSync(file, 'utf8')));

  assert.deepEqual(optional.map((file) => path.relative(process.cwd(), file)), []);
});
