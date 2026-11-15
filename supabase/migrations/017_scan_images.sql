-- Scan images (2026-11-15): the 1600 px version of the photographed cut list,
-- kept so a reopened project can show it in full.
--
-- The bucket is private and has no storage.objects policy on purpose: only the
-- server routes reach it, with the service role, after checking the owner. A
-- cut list often carries a customer's name, so nothing is public and no client
-- role can list, read or write it. Paths are {user_id}/{uuid}.{jpg|png|webp}.
-- The 1 MB limit (1048576 bytes) and the three image types are enforced by
-- Storage itself, on top of the route's own checks.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'scans',
  'scans',
  false,
  1048576,
  array['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;
