-- ============================================================
-- 023_refunded_purchases.sql
-- A refunded purchase (refund_purchase, migration 022) stops counting as a
-- payment:
--   * a manual order moves to a new status, 'refunded'. Every reader of
--     status = 'granted' (revenue in admin_kpis, paid_mad in
--     admin_client_list, the client page, the customer's order list) then
--     leaves it out without being changed;
--   * admin_kpis (migration 013) leaves refunded purchases out of its
--     payments: paying clients, card payment counts and the USD total;
--   * refund_purchase (migration 022) is redefined with the status change,
--     and orders already refunded are moved now.
-- The ledger keeps every row: the purchase, its refund, and the bonuses.
-- admin_client_list is left as it is: its purchase count still includes a
-- refunded purchase, like the client page's.
--
-- REQUIRES 022. Apply AFTER the app code that knows the 'refunded' status is
-- deployed (otherwise the pages show it as pending or expired).
--
-- Before running (both must be non-null, and the CHECK must be the one of
-- 006, whatever its name):
--   SELECT to_regprocedure('public.refund_purchase(text)'), to_regclass('public.referral_rewards');
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'public.manual_payments'::regclass AND contype = 'c';
--
-- One transaction, safe to re-run.
-- Rollback: run again refund_purchase from 022 and admin_kpis from 013,
-- with their REVOKE/GRANT lines; the extra status value is harmless.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. The 'refunded' status. 006 declared the CHECK inline, without a name:
--    every CHECK on manual_payments that is about the status is dropped,
--    whatever it is called, and one named constraint takes its place.
-- ------------------------------------------------------------

DO $$
DECLARE
  v_name TEXT;
BEGIN
  FOR v_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.manual_payments'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.manual_payments DROP CONSTRAINT %I', v_name);
  END LOOP;
END;
$$;

ALTER TABLE public.manual_payments
  ADD CONSTRAINT manual_payments_status_check
  CHECK (status IN ('pending', 'paid', 'granted', 'refused', 'expired', 'refunded'));

-- Orders refunded before this migration. This also proves the old CHECK is
-- gone: if it survived, this UPDATE fails and nothing is applied.
UPDATE public.manual_payments m
SET status = 'refunded'
WHERE m.status = 'granted'
  AND EXISTS (
    SELECT 1 FROM public.credit_transactions r
    WHERE r.stripe_payment_id = 'purchase_refund:manual:' || m.id::text
  );

-- ------------------------------------------------------------
-- 2. refund_purchase — migration 022's, plus the order status
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

  -- 023: a manual order leaves 'granted', so every reader of the status
  -- (revenue, client list, client page, the customer's orders) stops
  -- counting it. Matched as text: a malformed key matches nothing.
  IF p_purchase_key LIKE 'manual:%' THEN
    UPDATE public.manual_payments
    SET status = 'refunded'
    WHERE 'manual:' || id::text = p_purchase_key
      AND status = 'granted';
  END IF;

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
-- 3. admin_kpis — migration 013's, without refunded purchases
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_kpis()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH b AS (
    SELECT
      now() AS now_ts,
      date_trunc('day',   now() AT TIME ZONE 'Africa/Casablanca') AT TIME ZONE 'Africa/Casablanca' AS today_start,
      date_trunc('month', now() AT TIME ZONE 'Africa/Casablanca') AT TIME ZONE 'Africa/Casablanca' AS month_start
  ),
  payments AS (
    SELECT t.user_id, t.stripe_payment_id, t.amount_paid, t.currency, t.created_at
    FROM public.credit_transactions t
    WHERE (t.stripe_payment_id LIKE 'manual:%'
       OR t.stripe_payment_id LIKE 'creem:%'
       OR t.stripe_payment_id LIKE 'cs:%')
      -- 023: a refunded purchase is no longer a payment.
      AND NOT EXISTS (
        SELECT 1 FROM public.credit_transactions r
        WHERE r.stripe_payment_id = 'purchase_refund:' || t.stripe_payment_id
      )
  ),
  months AS (
    SELECT
      to_char(gs, 'YYYY-MM') AS month,
      gs AT TIME ZONE 'Africa/Casablanca' AS starts_at,
      (gs + interval '1 month') AT TIME ZONE 'Africa/Casablanca' AS ends_at
    FROM generate_series(
      date_trunc('month', now() AT TIME ZONE 'Africa/Casablanca') - interval '5 months',
      date_trunc('month', now() AT TIME ZONE 'Africa/Casablanca'),
      interval '1 month'
    ) AS gs
  )
  SELECT jsonb_build_object(
    'signups', (
      SELECT jsonb_build_object(
        'today', count(*) FILTER (WHERE u.created_at >= b.today_start),
        'd7',    count(*) FILTER (WHERE u.created_at >= b.now_ts - interval '7 days'),
        'd30',   count(*) FILTER (WHERE u.created_at >= b.now_ts - interval '30 days'),
        'total', count(*)
      )
      FROM auth.users u, b
    ),
    'active', (
      SELECT jsonb_build_object(
        'd7',  count(DISTINCT a.user_id) FILTER (WHERE a.at >= b.now_ts - interval '7 days'),
        'd30', count(DISTINCT a.user_id)
      )
      FROM (
        SELECT t.user_id, t.created_at AS at FROM public.credit_transactions t
        WHERE t.type = 'usage' AND t.created_at >= now() - interval '30 days'
        UNION ALL
        SELECT p.user_id, p.created_at AS at FROM public.projects p
        WHERE p.created_at >= now() - interval '30 days'
      ) a, b
    ),
    'paying_clients', (SELECT count(DISTINCT p.user_id) FROM payments p),
    'revenue_mad', (
      SELECT jsonb_build_object(
        'd30',   COALESCE(sum(m.amount_mad) FILTER (WHERE m.decided_at >= b.now_ts - interval '30 days'), 0),
        'month', COALESCE(sum(m.amount_mad) FILTER (WHERE m.decided_at >= b.month_start), 0),
        'total', COALESCE(sum(m.amount_mad), 0)
      )
      FROM public.manual_payments m, b
      WHERE m.status = 'granted'
    ),
    'card_payments', (
      SELECT jsonb_build_object(
        'count_d30',      count(*) FILTER (WHERE p.created_at >= b.now_ts - interval '30 days'),
        'count_total',    count(*),
        'usd_total',      COALESCE(sum(p.amount_paid) FILTER (WHERE p.currency = 'USD'), 0),
        'without_amount', count(*) FILTER (WHERE p.amount_paid IS NULL)
      )
      FROM payments p, b
      WHERE p.stripe_payment_id NOT LIKE 'manual:%'
    ),
    'usage', (
      SELECT jsonb_build_object(
        'scans_d7',          count(*) FILTER (WHERE t.reason = 'vision' AND t.created_at >= b.now_ts - interval '7 days'),
        'scans_d30',         count(*) FILTER (WHERE t.reason = 'vision'),
        'optimizations_d30', count(*) FILTER (WHERE t.reason = 'optimize'),
        'credits_used_d30',  COALESCE(-sum(t.amount), 0)
      )
      FROM public.credit_transactions t, b
      WHERE t.type = 'usage' AND t.created_at >= b.now_ts - interval '30 days'
    ),
    'pending_orders', (
      SELECT jsonb_build_object('count', count(*), 'oldest_created_at', min(m.created_at))
      FROM public.manual_payments m
      WHERE m.status = 'pending'
    ),
    'out_of_credits_never_paid', (
      SELECT count(*)
      FROM public.profiles pf
      WHERE pf.credits = 0
        AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.user_id = pf.id)
    ),
    'monthly', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'month', mo.month,
        'signups', (SELECT count(*) FROM auth.users u WHERE u.created_at >= mo.starts_at AND u.created_at < mo.ends_at),
        'revenue_mad', COALESCE((
          SELECT sum(m.amount_mad) FROM public.manual_payments m
          WHERE m.status = 'granted' AND m.decided_at >= mo.starts_at AND m.decided_at < mo.ends_at
        ), 0),
        'scans', (
          SELECT count(*) FROM public.credit_transactions t
          WHERE t.type = 'usage' AND t.reason = 'vision' AND t.created_at >= mo.starts_at AND t.created_at < mo.ends_at
        )
      ) ORDER BY mo.month), '[]'::jsonb)
      FROM months mo
    )
  );
$$;

REVOKE ALL ON FUNCTION public.refund_purchase(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_purchase(TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.admin_kpis() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_kpis() TO service_role;

COMMIT;

-- Check after applying:
--   SELECT count(*) FROM public.manual_payments WHERE status = 'refunded';  -- the orders already refunded
--   SELECT public.admin_kpis();
