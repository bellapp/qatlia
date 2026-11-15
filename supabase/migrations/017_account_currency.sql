-- ============================================================
-- 017_account_currency.sql
-- The account currency (user decision, 2026-11-15): each customer works in
-- one currency for every service — MAD, EUR or USD — assigned automatically
-- from their country on their first visit, and changeable by them.
--
--   * profiles.currency — NULL until assigned; the app then saves the
--     currency of the visitor's country (src/lib/currency-server.ts).
--   * Every account that exists today has been priced in dirhams, and its
--     saved panel and edge prices are dirham figures: it is set to MAD.
--
-- Additive only. Writes go through /api/currency with the service role and
-- an explicit id filter. The app keeps working before this is applied (it
-- prices by country and saves nothing).
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS currency TEXT
  CHECK (currency IS NULL OR currency IN ('MAD', 'EUR', 'USD'));

UPDATE public.profiles SET currency = 'MAD' WHERE currency IS NULL;

-- Check after applying:
--   SELECT currency, count(*) FROM public.profiles GROUP BY currency;   -- MAD only
