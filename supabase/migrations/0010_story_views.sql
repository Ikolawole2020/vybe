-- ============================================================================
-- Migration: 0010_story_views.sql
--
-- Who watched your story. The WhatsApp-status model: an eye and a count on your
-- own items, and tapping it lists the people behind the number.
--
-- The asymmetry is the whole design and is worth being explicit about, because
-- it is a privacy decision rather than a schema one:
--
--   * The **author** may see exactly who watched.
--   * A **viewer** may see only their own row — never the rest of the audience.
--
-- So watching someone's story does not disclose to you who else did. That is
-- how the feature is understood by people who have used it elsewhere, and
-- getting it backwards would quietly publish a social graph.
-- ============================================================================

begin;

create table if not exists public.story_views (
  story_item_id uuid not null references public.story_items (id) on delete cascade,
  viewer_id     uuid not null references public.profiles (id) on delete cascade,
  viewed_at     timestamptz not null default now(),
  -- One row per person per item: a view is "this person has seen it", not a
  -- play count. Re-opening a story does not make you two viewers, and the
  -- composite key is what makes the client's insert idempotent.
  primary key (story_item_id, viewer_id)
);

-- The list is read newest-first for one item, which is the only query there is.
create index if not exists story_views_item_idx
  on public.story_views (story_item_id, viewed_at desc);

alter table public.story_views enable row level security;

/**
 * Whether the caller wrote the story item in question.
 *
 * `security definer` for the usual reason: the policy below is evaluated while
 * inserting a *viewer's* row, and a viewer has no business being able to select
 * arbitrary rows out of `story_items` to satisfy a subquery. This answers the
 * one narrow question without granting that.
 */
create or replace function public.is_story_item_author(_item_id uuid, _user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.story_items
    where id = _item_id and author_id = _user_id
  );
$$;

-- You may record that *you* watched something, and only something you were
-- actually allowed to watch. Without the second half, any account could forge
-- views onto a story it could not open.
drop policy if exists story_views_insert on public.story_views;
create policy story_views_insert on public.story_views
  for insert to authenticated
  with check (
    viewer_id = (select auth.uid())
    and exists (
      select 1 from public.story_items si
      where si.id = story_item_id
        and si.expires_at > now()
        and not ((select auth.uid()) = any (si.hidden_user_ids))
    )
  );

-- The author sees the audience; everyone else sees only themselves.
drop policy if exists story_views_select on public.story_views;
create policy story_views_select on public.story_views
  for select to authenticated
  using (
    viewer_id = (select auth.uid())
    or public.is_story_item_author(story_item_id, (select auth.uid()))
  );

-- Views die with the story they belong to. `story_items` already cascades, and
-- `sweep_expired()` in 0008 deletes expired items, so this needs no sweeper of
-- its own — but the ordering matters, so it is stated: never delete views
-- without deleting the item, or the count outlives the thing it counted.

commit;
