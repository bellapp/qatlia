const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scanSource } = require('./helpers/i18n-scanner');

// Guards against a hardcoded, customer-facing French string slipping into a
// component that must render in whatever locale the artisan's atelier is
// currently set to (see useLocale() in src/components/LocaleProvider.tsx).
// Every real string an artisan reads has to come from src/i18n (the
// app-wide catalog) or src/lib/exports/pdf-catalog.ts (the PDF-only
// catalog) -- both of which are allowed translation *sources* and are
// deliberately not scanned here. src/app/api/export-pdf/route.ts is scanned
// (in 'ts' mode -- it has no JSX) and must come back with zero findings: it
// should only ever reference `cat.*` catalog labels, never a literal one.

function walk(dir, extensions) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full, extensions));
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

function scanFile(relPath, mode) {
  const abs = path.resolve(relPath);
  const source = fs.readFileSync(abs, 'utf8');
  return scanSource(relPath, source, { mode });
}

function formatFindings(findings) {
  return findings.map((f) => `  ${f.file}:${f.line}:${f.column} -- "${f.text}"`).join('\n');
}

// ─── Real source tree: must come back clean ────────────────────────────────

test('every customer-facing .tsx file under src/app and src/components has no hardcoded literal French UI text', () => {
  const targets = [...walk(path.resolve('src/app'), ['.tsx']), ...walk(path.resolve('src/components'), ['.tsx'])];
  assert.ok(targets.length > 10, 'sanity: expected to find a substantial number of .tsx files to scan');

  const allFindings = targets.flatMap((abs) => scanFile(path.relative(process.cwd(), abs), 'jsx'));
  assert.deepEqual(allFindings, [], `found hardcoded French UI text:\n${formatFindings(allFindings)}`);
});

// .ts (non-JSX) files under src/components, src/lib and src/hooks can still
// emit customer-facing text -- a hook or plain helper firing a
// `toast.error(...)`, or building a dynamic label later handed to JSX --
// even though they have no JSX text/attributes of their own to scan. This is
// scanned in 'jsx' mode, not 'ts' mode, and that choice is what makes it
// safe: 'jsx' mode only ever flags a JSX shape or a known notification call
// (`isTechnicalJsxAttr`/`NOTIFICATION_CALLEES` in the scanner), never a bare
// string literal, so it can walk src/lib's genuine domain/catalog data
// (src/lib/billing/catalog.ts's pack names, src/lib/pieces/templates.ts's
// furniture-piece names, every *-schema.ts/pdf-catalog.ts) without
// overflagging their non-UI string fields -- none of that data is ever
// passed to a notification call or written as JSX. src/hooks does not exist
// in this codebase yet (every hook currently lives inline in a .tsx
// component, already covered above); it's included here, guarded by
// `fs.existsSync`, so this test starts covering it the moment it does,
// rather than silently staying blind to it.
test('customer-facing .ts files under src/components, src/lib and src/hooks carry no hardcoded French text in a JSX/notification-call shape', () => {
  const dirs = ['src/components', 'src/lib', 'src/hooks'].filter((d) => fs.existsSync(path.resolve(d)));
  assert.ok(
    dirs.includes('src/components') && dirs.includes('src/lib'),
    'sanity: expected src/components and src/lib to exist'
  );

  const targets = dirs.flatMap((d) => walk(path.resolve(d), ['.ts', '.tsx']));
  assert.ok(targets.length > 5, 'sanity: expected a substantial number of files to scan');

  const allFindings = targets.flatMap((abs) => scanFile(path.relative(process.cwd(), abs), 'jsx'));
  assert.deepEqual(allFindings, [], `found hardcoded French UI text:\n${formatFindings(allFindings)}`);
});

test('/api/export-pdf/route.ts references only catalog labels, never a literal French string', () => {
  const findings = scanFile('src/app/api/export-pdf/route.ts', 'ts');
  assert.deepEqual(findings, [], `found hardcoded French text in the PDF route:\n${formatFindings(findings)}`);
});

// Every other export route that can generate a customer-facing message --
// scoped to the export pipeline this task covers, not an app-wide server
// route audit. Several *other* API routes (src/app/api/vision,
// src/app/api/projects, src/app/api/credits/checkout,
// src/app/api/credits/consume) already have pre-existing hardcoded French
// `message` fields returned straight to the client regardless of the
// caller's locale -- a real, separate localization gap, tracked as
// follow-up work, not part of this PDF-export remediation pass.
for (const routeFile of ['src/app/api/export-json/route.ts', 'src/app/api/export-dxf/route.ts']) {
  test(`${routeFile} contains no literal French text (its only strings are machine-readable error codes)`, () => {
    const findings = scanFile(routeFile, 'ts');
    assert.deepEqual(findings, [], `found hardcoded French text:\n${formatFindings(findings)}`);
  });
}

// ─── Mutation tests: prove the scanner actually catches what it claims to ──

test('catches literal French JSX text content', () => {
  const src = `
    export function Report() {
      return <button>Télécharger le rapport</button>;
    }
  `;
  const findings = scanSource('fixture.tsx', src, { mode: 'jsx' });
  assert.ok(findings.some((f) => f.text === 'Télécharger le rapport'), 'expected the JSX text to be caught');
});

test('catches a literal French string in an allowlisted user-facing attribute (aria-label)', () => {
  const src = `
    export function QtyInput() {
      return <input aria-label="Quantité" />;
    }
  `;
  const findings = scanSource('fixture.tsx', src, { mode: 'jsx' });
  assert.ok(findings.some((f) => f.text === 'Quantité'), 'expected the aria-label value to be caught');
});

test('catches a literal French string in placeholder/title/alt', () => {
  for (const attr of ['placeholder', 'title', 'alt']) {
    const src = `export function X() { return <input ${attr}="Rechercher une pièce" />; }`;
    const findings = scanSource('fixture.tsx', src, { mode: 'jsx' });
    assert.ok(findings.some((f) => f.text === 'Rechercher une pièce'), `expected ${attr}'s value to be caught`);
  }
});

test('catches an accented French sentence with no exact-known word match', () => {
  const src = `export function X() { return <p>Ceci est écrit en français avec des accents à foison.</p>; }`;
  const findings = scanSource('fixture.tsx', src, { mode: 'jsx' });
  assert.ok(findings.length > 0, 'expected the accented sentence to be caught');
});

test('catches accent-free but unambiguous French UI words', () => {
  const src = `export function X() { return <button>Annuler</button>; }`;
  const findings = scanSource('fixture.tsx', src, { mode: 'jsx' });
  assert.ok(findings.some((f) => f.text === 'Annuler'), 'expected the accent-free French word to be caught');
});

test('catches a literal French string used directly as JSX child content via an expression container', () => {
  const src = `export function X() { return <p>{'Bonjour à tous'}</p>; }`;
  const findings = scanSource('fixture.tsx', src, { mode: 'jsx' });
  assert.ok(findings.some((f) => f.text === 'Bonjour à tous'), 'expected the literal expression-container string to be caught');
});

test('catches a hardcoded literal French string in the PDF route (ts mode)', () => {
  const src = `
    export async function POST() {
      return new Response('Erreur de génération');
    }
  `;
  const findings = scanSource('fixture.ts', src, { mode: 'ts' });
  assert.ok(findings.some((f) => f.text === 'Erreur de génération'), 'expected the ts-mode literal to be caught');
});

// ─── Mutation tests: handler labels (toasts/alerts), component props ──────
// Prove the scanner catches customer-facing text that never touches JSX
// text content or a DOM a11y attribute at all -- a toast fired from a click
// handler, and a label/text prop passed to a custom (non-DOM) component.

test('catches a French toast message fired from a click handler, with no JSX text node nearby', () => {
  const src = `
    import { toast } from 'some-toast-lib';
    export function SaveButton() {
      const handleSave = () => {
        toast.success('Enregistré avec succès');
      };
      return <button onClick={handleSave}>Save</button>;
    }
  `;
  const findings = scanSource('fixture.tsx', src, { mode: 'jsx' });
  assert.ok(findings.some((f) => f.text === 'Enregistré avec succès'), 'expected the toast.success(...) argument to be caught');
});

test('catches a French alert()/confirm() message', () => {
  for (const [callee, code] of [
    ['alert', `alert('Suppression échouée')`],
    ['window.confirm', `window.confirm('Voulez-vous continuer ?')`],
  ]) {
    const src = `export function X() { const onClick = () => { ${code}; }; return <button onClick={onClick} />; }`;
    const findings = scanSource('fixture.tsx', src, { mode: 'jsx' });
    assert.ok(findings.length > 0, `expected the ${callee}(...) argument to be caught`);
  }
});

test('catches a French label passed as a prop to a custom (non-DOM) component', () => {
  const src = `
    export function Toolbar() {
      return <ActionButton label="Ajouter une pièce" />;
    }
  `;
  const findings = scanSource('fixture.tsx', src, { mode: 'jsx' });
  assert.ok(findings.some((f) => f.text === 'Ajouter une pièce'), 'expected the custom component\'s label prop to be caught');
});

test('catches the newly added accent-free French phrases/words (Plan de coupe, Ajouter, Retour, Ouvrir)', () => {
  for (const word of ['Plan de coupe', 'Ajouter', 'Retour', 'Ouvrir']) {
    const src = `export function X() { return <button>${word}</button>; }`;
    const findings = scanSource('fixture.tsx', src, { mode: 'jsx' });
    assert.ok(findings.some((f) => f.text === word), `expected "${word}" to be caught`);
  }
});

// ─── Mutation tests: template literals in customer-facing shapes ──────────
// Prove the scanner catches French text in a template literal's *static*
// pieces even when it also interpolates a dynamic value -- not just a plain
// string literal -- across every customer-facing shape it scans.

test('catches a French template-literal string used directly as JSX child content, with a dynamic interpolation', () => {
  const src = 'export function X({ name }) { return <p>{`Télécharger ${name}`}</p>; }';
  const findings = scanSource('fixture.tsx', src, { mode: 'jsx' });
  assert.ok(
    findings.some((f) => f.text === 'Télécharger'),
    "expected the template literal's static head to be caught as JSX child content"
  );
});

test('catches a French template-literal string passed as a prop to a custom component, with a dynamic interpolation', () => {
  const src = 'export function X({ count }) { return <ActionButton label={`Ajouter ${count} pièces`} />; }';
  const findings = scanSource('fixture.tsx', src, { mode: 'jsx' });
  assert.ok(
    findings.some((f) => f.text === 'Ajouter'),
    "expected the template literal prop's static head to be caught"
  );
  assert.ok(
    findings.some((f) => f.text === 'pièces'),
    "expected the template literal prop's static tail to be caught too"
  );
});

test('catches a French template-literal string fired as a toast, with a dynamic interpolation', () => {
  const src = `
    import { toast } from 'some-toast-lib';
    export function SaveButton({ name }) {
      const handleSave = () => {
        toast.error(\`Télécharger \${name} a échoué\`);
      };
      return <button onClick={handleSave}>Save</button>;
    }
  `;
  const findings = scanSource('fixture.tsx', src, { mode: 'jsx' });
  assert.ok(
    findings.some((f) => f.text === 'Télécharger'),
    "expected the toast template literal's static head to be caught"
  );
});

// ─── False-positive guards ─────────────────────────────────────────────────

test('does not flag a className, even one that happens to contain accented-looking text', () => {
  const src = `export function X() { return <div className="téléchargement-icone" />; }`;
  const findings = scanSource('fixture.tsx', src, { mode: 'jsx' });
  assert.deepEqual(findings, [], 'className must never be scanned');
});

test('does not flag JSX comments', () => {
  const src = `
    export function X() {
      return (
        <div>
          {/* Télécharger le rapport ici, pas un vrai texte affiché */}
          <span>QatlIA Pro 2026</span>
        </div>
      );
    }
  `;
  const findings = scanSource('fixture.tsx', src, { mode: 'jsx' });
  assert.deepEqual(findings, [], 'a JSX comment must never be scanned, and the brand string is allowlisted');
});

test('does not flag block/line comments in ts mode', () => {
  const src = `
    // Ceci est un commentaire en français, jamais affiché à l'utilisateur.
    /** Un autre commentaire français, dans une docstring. */
    export const OK = 'PDF_EXPORT_FAILED';
  `;
  const findings = scanSource('fixture.ts', src, { mode: 'ts' });
  assert.deepEqual(findings, [], 'comments are not literal-value AST nodes and must never be scanned');
});

test('does not flag the allowlisted brand string or unit/currency tokens', () => {
  const src = `
    export function X() {
      return (
        <div>
          <span>QatlIA Pro 2026</span>
          <span>208.5 cm</span>
          <span>5.78 m²</span>
          <span title="MAD" />
        </div>
      );
    }
  `;
  const findings = scanSource('fixture.tsx', src, { mode: 'jsx' });
  assert.deepEqual(findings, [], `allowlisted/technical tokens must never be flagged:\n${formatFindings(findings)}`);
});

test('does not flag an import module specifier, even one with a (contrived) accented path', () => {
  const src = `
    import x from './télécharger-utils';
    const y = require('./annuler-helpers');
  `;
  const findings = scanSource('fixture.ts', src, { mode: 'ts' });
  assert.deepEqual(findings, [], 'import/require module specifiers must never be scanned');
});

test('does not flag a plain (non-JSX-text, non-allowlisted-attribute) data string in jsx mode', () => {
  // e.g. a seed/fixture object literal's French field value, or a
  // console.error message -- neither is JSX text nor a scanned attribute.
  const src = `
    const DEFAULT_PIECES = [{ name: 'Panneau Latéral G' }];
    export function X() {
      console.error('Erreur téléchargement PDF:', null);
      return <div data-testid="Panneau Latéral G" />;
    }
  `;
  const findings = scanSource('fixture.tsx', src, { mode: 'jsx' });
  assert.deepEqual(findings, [], 'plain data/log strings and technical attributes must never be scanned');
});

test('does not flag a technical JSX attribute value, even a widened one now scanned by default (value, href, data-*)', () => {
  const src = `
    export function X() {
      return (
        <div>
          <option value="Ajouter une pièce" />
          <a href="/annuler-la-commande">link</a>
          <div data-tooltip="Télécharger le rapport" />
        </div>
      );
    }
  `;
  const findings = scanSource('fixture.tsx', src, { mode: 'jsx' });
  assert.deepEqual(findings, [], `technical attributes must never be scanned even by the widened default:\n${formatFindings(findings)}`);
});

test('does not flag a French string passed to an unrelated call (console.error, fetch, an analytics track call)', () => {
  const src = `
    export function X() {
      const onClick = () => {
        console.error('Erreur de téléchargement');
        fetch('/api/annuler-commande');
        track('Suppression réussie');
      };
      return <button onClick={onClick} />;
    }
  `;
  const findings = scanSource('fixture.tsx', src, { mode: 'jsx' });
  assert.deepEqual(findings, [], `only known notification callees must be scanned for handler labels:\n${formatFindings(findings)}`);
});
