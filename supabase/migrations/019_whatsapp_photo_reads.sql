-- WhatsApp photo reading (2026-11-19): one row per photo of a cut list the
-- bot read, or tried to read, for a prospect.
--
-- * One successful read per number, forever: the partial unique index lets a
--   number hold one 'reading' or 'ok' row; a failed read frees it.
-- * The photo itself is never stored. The pieces read, the panel and the
--   summary are kept behind the link's code for 7 days (expires_at), then
--   nulled; the row stays so the one-read rule still holds.
-- * Only the webhook route and the /w/[code] page use it, with the service
--   role. Client roles get nothing: RLS is on, there is no policy, and every
--   client grant is revoked (same as 016).

CREATE TABLE IF NOT EXISTS public.whatsapp_photo_reads (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wa_id      TEXT NOT NULL REFERENCES public.whatsapp_contacts(wa_id) ON DELETE CASCADE,
  status     TEXT NOT NULL CHECK (status IN ('reading', 'ok', 'failed')),
  -- The link's code (qatlia.ma/w/<code>), set once the read succeeded.
  code       TEXT UNIQUE,
  pieces     JSONB,
  sheet      JSONB,
  summary    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  opened_at  TIMESTAMPTZ
);

-- One read running or done per number: a second photo cannot start another.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_photo_reads_one_per_number
  ON public.whatsapp_photo_reads (wa_id) WHERE status IN ('reading', 'ok');

-- The day's reads, for the global cap.
CREATE INDEX IF NOT EXISTS whatsapp_photo_reads_created_at_idx
  ON public.whatsapp_photo_reads (created_at);

ALTER TABLE public.whatsapp_photo_reads ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.whatsapp_photo_reads FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.whatsapp_photo_reads TO service_role;
