-- Extension UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- Table profiles (gérée par Supabase Auth, extended ici)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id            UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email         TEXT NOT NULL,
  full_name     TEXT,
  locale        TEXT DEFAULT 'fr',          -- 'fr' ou 'ar'
  credits       INTEGER NOT NULL DEFAULT 5, -- 5 crédits offerts à l'inscription
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Table projects (projets de découpe)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.projects (
  id            UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id       UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  name          TEXT NOT NULL,
  material      TEXT NOT NULL,              -- 'mdf' | 'aluminium' | 'verre' | 'contreplaques'
  sheet_width   DECIMAL(8,2) NOT NULL,      -- Largeur feuille en cm
  sheet_height  DECIMAL(8,2) NOT NULL,      -- Hauteur feuille en cm
  kerf          DECIMAL(4,2) DEFAULT 0.3,   -- Épaisseur trait de scie en cm
  grain_direction BOOLEAN DEFAULT TRUE,     -- Respecter le sens du veinage
  status        TEXT DEFAULT 'draft',       -- 'draft' | 'optimized' | 'exported'
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Table pieces (liste des pièces à découper)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pieces (
  id            UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  project_id    UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  label         TEXT,                       -- Nom optionnel (ex: "Panneau latéral gauche")
  width         DECIMAL(8,2) NOT NULL,      -- Largeur en cm
  height        DECIMAL(8,2) NOT NULL,      -- Hauteur en cm
  quantity      INTEGER NOT NULL DEFAULT 1,
  rotatable     BOOLEAN DEFAULT FALSE,      -- Peut être tournée (si pas de veinage)
  sort_order    INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Table cut_results (résultats d'optimisation)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cut_results (
  id              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  project_id      UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  sheets_used     INTEGER NOT NULL,
  waste_percentage DECIMAL(5,2),
  total_area_used DECIMAL(10,2),
  layout_data     JSONB NOT NULL,           -- Données complètes du schéma (positions pièces)
  svg_data        TEXT,                     -- SVG du schéma généré
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Table credit_transactions (historique des transactions)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.credit_transactions (
  id              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id         UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  type            TEXT NOT NULL,            -- 'purchase' | 'usage' | 'bonus'
  amount          INTEGER NOT NULL,         -- Positif = crédit, négatif = débit
  balance_after   INTEGER NOT NULL,
  description     TEXT,
  stripe_payment_id TEXT,
  youcan_payment_id TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Table image_extractions (log des extractions IA)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.image_extractions (
  id              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  project_id      UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  user_id         UUID REFERENCES public.profiles(id) NOT NULL,
  image_url       TEXT NOT NULL,            -- URL temporaire Supabase Storage
  extracted_data  JSONB,                    -- Données brutes extraites par l'IA
  credits_used    INTEGER DEFAULT 1,
  success         BOOLEAN DEFAULT TRUE,
  error_message   TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pieces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cut_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.image_extractions ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR ALL USING (auth.uid() = id);

CREATE POLICY "Users can manage own projects"
  ON public.projects FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own pieces"
  ON public.pieces FOR ALL USING (
    auth.uid() = (SELECT user_id FROM public.projects WHERE id = project_id)
  );

CREATE POLICY "Users can view own results"
  ON public.cut_results FOR ALL USING (
    auth.uid() = (SELECT user_id FROM public.projects WHERE id = project_id)
  );

CREATE POLICY "Users can view own transactions"
  ON public.credit_transactions FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can view own extractions"
  ON public.image_extractions FOR ALL USING (auth.uid() = user_id);

-- Trigger création automatique de profil après signup Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, credits)
  VALUES (new.id, new.email, new.raw_user_meta_data->>'full_name', 5);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
