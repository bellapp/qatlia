-- ============================================================
-- SCRIPT COMPLET À EXÉCUTER DANS LE SQL EDITOR DE SUPABASE
-- ============================================================

-- 1. Extension UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Table profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id            UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email         TEXT NOT NULL,
  full_name     TEXT,
  locale        TEXT DEFAULT 'fr',
  credits       INTEGER NOT NULL DEFAULT 5,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Table projects
CREATE TABLE IF NOT EXISTS public.projects (
  id            UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name          TEXT NOT NULL,
  material      TEXT NOT NULL,
  sheet_width   DECIMAL(8,2) NOT NULL,
  sheet_height  DECIMAL(8,2) NOT NULL,
  kerf          DECIMAL(4,2) DEFAULT 0.3,
  grain_direction BOOLEAN DEFAULT FALSE,
  status        TEXT DEFAULT 'optimized',
  options_json  JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS options_json JSONB;

-- 4. Table pieces
CREATE TABLE IF NOT EXISTS public.pieces (
  id            UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  project_id    UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  label         TEXT,
  width         DECIMAL(8,2) NOT NULL,
  height        DECIMAL(8,2) NOT NULL,
  quantity      INTEGER NOT NULL DEFAULT 1,
  material      TEXT,
  rotatable     BOOLEAN DEFAULT TRUE,
  sort_order    INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Table cut_results
CREATE TABLE IF NOT EXISTS public.cut_results (
  id              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  project_id      UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  sheets_used     INTEGER NOT NULL,
  waste_percentage DECIMAL(5,2),
  total_area_used DECIMAL(10,2),
  layout_data     JSONB NOT NULL,
  svg_data        TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Table credit_transactions
CREATE TABLE IF NOT EXISTS public.credit_transactions (
  id              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  type            TEXT DEFAULT 'usage',
  amount          INTEGER NOT NULL,
  balance_after   INTEGER DEFAULT 0,
  description     TEXT,
  reason          TEXT,
  stripe_payment_id TEXT,
  youcan_payment_id TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Activer RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pieces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cut_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

-- 8. Policies RLS
DROP POLICY IF EXISTS "Users can view and edit own profile" ON public.profiles;
CREATE POLICY "Users can view and edit own profile"
  ON public.profiles FOR ALL USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can manage own projects" ON public.projects;
CREATE POLICY "Users can manage own projects"
  ON public.projects FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage own pieces" ON public.pieces;
CREATE POLICY "Users can manage own pieces"
  ON public.pieces FOR ALL USING (
    auth.uid() = (SELECT user_id FROM public.projects WHERE id = project_id)
  );

DROP POLICY IF EXISTS "Users can view own results" ON public.cut_results;
CREATE POLICY "Users can view own results"
  ON public.cut_results FOR ALL USING (
    auth.uid() = (SELECT user_id FROM public.projects WHERE id = project_id)
  );

DROP POLICY IF EXISTS "Users can view own transactions" ON public.credit_transactions;
CREATE POLICY "Users can view own transactions"
  ON public.credit_transactions FOR ALL USING (auth.uid() = user_id);

-- 9. Trigger création de profil automatique sur Auth SignUp
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, credits)
  VALUES (new.id, new.email, COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)), 5)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 10. Insérer les profils pour les utilisateurs déjà créés
INSERT INTO public.profiles (id, email, full_name, credits)
SELECT id, email, COALESCE(raw_user_meta_data->>'full_name', split_part(email, '@', 1)), 5
FROM auth.users
ON CONFLICT (id) DO NOTHING;
