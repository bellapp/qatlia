const { loadComponentModule, renderComponent } = require('./render-component');

const SOURCE = 'src/components/SheetTabs.tsx';

/** Loads the real `SheetTabs` component (see render-component.js). */
function loadSheetTabs(locale = 'fr') {
  return loadComponentModule(SOURCE, locale);
}

/** Server-renders the tabs; `onSelect` is inert in static markup. */
function renderSheetTabs(props, locale = 'fr') {
  return renderComponent(SOURCE, 'SheetTabs', { onSelect: () => {}, mode: '2d', ...props }, locale);
}

module.exports = { loadSheetTabs, renderSheetTabs };
