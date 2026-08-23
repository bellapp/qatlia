-- Migration M007 : Extension schéma pour le matériau par pièce et options JSON (Addendum v1.1)

-- 1. Ajout colonne material sur la table pieces
ALTER TABLE public.pieces
ADD COLUMN IF NOT EXISTS material TEXT DEFAULT NULL;

-- 2. Index pour filtrage et jointures rapides par matériau
CREATE INDEX IF NOT EXISTS idx_pieces_material
ON public.pieces(project_id, material);

-- 3. Ajout colonne options_json sur la table projects pour persister les options avancées (F10-F12)
ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS options_json JSONB DEFAULT '{
  "kerfWidth": 3,
  "showLabels": true,
  "singleSheetOnly": false,
  "considerMaterial": false,
  "edgeBanding": false,
  "grainDirection": true,
  "optimizationPriority": "min_waste"
}'::jsonb;
