export type MaterialType = 'mdf' | 'aluminium' | 'verre' | 'contreplaques' | 'melamine' | 'chene' | 'stratifié' | 'medium';

export interface ImportedPiece {
  id: string;
  name: string;
  height: number;
  width: number;
  quantity: number;
  material: MaterialType;
  rotatable: true;
}

export interface ParsePiecesImportParams {
  input: string;
  defaultMaterial: MaterialType;
}

export interface ParsePiecesImportResult {
  importedPieces: ImportedPiece[];
  ignoredLines: number;
  summary: string;
}

const HEADER_TOKENS = new Set([
  'nom',
  'reference',
  'référence',
  'hauteur',
  'largeur',
  'quantite',
  'quantité',
  'qty',
]);

function detectDelimiter(line: string): ';' | '\t' | ',' {
  let quote: '"' | '\'' | null = null;
  let hasSemicolon = false;
  let hasTab = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if ((char === '"' || char === '\'') && (quote === null || quote === char)) {
      if (quote === char && line[index + 1] === char) {
        index += 1;
        continue;
      }
      quote = quote === null ? char : null;
      continue;
    }

    if (quote !== null) continue;
    if (char === '\t') hasTab = true;
    if (char === ';') hasSemicolon = true;
  }

  if (hasTab) return '\t';
  if (hasSemicolon) return ';';
  return ',';
}

function splitRow(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quote: '"' | '\'' | null = null;
  const delimiter = detectDelimiter(line);

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if ((char === '"' || char === '\'') && (quote === null || quote === char)) {
      if (quote === char && line[index + 1] === char) {
        current += char;
        index += 1;
        continue;
      }
      quote = quote === null ? char : null;
      continue;
    }

    if (quote === null && char === delimiter) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function normalizeLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function isHeaderRow(cells: string[]): boolean {
  if (cells.length < 4) return false;
  return cells.slice(0, 4).every((cell) => HEADER_TOKENS.has(normalizeLabel(cell)));
}

function parseNumber(value: string): number | null {
  const normalized = value.trim().replace(/\s+/g, '').replace(',', '.');
  if (normalized === '') return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function normalizeDimensions(height: number, width: number): [number, number] {
  const shouldConvertFromMm = height > 500 || width > 500;
  const divisor = shouldConvertFromMm ? 10 : 1;
  const round = (value: number) => Math.round((value / divisor) * 10) / 10;
  return [round(height), round(width)];
}

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count > 1 ? plural : singular}`;
}

export function parsePiecesImport({
  input,
  defaultMaterial,
}: ParsePiecesImportParams): ParsePiecesImportResult {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');

  const importedPieces: ImportedPiece[] = [];
  let ignoredLines = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const cells = splitRow(line);
    const nonEmptyCells = cells.filter((cell) => cell !== '');

    if (nonEmptyCells.length === 0) {
      ignoredLines += 1;
      continue;
    }

    if (lineIndex === 0 && isHeaderRow(nonEmptyCells)) {
      continue;
    }

    if (nonEmptyCells.length < 4) {
      ignoredLines += 1;
      continue;
    }

    const [rawName, rawHeight, rawWidth, rawQuantity] = nonEmptyCells;
    const height = parseNumber(rawHeight);
    const width = parseNumber(rawWidth);
    const quantity = parseNumber(rawQuantity);

    if (height === null || width === null || quantity === null) {
      ignoredLines += 1;
      continue;
    }

    const [normalizedHeight, normalizedWidth] = normalizeDimensions(height, width);

    importedPieces.push({
      id: `import_${importedPieces.length + 1}`,
      name: rawName.replace(/^["']|["']$/g, '').trim() || `Pièce ${importedPieces.length + 1}`,
      height: normalizedHeight,
      width: normalizedWidth,
      quantity: Math.max(1, Math.round(quantity)),
      material: defaultMaterial,
      rotatable: true,
    });
  }

  return {
    importedPieces,
    ignoredLines,
    summary: `${pluralize(importedPieces.length, 'pièce importée', 'pièces importées')} · ${pluralize(ignoredLines, 'ligne ignorée', 'lignes ignorées')}`,
  };
}
