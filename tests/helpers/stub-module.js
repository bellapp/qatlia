const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

// Mirror of the "@/*" -> "src/*" alias resolution in load-ts-module.js, so a test
// can pre-seed require.cache for a module the loaded route will require by alias.
function resolveRequest(request) {
  if (request.startsWith('@/')) {
    const base = path.join(PROJECT_ROOT, 'src', request.slice(2));
    const candidates = [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')];
    const found = candidates.find((candidate) => fs.existsSync(candidate));
    if (!found) throw new Error(`Cannot resolve aliased request: ${request}`);
    return found;
  }
  return require.resolve(request, { paths: [PROJECT_ROOT] });
}

const stubbed = new Set();

// Insert a fake module into require.cache so that route modules loaded via
// loadTsModule() pick it up instead of the real (browser/request-scoped) one.
function stubModule(request, exports) {
  const absolutePath = resolveRequest(request);
  const fake = new Module.Module(absolutePath, null);
  fake.filename = absolutePath;
  fake.loaded = true;
  fake.exports = exports;
  require.cache[absolutePath] = fake;
  stubbed.add(absolutePath);
  return absolutePath;
}

function restoreStubs() {
  for (const absolutePath of stubbed) delete require.cache[absolutePath];
  stubbed.clear();
}

module.exports = { stubModule, restoreStubs, resolveRequest, PROJECT_ROOT };
