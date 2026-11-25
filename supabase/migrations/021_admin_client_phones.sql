-- ============================================================
-- 021_admin_client_phones.sql
-- Back office (spec docs/superpowers/specs/2026-11-25-admin-fiche-client-design.md):
--   * the client list shows every phone number known for an account, next to
--     its email: the operator's note (admin_client_notes.phone), the WhatsApp
--     number the account came from (auth user_metadata.whatsapp_code →
--     whatsapp_photo_reads.wa_id) and the business phone (ateliers.phone);
--   * the search finds an account by any of them, however it is written:
--     « 0612345678 », « +212 612-34-56-78 » and « 00212612345678 » are the
--     same number;
--   * more sort orders, one per column header, both directions.
--
-- REQUIRES 019 (whatsapp_photo_reads) and 020 (ateliers): a LANGUAGE sql body
-- is checked when the function is created, so apply those first.
--
-- Same arguments as 012 (TEXT, TEXT, TEXT, INT, INT): the new sort orders are
-- new values of p_sort, and the six of 012 keep their meaning. The page sends
-- the new values before this file is applied; 012 does not know them and
-- falls back to « newest sign-up first », and the two new columns read as
-- empty. Two columns are added to the result, so the function is dropped and
-- created again, and its grants are given again below.
--
-- Additive otherwise: no table, policy or other function is changed.
-- Safe to re-run. One transaction: if the new function cannot be created,
-- the old one is not dropped.
--
-- Before running, check that 019 and 020 are applied (both must be non-null):
--   SELECT to_regclass('public.whatsapp_photo_reads'), to_regclass('public.ateliers');
-- ============================================================

BEGIN;

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
  whatsapp          TEXT,
  atelier_phone     TEXT,
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
      COALESCE(n.tags, '{}'::TEXT[])                                    AS tags,
      -- Digits only, or the business-scoped id of a WhatsApp username.
      wr.wa_id                                                          AS whatsapp,
      a.phone                                                           AS atelier_phone
    FROM auth.users u
    LEFT JOIN public.profiles pf            ON pf.id = u.id
    LEFT JOIN tx                            ON tx.user_id = u.id
    LEFT JOIN mp                            ON mp.user_id = u.id
    LEFT JOIN pr                            ON pr.user_id = u.id
    LEFT JOIN public.admin_client_notes n   ON n.user_id = u.id
    -- One row at most each: whatsapp_photo_reads.code is UNIQUE, ateliers is keyed by user_id.
    LEFT JOIN public.whatsapp_photo_reads wr ON wr.code = (u.raw_user_meta_data->>'whatsapp_code')
    LEFT JOIN public.ateliers a             ON a.user_id = u.id
  ),
  search AS (
    -- LIKE wildcards typed by the operator are matched literally.
    SELECT
      NULLIF(btrim(COALESCE(p_search, '')), '') AS term,
      '%' || replace(replace(replace(btrim(COALESCE(p_search, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%' AS pattern,
      -- A term made of digits and phone punctuation only is also looked up as
      -- a number: its digits without the 00 / 212 / 0 prefix, at least 6 of
      -- them so a short number does not match half the list.
      CASE
        WHEN btrim(COALESCE(p_search, '')) ~ '^[0-9 +().-]+$'
         AND length(regexp_replace(regexp_replace(p_search, '\D', '', 'g'), '^(00212|212|00|0)', '')) >= 6
        THEN regexp_replace(regexp_replace(p_search, '\D', '', 'g'), '^(00212|212|00|0)', '')
      END AS phone_core
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
        OR (
          s.phone_core IS NOT NULL
          AND (
               regexp_replace(COALESCE(b.phone, ''), '\D', '', 'g')         LIKE '%' || s.phone_core || '%'
            OR regexp_replace(COALESCE(b.whatsapp, ''), '\D', '', 'g')      LIKE '%' || s.phone_core || '%'
            OR regexp_replace(COALESCE(b.atelier_phone, ''), '\D', '', 'g') LIKE '%' || s.phone_core || '%'
          )
        )
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
    f.last_activity_at, f.phone, f.tags, f.whatsapp, f.atelier_phone,
    count(*) OVER ()::BIGINT AS total_count
  FROM filtered f
  -- One CASE per sort key, each of a single type; the sort that is not
  -- selected evaluates to NULL and does not affect the order. Keep the list
  -- in step with CLIENT_SORTS (src/lib/admin/clients.ts); a test checks it.
  ORDER BY
    CASE WHEN p_sort = 'created_asc'        THEN f.signed_up_at     END ASC  NULLS LAST,
    CASE WHEN p_sort = 'last_activity_desc' THEN f.last_activity_at END DESC NULLS LAST,
    CASE WHEN p_sort = 'last_activity_asc'  THEN f.last_activity_at END ASC  NULLS LAST,
    CASE WHEN p_sort = 'credits_asc'        THEN f.credits          END ASC  NULLS LAST,
    CASE WHEN p_sort = 'credits_desc'       THEN f.credits          END DESC NULLS LAST,
    CASE WHEN p_sort = 'paid_desc'          THEN f.paid_mad         END DESC NULLS LAST,
    CASE WHEN p_sort = 'paid_asc'           THEN f.paid_mad         END ASC  NULLS LAST,
    CASE WHEN p_sort = 'scans_desc'         THEN f.scans            END DESC NULLS LAST,
    CASE WHEN p_sort = 'scans_asc'          THEN f.scans            END ASC  NULLS LAST,
    CASE WHEN p_sort = 'purchases_desc'     THEN f.purchases        END DESC NULLS LAST,
    CASE WHEN p_sort = 'purchases_asc'      THEN f.purchases        END ASC  NULLS LAST,
    CASE WHEN p_sort = 'projects_desc'      THEN f.projects         END DESC NULLS LAST,
    CASE WHEN p_sort = 'projects_asc'       THEN f.projects         END ASC  NULLS LAST,
    CASE WHEN p_sort = 'email_asc'          THEN lower(f.email)     END ASC  NULLS LAST,
    CASE WHEN p_sort = 'email_desc'         THEN lower(f.email)     END DESC NULLS LAST,
    f.signed_up_at DESC NULLS LAST,
    f.user_id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

REVOKE ALL ON FUNCTION public.admin_client_list(TEXT, TEXT, TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_client_list(TEXT, TEXT, TEXT, INT, INT) TO service_role;

COMMIT;

-- Check after applying (SQL editor):
--   SELECT email, phone, whatsapp, atelier_phone, total_count
--   FROM public.admin_client_list('0612345678', 'all', 'projects_desc', 5, 0);
