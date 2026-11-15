const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { loadTsModule } = require('./load-ts-module');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const SOURCE_EXTENSIONS = ['.tsx', '.ts'];

const COMPILER_OPTIONS = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2020,
  jsx: ts.JsxEmit.ReactJSX,
  esModuleInterop: true,
};

/** Finds the .ts/.tsx file (or folder index) a path stands for, or null. */
function resolveSource(base) {
  if (fs.existsSync(base) && fs.statSync(base).isFile() && /\.tsx?$/.test(base)) return base;
  const candidates = [
    ...SOURCE_EXTENSIONS.map((ext) => `${base}${ext}`),
    ...SOURCE_EXTENSIONS.map((ext) => path.join(base, `index${ext}`)),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

/**
 * Loads a real component with the real message catalogs. `@/` imports resolve
 * to `src/`, and the .ts/.tsx files they reach are transpiled the same way
 * (once per call). Only `useLocale` is replaced, by one bound to the requested
 * locale, since the provider itself needs a browser. Anything that is not a
 * source file of this project goes through normal module resolution.
 */
function loadComponentModule(sourcePath, locale = 'fr') {
  const { translate, translatePlural, formatNumber, dirFor } = loadTsModule('src/i18n/index.ts');
  const localeValue = {
    t: (key, vars) => translate(locale, key, vars),
    tn: (key, count, vars) => translatePlural(locale, key, count, vars),
    n: (value, options) => formatNumber(locale, value, options),
    dir: dirFor(locale),
    locale,
  };
  const stubs = {
    '@/components/LocaleProvider': { useLocale: () => localeValue },
  };
  const cache = new Map();

  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: COMPILER_OPTIONS, fileName: file }).outputText;
    const mod = new Module.Module(file, module);
    mod.filename = file;
    mod.paths = Module._nodeModulePaths(path.dirname(file));
    cache.set(file, mod);
    mod.require = (request) => {
      if (request in stubs) return stubs[request];
      let source = null;
      if (request.startsWith('@/')) source = resolveSource(path.join(PROJECT_ROOT, 'src', request.slice(2)));
      else if (request.startsWith('.')) source = resolveSource(path.resolve(path.dirname(file), request));
      if (source) return load(source);
      return require(require.resolve(request, { paths: mod.paths }));
    };
    mod._compile(output, file);
    return mod.exports;
  }

  return load(path.resolve(PROJECT_ROOT, sourcePath));
}

/** Server-renders `exportName` from `sourcePath` (relative to the repo root). */
function renderComponent(sourcePath, exportName, props, locale = 'fr') {
  const component = loadComponentModule(sourcePath, locale)[exportName];
  if (typeof component !== 'function') throw new Error(`${sourcePath} does not export ${exportName}`);
  return renderToStaticMarkup(React.createElement(component, props));
}

module.exports = { loadComponentModule, renderComponent };
