-- Replies.
--
-- 0001 shipped `posts.reply_policy` — a column deciding who *may* reply — with
-- nowhere for a reply to go. This is the other half.
--
-- The permission it enforces is already written: `can_reply_to_post()` is the
-- function the likes and boosts policies use, so a reply is subject to exactly
-- the same rule as any other act on a post, and the rule exists once.
--
-- Run with: supabase db push   (or paste into the SQL editor)

create table if not exists public.replies (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  author_id  uuid not null references public.profiles (id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now(),

  -- An empty reply is a client bug, not a thing anyone meant to say.
  constraint reply_not_blank check (length(btrim(body)) > 0),
  constraint reply_not_endless check (length(body) <= 2000)
);

-- Threads are read oldest-first under one post, which is exactly this index.
create index if not exists replies_post_idx on public.replies (post_id, created_at);
create index if not exists replies_author_idx on public.replies (author_id, created_at desc);

alter table public.replies enable row level security;

-- Anyone who can see the post can read its replies. A reply is not more private
-- than the thing it is attached to, and must not be less private either.
drop policy if exists replies_select_visible on public.replies;
create policy replies_select_visible on public.replies
  for select using (
    exists (select 1 from public.posts p where p.id = post_id and public.can_view_post(p))
  );

/*
 * Writing is gated on the post's own reply permission.
 *
 * This is the half of the Boundary that had no teeth until now: a post set to
 * "only my circles can reply" was, in practice, a post nobody could reply to at
 * all. `can_reply_to_post` already returns true for the post's author, so
 * replying to your own post works whatever you set the policy to.
 */
drop policy if exists replies_insert_permitted on public.replies;
create policy replies_insert_permitted on public.replies
  for insert with check (
    author_id = (select auth.uid())
    and exists (
      select 1 from public.posts p where p.id = post_id and public.can_reply_to_post(p)
    )
  );

-- You can delete your own words; so can the author of the post they are under,
-- which is the smallest moderation tool that makes a thread survivable.
drop policy if exists replies_delete_own_or_on_own_post on public.replies;
create policy replies_delete_own_or_on_own_post on public.replies
  for delete using (
    author_id = (select auth.uid())
    or exists (
      select 1 from public.posts p where p.id = post_id and p.author_id = (select auth.uid())
    )
  );
