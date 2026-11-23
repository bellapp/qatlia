-- ============================================================
-- 020_ateliers.sql
-- The account's business identity (user decision, 2026-11-23): each customer
-- saves "Mon entreprise" once — name, contact details, ICE / IF and an
-- optional logo — and QatliA prints it on the cut-plan and quotation PDFs.
--
--   * One row per account (user_id is the primary key). The row goes away
--     with the account (ON DELETE CASCADE).
--   * logo_data_url is a PNG or JPEG data URL, or NULL. The app validates it
--     on write and again before it is drawn in a PDF.
--   * Row Level Security is on with NO policy: the session client reads and
--     writes nothing here. Only the server routes (/api/atelier, the PDF
--     exports) touch the table, with the service role and an explicit
--     .eq('user_id', user.id) filter (src/lib/atelier-server.ts).
--
-- Additive only: a new table, nothing existing is altered. The app keeps
-- working before this is applied: a read error on ateliers means "no
-- business", so the PDFs stay exactly as they are today.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ateliers (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  address    TEXT,
  phone      TEXT,
  email      TEXT,
  ice        TEXT,
  tax_id     TEXT,
  logo_data_url TEXT,           -- data:image/(png|jpeg);base64,... ou NULL
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.ateliers ENABLE ROW LEVEL SECURITY;
-- Aucune policy client : seules les routes serveur y accèdent, avec la
-- service role et un filtre explicite .eq('user_id', user.id).

-- Check after applying:
--   SELECT count(*) FROM public.ateliers;   -- 0 until customers save theirs
--   SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ateliers'::regclass;   -- true
