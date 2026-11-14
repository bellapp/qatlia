const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { loadTsModule } = require('./load-ts-module');

const SOURCE = path.resolve(__dirname, '..', '..', 'src/components/SheetTabs.tsx');

/**
 * Loads the real `SheetTabs` component with the real message catalogs. Only
 * `useLocale` is replaced, by one bound to the requested locale, since the
 * provider itself needs a browser.
 */
function loadSheetTabs(locale = 'fr') {
  const { translate } = loadTsModule('src/i18n/index.ts');
  const output = ts.transpileModule(fs.readFileSync(SOURCE, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: SOURCE,
  }).outputText;

  const mod = new Module.Module(SOURCE, module);
  mod.filename = SOURCE;
  mod.paths = Module._nodeModulePaths(path.dirname(SOURCE));
  const stubs = {
    '@/components/LocaleProvider': { useLocale: () => ({ t: (key, vars) => translate(locale, key, vars) }) },
  };
  mod.require = (request) => (request in stubs ? stubs[request] : require(require.resolve(request, { paths: mod.paths })));
  mod._compile(output, SOURCE);
  return mod.exports;
}

/** Server-renders the tabs; `onSelect` is inert in static markup. */
function renderSheetTabs(props, locale = 'fr') {
  const { SheetTabs } = loadSheetTabs(locale);
  return renderToStaticMarkup(React.createElement(SheetTabs, { onSelect: () => {}, mode: '2d', ...props }));
}

module.exports = { loadSheetTabs, renderSheetTabs };
