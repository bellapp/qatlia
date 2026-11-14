-- ============================================================
-- 015_artisan_prices.sql
-- The artisan's own prices (user request, 2026-11-13): panel and
-- edge-banding prices vary from one supplier to the next.
--
--   * panel_presets.price_per_sheet — what one such panel costs, MAD.
--     NULL: the catalog price per m² of its material applies (as before).
--   * edge_band_prices — MAD per metre for each edge-banding colour.
--     A colour with no row keeps the catalog price.
--
-- Additive only. Same access model as 011: client roles may read their own
-- rows; every write goes through /api/panel-presets and /api/edge-prices
-- with the service role and an explicit user_id filter.
-- ============================================================

ALTER TABLE public.panel_presets
  ADD COLUMN IF NOT EXISTS price_per_sheet NUMERIC(12, 2)
  CHECK (price_per_sheet IS NULL OR (price_per_sheet >= 0 AND price_per_sheet <= 1000000));

CREATE TABLE IF NOT EXISTS public.edge_band_prices (
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Edge-banding preset id (white, beech, oak, grey, black, walnut);
  -- the list itself is checked by /api/edge-prices.
  edge_id     TEXT NOT NULL CHECK (char_length(edge_id) BETWEEN 1 AND 20),
  price_per_m NUMERIC(12, 2) NOT NULL CHECK (price_per_m >= 0 AND price_per_m <= 1000000),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, edge_id)
);

ALTER TABLE public.edge_band_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "edge_band_prices_select_own" ON public.edge_band_prices;
CREATE POLICY "edge_band_prices_select_own"
  ON public.edge_band_prices FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Supabase's default privileges grant client roles access to every new public
-- table; take it back so writes go through the API route only.
REVOKE ALL ON public.edge_band_prices FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.edge_band_prices TO authenticated;
GRANT ALL ON public.edge_band_prices TO service_role;

-- Check after applying:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'panel_presets' AND column_name = 'price_per_sheet';   -- one row
--   SELECT count(*) FROM public.edge_band_prices;                              -- 0
