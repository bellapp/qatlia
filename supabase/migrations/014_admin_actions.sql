-- ============================================================
-- 014_admin_actions.sql
-- Back office, lot 3 (plan docs/superpowers/plans/2026-11-12-espace-superadmin.md):
-- admin_adjust_credits() — an admin adds or removes credits by hand.
--
-- Same guarantees as consume_credit/add_credits (migration 005): the profile
-- row is locked, the ledger and the balance move together, and the request
-- id makes a retried or double-clicked adjustment a no-op. The idempotency
-- key lives in credit_transactions.stripe_payment_id (unique index), prefixed
-- 'admin:' like LEDGER_KEY_PREFIXES.admin in src/lib/admin/ledger.ts.
--
-- Additive: no existing function is redefined. Executable by service_role only.
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_adjust_credits(
  p_user_id    UUID,
  p_delta      INT,
  p_request_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current INT;
  v_new     INT;
  v_tx_id   UUID;
BEGIN
  IF p_delta IS NULL OR p_delta = 0 OR p_delta < -1000 OR p_delta > 1000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_DELTA');
  END IF;

  IF p_request_id IS NULL OR btrim(p_request_id) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'MISSING_REQUEST_ID');
  END IF;

  SELECT credits INTO v_current
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF v_current IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'PROFILE_NOT_FOUND');
  END IF;

  -- A replay of an adjustment that already went through answers success
  -- before the balance check, so a retried removal is never reported as
  -- "insufficient" after it was applied.
  IF EXISTS (SELECT 1 FROM public.credit_transactions WHERE stripe_payment_id = 'admin:' || p_request_id) THEN
    RETURN jsonb_build_object('success', true, 'duplicate', true, 'balance', v_current);
  END IF;

  IF v_current + p_delta < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_CREDITS', 'balance', v_current);
  END IF;

  INSERT INTO public.credit_transactions (user_id, type, amount, balance_after, description, reason, stripe_payment_id)
  VALUES (p_user_id, 'adjustment', p_delta, v_current + p_delta, 'Ajustement QatliA', 'admin_adjustment', 'admin:' || p_request_id)
  ON CONFLICT (stripe_payment_id) WHERE stripe_payment_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_tx_id;

  IF v_tx_id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'duplicate', true, 'balance', v_current);
  END IF;

  UPDATE public.profiles
  SET credits = credits + p_delta,
      updated_at = NOW()
  WHERE id = p_user_id
  RETURNING credits INTO v_new;

  RETURN jsonb_build_object('success', true, 'duplicate', false, 'balance', v_new);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_adjust_credits(UUID, INT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_credits(UUID, INT, TEXT) TO service_role;

-- Check after applying (SQL editor, on a test account):
--   SELECT public.admin_adjust_credits('<user id>', 5, 'test-1');  -- twice: the second says duplicate
