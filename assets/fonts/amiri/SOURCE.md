# Amiri (Arabic PDF font)

Used by `src/lib/exports/pdf-fonts.ts` to embed real Arabic glyphs into the
`/api/export-pdf` report whenever the payload actually needs them — locale
`ar`, or an artisan-typed Arabic `projectName`/`material` in a French/English
export (see `payloadNeedsArabicFont` in `pdf-fonts.ts`; a pure-Latin fr/en
export never embeds it at all). jsPDF's built-in Helvetica has no Arabic
glyphs, so without this embedded font Arabic labels would render as tofu
(empty boxes) or be silently dropped.

- **Font**: Amiri, by Khaled Hosny and Sebastian Kosch.
- **License**: SIL Open Font License 1.1 — see `OFL.txt` in this directory
  (fetched from the same source, unmodified).
- **Upstream source**: https://github.com/aliftype/amiri (release 1.002),
  mirrored into the Google Fonts catalog at
  https://github.com/google/fonts/tree/main/ofl/amiri
- **Fetched from**: `https://raw.githubusercontent.com/google/fonts/main/ofl/amiri/`
  at commit `04d40ee68cc6b8cb6870eca81a8a7451165aa95a` (per that directory's
  `METADATA.pb`), fetched 2026-08-31.
- **Files and checksums** (`sha256sum`):

  | File | SHA-256 |
  |---|---|
  | `Amiri-Regular.ttf` | `ab391c4147d054c48976e98322ad0eefe1427aa0e0502a12a4c75d80a70cfcd7` |
  | `Amiri-Bold.ttf` | `cfccb794268e7d573d857e6d6a67f89cf8a053e8ffd85dfa0c8ec1bb36fc4827` |
  | `OFL.txt` | `72de68e5954f4fdd24702292ef5a32f003ca960ec9330dc86e5eefb5dffb9b22` |

  `tests/pdf-fonts.test.js` recomputes and asserts these checksums against the
  constants exported by `src/lib/exports/pdf-fonts.ts`, so the two can never
  silently drift apart.

Only `Amiri-Regular.ttf` and `Amiri-Bold.ttf` are used at runtime (headings use
the bold weight, body copy the regular weight); `Amiri-Italic.ttf` and
`Amiri-BoldItalic.ttf` are not fetched since the PDF report never uses italics.

## How these bytes actually reach a running request

These `.ttf` files themselves are **never read from disk, and never fetched
over the network, at request time.** `scripts/generate-pdf-font-modules.mjs`
base64-encodes them once, ahead of time, into two generated TypeScript
modules under `src/lib/exports/fonts/` (`amiri-regular-base64.ts`,
`amiri-bold-base64.ts`), each exporting the font as a plain string constant.
Those generated modules are ordinary source files: they get bundled exactly
like any other `import`, so there is no `process.cwd()`-relative filesystem
read that can break depending on where a serverless function's working
directory ends up, no dependency on the bundler's file-tracer noticing an
`fs` call, and no runtime network fetch — `/api/export-pdf` has no runtime
network dependency on this font. `registerAmiriFont` (`pdf-fonts.ts`) loads
those two generated modules with a *dynamic* `import()`, and only when
`payloadNeedsArabicFont` says the current request actually needs Arabic
glyphs — so Next can code-split them into a chunk a pure-Latin fr/en request
never fetches or decodes.

Regenerate the two generated modules with:

```bash
npm run fonts:build
```

whenever `Amiri-Regular.ttf`/`Amiri-Bold.ttf` above change, and update the
checksum table (and the constants in `pdf-fonts.ts`) to match. No native
dependency is needed for this script itself (`scripts/generate-pdf-font-modules.mjs`
only uses Node's built-in `fs`/`crypto`); `tests/pdf-fonts.test.js` (which
re-decodes the generated modules and re-hashes them) and
`tests/pdf-artifact.test.js` (which re-parses and rasterizes a real generated
PDF) do pull in native devDependencies — `pdfjs-dist` and `@napi-rs/canvas`
— purely for *testing*, not for anything this font-loading path depends on
at runtime.
