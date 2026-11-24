const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve('src/components/OptionsPanel.tsx'), 'utf8');

// The fields sit on `bg-studio-field`, nearly white in light mode: a light
// text colour there must only apply in dark mode.
test('every field of the options panel stays readable in light mode', () => {
  const fields = source.match(/className="[^"]*\bbg-studio-field\b[^"]*"/g) ?? [];
  assert.ok(fields.length >= 5, 'the fields are found');
  for (const field of fields) {
    assert.doesNotMatch(field, /(?<![:\w-])text-(?:white|slate-[123]00)\b/, field);
  }
});
