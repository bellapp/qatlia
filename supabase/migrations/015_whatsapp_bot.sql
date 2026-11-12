-- WhatsApp bot (2026-11-12): one row per customer phone number and a log of
-- the messages exchanged, so the bot can keep the conversation language,
-- greet once, step aside while a human answers, and ignore webhooks that Meta
-- redelivers.
--
-- Only the webhook route reads and writes these tables, with the service
-- role. Client roles get nothing: RLS is on, there is no policy, and every
-- client grant is revoked. 012-014 are reserved by another branch.

CREATE TABLE IF NOT EXISTS public.whatsapp_contacts (
  -- WhatsApp id of the customer (their phone number, digits only).
  wa_id         TEXT PRIMARY KEY,
  profile_name  TEXT,
  lang          TEXT NOT NULL DEFAULT 'fr' CHECK (lang IN ('fr', 'ar')),
  -- Set once the welcome message has been sent.
  greeted_at    TIMESTAMPTZ,
  -- The bot stays silent until this instant after a human has taken over.
  handoff_until TIMESTAMPTZ,
  -- Click-to-WhatsApp ad referral payload, as received.
  referral      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id         BIGSERIAL PRIMARY KEY,
  -- Meta message id. UNIQUE so a redelivered webhook is stored only once.
  wamid      TEXT UNIQUE,
  wa_id      TEXT NOT NULL REFERENCES public.whatsapp_contacts(wa_id) ON DELETE CASCADE,
  direction  TEXT NOT NULL CHECK (direction IN ('user', 'bot', 'human')),
  -- Message type as reported by Meta (text, image, audio...).
  kind       TEXT NOT NULL,
  body       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Newest messages of one conversation first.
CREATE INDEX IF NOT EXISTS whatsapp_messages_wa_id_created_at_idx
  ON public.whatsapp_messages (wa_id, created_at DESC);

ALTER TABLE public.whatsapp_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

-- Supabase's default privileges grant client roles access to every new public
-- table and sequence; take it back so only the service role can use them.
REVOKE ALL ON public.whatsapp_contacts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.whatsapp_contacts TO service_role;

REVOKE ALL ON public.whatsapp_messages FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.whatsapp_messages TO service_role;

REVOKE ALL ON SEQUENCE public.whatsapp_messages_id_seq FROM PUBLIC, anon, authenticated;
GRANT ALL ON SEQUENCE public.whatsapp_messages_id_seq TO service_role;
