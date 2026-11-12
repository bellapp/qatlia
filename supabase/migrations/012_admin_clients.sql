-- ============================================================
-- 012_admin_clients.sql
-- Back office, lot 1 (plan docs/superpowers/plans/2026-11-12-espace-superadmin.md):
--   * admin_client_notes — the operator's private note, phone and tags per
--     client. Read and written by the service role only;
--   * admin_client_list() — one row per account with everything the client
--     list needs, aggregated in SQL so the page is a single round trip.
--
-- Additive and idempotent: no existing table, policy or function is changed.
-- Both objects are closed to the anon and authenticated roles, so a browser
-- session holding the public anon key can reach neither.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Operator notes
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.admin_client_notes (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone      TEXT,
  tags       TEXT[] NOT NULL DEFAULT '{}',
  note       TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);

-- RLS on and no policy at all: every client-role command is denied.
ALTER TABLE public.admin_client_notes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.admin_client_notes FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.admin_client_notes TO service_role;

-- ------------------------------------------------------------
-- 2. Client list
--
-- Payment rows are recognised by their idempotency key, with the same
-- prefixes as src/lib/admin/ledger.ts (LEDGER_KEY_PREFIXES):
--   'manual:%' manual payment, 'creem:%' Creem card, 'cs:%' Stripe card.
-- Optimization refunds also carry type 'purchase' but none of these keys, so
-- they are never counted as a purchase.
--
-- Each table is aggregated per user in its own CTE before the join, so the
-- counts cannot be multiplied by a fan-out join.
--
-- LANGUAGE sql (not plpgsql): the RETURNS TABLE column names would otherwise
-- shadow the table columns of the same name.
-- ------------------------------------------------------------

DROP FUNCTION IF EXISTS public.admin_client_list(TEXT, TEXT, TEXT, INT, INT);

CREATE OR REPLACE FUNCTION public.admin_client_list(
  p_search  TEXT DEFAULT NULL,
  p_segment TEXT DEFAULT 'all',
  p_sort    TEXT DEFAULT 'created_desc',
  p_limit   INT  DEFAULT 50,
  p_offset  INT  DEFAULT 0
)
RETURNS TABLE (
  user_id           UUID,
  email             TEXT,
  full_name         TEXT,
  locale            TEXT,
  provider          TEXT,
  credits           INT,
  signed_up_at      TIMESTAMPTZ,
  last_sign_in_at   TIMESTAMPTZ,
  scans             BIGINT,
  optimizations     BIGINT,
  purchases         BIGINT,
  credits_purchased BIGINT,
  paid_mad          NUMERIC,
  pending_orders    BIGINT,
  projects          BIGINT,
  last_activity_at  TIMESTAMPTZ,
  phone             TEXT,
  tags              TEXT[],
  total_count       BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH tx AS (
    SELECT
      t.user_id,
      count(*) FILTER (WHERE t.type = 'usage' AND t.reason = 'vision') AS scans,
      count(*) FILTER (WHERE t.type = 'usage' AND t.reason = 'optimize') AS optimizations,
      count(*) FILTER (
        WHERE t.stripe_payment_id LIKE 'manual:%'
           OR t.stripe_payment_id LIKE 'creem:%'
           OR t.stripe_payment_id LIKE 'cs:%'
      ) AS purchases,
      COALESCE(sum(t.amount) FILTER (
        WHERE t.stripe_payment_id LIKE 'manual:%'
           OR t.stripe_payment_id LIKE 'creem:%'
           OR t.stripe_payment_id LIKE 'cs:%'
      ), 0) AS credits_purchased,
      max(t.created_at) AS last_tx_at
    FROM public.credit_transactions t
    GROUP BY t.user_id
  ),
  mp AS (
    SELECT
      m.user_id,
      COALESCE(sum(m.amount_mad) FILTER (WHERE m.status = 'granted'), 0) AS paid_mad,
      count(*) FILTER (WHERE m.status = 'pending') AS pending_orders
    FROM public.manual_payments m
    GROUP BY m.user_id
  ),
  pr AS (
    SELECT p.user_id, count(*) AS projects, max(p.created_at) AS last_project_at
    FROM public.projects p
    GROUP BY p.user_id
  ),
  base AS (
    SELECT
      u.id                                                              AS user_id,
      COALESCE(u.email::TEXT, pf.email)                                 AS email,
      COALESCE(pf.full_name, u.raw_user_meta_data->>'full_name')        AS full_name,
      pf.locale::TEXT                                                   AS locale,
      (u.raw_app_meta_data->>'provider')                                AS provider,
      COALESCE(pf.credits, 0)::INT                                      AS credits,
      u.created_at                                                      AS signed_up_at,
      u.last_sign_in_at                                                 AS last_sign_in_at,
      COALESCE(tx.scans, 0)::BIGINT                                     AS scans,
      COALESCE(tx.optimizations, 0)::BIGINT                             AS optimizations,
      COALESCE(tx.purchases, 0)::BIGINT                                 AS purchases,
      COALESCE(tx.credits_purchased, 0)::BIGINT                         AS credits_purchased,
      COALESCE(mp.paid_mad, 0)::NUMERIC                                 AS paid_mad,
      COALESCE(mp.pending_orders, 0)::BIGINT                            AS pending_orders,
      COALESCE(pr.projects, 0)::BIGINT                                  AS projects,
      GREATEST(u.last_sign_in_at, tx.last_tx_at, pr.last_project_at)    AS last_activity_at,
      n.phone                                                           AS phone,
      COALESCE(n.tags, '{}'::TEXT[])                                    AS tags
    FROM auth.users u
    LEFT JOIN public.profiles pf            ON pf.id = u.id
    LEFT JOIN tx                            ON tx.user_id = u.id
    LEFT JOIN mp                            ON mp.user_id = u.id
    LEFT JOIN pr                            ON pr.user_id = u.id
    LEFT JOIN public.admin_client_notes n   ON n.user_id = u.id
  ),
  search AS (
    -- LIKE wildcards typed by the operator are matched literally.
    SELECT
      NULLIF(btrim(COALESCE(p_search, '')), '') AS term,
      '%' || replace(replace(replace(btrim(COALESCE(p_search, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%' AS pattern
  ),
  filtered AS (
    SELECT b.*
    FROM base b, search s
    WHERE (
        s.term IS NULL
        OR b.email ILIKE s.pattern
        OR b.full_name ILIKE s.pattern
        OR b.phone ILIKE s.pattern
        OR b.user_id::TEXT = lower(s.term)
      )
      AND (
        CASE p_segment
          WHEN 'paying'         THEN b.purchases > 0
          WHEN 'never_paid'     THEN b.purchases = 0
          WHEN 'out_of_credits' THEN b.credits = 0
          WHEN 'inactive_30d'   THEN b.last_activity_at IS NULL OR b.last_activity_at < now() - interval '30 days'
          WHEN 'pending_order'  THEN b.pending_orders > 0
          ELSE TRUE
        END
      )
  )
  SELECT
    f.user_id, f.email, f.full_name, f.locale, f.provider, f.credits,
    f.signed_up_at, f.last_sign_in_at, f.scans, f.optimizations, f.purchases,
    f.credits_purchased, f.paid_mad, f.pending_orders, f.projects,
    f.last_activity_at, f.phone, f.tags,
    count(*) OVER ()::BIGINT AS total_count
  FROM filtered f
  -- One CASE per sort key, each of a single type; the sort that is not
  -- selected evaluates to NULL and does not affect the order.
  ORDER BY
    CASE WHEN p_sort = 'last_activity_desc' THEN f.last_activity_at END DESC NULLS LAST,
    CASE WHEN p_sort = 'credits_asc'        THEN f.credits          END ASC  NULLS LAST,
    CASE WHEN p_sort = 'credits_desc'       THEN f.credits          END DESC NULLS LAST,
    CASE WHEN p_sort = 'paid_desc'          THEN f.paid_mad         END DESC NULLS LAST,
    CASE WHEN p_sort = 'scans_desc'         THEN f.scans            END DESC NULLS LAST,
    f.signed_up_at DESC NULLS LAST,
    f.user_id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

REVOKE ALL ON FUNCTION public.admin_client_list(TEXT, TEXT, TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_client_list(TEXT, TEXT, TEXT, INT, INT) TO service_role;

-- Check after applying (SQL editor):
--   SELECT user_id, email, credits, scans, purchases, paid_mad, total_count
--   FROM public.admin_client_list(NULL, 'all', 'paid_desc', 5, 0);
