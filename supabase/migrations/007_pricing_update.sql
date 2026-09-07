-- Pricing update (user decision, 2026-09-06):
-- 1. AI photo scan costs 2 credits (was 1)
-- 2. New signups get 10 free credits (was 5)
-- 3. Credit packs start at 20 MAD (Starter pack repriced)

-- Signup grant: 10 credits
ALTER TABLE public.profiles ALTER COLUMN credits SET DEFAULT 10;

-- Existing migration mirrors (FULL_DATABASE_SETUP + 004) updated in repo separately.

-- NOTE: the vision route reads the cost from src/lib/billing/policy.ts
-- (VISION_CREDIT_COST). That code change ships in the same deploy.
-- The profile default only affects NEW signups; existing balances untouched.
