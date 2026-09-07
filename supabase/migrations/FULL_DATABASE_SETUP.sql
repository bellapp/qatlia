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
  credits       INTEGER NOT NULL DEFAULT 10,
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
--    Les politiques des tables de crédits sont définies en section 12 : elles
--    sont en lecture seule, contrairement aux FOR ALL historiques.
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

-- 9. Trigger création de profil automatique sur Auth SignUp
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, credits)
  VALUES (new.id, new.email, COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)), 5)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 10. Insérer les profils pour les utilisateurs déjà créés
INSERT INTO public.profiles (id, email, full_name, credits)
SELECT id, email, COALESCE(raw_user_meta_data->>'full_name', split_part(email, '@', 1)), 5
FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 11. Politique de crédits (miroir de 005_credit_policy.sql)
--     1 crédit par analyse photo IA réussie. Optimisation et exports gratuits.
-- ============================================================

ALTER TABLE public.credit_transactions ADD COLUMN IF NOT EXISTS type              TEXT DEFAULT 'usage';
ALTER TABLE public.credit_transactions ADD COLUMN IF NOT EXISTS balance_after     INTEGER;
ALTER TABLE public.credit_transactions ADD COLUMN IF NOT EXISTS description       TEXT;
ALTER TABLE public.credit_transactions ADD COLUMN IF NOT EXISTS reason            TEXT;
ALTER TABLE public.credit_transactions ADD COLUMN IF NOT EXISTS stripe_payment_id TEXT;
ALTER TABLE public.credit_transactions ADD COLUMN IF NOT EXISTS created_at        TIMESTAMPTZ DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS uniq_credit_tx_stripe_payment_id
  ON public.credit_transactions (stripe_payment_id)
  WHERE stripe_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_credit_tx_user_id
  ON public.credit_transactions (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.ensure_profile(
  p_user_id   UUID,
  p_email     TEXT DEFAULT NULL,
  p_full_name TEXT DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_credits INT;
BEGIN
  INSERT INTO public.profiles (id, email, full_name, credits)
  VALUES (
    p_user_id,
    COALESCE(p_email, 'artisan@qatlia.ma'),
    COALESCE(p_full_name, split_part(COALESCE(p_email, 'artisan'), '@', 1)),
    5
  )
  ON CONFLICT (id) DO UPDATE
    -- N'écrase jamais `credits` : le solde dépensé ne doit pas être réinitialisé.
    SET email      = COALESCE(EXCLUDED.email, public.profiles.email),
        full_name  = COALESCE(public.profiles.full_name, EXCLUDED.full_name),
        updated_at = NOW()
  RETURNING credits INTO v_credits;

  RETURN v_credits;
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_credit(
  p_user_id UUID,
  p_amount  INT  DEFAULT 1,
  p_reason  TEXT DEFAULT 'vision'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current INT;
  v_new     INT;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_AMOUNT');
  END IF;

  SELECT credits INTO v_current
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF v_current IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'PROFILE_NOT_FOUND');
  END IF;

  IF v_current < p_amount THEN
    RETURN jsonb_build_object('success', false, 'balance', v_current, 'error', 'INSUFFICIENT_CREDITS');
  END IF;

  UPDATE public.profiles
  SET credits = credits - p_amount,
      updated_at = NOW()
  WHERE id = p_user_id
  RETURNING credits INTO v_new;

  INSERT INTO public.credit_transactions (user_id, type, amount, balance_after, description, reason)
  VALUES (p_user_id, 'usage', -p_amount, v_new, 'Analyse photo IA', p_reason);

  RETURN jsonb_build_object('success', true, 'balance', v_new);
END;
$$;

DROP FUNCTION IF EXISTS public.add_credits(UUID, INT);

CREATE OR REPLACE FUNCTION public.add_credits(
  p_user_id           UUID,
  p_credits           INT,
  p_stripe_payment_id TEXT,
  p_pack_id           TEXT DEFAULT 'custom'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tx_id   UUID;
  v_current INT;
  v_new     INT;
BEGIN
  IF p_credits IS NULL OR p_credits <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_CREDITS');
  END IF;

  IF p_stripe_payment_id IS NULL OR btrim(p_stripe_payment_id) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'MISSING_PAYMENT_ID');
  END IF;

  SELECT credits INTO v_current
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF v_current IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'PROFILE_NOT_FOUND');
  END IF;

  INSERT INTO public.credit_transactions (user_id, type, amount, balance_after, description, reason, stripe_payment_id)
  VALUES (p_user_id, 'purchase', p_credits, v_current + p_credits, 'Achat pack crédits', p_pack_id, p_stripe_payment_id)
  ON CONFLICT (stripe_payment_id) WHERE stripe_payment_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_tx_id;

  IF v_tx_id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'balance', v_current, 'duplicate', true);
  END IF;

  UPDATE public.profiles
  SET credits = credits + p_credits,
      updated_at = NOW()
  WHERE id = p_user_id
  RETURNING credits INTO v_new;

  RETURN jsonb_build_object('success', true, 'balance', v_new, 'duplicate', false);
END;
$$;

REVOKE ALL ON FUNCTION public.consume_credit(UUID, INT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.add_credits(UUID, INT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_profile(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.consume_credit(UUID, INT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.add_credits(UUID, INT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_profile(UUID, TEXT, TEXT) TO service_role;

DROP FUNCTION IF EXISTS public.deduct_credit(UUID, INT);

-- ============================================================
-- 12. Verrouillage RLS + privilèges colonne (miroir de 005_credit_policy.sql)
--
--     Une policy « FOR ALL USING (auth.uid() = id) » suffisait à laisser un
--     navigateur authentifié exécuter, avec la seule clé anon publique :
--
--       update profiles set credits = 999999 where id = auth.uid();
--       insert into credit_transactions (user_id, amount, ...) values (...);
--
--     Deux verrous indépendants ferment ces deux chemins :
--       * privilèges SQL : `credits` n'apparaît dans aucun GRANT client, donc
--         l'UPDATE est refusé avant même l'évaluation du RLS ;
--       * policies RLS : le client ne peut que lire ses propres lignes.
--
--     Les crédits ne bougent que via consume_credit/add_credits (SECURITY
--     DEFINER, exécutables par le seul service_role).
-- ============================================================

ALTER TABLE public.profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own profile"          ON public.profiles;
DROP POLICY IF EXISTS "Users can view and edit own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own transactions"     ON public.credit_transactions;

DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id);

-- L'app crée sa propre ligne de profil (upsert id/email/full_name). `credits`
-- n'étant pas dans le GRANT ci-dessous, l'insertion prend toujours la valeur
-- par défaut de la colonne.
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

-- WITH CHECK autant que USING : sans lui, un utilisateur pourrait déplacer sa
-- ligne vers l'id d'un autre compte.
DROP POLICY IF EXISTS "profiles_update_own_details" ON public.profiles;
CREATE POLICY "profiles_update_own_details"
  ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Seule policy du grand livre : sans policy INSERT/UPDATE/DELETE, ces commandes
-- sont refusées à tout rôle client, quels que soient les privilèges.
DROP POLICY IF EXISTS "credit_transactions_select_own" ON public.credit_transactions;
CREATE POLICY "credit_transactions_select_own"
  ON public.credit_transactions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

REVOKE ALL ON public.profiles            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.credit_transactions FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.profiles TO authenticated;
-- Champs libre-service uniquement : `credits`, `created_at` et `updated_at`
-- appartiennent au serveur et sont volontairement absents.
GRANT INSERT (id, email, full_name, locale) ON public.profiles TO authenticated;
GRANT UPDATE (email, full_name, locale)     ON public.profiles TO authenticated;

GRANT SELECT ON public.credit_transactions TO authenticated;

GRANT ALL ON public.profiles            TO service_role;
GRANT ALL ON public.credit_transactions TO service_role;
