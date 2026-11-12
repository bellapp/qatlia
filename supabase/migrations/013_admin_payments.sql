-- ============================================================
-- 013_admin_payments.sql
-- Back office, lot 2 (plan docs/superpowers/plans/2026-11-12-espace-superadmin.md):
--   1. credit_transactions.amount_paid / currency — what a payment really
--      charged, written by the webhooks and the manual-payment validation
--      after the credits are granted. Informational only;
--   2. admin_audit_log — every decision an admin takes, with who and when;
--   3. admin_kpis() — the overview figures in one call.
--
-- Additive and idempotent: no existing function or policy is changed, and the
-- client roles keep exactly the privileges migration 005 left them.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Paid amount on the ledger
--    Rows from before this migration keep NULL; the back office then shows
--    the catalog price of the pack, marked as an estimate.
-- ------------------------------------------------------------

ALTER TABLE public.credit_transactions ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(10,2);
ALTER TABLE public.credit_transactions ADD COLUMN IF NOT EXISTS currency    TEXT;

-- ------------------------------------------------------------
-- 2. Admin audit log
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id       UUID NOT NULL,
  action         TEXT NOT NULL,
  target_user_id UUID,
  details        JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON public.admin_audit_log (target_user_id, created_at DESC);

-- RLS on and no policy at all: every client-role command is denied.
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.admin_audit_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.admin_audit_log TO service_role;

-- ------------------------------------------------------------
-- 3. Overview figures
--
-- "Today" and "this month" are Casablanca calendar periods; the rolling
-- windows (7 / 30 days) count back from now. Payment rows are recognised by
-- their key prefix, as in src/lib/admin/ledger.ts:
--   'manual:%' manual payment, 'creem:%' Creem card, 'cs:%' Stripe card.
-- Manual revenue is dated by the validation (decided_at).
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
    WHERE t.stripe_payment_id LIKE 'manual:%'
       OR t.stripe_payment_id LIKE 'creem:%'
       OR t.stripe_payment_id LIKE 'cs:%'
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

REVOKE ALL ON FUNCTION public.admin_kpis() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_kpis() TO service_role;

-- Check after applying (SQL editor):
--   SELECT public.admin_kpis();
