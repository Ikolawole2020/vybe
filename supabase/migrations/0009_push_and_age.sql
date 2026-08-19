-- ============================================================================
-- Migration: 0009_push_and_age.sql
--
-- Two additions:
--
--   1. `profiles.age_range` — collected on a dedicated screen during sign-up.
--   2. `device_tokens` — the missing half of notifications.
--
-- On (2): the app had no way to notify anybody but the person holding the
-- phone. `notifyForFollowedPost` scheduled a *local* notification during
-- `sync()`, so it fired while the user was already looking at the app and
-- announced the same post on every launch. Nothing anywhere reached another
-- person's device, because a local notification cannot. Real delivery needs a
-- push token per device, which is what this table holds, and something on the
-- server to send to it — `supabase/functions/push-notify`.
-- ============================================================================

begin;

-- ----------------------------------------------------------------- 1. age --

/**
 * Stored as a band rather than a birth date.
 *
 * A date of birth is a stronger identifier than anything else the app holds and
 * the product has no use for one — the only question being asked is roughly who
 * this person is, so that setup can lean the right way. Collecting the precise
 * value and then bucketing it in the client would mean holding a piece of data
 * we do not need and cannot un-hold after a breach.
 *
 * Nullable, because the screen has a Skip.
 */
alter table public.profiles
  add column if not exists age_range text
    check (age_range is null or age_range in
      ('under-18', '18-24', '25-34', '35-44', '45-54', '55-64', 'over-64'));

comment on column public.profiles.age_range is
  'Self-reported age band from sign-up. Null means skipped. Never a birth date.';

-- ------------------------------------------------------- 2. device tokens --

create table if not exists public.device_tokens (
  -- The Expo push token is globally unique and is the natural key: reinstalling
  -- issues a new one, and the same token can move between accounts on a shared
  -- handset, which the upsert below handles by reassigning `user_id`.
  token       text primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  platform    text not null check (platform in ('ios', 'android')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists device_tokens_user_idx on public.device_tokens (user_id);

alter table public.device_tokens enable row level security;

-- A token is a delivery address for one person's phone. Only its owner may see
-- or change it; the sender reads them with the service key, which bypasses RLS.
drop policy if exists device_tokens_owner on public.device_tokens;
create policy device_tokens_owner on public.device_tokens
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- --------------------------------------------------- 3. notification bodies --

/**
 * `notifications` records *that* something happened and by whom. The push
 * sender needs a sentence, and reconstructing one means joining profiles and
 * posts per row at send time.
 *
 * This view does that join once, and is what the Edge Function reads.
 * `security_invoker` is off deliberately — the function calls it with the
 * service key, and the underlying policies would otherwise hide every row,
 * since the service role is nobody's `auth.uid()`.
 */
create or replace view public.notification_delivery as
select
  n.id,
  n.user_id,
  n.type,
  n.post_id,
  n.created_at,
  a.name    as actor_name,
  a.handle  as actor_handle,
  left(coalesce(p.body, ''), 90) as post_snippet
from public.notifications n
join public.profiles a on a.id = n.actor_id
left join public.posts p on p.id = n.post_id;

revoke all on public.notification_delivery from anon, authenticated;

-- ------------------------------------------------------- 4. follow fan-out --

/**
 * A new post notifies the author's followers.
 *
 * This is the row that "someone you follow posted" was pretending to be. It
 * belongs in the database because the fan-out has to happen once, near the
 * data, for everyone — not on each reader's device when they next happen to
 * open the app.
 *
 * Only public posts fan out. A post addressed to a Circle is already narrow by
 * intent, and pushing it to every follower would route straight around that.
 *
 * The 500-follower cap is a deliberate stopgap: past that, a synchronous
 * trigger makes the author's own insert wait on thousands of rows. An account
 * that large wants a queue, and this comment is here so that the day it matters
 * the limit is found rather than discovered.
 */
create or replace function public.notify_followers_of_post()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not new.is_public then
    return new;
  end if;

  insert into public.notifications (user_id, actor_id, type, post_id)
  select f.follower_id, new.author_id, 'post', new.id
  from public.follows f
  where f.followee_id = new.author_id
  limit 500
  on conflict do nothing;

  return new;
end;
$$;

-- 'post' is a new notification type and the existing check constraint does not
-- allow it, so the constraint is replaced before the trigger can fire.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('like', 'boost', 'reply', 'follow', 'circle', 'profile_view', 'post'));

drop trigger if exists on_post_notify_followers on public.posts;
create trigger on_post_notify_followers
  after insert on public.posts
  for each row execute function public.notify_followers_of_post();

commit;
