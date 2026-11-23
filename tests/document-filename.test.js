const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

const {
  cutPlanFileNames,
  quotationFileNames,
  contentDispositionFor,
  fileNameFromContentDisposition,
} = loadTsModule('src/lib/document-filename.ts');

test("cutPlanFileNames without a company keeps today's QatliA_ name", () => {
  assert.deepEqual(cutPlanFileNames('Cuisine bois'), {
    ascii: 'QatliA_CUISINE_BOIS.pdf',
    utf8: 'QatliA_CUISINE_BOIS.pdf',
  });
});

test('cutPlanFileNames without a company reproduces the legacy ascii/utf8 split exactly', () => {
  // Arabic-only project: ascii falls back to EXPORT, utf8 keeps the name.
  assert.deepEqual(cutPlanFileNames('مطبخ خشب'), {
    ascii: 'QatliA_EXPORT.pdf',
    utf8: 'QatliA_مطبخ_خشب.pdf',
  });
  // Mixed: non-printable-ASCII chars dropped from ascii only.
  assert.equal(cutPlanFileNames('Café  noir').ascii, 'QatliA_CAF_NOIR.pdf');
  assert.equal(cutPlanFileNames('Café  noir').utf8, 'QatliA_CAFÉ_NOIR.pdf');
  // null / blank company behaves like no company.
  assert.deepEqual(cutPlanFileNames('Cuisine', null), cutPlanFileNames('Cuisine'));
  assert.deepEqual(cutPlanFileNames('Cuisine', '   '), cutPlanFileNames('Cuisine'));
});

test('cutPlanFileNames uses the company name as prefix', () => {
  assert.equal(cutPlanFileNames('Cuisine', 'Menuiserie Benali').ascii, 'Menuiserie_Benali_CUISINE.pdf');
  assert.equal(cutPlanFileNames('Cuisine', 'Menuiserie Benali').utf8, 'Menuiserie_Benali_CUISINE.pdf');
});

test('company names with quotes, semicolons and CR/LF never reach the ascii filename', () => {
  const { ascii, utf8 } = cutPlanFileNames('X', 'A"b;\r\nc');
  assert.doesNotMatch(ascii, /["; \r\n]/);
  assert.doesNotMatch(utf8, /["; \r\n/\\]/);
});

test('company name is capped at 40 ascii characters', () => {
  const { ascii } = cutPlanFileNames('X', 'A'.repeat(100));
  assert.equal(ascii, `${'A'.repeat(40)}_X.pdf`);
});

test('the utf8 company part is capped at 40 code points too', () => {
  const arabic = 'نجارة'.repeat(40); // 200 characters
  const capped = Array.from(arabic).slice(0, 40).join('');
  assert.equal(cutPlanFileNames('X', arabic).utf8, `${capped}_X.pdf`);
  assert.equal(quotationFileNames('DEV-1', arabic).utf8, `${capped}_Devis_DEV-1.pdf`);
  // Code points, not UTF-16 units: an astral character is never split.
  const hammers = cutPlanFileNames('X', '\u{1F528}'.repeat(60)).utf8;
  assert.equal(Array.from(hammers.replace(/_X\.pdf$/, '')).length, 40);
});

test('an Arabic-only company falls back to QatliA in ascii but keeps the Arabic in utf8', () => {
  const names = cutPlanFileNames('Cuisine', 'نجارة بنعلي');
  assert.equal(names.ascii, 'QatliA_CUISINE.pdf');
  assert.match(names.utf8, /^نجارة_بنعلي_CUISINE\.pdf$/);
});

test('non-ASCII words are dropped from the ascii prefix without leaving doubled separators', () => {
  assert.equal(cutPlanFileNames('X', 'Atelier é Benali').ascii, 'Atelier_Benali_X.pdf');
});

test('quotationFileNames → {Entreprise}_Devis_{n}.pdf', () => {
  assert.equal(quotationFileNames('DEV-1', 'Atelier Karim').ascii, 'Atelier_Karim_Devis_DEV-1.pdf');
  assert.equal(quotationFileNames('DEV-1', 'Atelier Karim').utf8, 'Atelier_Karim_Devis_DEV-1.pdf');
});

test('quotationFileNames falls back to QatliA for an Arabic-only company and sanitises the quote number', () => {
  const names = quotationFileNames('DEV"1;', 'نجارة');
  assert.equal(names.ascii, 'QatliA_Devis_DEV1.pdf');
  assert.equal(names.utf8, 'نجارة_Devis_DEV1.pdf');
  assert.equal(quotationFileNames('رقم', 'Atelier').ascii, 'Atelier_Devis_DEVIS.pdf');
});

test('contentDispositionFor builds an attachment header with ascii filename and RFC 5987 filename*', () => {
  const header = contentDispositionFor({ ascii: 'A_B.pdf', utf8: 'ب (1).pdf' });
  assert.equal(header, `attachment; filename="A_B.pdf"; filename*=UTF-8''%D8%A8%20%281%29.pdf`);
});

test('fileNameFromContentDisposition round-trips contentDispositionFor', () => {
  const names = quotationFileNames('DEV-1', 'نجارة');
  assert.equal(fileNameFromContentDisposition(contentDispositionFor(names)), names.utf8);
  assert.equal(fileNameFromContentDisposition(null), null);
});

test('fileNameFromContentDisposition falls back to the plain filename and tolerates garbage', () => {
  assert.equal(fileNameFromContentDisposition('attachment; filename="plan.pdf"'), 'plan.pdf');
  assert.equal(fileNameFromContentDisposition('attachment'), null);
  assert.equal(fileNameFromContentDisposition("attachment; filename*=UTF-8''%E0%A4%A"), null);
});

test('a free-typed project name cannot inject quotes, semicolons or backslashes into the ascii filename', () => {
  const project = 'Cuisine "A";B\\C';
  for (const names of [cutPlanFileNames(project), cutPlanFileNames(project, 'Menuiserie Benali')]) {
    assert.doesNotMatch(names.ascii, /["\\;]/);
    assert.match(names.ascii, /CUISINE_AB.*C\.pdf$/);
  }
  assert.equal(cutPlanFileNames(project).ascii, 'QatliA_CUISINE_ABC.pdf');
  assert.equal(
    contentDispositionFor(cutPlanFileNames(project)).split('; filename*=')[0],
    'attachment; filename="QatliA_CUISINE_ABC.pdf"'
  );
});
