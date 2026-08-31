-- ============================================================
-- 005_credit_policy.sql
-- P0 Task 5 — align the credit ledger with the published policy:
--   * exactly one credit per successful Vision analysis, debited atomically;
--   * exports (PDF/DXF/JSON/PNG/quotation) and optimization are free;
--   * Stripe grants are idempotent on a unique payment id.
--
-- Defensive and idempotent: safe to re-run, and safe on a database where
-- migrations 001-004 were applied in any partial combination.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------
-- 1. Reconcile credit_transactions
--    Migration 003 wrote (user_id, amount, reason) while the app wrote
--    (type, balance_after, description). Ensure every column exists.
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.credit_transactions (
  id                UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id           UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  amount            INTEGER NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- A table this migration may have just created starts with RLS *off*, which
-- would expose every user's ledger through PostgREST. Section 6 sets the
-- policies; enabling it here keeps the table closed in the interim.
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.credit_transactions ADD COLUMN IF NOT EXISTS type              TEXT DEFAULT 'usage';
ALTER TABLE public.credit_transactions ADD COLUMN IF NOT EXISTS balance_after     INTEGER;
ALTER TABLE public.credit_transactions ADD COLUMN IF NOT EXISTS description       TEXT;
ALTER TABLE public.credit_transactions ADD COLUMN IF NOT EXISTS reason            TEXT;
ALTER TABLE public.credit_transactions ADD COLUMN IF NOT EXISTS stripe_payment_id TEXT;
ALTER TABLE public.credit_transactions ADD COLUMN IF NOT EXISTS created_at        TIMESTAMPTZ DEFAULT NOW();

-- The idempotency anchor for Stripe grants. Partial, so ordinary usage rows
-- (stripe_payment_id IS NULL) are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_credit_tx_stripe_payment_id
  ON public.credit_transactions (stripe_payment_id)
  WHERE stripe_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_credit_tx_user_id
  ON public.credit_transactions (user_id, created_at DESC);

-- ------------------------------------------------------------
-- 2. ensure_profile — backfill a missing profile, never touch the balance
-- ------------------------------------------------------------

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
    -- Deliberately does NOT list `credits`: re-running this must never
    -- reset a spent balance back to the signup default.
    SET email      = COALESCE(EXCLUDED.email, public.profiles.email),
        full_name  = COALESCE(public.profiles.full_name, EXCLUDED.full_name),
        updated_at = NOW()
  RETURNING credits INTO v_credits;

  RETURN v_credits;
END;
$$;

-- ------------------------------------------------------------
-- 3. consume_credit — the only debit path
--    Locks the profile row so two concurrent analyses cannot spend the same
--    last credit. Returns a result object instead of raising, so an exhausted
--    balance is an ordinary answer and not a rolled-back transaction.
-- ------------------------------------------------------------

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

-- ------------------------------------------------------------
-- 4. add_credits — idempotent Stripe grant
--    The ledger insert is attempted first; if the unique stripe_payment_id
--    already exists the event is a redelivery and the balance is left alone.
-- ------------------------------------------------------------

-- Drop the pre-existing 2-argument version so the 4-argument signature is
-- unambiguous to PostgREST.
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
    -- Already granted for this payment; a redelivered webhook is a no-op.
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

-- ------------------------------------------------------------
-- 5. Lock down execution
--    Only the service role (and the owner) may move credits. `deduct_credit`
--    from migration 003 is superseded by consume_credit.
-- ------------------------------------------------------------

REVOKE ALL ON FUNCTION public.consume_credit(UUID, INT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.add_credits(UUID, INT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_profile(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.consume_credit(UUID, INT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.add_credits(UUID, INT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_profile(UUID, TEXT, TEXT) TO service_role;

DROP FUNCTION IF EXISTS public.deduct_credit(UUID, INT);

-- ------------------------------------------------------------
-- 6. Row-level security and column privileges on the credit tables
--
--    Locking the functions down is not enough on its own. Migrations 001/004
--    left behind
--
--      CREATE POLICY ... ON public.profiles FOR ALL USING (auth.uid() = id);
--      CREATE POLICY ... ON public.credit_transactions FOR ALL USING (...);
--      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
--        TO authenticated;
--
--    which let any signed-in browser session send, with nothing but the public
--    anon key:
--
--      update profiles set credits = 999999 where id = auth.uid();
--      insert into credit_transactions (user_id, amount, ...) values (...);
--
--    Both are closed here by two independent locks, so neither is solely
--    load-bearing:
--
--      * SQL privileges — `credits` appears in no GRANT to a client role, so
--        the update is refused before RLS is even consulted;
--      * RLS policies — clients get SELECT-own and nothing else.
--
--    Credits move only through consume_credit/add_credits above, which are
--    SECURITY DEFINER and executable by service_role alone.
-- ------------------------------------------------------------

ALTER TABLE public.profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

-- 6a. Remove the permissive legacy policies by name (001, 004 and the earlier
--     FULL_DATABASE_SETUP all used FOR ALL).
DROP POLICY IF EXISTS "Users can view own profile"          ON public.profiles;
DROP POLICY IF EXISTS "Users can view and edit own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own transactions"     ON public.credit_transactions;

-- 6b. Reads only, and only of one's own rows.
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id);

-- The app backfills its own profile row (src/app/api/projects/route.ts upserts
-- id/email/full_name when the service-role key is absent). `credits` is not in
-- the column grant below, so such an insert always takes the column default.
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

-- WITH CHECK as well as USING: without it a user could move their row onto
-- another account's id.
DROP POLICY IF EXISTS "profiles_update_own_details" ON public.profiles;
CREATE POLICY "profiles_update_own_details"
  ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Deliberately the only policy on the ledger: with no INSERT/UPDATE/DELETE
-- policy, those commands are denied for every client role regardless of grants.
DROP POLICY IF EXISTS "credit_transactions_select_own" ON public.credit_transactions;
CREATE POLICY "credit_transactions_select_own"
  ON public.credit_transactions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- 6c. Column privileges. These run last so that a blanket grant inherited from
--     migration 004 cannot survive them.
REVOKE ALL ON public.profiles            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.credit_transactions FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.profiles TO authenticated;
-- Self-service fields only. `credits`, `created_at` and `updated_at` are
-- server-owned and are absent on purpose.
GRANT INSERT (id, email, full_name, locale) ON public.profiles TO authenticated;
GRANT UPDATE (email, full_name, locale)     ON public.profiles TO authenticated;

-- /api/credits/history renders the user's own rows; nothing more.
GRANT SELECT ON public.credit_transactions TO authenticated;

GRANT ALL ON public.profiles            TO service_role;
GRANT ALL ON public.credit_transactions TO service_role;
