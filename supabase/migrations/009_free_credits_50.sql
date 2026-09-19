-- Free credits update (user decision, 2026-09-19):
-- New signups get 50 free credits (was nominally 30, actually 5 — see below).
--
-- BUG FIXED HERE: migrations 007 and 008 only moved the column DEFAULT (5 -> 10
-- -> 30), but BOTH functions that create a profile INSERT an explicit `credits`
-- value of 5 — public.handle_new_user() (the auth.users trigger) and
-- public.ensure_profile() (the backfill the vision route calls). The DEFAULT was
-- therefore never reached, and every new account was created with 5 credits
-- while the landing page promised 30.
--
-- Both now omit the column, so the DEFAULT below is the single place the grant
-- is stated on the SQL side. Its twin on the app side is SIGNUP_FREE_CREDITS in
-- src/lib/billing/policy.ts.

-- Signup grant: 50 credits
ALTER TABLE public.profiles ALTER COLUMN credits SET DEFAULT 50;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- `credits` is deliberately not listed: the column DEFAULT is the grant.
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, 'artisan@qatlia.ma'),
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(COALESCE(NEW.email, 'artisan'), '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ensure_profile: same fix. It backfills a profile for a user that predates the
-- trigger (or whose trigger insert lost a race) and returns the balance; the
-- ON CONFLICT branch still never touches `credits`, so a spent balance is never
-- reset.
CREATE OR REPLACE FUNCTION public.ensure_profile(
  p_user_id   UUID,
  p_email     TEXT DEFAULT NULL,
  p_full_name TEXT DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_credits INT;
BEGIN
  -- `credits` is deliberately not listed: the column DEFAULT is the grant.
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    p_user_id,
    COALESCE(p_email, 'artisan@qatlia.ma'),
    COALESCE(p_full_name, split_part(COALESCE(p_email, 'artisan'), '@', 1))
  )
  ON CONFLICT (id) DO UPDATE
    -- Deliberately does NOT list `credits`: re-running this must never
    -- reset a spent balance back to the signup default.
    SET email      = COALESCE(EXCLUDED.email, public.profiles.email),
        full_name  = COALESCE(public.profiles.full_name, EXCLUDED.full_name),
        updated_at = NOW()
  RETURNING credits INTO v_credits;

  RETURN v_credits;
END;
$$;

-- NOTE: the DEFAULT only affects NEW signups; existing balances are untouched.
-- Accounts created while the trigger was hardcoding 5 keep their balance unless
-- you top them up deliberately (public.add_credits / the admin page).
