-- Pricing v3 (user decision, 2026-10-30):
--   * one credit now buys one complete analysis (scan + 24 h of re-runs)
--     instead of 2 per scan and 1 per optimization, so the signup grant goes
--     from 50 to 20 credits — about the same trial as before (50 credits used
--     to cover ~16 complete analyses);
--   * the packs (50/100/200/300 DH) and the end of the Atelier Max
--     subscription live in src/lib/billing/catalog.ts; nothing about them is
--     stored in SQL.
--
-- Since migration 009, handle_new_user() and ensure_profile() omit `credits`,
-- so the column DEFAULT below is the single SQL statement of the grant. Its
-- twin on the app side is SIGNUP_FREE_CREDITS in src/lib/billing/policy.ts.

ALTER TABLE public.profiles ALTER COLUMN credits SET DEFAULT 20;

-- NOTE: the DEFAULT only affects NEW signups; existing balances are untouched.
