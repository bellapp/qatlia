-- Panel presets per account (user request, 2026-11-12): each artisan manages
-- their own list of stock panels, kept in their account so it follows them to
-- any device. Two panels may share dimensions when their material, colour or
-- grain differ; that rule is enforced by /api/panel-presets
-- (src/lib/panel-preset-rules.ts), not by a unique index, because the colour
-- is compared case-insensitively and the grain direction only counts on a
-- grained panel.
--
-- Access goes through /api/panel-presets with the service role and an
-- explicit user_id filter, like /api/projects. Client roles get read-own via
-- RLS and nothing else.

CREATE TABLE IF NOT EXISTS public.panel_presets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  -- Canonical centimetres, as everywhere else in the app.
  height            DOUBLE PRECISION NOT NULL CHECK (height > 0 AND height <= 100000),
  width             DOUBLE PRECISION NOT NULL CHECK (width > 0 AND width <= 100000),
  material          TEXT NOT NULL DEFAULT 'mdf' CHECK (char_length(material) BETWEEN 1 AND 40),
  -- Free-text colour or décor (« Blanc », « Noyer »…); NULL when none.
  color             TEXT CHECK (color IS NULL OR char_length(color) BETWEEN 1 AND 60),
  has_grain         BOOLEAN NOT NULL DEFAULT false,
  -- Only meaningful on a grained panel.
  grain_orientation TEXT CHECK (
    (has_grain AND grain_orientation IN ('vertical', 'horizontal'))
    OR (NOT has_grain AND grain_orientation IS NULL)
  ),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_panel_presets_user ON public.panel_presets (user_id, created_at);

ALTER TABLE public.panel_presets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "panel_presets_select_own" ON public.panel_presets;
CREATE POLICY "panel_presets_select_own"
  ON public.panel_presets FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Supabase's default privileges grant client roles access to every new public
-- table; take it back so writes go through the API route only.
REVOKE ALL ON public.panel_presets FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.panel_presets TO authenticated;
GRANT ALL ON public.panel_presets TO service_role;
