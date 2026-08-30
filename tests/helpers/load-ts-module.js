const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const TS_COMPILER_OPTIONS = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2020,
  esModuleInterop: true,
};

function transpile(source, fileName) {
  return ts.transpileModule(source, { compilerOptions: TS_COMPILER_OPTIONS, fileName }).outputText;
}

// Resolve this project's "@/*" -> "src/*" path alias (see tsconfig.json) to an
// actual .ts/.tsx file on disk, so test-loaded modules can require siblings the
// same way the app does (e.g. src/app/api/*/route.ts importing "@/lib/...").
function resolveAliasedPath(request) {
  const base = path.join(PROJECT_ROOT, 'src', request.slice(2));
  const candidates = [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

let tsExtensionRegistered = false;
function ensureTsExtensionRegistered() {
  if (tsExtensionRegistered) return;
  Module._extensions['.ts'] = (childModule, filename) => {
    const source = fs.readFileSync(filename, 'utf8');
    childModule._compile(transpile(source, filename), filename);
  };
  tsExtensionRegistered = true;
}

function loadTsModule(filePath) {
  const absolutePath = path.resolve(filePath);
  const source = fs.readFileSync(absolutePath, 'utf8');
  const transpiled = transpile(source, absolutePath);

  ensureTsExtensionRegistered();

  const mod = new Module.Module(absolutePath, module);
  mod.filename = absolutePath;
  mod.paths = Module._nodeModulePaths(path.dirname(absolutePath));

  // Temporarily teach module resolution about the "@/*" alias for the (synchronous)
  // duration of compiling this module and everything it requires transitively.
  const originalResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function patchedResolveFilename(request, ...rest) {
    if (request.startsWith('@/')) {
      const resolved = resolveAliasedPath(request);
      if (resolved) return resolved;
    }
    return originalResolveFilename.call(this, request, ...rest);
  };

  try {
    mod._compile(transpiled, absolutePath);
  } finally {
    Module._resolveFilename = originalResolveFilename;
  }

  return mod.exports;
}

module.exports = {
  loadTsModule,
};
