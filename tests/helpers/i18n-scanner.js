'use strict';

const ts = require('typescript');

// A French accented/ligature character is the primary, low-false-positive
// signal: none of these appear in English UI copy, technical identifiers,
// CSS class names, brand names ("QatlIA Pro 2026"), unit tokens (cm, mm,
// m², MAD) or error codes (SCREAMING_SNAKE_CASE) used in this codebase.
const FRENCH_ACCENTS = /[àâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇœŒæÆ]/;

// A small supplementary list of common French UI words/phrases that happen
// to carry no accent at all, so the regex above alone would miss them. Kept
// short and deliberately unambiguous (no entry here is also a plausible
// English *technical* identifier this codebase uses), matched whole-word/
// whole-phrase so it never fires on a substring (e.g. "connexionId"). A
// phrase like "plan de coupe" is still matched as one alternative, not
// word-by-word, so an unrelated sentence that merely contains "plan" alone
// is never flagged.
// 'total' is deliberately *not* in this list on its own: it is spelled
// identically in English, so a bare-word match would flag legitimate
// English UI copy as French (a real false positive, not a hypothetical
// one -- see the dedicated false-positive-guard test in
// tests/i18n-coverage.test.js). A French-specific phrase/context that
// actually contains it ("plan de coupe" already covers the compound case
// this app renders) is a fine signal; the bare word alone is not.
const FRENCH_WORDS = [
  'telecharger',
  'rechercher',
  'annuler',
  'enregistrer',
  'supprimer',
  'fermer',
  'confirmer',
  'continuer',
  'connexion',
  'deconnexion',
  'parametres',
  'precedent',
  'suivant',
  'chargement',
  'quantite',
  'plan de coupe',
  'ajouter',
  'retour',
  'ouvrir',
];
const FRENCH_WORD_PATTERN = new RegExp(`\\b(?:${FRENCH_WORDS.join('|')})\\b`, 'i');

// 'jsx' mode used to only look at a small *inclusion* allowlist of textual
// JSX attributes (placeholder/aria-label/alt/title/...), which meant a
// string passed to any other prop -- including a custom component's own
// label/text prop ("component props": `<Button label="Ajouter" />`,
// `<EmptyState message="..." />`) -- was invisible to the scanner. Per the
// task this supports ("minimal explicit technical allowlist, not broad
// ignore"), the default is now inverted: every JSX attribute's string value
// is scanned *unless* its name is in this small, explicitly technical
// exclusion set (DOM/SVG plumbing that is never rendered as visible text,
// or is read by tooling rather than a human).
const TECHNICAL_JSX_ATTRS = new Set([
  'className', 'class', 'style', 'id', 'key', 'ref',
  'href', 'src', 'srcSet', 'action', 'method', 'target', 'rel', 'formAction',
  'name', 'type', 'htmlFor', 'for', 'autoComplete', 'inputMode', 'pattern',
  'value', 'defaultValue', 'tabIndex', 'role', 'dir', 'lang', 'encType',
  'viewBox', 'xmlns', 'd', 'fill', 'stroke', 'transform', 'points',
  'cx', 'cy', 'r', 'x', 'y', 'width', 'height', 'min', 'max', 'step',
]);
function isTechnicalJsxAttr(name) {
  return TECHNICAL_JSX_ATTRS.has(name) || name.startsWith('data-') || name.startsWith('aria-hidden') || name.startsWith('on');
}

// User-facing notification APIs: a literal string passed to one of these is
// shown directly to the artisan (a toast/alert/confirm/prompt dialog), even
// though it never touches JSX at all -- e.g. a handler's
// `toast.error('Une erreur est survenue')` fired from an onClick, with no
// JSX text node or scanned attribute anywhere near it ("handler labels").
// Matched by the exact callee shape (a bare identifier, or a two-level
// `object.method` property access) rather than scanning every call
// expression's arguments indiscriminately -- a technical
// `console.error('...')`, `fetch('...')` or `track('event_name')` call must
// never be flagged just for being nearby.
const NOTIFICATION_CALLEES = new Set([
  'alert', 'confirm', 'prompt',
  'toast.success', 'toast.error', 'toast.info', 'toast.warning', 'toast.message', 'toast.loading',
  'window.alert', 'window.confirm', 'window.prompt',
]);

function calleeName(expr) {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)) {
    if (ts.isIdentifier(expr.expression)) return `${expr.expression.text}.${expr.name.text}`;
  }
  return null;
}

// Exact full-string matches only (never a substring) -- the brand name, and
// the unit/currency tokens this app-wide convention (see pdf-catalog.ts's
// module doc comment) never translates. Kept intentionally tiny: broadening
// this is exactly what the task this scanner supports asks not to do.
const ALLOWLIST = new Set(['QatlIA', 'QatlIA Pro', 'QatlIA Pro 2026', 'cm', 'mm', 'm²', 'm2', 'MAD']);

function looksFrench(text) {
  return FRENCH_ACCENTS.test(text) || FRENCH_WORD_PATTERN.test(text);
}

function isExcludedStringLiteral(node) {
  const parent = node.parent;
  if (!parent) return false;
  // import/export ... from '...'
  if ((ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) && parent.moduleSpecifier === node) return true;
  // require('...') and dynamic import('...')
  if (ts.isCallExpression(parent) && parent.arguments[0] === node) {
    const callee = parent.expression;
    if (ts.isIdentifier(callee) && callee.text === 'require') return true;
    if (callee.kind === ts.SyntaxKind.ImportKeyword) return true;
  }
  return false;
}

/**
 * Scans one already-read TS/TSX source string for literal, customer-facing
 * French UI text.
 *
 * `mode: 'jsx'` (the default, for .tsx component files) looks at:
 *  - JSX text nodes;
 *  - every JSX attribute's string *or template-literal* value, except the
 *    small explicitly technical exclusion set above (`isTechnicalJsxAttr`)
 *    -- this covers both DOM a11y attributes (aria-label, alt, title,
 *    placeholder, ...) and a custom component's own label/text *props*,
 *    including a dynamic one like `label={`Télécharger ${name}`}`;
 *  - a literal string or template literal used directly as JSX child
 *    content via an expression container, e.g. `<p>{'Texte'}</p>` or
 *    `<p>{`Ajouter ${count}`}</p>`;
 *  - a literal string or template-literal argument to a known user-facing
 *    notification call (`toast.error(...)`, `alert(...)`, ...), anywhere in
 *    the file, not just inside JSX -- this is how a hardcoded *handler*
 *    label (e.g. a toast fired from an onClick with no JSX text nearby)
 *    gets caught.
 * For a template literal (with or without interpolation), only the static
 * text pieces (`` `head` ``/each span's `.literal`) are checked -- the
 * interpolated expressions themselves are never literal UI text -- so
 * `` `Télécharger ${name}` `` is caught via its "Télécharger " head without
 * needing to evaluate or stringify `name`.
 * It deliberately does not scan every string literal in the file (a seed
 * fixture's French field value, a `console.error` message, a technical
 * identifier) -- only these customer-facing shapes. Comments are never
 * visited (they aren't literal-value AST nodes at all, so nothing special
 * has to exclude them).
 *
 * `mode: 'ts'` (for server routes with no JSX to scope down to) scans every
 * string and template literal in the file, excluding import/require module
 * specifiers. A route's machine-readable `error: 'SOME_CODE'` fields are
 * exempt by construction, not by a special case: a SCREAMING_SNAKE_CASE
 * code contains no French accents and none of FRENCH_WORDS, so it never
 * matches `looksFrench` in the first place.
 */
function scanSource(filePath, sourceText, { mode = 'jsx' } = {}) {
  const scriptKind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
  const findings = [];

  function report(node, text) {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    findings.push({ file: filePath, line: line + 1, column: character + 1, text: text.trim() });
  }

  function checkCandidate(node, rawText) {
    const text = rawText.trim();
    if (!text || ALLOWLIST.has(text)) return;
    if (looksFrench(text)) report(node, text);
  }

  // Checks a string OR template literal expression -- `'Texte'`,
  // `` `Texte` `` (no-substitution) and `` `Texte ${dynamic}` `` (with
  // interpolation) alike. Only the *static* pieces of a template
  // (`.head`/each `.literal`) are ever checked -- the interpolated
  // expression itself (`${name}`, `${count}`) is never a string literal
  // needing translation, so nothing is lost by not descending into it; but
  // catching French text in the surrounding static text
  // (`` `Télécharger ${name}` `` -- "Télécharger " is the head) is exactly
  // the point.
  function checkTemplateLike(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      checkCandidate(node, node.text);
    } else if (ts.isTemplateExpression(node)) {
      checkCandidate(node.head, node.head.text);
      for (const span of node.templateSpans) checkCandidate(span.literal, span.literal.text);
    }
  }

  function visitJsxAttribute(node) {
    const name = node.name.getText(sourceFile);
    if (isTechnicalJsxAttr(name) || !node.initializer) return;
    if (ts.isStringLiteral(node.initializer)) {
      checkCandidate(node.initializer, node.initializer.text);
    } else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
      checkTemplateLike(node.initializer.expression);
    }
  }

  function visitNotificationCall(node) {
    const name = calleeName(node.expression);
    if (!name || !NOTIFICATION_CALLEES.has(name)) return;
    for (const arg of node.arguments) checkTemplateLike(arg);
  }

  function visit(node) {
    if (ts.isJsxText(node)) {
      checkCandidate(node, node.text);
    } else if (mode === 'jsx' && ts.isJsxAttribute(node)) {
      visitJsxAttribute(node);
    } else if (
      mode === 'jsx' &&
      ts.isJsxExpression(node) &&
      !ts.isJsxAttribute(node.parent) &&
      node.expression &&
      (ts.isStringLiteral(node.expression) ||
        ts.isNoSubstitutionTemplateLiteral(node.expression) ||
        ts.isTemplateExpression(node.expression))
    ) {
      // A literal string or template literal used directly as JSX child
      // content, e.g. `<p>{'Texte'}</p>` or `<p>{`Télécharger ${name}`}</p>`.
      checkTemplateLike(node.expression);
    } else if (mode === 'jsx' && ts.isCallExpression(node)) {
      visitNotificationCall(node);
    } else if (mode === 'ts' && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) {
      if (!isExcludedStringLiteral(node)) checkCandidate(node, node.text);
    } else if (mode === 'ts' && ts.isTemplateExpression(node)) {
      checkCandidate(node.head, node.head.text);
      for (const span of node.templateSpans) checkCandidate(span.literal, span.literal.text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}

module.exports = { scanSource, looksFrench, ALLOWLIST, isTechnicalJsxAttr };
