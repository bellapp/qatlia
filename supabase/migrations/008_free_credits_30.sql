-- Free credits update (user decision, 2026-09-15):
-- New signups get 30 free credits (was 10)

-- Signup grant: 30 credits
ALTER TABLE public.profiles ALTER COLUMN credits SET DEFAULT 30;

-- Existing migration mirrors (FULL_DATABASE_SETUP + 004) updated in repo separately.

-- NOTE: the profile default only affects NEW signups; existing balances untouched.
