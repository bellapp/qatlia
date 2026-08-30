import type { MaterialType } from '../cutting/binpacking';

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

export interface TemplatePiece {
  id: string;
  name: string;
  height: number;
  width: number;
  quantity: number;
  material: MaterialType;
  rotatable: true;
  color: string;
  edges: {
    left: boolean;
    right: boolean;
    top: boolean;
    bottom: boolean;
  };
}

export interface FurnitureTemplate {
  name: TemplateName;
  description: string;
  pieceCount: number;
}

type TemplateDraftPiece = Omit<TemplatePiece, 'id' | 'material' | 'color'>;

export type TemplateName = 'Meuble TV' | 'Bibliothèque' | 'Armoire' | 'Meuble bas cuisine';

const TEMPLATE_DRAFTS: Record<TemplateName, TemplateDraftPiece[]> = {
  'Meuble TV': [
    { name: 'Plateau haut', height: 45, width: 160, quantity: 1, rotatable: true, edges: { left: false, right: false, top: true, bottom: true } },
    { name: 'Plateau bas', height: 45, width: 160, quantity: 1, rotatable: true, edges: { left: false, right: false, top: true, bottom: true } },
    { name: 'Côté gauche', height: 40, width: 45, quantity: 1, rotatable: true, edges: { left: true, right: false, top: false, bottom: false } },
    { name: 'Côté droit', height: 40, width: 45, quantity: 1, rotatable: true, edges: { left: false, right: true, top: false, bottom: false } },
    { name: 'Séparation centrale', height: 40, width: 45, quantity: 2, rotatable: true, edges: { left: false, right: false, top: false, bottom: false } },
    { name: 'Fond niche', height: 38, width: 52, quantity: 2, rotatable: true, edges: { left: false, right: false, top: false, bottom: false } },
  ],
  'Bibliothèque': [
    { name: 'Côté gauche', height: 210, width: 32, quantity: 1, rotatable: true, edges: { left: true, right: false, top: false, bottom: false } },
    { name: 'Côté droit', height: 210, width: 32, quantity: 1, rotatable: true, edges: { left: false, right: true, top: false, bottom: false } },
    { name: 'Dessus', height: 32, width: 90, quantity: 1, rotatable: true, edges: { left: false, right: false, top: true, bottom: false } },
    { name: 'Dessous', height: 32, width: 90, quantity: 1, rotatable: true, edges: { left: false, right: false, top: false, bottom: true } },
    { name: 'Tablette réglable', height: 30, width: 86, quantity: 5, rotatable: true, edges: { left: false, right: false, top: true, bottom: false } },
    { name: 'Traverse arrière', height: 22, width: 86, quantity: 2, rotatable: true, edges: { left: false, right: false, top: false, bottom: false } },
  ],
  'Armoire': [
    { name: 'Côté gauche', height: 220, width: 58, quantity: 1, rotatable: true, edges: { left: true, right: false, top: false, bottom: false } },
    { name: 'Côté droit', height: 220, width: 58, quantity: 1, rotatable: true, edges: { left: false, right: true, top: false, bottom: false } },
    { name: 'Dessus', height: 58, width: 120, quantity: 1, rotatable: true, edges: { left: false, right: false, top: true, bottom: false } },
    { name: 'Dessous', height: 58, width: 120, quantity: 1, rotatable: true, edges: { left: false, right: false, top: false, bottom: true } },
    { name: 'Étagère', height: 56, width: 116, quantity: 3, rotatable: true, edges: { left: false, right: false, top: true, bottom: false } },
    { name: 'Séparation verticale', height: 180, width: 56, quantity: 1, rotatable: true, edges: { left: false, right: false, top: false, bottom: false } },
    { name: 'Porte', height: 210, width: 59, quantity: 2, rotatable: true, edges: { left: true, right: true, top: true, bottom: true } },
  ],
  'Meuble bas cuisine': [
    { name: 'Côté gauche', height: 72, width: 56, quantity: 1, rotatable: true, edges: { left: true, right: false, top: false, bottom: false } },
    { name: 'Côté droit', height: 72, width: 56, quantity: 1, rotatable: true, edges: { left: false, right: true, top: false, bottom: false } },
    { name: 'Dessus', height: 56, width: 80, quantity: 1, rotatable: true, edges: { left: false, right: false, top: true, bottom: false } },
    { name: 'Dessous', height: 56, width: 80, quantity: 1, rotatable: true, edges: { left: false, right: false, top: false, bottom: true } },
    { name: 'Tablette', height: 54, width: 76, quantity: 1, rotatable: true, edges: { left: false, right: false, top: false, bottom: false } },
    { name: 'Traverse façade', height: 22, width: 76, quantity: 2, rotatable: true, edges: { left: false, right: false, top: false, bottom: false } },
    { name: 'Porte', height: 71.5, width: 39.7, quantity: 2, rotatable: true, edges: { left: true, right: true, top: true, bottom: true } },
  ],
};

export const FURNITURE_TEMPLATES: FurnitureTemplate[] = (Object.keys(TEMPLATE_DRAFTS) as TemplateName[]).map((name) => ({
  name,
  description: `${TEMPLATE_DRAFTS[name].length} éléments prêts à ajouter`,
  pieceCount: TEMPLATE_DRAFTS[name].length,
}));

export function createFurnitureTemplatePieces(
  templateName: TemplateName,
  defaultMaterial: MaterialType,
): TemplatePiece[] {
  const draft = TEMPLATE_DRAFTS[templateName];

  return draft.map((piece, index) => ({
    id: `template_${templateName.toLowerCase().replace(/\s+/g, '_')}_${index + 1}`,
    name: piece.name,
    height: piece.height,
    width: piece.width,
    quantity: piece.quantity,
    material: defaultMaterial,
    rotatable: true,
    color: PIECE_COLOR_PALETTE[index % PIECE_COLOR_PALETTE.length],
    edges: { ...piece.edges },
  }));
}
