export const PIECE_COLOR_PALETTE = [
  '#D97706',
  '#0F766E',
  '#1D4ED8',
  '#B45309',
  '#BE123C',
  '#4F46E5',
  '#15803D',
  '#7C3AED',
] as const;

function hashSeed(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function getDeterministicPieceColor(seed: string): string {
  return PIECE_COLOR_PALETTE[hashSeed(seed) % PIECE_COLOR_PALETTE.length];
}

export function buildPieceColorSeed(input: {
  id?: string;
  name?: string;
  height: number;
  width: number;
  quantity?: number;
  index?: number;
}): string {
  return [
    input.id || '',
    input.name || '',
    input.height,
    input.width,
    input.quantity || 1,
    input.index ?? 0,
  ].join('|');
}

export function getResolvedPieceColor(input: {
  color?: string | null;
  id?: string;
  name?: string;
  height: number;
  width: number;
  quantity?: number;
  index?: number;
}): string {
  if (input.color && /^#[0-9a-f]{6}$/i.test(input.color)) {
    return input.color;
  }
  return getDeterministicPieceColor(buildPieceColorSeed(input));
}

export function ensureUniquePieceId(existingIds: Iterable<string>, baseId: string): string {
  const seen = new Set(existingIds);
  if (!seen.has(baseId)) return baseId;

  let suffix = 2;
  while (seen.has(`${baseId}_${suffix}`)) {
    suffix += 1;
  }
  return `${baseId}_${suffix}`;
}
