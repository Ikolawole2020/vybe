-- ============================================================================
-- Migration: 0008_security_hardening.sql
--
-- Closes the holes found in the 16 Aug security review, and adds the limits a
-- table needs before it holds a million people's rows. Run with
-- `supabase db push`, or paste into the Supabase SQL editor.
--
-- The two that matter most:
--
--   1. `participants_insert_policy` was `with check (auth.uid() is not null)`.
--      Any signed-in account could insert `(someone_elses_conversation_id,
--      my_id)` into `conversation_participants` and, being a participant, then
--      read every message in that thread. Every direct message in the product
--      was readable by anyone holding the anon key and an account.
--
--   2. `notifications_insert_policy` was
--      `with check (actor_id = auth.uid() or user_id is not null)`.
--      `user_id` is `not null`, so the second arm is a tautology and the whole
--      policy allowed anything: forge a notification from any account, to any
--      account, of any type.
--
-- Both are rewritten below. Everything else here is defence in depth: length
-- caps so a single row cannot be a megabyte, a send-rate ceiling, storage
-- object limits, reads narrowed to authenticated callers, and the indexes the
-- new predicates need.
-- ============================================================================

begin;

-- --------------------------------------------------------------- 1. DM ACL --

-- A conversation now records who opened it. Without an owner there is no
-- non-recursive way to answer "may this person add the first participant?" —
-- the row that would prove it is the row being inserted.
alter table public.conversations
  add column if not exists created_by uuid references public.profiles (id) on delete set null;

-- Backfill: the earliest participant is the closest thing to a creator that the
-- existing rows record.
update public.conversations c
set created_by = p.user_id
from (
  select distinct on (conversation_id) conversation_id, user_id
  from public.conversation_participants
  order by conversation_id, last_read_at asc
) p
where p.conversation_id = c.id
  and c.created_by is null;

create index if not exists conversations_created_by_idx
  on public.conversations (created_by);

drop policy if exists conversations_insert_policy on public.conversations;
create policy conversations_insert_policy on public.conversations
  for insert to authenticated
  with check (created_by = (select auth.uid()));

/**
 * "Did this person open this conversation?"
 *
 * `security definer` for the same reason `is_conversation_participant` is, and
 * the reason is easy to get wrong: a bare `exists (select 1 from conversations
 * …)` inside a policy runs under the *caller's* RLS, and `conversations_select_policy`
 * only lets participants read a conversation. At the moment the creator inserts
 * their own first participant row they are not a participant yet — so the
 * subquery would return nothing, the insert would be refused, and no
 * conversation could ever be created by anyone.
 */
create or replace function public.is_conversation_creator(_conversation_id uuid, _user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.conversations
    where id = _conversation_id and created_by = _user_id
  );
$$;

-- A participant may be added by the conversation's creator, or by anyone
-- already in it. Nobody else — which is the whole fix.
drop policy if exists participants_insert_policy on public.conversation_participants;
create policy participants_insert_policy on public.conversation_participants
  for insert to authenticated
  with check (
    public.is_conversation_creator(conversation_id, (select auth.uid()))
    or public.is_conversation_participant(conversation_id, (select auth.uid()))
  );

-- Leaving a conversation is your own row to delete, and only your own.
drop policy if exists participants_delete_self on public.conversation_participants;
create policy participants_delete_self on public.conversation_participants
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- `last_read_at` is how the unread badge stops lying, so it has to be writable
-- — but only on your own row.
drop policy if exists participants_update_self on public.conversation_participants;
create policy participants_update_self on public.conversation_participants
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- The update policy on `conversations` had no `with check`, so a participant
-- could hand the thread to a different creator and, through the participant
-- policy above, gain the right to add anyone to it.
--
-- Pinning the column is a trigger rather than a `with check` clause: a policy
-- cannot see the old row, so expressing "this value did not change" there means
-- a correlated subquery back into the same table, which is both slower and one
-- policy edit away from recursing.
drop policy if exists conversations_update_policy on public.conversations;
create policy conversations_update_policy on public.conversations
  for update to authenticated
  using (public.is_conversation_participant(id, (select auth.uid())))
  with check (public.is_conversation_participant(id, (select auth.uid())));

create or replace function public.pin_conversation_creator()
returns trigger
language plpgsql
as $$
begin
  new.created_by := old.created_by;
  new.id := old.id;
  return new;
end;
$$;

drop trigger if exists conversations_pin_creator on public.conversations;
create trigger conversations_pin_creator
  before update on public.conversations
  for each row execute function public.pin_conversation_creator();

-- Deleting your own message was simply impossible: there was no delete policy,
-- and no policy means denied.
drop policy if exists messages_delete_own on public.messages;
create policy messages_delete_own on public.messages
  for delete to authenticated
  using (sender_id = (select auth.uid()));

-- ------------------------------------------------------ 2. notification ACL --

-- `user_id is not null` was always true. An actor may now only speak as
-- themselves. The notification triggers in 0005 are `security definer`, so they
-- are unaffected by this and keep firing for likes, boosts, replies and follows.
drop policy if exists notifications_insert_policy on public.notifications;
create policy notifications_insert_policy on public.notifications
  for insert to authenticated
  with check (
    actor_id = (select auth.uid())
    and user_id <> actor_id
  );

/**
 * One profile-view notification per viewer per target, ever.
 *
 * Without it the row count grows with page views rather than with events, and
 * one curious person scrolling back through someone's posts puts fifty
 * identical "viewed your profile" rows in their inbox.
 *
 * The duplicates that already exist have to go first, or the index cannot be
 * built. The **partial** index is deliberate — it constrains only profile
 * views, leaving likes and follows free to recur. Note that a partial unique
 * index cannot serve as an `ON CONFLICT` arbiter through PostgREST, which
 * cannot send the matching `WHERE`; `recordRemoteProfileView` therefore does a
 * plain insert and treats the duplicate error as success.
 */
delete from public.notifications a
using public.notifications b
where a.type = 'profile_view'
  and b.type = 'profile_view'
  and a.user_id = b.user_id
  and a.actor_id = b.actor_id
  and a.created_at < b.created_at;

create unique index if not exists notifications_profile_view_unique
  on public.notifications (user_id, actor_id)
  where type = 'profile_view';

-- ------------------------------------------------------------ 3. size caps --

-- Nothing anywhere bounded the length of user text. A single client could
-- insert a hundred-megabyte post body, and every reader of that feed would
-- download it.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'posts_body_len') then
    alter table public.posts add constraint posts_body_len check (length(body) <= 5000) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'posts_topics_len') then
    alter table public.posts add constraint posts_topics_len check (cardinality(topics) <= 12) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'replies_body_len') then
    alter table public.replies add constraint replies_body_len check (length(body) <= 2000) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'messages_body_len') then
    alter table public.messages add constraint messages_body_len check (length(body) <= 4000) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_bio_len') then
    alter table public.profiles add constraint profiles_bio_len check (length(bio) <= 300) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_name_len') then
    alter table public.profiles add constraint profiles_name_len check (length(name) <= 60) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'story_caption_len') then
    alter table public.story_items add constraint story_caption_len check (caption is null or length(caption) <= 500) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'story_hidden_len') then
    alter table public.story_items add constraint story_hidden_len check (cardinality(hidden_user_ids) <= 500) not valid;
  end if;
end $$;

-- `not valid` above skips the scan of existing rows; validating separately
-- takes only a SHARE UPDATE EXCLUSIVE lock rather than blocking writes.
alter table public.posts       validate constraint posts_body_len;
alter table public.posts       validate constraint posts_topics_len;
alter table public.replies     validate constraint replies_body_len;
alter table public.messages    validate constraint messages_body_len;
alter table public.profiles    validate constraint profiles_bio_len;
alter table public.profiles    validate constraint profiles_name_len;
alter table public.story_items validate constraint story_caption_len;
alter table public.story_items validate constraint story_hidden_len;

-- --------------------------------------------------------- 4. send ceiling --

-- A client bug that retries in a tight loop, or one account deciding to be a
-- problem, should hit a wall in the database rather than in the invoice. Sixty
-- messages a minute is far above human typing and far below a flood.
create index if not exists messages_sender_recent_idx
  on public.messages (sender_id, created_at desc);

create or replace function public.enforce_message_rate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  recent int;
begin
  select count(*) into recent
  from public.messages
  where sender_id = new.sender_id
    and created_at > now() - interval '1 minute';

  if recent >= 60 then
    raise exception 'Slow down — too many messages sent in the last minute.'
      using errcode = '53400';
  end if;

  return new;
end;
$$;

drop trigger if exists messages_rate_limit on public.messages;
create trigger messages_rate_limit
  before insert on public.messages
  for each row execute function public.enforce_message_rate();

-- ------------------------------------------------------- 5. reads narrowed --

-- These were readable by the `anon` role, which every copy of the app ships the
-- key for. A signed-out caller could enumerate every story and every poll in
-- the product. Stories are ephemeral personal media; they belong behind an
-- account at minimum.
drop policy if exists stories_read_policy on public.stories;
create policy stories_read_policy on public.stories
  for select to authenticated
  using (expires_at > now());

drop policy if exists story_items_read_policy on public.story_items;
create policy story_items_read_policy on public.story_items
  for select to authenticated
  using (
    expires_at > now()
    and (
      author_id = (select auth.uid())
      or not ((select auth.uid()) = any (hidden_user_ids))
    )
  );

drop policy if exists polls_read_policy on public.polls;
create policy polls_read_policy on public.polls
  for select to authenticated using (true);

-- Poll tallies are unreadable while the only policy is "your own vote", so a
-- result bar can never be anything but invented. Votes on a poll you can see
-- are readable; who cast them is the same disclosure a like already makes.
drop policy if exists poll_votes_read_policy on public.poll_votes;
create policy poll_votes_read_policy on public.poll_votes
  for select to authenticated using (true);

-- Index for reading a story tray: unexpired items, newest first, by author.
create index if not exists story_items_expiry_idx
  on public.story_items (expires_at desc, author_id);

-- ------------------------------------------------------- 6. storage limits --

-- Buckets were created with no ceiling and no type filter, so any account could
-- upload a multi-gigabyte file of any kind and have it served publicly.
update storage.buckets
set file_size_limit = 8388608, -- 8 MB
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
where id = 'avatars';

update storage.buckets
set file_size_limit = 26214400, -- 25 MB, enough for a short clip or a voice note
    allowed_mime_types = array[
      'image/jpeg', 'image/png', 'image/webp', 'image/heic',
      'audio/m4a', 'audio/mp4', 'audio/mpeg', 'audio/aac',
      'video/mp4', 'video/quicktime'
    ]
where id = 'post-media';

-- ------------------------------------------------------------- 7. sweeping --

-- Expired stories are invisible but not gone: the read policies filter them and
-- the rows accumulate forever. Same for notifications nobody will scroll back
-- to. Schedule this with pg_cron (`select cron.schedule('vybe-sweep', '17 * * * *',
-- 'select public.sweep_expired()')`) or call it from a scheduled Edge Function.
create or replace function public.sweep_expired()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.story_items where expires_at < now() - interval '1 day';
  delete from public.stories
    where expires_at < now() - interval '1 day'
      and not exists (select 1 from public.story_items si where si.story_id = stories.id);
  delete from public.notifications where created_at < now() - interval '60 days';
end;
$$;

revoke all on function public.sweep_expired() from public, anon, authenticated;

-- --------------------------------------------------------- 8. feed indexes --

-- `fetchFeed` orders by `created_at desc` across all visible posts and now
-- pages with a `lt(created_at, cursor)`. The partial index on public posts
-- already exists; this covers the unfiltered ordering the paging query uses.
create index if not exists posts_created_at_idx on public.posts (created_at desc);
create index if not exists replies_post_idx on public.replies (post_id, created_at asc);
create index if not exists likes_user_idx on public.likes (user_id);
create index if not exists boosts_user_idx on public.boosts (user_id);
create index if not exists saves_user_idx on public.saves (user_id);
create index if not exists follows_follower_idx on public.follows (follower_id);
create index if not exists follows_followee_idx on public.follows (followee_id);

commit;
