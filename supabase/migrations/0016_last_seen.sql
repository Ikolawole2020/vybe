-- Last seen.
--
-- Presence in a chat is broadcast over a realtime channel and written nowhere,
-- so the header could only ever say "Online" or say nothing — and "nothing" is
-- what it said for every conversation whose other side was not currently in the
-- room, which reads as the app having no idea who these people are.
--
-- One column is the whole feature: each client stamps its own row while the app
-- is in front, and anyone reading the profile can say how long ago that was.
--
-- Existing policies cover it exactly as they are: `profiles_update_self` allows
-- a row to be written only by the person it describes, and `profiles_read_all`
-- already exposes profile rows to signed-in users. That second one is the
-- privacy decision worth being explicit about — last seen is visible to any
-- authenticated user who can see the profile, the same as the handle and the
-- avatar. If it should ever be narrower than that (mutuals only, or a per-user
-- switch), it needs its own policy and a preference column, not a client-side
-- check: hiding it in the app while the row still answers is not privacy.

alter table public.profiles
  add column if not exists last_seen_at timestamptz;

comment on column public.profiles.last_seen_at is
  'Heartbeat written by the owner''s client while the app is foregrounded. '
  'Null means never recorded — treated as unknown rather than as "long ago".';
