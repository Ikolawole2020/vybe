-- Notifications and activity feed tables, indexes, and triggers.
--
-- Automatically creates notification records when users interact with posts
-- (likes, boosts, replies) or follow someone.
--
-- Run with: supabase db push   (or execute in Supabase SQL editor)

-- ----------------------------------------------------------- notifications --

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  actor_id    uuid not null references public.profiles (id) on delete cascade,
  type        text not null check (type in ('like', 'boost', 'reply', 'follow', 'circle', 'profile_view')),
  post_id     uuid references public.posts (id) on delete cascade,
  reply_id    uuid references public.replies (id) on delete cascade,
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Performance index for reading an account's recent notifications
create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);

-- Index for counting/filtering unread items
create index if not exists notifications_unread_idx
  on public.notifications (user_id, read)
  where read = false;

-- ------------------------------------------------- row level security (RLS) --

alter table public.notifications enable row level security;

-- Users can only view and manage their own notifications
drop policy if exists notifications_owner_policy on public.notifications;
create policy notifications_owner_policy on public.notifications
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Allow authenticated users / system triggers to insert notifications
drop policy if exists notifications_insert_policy on public.notifications;
create policy notifications_insert_policy on public.notifications
  for insert
  with check (actor_id = (select auth.uid()) or user_id is not null);

-- ------------------------------------------------- notification triggers ---

-- Trigger: When someone likes a post
create or replace function public.notify_on_like()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_user_id uuid;
begin
  select author_id into target_user_id from public.posts where id = new.post_id;

  -- Only notify if the liker is not the post author
  if target_user_id is not null and target_user_id <> new.user_id then
    insert into public.notifications (user_id, actor_id, type, post_id, created_at)
    values (target_user_id, new.user_id, 'like', new.post_id, now())
    on conflict do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_like_notify on public.likes;
create trigger on_like_notify
  after insert on public.likes
  for each row execute function public.notify_on_like();

-- Trigger: When someone boosts a post
create or replace function public.notify_on_boost()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_user_id uuid;
begin
  select author_id into target_user_id from public.posts where id = new.post_id;

  -- Only notify if the booster is not the post author
  if target_user_id is not null and target_user_id <> new.user_id then
    insert into public.notifications (user_id, actor_id, type, post_id, created_at)
    values (target_user_id, new.user_id, 'boost', new.post_id, now())
    on conflict do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_boost_notify on public.boosts;
create trigger on_boost_notify
  after insert on public.boosts
  for each row execute function public.notify_on_boost();

-- Trigger: When someone replies to a post
create or replace function public.notify_on_reply()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_user_id uuid;
begin
  select author_id into target_user_id from public.posts where id = new.post_id;

  -- Only notify if the replier is not the post author
  if target_user_id is not null and target_user_id <> new.author_id then
    insert into public.notifications (user_id, actor_id, type, post_id, reply_id, created_at)
    values (target_user_id, new.author_id, 'reply', new.post_id, new.id, now())
    on conflict do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_reply_notify on public.replies;
create trigger on_reply_notify
  after insert on public.replies
  for each row execute function public.notify_on_reply();

-- Trigger: When someone follows another user
create or replace function public.notify_on_follow()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.followee_id <> new.follower_id then
    insert into public.notifications (user_id, actor_id, type, created_at)
    values (new.followee_id, new.follower_id, 'follow', now())
    on conflict do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_follow_notify on public.follows;
create trigger on_follow_notify
  after insert on public.follows
  for each row execute function public.notify_on_follow();
