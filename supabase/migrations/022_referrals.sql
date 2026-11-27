-- ============================================================
-- 022_referrals.sql
-- Parrainage (docs/adr/0001-recompense-parrainage.md and
-- docs/adr/0002-rattachement-et-remboursement.md, decided 2026-11-27):
--
--   * every account has a referral code (created the first time it is asked
--     for, so no backfill);
--   * an account (the filleul) is attached to the account whose code it
--     gave (the parrain) as long as it has made no purchase, then never
--     again: no own code, no A <-> B pair;
--   * each purchase of a filleul (card or validated manual payment) gives
--     the parrain 10 % of the pack's credits, and the filleul's first
--     purchase that is not refunded gives the filleul 10 % more;
--   * refunding a purchase takes back its pack credits and both bonuses,
--     each balance stopping at zero.
--
-- How:
--   * add_credits (migration 005) is redefined here, same signature, same
--     guarantees. The bonuses are written in the same transaction as the
--     purchase, only for a new purchase (never a replay) whose key is a
--     payment key: 'cs:%' Stripe, 'creem:%' Creem, 'manual:%' manual. An
--     optimization refund (key 'optimize_refund_…', pack 'refund') never
--     gives a bonus. Card webhooks and the manual validation route are
--     unchanged: they already call add_credits.
--   * a bonus is a ledger row of type 'bonus', a refund a row of type
--     'reversal'. Their keys start with their own prefix ('referral:',
--     'welcome:', 'purchase_refund:', 'referral_reversal:',
--     'welcome_reversal:') followed by the purchase key, so nothing that
--     looks for 'cs:%', 'creem:%' or 'manual:%' (migrations 012, 013, 021)
--     ever counts them as a payment.
--   * a reversal row records what was really taken back after stopping at
--     zero, so the balance stays the sum of the ledger plus the sign-up
--     grant.
--   * referral_rewards keeps every bonus with the purchase that gave it: one
--     per (purchase, kind), and the referrer page and the back office read it.
--   * the 10 % is REFERRAL_BONUS_PERCENT in src/lib/billing/policy.ts; a test
--     keeps the two in step. The bonus is rounded down (every pack sold
--     today is a multiple of ten credits).
--
-- Lock order, everywhere: the buyer's profile, then the parrain's.
--
-- FULL_DATABASE_SETUP.sql is not updated, like migrations 011 to 021: a new
-- database applies the numbered migrations in order.
--
-- One transaction: if anything fails, the add_credits of migration 005 stays
-- in place and payments keep working. Safe to re-run.
--
-- Before running, check that 013 is applied (amount_paid must exist):
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'credit_transactions' AND column_name = 'amount_paid';
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Tables. RLS on with NO policy: only the server routes read or write
--    them, with the service role.
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.referral_codes (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The order-number alphabet (src/app/api/credits/manual/route.ts): no 0/O, 1/I/L.
  code       TEXT NOT NULL UNIQUE CHECK (code ~ '^[2-9A-HJKMNP-Z]{6}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per filleul. Deleting either account removes the row: the filleul
-- stays a client, without a parrain.
CREATE TABLE IF NOT EXISTS public.referrals (
  referee_id  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  referrer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (referee_id <> referrer_id)
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON public.referrals (referrer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.referral_rewards (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The ledger key of the purchase that gave the bonus ('cs:…', 'creem:…', 'manual:…').
  purchase_key     TEXT NOT NULL,
  -- 'referral': the parrain's bonus; 'welcome': the filleul's.
  kind             TEXT NOT NULL CHECK (kind IN ('referral', 'welcome')),
  -- Who received the credits.
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Who bought (the filleul). Kept as NULL if that account is deleted.
  referee_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  credits          INT NOT NULL CHECK (credits > 0),
  reversed_at      TIMESTAMPTZ,
  -- What the refund really took back (0 up to credits).
  reversed_credits INT CHECK (reversed_credits >= 0),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (purchase_key, kind)
);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_user ON public.referral_rewards (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_referee ON public.referral_rewards (referee_id);

ALTER TABLE public.referral_codes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_rewards ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.referral_codes   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.referrals        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.referral_rewards FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.referral_codes   TO service_role;
GRANT ALL ON public.referrals        TO service_role;
GRANT ALL ON public.referral_rewards TO service_role;

-- ------------------------------------------------------------
-- 2. referral_code_for — the account's code, created on first use
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.referral_code_for(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_alphabet CONSTANT TEXT := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_code     TEXT;
  v_attempt  INT := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  LOOP
    SELECT code INTO v_code FROM public.referral_codes WHERE user_id = p_user_id;
    IF v_code IS NOT NULL THEN
      RETURN v_code;
    END IF;

    v_attempt := v_attempt + 1;
    IF v_attempt > 20 THEN
      RAISE EXCEPTION 'REFERRAL_CODE_EXHAUSTED';
    END IF;

    v_code := '';
    FOR i IN 1..6 LOOP
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::INT, 1);
    END LOOP;

    -- A taken code, or a concurrent call that created this account's code
    -- first, inserts nothing: the loop reads again or draws another code.
    INSERT INTO public.referral_codes (user_id, code)
    VALUES (p_user_id, v_code)
    ON CONFLICT DO NOTHING;
  END LOOP;
END;
$$;

-- ------------------------------------------------------------
-- 3. attach_referral — attach a filleul to the owner of a code
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.attach_referral(p_referee_id UUID, p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code     TEXT := upper(regexp_replace(COALESCE(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_referrer UUID;
  v_existing UUID;
  v_profile  UUID;
BEGIN
  SELECT user_id INTO v_referrer FROM public.referral_codes WHERE code = v_code;
  IF v_referrer IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_CODE');
  END IF;

  IF v_referrer = p_referee_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'OWN_CODE');
  END IF;

  -- The same lock as add_credits: an attachment and a purchase of this
  -- account never interleave.
  SELECT id INTO v_profile FROM public.profiles WHERE id = p_referee_id FOR UPDATE;
  IF v_profile IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'PROFILE_NOT_FOUND');
  END IF;

  SELECT referrer_id INTO v_existing FROM public.referrals WHERE referee_id = p_referee_id;
  IF v_existing IS NOT NULL THEN
    IF v_existing = v_referrer THEN
      RETURN jsonb_build_object('success', true, 'duplicate', true);
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_ATTACHED');
  END IF;

  -- Any purchase, refunded or not, closes the attachment for good.
  IF EXISTS (
    SELECT 1 FROM public.credit_transactions
    WHERE user_id = p_referee_id
      AND (stripe_payment_id LIKE 'cs:%' OR stripe_payment_id LIKE 'creem:%' OR stripe_payment_id LIKE 'manual:%')
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_PURCHASED');
  END IF;

  IF EXISTS (SELECT 1 FROM public.referrals WHERE referee_id = v_referrer AND referrer_id = p_referee_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'CIRCULAR');
  END IF;

  INSERT INTO public.referrals (referee_id, referrer_id)
  VALUES (p_referee_id, v_referrer)
  ON CONFLICT (referee_id) DO NOTHING;

  RETURN jsonb_build_object('success', true, 'duplicate', false);
END;
$$;

-- ------------------------------------------------------------
-- 4. add_credits — migration 005's grant, plus the referral bonuses
-- ------------------------------------------------------------

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
  v_tx_id       UUID;
  v_current     INT;
  v_new         INT;
  v_bonus       INT;
  v_referrer    UUID;
  v_ref_balance INT;
  v_reward_id   UUID;
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

  -- Referral bonuses: only a payment gives one.
  IF p_stripe_payment_id LIKE 'cs:%' OR p_stripe_payment_id LIKE 'creem:%' OR p_stripe_payment_id LIKE 'manual:%' THEN
    SELECT referrer_id INTO v_referrer FROM public.referrals WHERE referee_id = p_user_id;
    -- REFERRAL_BONUS_PERCENT (src/lib/billing/policy.ts), rounded down.
    v_bonus := (p_credits * 10) / 100;

    IF v_referrer IS NOT NULL AND v_bonus > 0 THEN
      -- The filleul's welcome bonus, while it holds none that was not refunded.
      IF NOT EXISTS (
        SELECT 1 FROM public.referral_rewards
        WHERE user_id = p_user_id AND kind = 'welcome' AND reversed_at IS NULL
      ) THEN
        v_reward_id := NULL;
        INSERT INTO public.referral_rewards (purchase_key, kind, user_id, referee_id, credits)
        VALUES (p_stripe_payment_id, 'welcome', p_user_id, p_user_id, v_bonus)
        ON CONFLICT (purchase_key, kind) DO NOTHING
        RETURNING id INTO v_reward_id;

        IF v_reward_id IS NOT NULL THEN
          INSERT INTO public.credit_transactions (user_id, type, amount, balance_after, description, reason, stripe_payment_id)
          VALUES (p_user_id, 'bonus', v_bonus, v_new + v_bonus, 'Bonus de bienvenue (parrainage)', 'welcome', 'welcome:' || p_stripe_payment_id);

          UPDATE public.profiles
          SET credits = credits + v_bonus,
              updated_at = NOW()
          WHERE id = p_user_id
          RETURNING credits INTO v_new;
        END IF;
      END IF;

      -- The parrain's bonus.
      SELECT credits INTO v_ref_balance FROM public.profiles WHERE id = v_referrer FOR UPDATE;
      IF v_ref_balance IS NOT NULL THEN
        v_reward_id := NULL;
        INSERT INTO public.referral_rewards (purchase_key, kind, user_id, referee_id, credits)
        VALUES (p_stripe_payment_id, 'referral', v_referrer, p_user_id, v_bonus)
        ON CONFLICT (purchase_key, kind) DO NOTHING
        RETURNING id INTO v_reward_id;

        IF v_reward_id IS NOT NULL THEN
          INSERT INTO public.credit_transactions (user_id, type, amount, balance_after, description, reason, stripe_payment_id)
          VALUES (v_referrer, 'bonus', v_bonus, v_ref_balance + v_bonus, 'Bonus de parrainage', 'referral', 'referral:' || p_stripe_payment_id);

          UPDATE public.profiles
          SET credits = credits + v_bonus,
              updated_at = NOW()
          WHERE id = v_referrer;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'balance', v_new, 'duplicate', false);
END;
$$;

-- ------------------------------------------------------------
-- 5. refund_purchase — take a purchase back, with its bonuses
--    Each withdrawal stops at the balance it is taken from. The money
--    itself is given back outside the app.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.refund_purchase(p_purchase_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_buyer        UUID;
  v_credits      INT;
  v_balance      INT;
  v_take         INT;
  v_purchase     INT := 0;
  v_welcome      INT := 0;
  v_referral     INT := 0;
  v_reward       RECORD;
  v_ref_balance  INT;
BEGIN
  IF p_purchase_key IS NULL
     OR NOT (p_purchase_key LIKE 'cs:%' OR p_purchase_key LIKE 'creem:%' OR p_purchase_key LIKE 'manual:%') THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_A_PURCHASE');
  END IF;

  SELECT user_id, amount INTO v_buyer, v_credits
  FROM public.credit_transactions
  WHERE stripe_payment_id = p_purchase_key;
  IF v_buyer IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'PURCHASE_NOT_FOUND');
  END IF;

  SELECT credits INTO v_balance FROM public.profiles WHERE id = v_buyer FOR UPDATE;
  IF v_balance IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'PROFILE_NOT_FOUND');
  END IF;

  IF EXISTS (SELECT 1 FROM public.credit_transactions WHERE stripe_payment_id = 'purchase_refund:' || p_purchase_key) THEN
    RETURN jsonb_build_object('success', true, 'duplicate', true, 'balance', v_balance);
  END IF;

  -- The pack's credits.
  v_purchase := LEAST(GREATEST(v_credits, 0), v_balance);
  v_balance := v_balance - v_purchase;
  INSERT INTO public.credit_transactions (user_id, type, amount, balance_after, description, reason, stripe_payment_id)
  VALUES (v_buyer, 'reversal', -v_purchase, v_balance, 'Achat remboursé', 'purchase_refund', 'purchase_refund:' || p_purchase_key);

  -- The filleul's welcome bonus, if this purchase gave one.
  SELECT id, credits INTO v_reward
  FROM public.referral_rewards
  WHERE purchase_key = p_purchase_key AND kind = 'welcome' AND reversed_at IS NULL;
  IF v_reward.id IS NOT NULL THEN
    v_welcome := LEAST(v_reward.credits, v_balance);
    v_balance := v_balance - v_welcome;
    INSERT INTO public.credit_transactions (user_id, type, amount, balance_after, description, reason, stripe_payment_id)
    VALUES (v_buyer, 'reversal', -v_welcome, v_balance, 'Bonus de bienvenue repris (achat remboursé)', 'welcome_reversal', 'welcome_reversal:' || p_purchase_key);
    UPDATE public.referral_rewards SET reversed_at = now(), reversed_credits = v_welcome WHERE id = v_reward.id;
  END IF;

  UPDATE public.profiles
  SET credits = v_balance,
      updated_at = NOW()
  WHERE id = v_buyer;

  -- The parrain's bonus, if this purchase gave one.
  v_reward := NULL;
  SELECT id, user_id, credits INTO v_reward
  FROM public.referral_rewards
  WHERE purchase_key = p_purchase_key AND kind = 'referral' AND reversed_at IS NULL;
  IF v_reward.id IS NOT NULL THEN
    SELECT credits INTO v_ref_balance FROM public.profiles WHERE id = v_reward.user_id FOR UPDATE;
    IF v_ref_balance IS NOT NULL THEN
      v_referral := LEAST(v_reward.credits, v_ref_balance);
      INSERT INTO public.credit_transactions (user_id, type, amount, balance_after, description, reason, stripe_payment_id)
      VALUES (v_reward.user_id, 'reversal', -v_referral, v_ref_balance - v_referral, 'Bonus de parrainage repris (achat remboursé)', 'referral_reversal', 'referral_reversal:' || p_purchase_key);
      UPDATE public.profiles
      SET credits = credits - v_referral,
          updated_at = NOW()
      WHERE id = v_reward.user_id;
    END IF;
    UPDATE public.referral_rewards SET reversed_at = now(), reversed_credits = v_referral WHERE id = v_reward.id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'duplicate', false,
    'balance', v_balance,
    'removed_purchase', v_purchase,
    'removed_welcome', v_welcome,
    'removed_referral', v_referral
  );
END;
$$;

-- ------------------------------------------------------------
-- 6. Execution: the service role only
-- ------------------------------------------------------------

REVOKE ALL ON FUNCTION public.referral_code_for(UUID)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attach_referral(UUID, TEXT)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.add_credits(UUID, INT, TEXT, TEXT)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refund_purchase(TEXT)                 FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.referral_code_for(UUID)            TO service_role;
GRANT EXECUTE ON FUNCTION public.attach_referral(UUID, TEXT)        TO service_role;
GRANT EXECUTE ON FUNCTION public.add_credits(UUID, INT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_purchase(TEXT)              TO service_role;

COMMIT;

-- Check after applying (SQL editor, on two test accounts A and B):
--   SELECT public.referral_code_for('<A>');                 -- the same code twice
--   SELECT public.attach_referral('<B>', '<code of A>');    -- success
--   SELECT public.add_credits('<B>', 80, 'manual:test-1', 'standard');
--     -- B: +80 then +8 (welcome); A: +8 (referral)
--   SELECT public.refund_purchase('manual:test-1');         -- takes the three back
