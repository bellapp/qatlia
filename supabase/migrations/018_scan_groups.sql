-- Scan groups (2026-11-17): up to 4 cut-list photos per project for one credit.
--
-- A paid photo read (consume_credit) opens a group of 4 reads, valid 24 hours.
-- The next photos of the same project present the group and are read without
-- a debit while it has room. MAX_SCANS_PER_ANALYSIS and ANALYSIS_WINDOW_HOURS
-- in src/lib/billing/policy.ts state the same 4 and 24 h; a test keeps them in
-- step with this file.
--
-- Only /api/vision touches this table, with the service role: RLS is on, there
-- is no policy, and every client grant is revoked. The route treats any error
-- of these functions as "no group" and charges the read as before, so the code
-- can run before this migration is applied.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS public.scan_groups (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Successful reads counted in this group, the paid one included.
  reads_used INT NOT NULL DEFAULT 1 CHECK (reads_used BETWEEN 1 AND 4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scan_groups_user_id_created_at_idx
  ON public.scan_groups (user_id, created_at DESC);

ALTER TABLE public.scan_groups ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.scan_groups FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.scan_groups TO service_role;

-- Opens a group after a paid read; that read counts as the first.
CREATE OR REPLACE FUNCTION public.open_scan_group(p_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.scan_groups (user_id) VALUES (p_user_id) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Advisory: whether a read may skip the balance check. claim_scan_read decides.
CREATE OR REPLACE FUNCTION public.scan_group_has_room(p_user_id UUID, p_group_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.scan_groups
    WHERE id = p_group_id
      AND user_id = p_user_id
      AND reads_used < 4
      AND created_at > now() - interval '24 hours'
  );
$$;

-- Counts one more read in the group, in a single conditional update, so two
-- reads racing for the last place cannot both win. Returns the reads used
-- after this one, or NULL when the group is not the caller's, is full or has
-- expired.
CREATE OR REPLACE FUNCTION public.claim_scan_read(p_user_id UUID, p_group_id UUID)
RETURNS INT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.scan_groups SET reads_used = reads_used + 1
  WHERE id = p_group_id
    AND user_id = p_user_id
    AND reads_used < 4
    AND created_at > now() - interval '24 hours'
  RETURNING reads_used;
$$;

REVOKE ALL ON FUNCTION public.open_scan_group(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_scan_group(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.scan_group_has_room(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scan_group_has_room(UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.claim_scan_read(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_scan_read(UUID, UUID) TO service_role;
