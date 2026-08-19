-- Vybe — initial schema.
--
-- The one non-negotiable in this file is that a Boundary is enforced here, not
-- in the client. `canView()` in src/algo/engine.ts is a rendering convenience;
-- a post restricted to a Circle must never be *serialised* to someone outside
-- it, which means the rule has to live in a row-level policy where no client
-- bug can route around it. See PRD §5.3.
--
-- Run with: supabase db push   (or paste into the SQL editor)

-- `citext` makes handle uniqueness case-insensitive at the index, so @Tomisin
-- and @tomisin cannot both be claimed.
create extension if not exists citext;

-- ---------------------------------------------------------------- profiles --

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  handle      citext unique not null,
  name        text not null default '',
  bio         text not null default '',
  avatar_url  text,
  created_at  timestamptz not null default now(),

  -- Handles are what people type to find each other, so the shape is enforced
  -- rather than left to whatever the client happened to send.
  --
  -- The cast to text is load-bearing: citext overrides `~` to be
  -- case-insensitive, so against a citext column this pattern would happily
  -- accept 'Tomisin' and store it with the capital. Comparing as text restores
  -- the case-sensitive match, and uniqueness stays case-insensitive because the
  -- index is still on the citext column.
  constraint handle_format check (handle::text ~ '^[a-z0-9_]{3,20}$')
);

comment on column public.profiles.created_at is
  'Drives the early-adopter badge. Accounts created before 2026-10-01 keep it permanently.';

-- ----------------------------------------------------------------- circles --

create table public.circles (
  id        uuid primary key default gen_random_uuid(),
  owner_id  uuid not null references public.profiles (id) on delete cascade,
  name      text not null,
  color     text not null default '#D2F34C',
  glyph     text not null default 'users',
  -- How much this circle lifts its members in the owner's own ranking.
  boost     real not null default 0.5 check (boost between 0 and 1),
  created_at timestamptz not null default now()
);

create index circles_owner_idx on public.circles (owner_id);

create table public.circle_members (
  circle_id uuid not null references public.circles (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  primary key (circle_id, member_id)
);

create index circle_members_member_idx on public.circle_members (member_id);

-- ------------------------------------------------------------------- posts --

create type public.post_kind as enum ('text', 'photo', 'carousel', 'video', 'thread', 'article');
create type public.reply_policy as enum ('everyone', 'circles', 'none');

create table public.posts (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid not null references public.profiles (id) on delete cascade,
  kind        public.post_kind not null default 'text',
  body        text not null default '',
  topics      text[] not null default '{}',
  read_seconds int not null default 10,
  created_at  timestamptz not null default now(),

  -- The Boundary, split into two independent questions rather than one array
  -- with a magic 'public' member. Audience and reply rights are separate
  -- permissions and the schema should say so.
  is_public          boolean not null default true,
  visible_circle_ids uuid[] not null default '{}',
  reply_policy       public.reply_policy not null default 'everyone',

  -- A private post addressed to nobody is unreachable even by its author's
  -- intent, and is almost always a client bug rather than a choice.
  constraint audience_not_empty
    check (is_public or cardinality(visible_circle_ids) > 0)
);

create index posts_author_idx on public.posts (author_id, created_at desc);
create index posts_public_idx on public.posts (created_at desc) where is_public;
create index posts_circles_idx on public.posts using gin (visible_circle_ids);
create index posts_topics_idx on public.posts using gin (topics);

create table public.post_media (
  id       uuid primary key default gen_random_uuid(),
  post_id  uuid not null references public.posts (id) on delete cascade,
  url      text not null,
  ordinal  int not null default 0
);

create index post_media_post_idx on public.post_media (post_id, ordinal);

-- ------------------------------------------------------------- reactions ---

create table public.likes (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table public.boosts (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- Saves are private by design — a bookmark is not a signal to anyone else.
create table public.saves (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint no_self_follow check (follower_id <> followee_id)
);

-- ------------------------------------------------------------------ rooms --

create table public.spaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text not null default '',
  hue         text not null default '#D2F34C',
  topics      text[] not null default '{}',
  created_at  timestamptz not null default now()
);

create table public.space_members (
  space_id  uuid not null references public.spaces (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (space_id, member_id)
);

-- ----------------------------------------------------------------- drafts --

-- Drafts are strictly private, so they get the simplest possible policy: the
-- owner and nobody else, ever, including for select.
create table public.drafts (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  kind        public.post_kind not null default 'text',
  body        text not null default '',
  media       text[] not null default '{}',
  topics      text[] not null default '{}',
  is_public   boolean not null default true,
  visible_circle_ids uuid[] not null default '{}',
  reply_policy public.reply_policy not null default 'everyone',
  saved_at    timestamptz not null default now()
);

create index drafts_owner_idx on public.drafts (owner_id, saved_at desc);

-- ------------------------------------------------- the visibility predicate --

/**
 * Can the current user see this post?
 *
 * Kept as a function so the rule exists once. It is inlined into the posts
 * policy and reused by post_media, and any future surface that returns post
 * rows must go through it rather than reimplementing the check.
 *
 * `security definer` so it can read circle_members regardless of the caller's
 * own policies; `search_path` is pinned because a definer function that
 * resolves names against the caller's path is a privilege-escalation hole.
 */
create or replace function public.can_view_post(p public.posts)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    p.is_public
    or p.author_id = (select auth.uid())
    or exists (
      select 1
      from public.circle_members cm
      where cm.member_id = (select auth.uid())
        and cm.circle_id = any (p.visible_circle_ids)
    );
$$;

/** Can the current user reply to it? Never wider than being able to see it. */
create or replace function public.can_reply_to_post(p public.posts)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    public.can_view_post(p)
    and (
      p.author_id = (select auth.uid())
      or case p.reply_policy
           when 'everyone' then true
           when 'none'     then false
           when 'circles'  then exists (
             select 1
             from public.circles c
             join public.circle_members cm on cm.circle_id = c.id
             where c.owner_id = p.author_id
               and cm.member_id = (select auth.uid())
           )
         end
    );
$$;

-- ------------------------------------------------------------------- RLS ----

alter table public.profiles       enable row level security;
alter table public.circles        enable row level security;
alter table public.circle_members enable row level security;
alter table public.posts          enable row level security;
alter table public.post_media     enable row level security;
alter table public.likes          enable row level security;
alter table public.boosts         enable row level security;
alter table public.saves          enable row level security;
alter table public.follows        enable row level security;
alter table public.spaces         enable row level security;
alter table public.space_members  enable row level security;
alter table public.drafts         enable row level security;

-- Profiles are a public directory: people have to be findable by name or
-- handle to be addable to a circle. Only the owner may write.
create policy profiles_read_all on public.profiles
  for select using (true);
create policy profiles_insert_self on public.profiles
  for insert with check (id = (select auth.uid()));
create policy profiles_update_self on public.profiles
  for update using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- A circle is the owner's private filing of other people. Members are
-- deliberately NOT told which circles they are in.
create policy circles_owner_all on public.circles
  for all using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy circle_members_owner_all on public.circle_members
  for all using (
    exists (select 1 from public.circles c where c.id = circle_id and c.owner_id = (select auth.uid()))
  )
  with check (
    exists (select 1 from public.circles c where c.id = circle_id and c.owner_id = (select auth.uid()))
  );

-- The Boundary, enforced. A post outside your audience is not filtered from a
-- result set — it is never in one.
create policy posts_select_visible on public.posts
  for select using (public.can_view_post(posts));

create policy posts_insert_own on public.posts
  for insert with check (author_id = (select auth.uid()));
create policy posts_update_own on public.posts
  for update using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
create policy posts_delete_own on public.posts
  for delete using (author_id = (select auth.uid()));

/**
 * A post may only be addressed to circles its author owns.
 *
 * Without this, `visible_circle_ids` is an arbitrary uuid array and a crafted
 * client could address a private post at a stranger's circle — pushing content
 * into a group the author has no relationship with, which is the Boundary
 * running backwards. A check constraint cannot ask this question (it needs a
 * subquery), so it is a trigger.
 *
 * `security definer` because the author cannot select another owner's circles
 * to prove the negative; the check must see all of them.
 */
create or replace function public.assert_circles_owned()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from unnest(new.visible_circle_ids) as t (cid)
    where not exists (
      select 1 from public.circles c
      where c.id = t.cid and c.owner_id = new.author_id
    )
  ) then
    raise exception 'visible_circle_ids must contain only circles owned by the author';
  end if;
  return new;
end;
$$;

create trigger posts_circles_owned
  before insert or update of visible_circle_ids, author_id on public.posts
  for each row execute function public.assert_circles_owned();

-- Media inherits the post's audience exactly. Without this the images of a
-- circle-only post would be listable by anyone who could guess a post id.
create policy post_media_follows_post on public.post_media
  for select using (
    exists (select 1 from public.posts p where p.id = post_id and public.can_view_post(p))
  );
create policy post_media_write_own on public.post_media
  for all using (
    exists (select 1 from public.posts p where p.id = post_id and p.author_id = (select auth.uid()))
  )
  with check (
    exists (select 1 from public.posts p where p.id = post_id and p.author_id = (select auth.uid()))
  );

-- Counts are visible to anyone who can see the post; acting requires the
-- reply permission, so a read-only audience cannot like or boost into a room
-- it was only allowed to watch.
create policy likes_select_visible on public.likes
  for select using (
    exists (select 1 from public.posts p where p.id = post_id and public.can_view_post(p))
  );
create policy likes_write_self on public.likes
  for all using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.posts p where p.id = post_id and public.can_reply_to_post(p))
  );

create policy boosts_select_visible on public.boosts
  for select using (
    exists (select 1 from public.posts p where p.id = post_id and public.can_view_post(p))
  );
create policy boosts_write_self on public.boosts
  for all using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.posts p where p.id = post_id and public.can_reply_to_post(p))
  );

-- Saves are private in both directions: nobody can read yours, not even the
-- author of the post you saved.
create policy saves_self_only on public.saves
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy follows_read_all on public.follows
  for select using (true);
create policy follows_write_self on public.follows
  for all using (follower_id = (select auth.uid())) with check (follower_id = (select auth.uid()));

create policy spaces_read_all on public.spaces
  for select using (true);

create policy space_members_read_all on public.space_members
  for select using (true);
create policy space_members_write_self on public.space_members
  for all using (member_id = (select auth.uid())) with check (member_id = (select auth.uid()));

create policy drafts_owner_only on public.drafts
  for all using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

-- ---------------------------------------------------- profile provisioning --

/**
 * Every account gets a profile row the moment auth.users gains one — which is
 * at sign-up, before the emailed code is typed, not after. An abandoned
 * sign-up therefore holds its handle; that is the cheaper failure than the
 * alternative, which is a confirmed user with no profile row.
 *
 * Doing this in a trigger rather than from the client means there is no window
 * where a signed-in user has no profile — which would otherwise break every
 * foreign key in this file on the user's very first action.
 */
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  base text;
  candidate text;
  n int := 0;
begin
  -- `new.email` is nullable — a phone or OAuth sign-up can arrive without one,
  -- and a null here would propagate all the way to a not-null violation on
  -- handle, which surfaces to the user as a failed sign-up rather than as the
  -- missing-email case it actually is.
  base := regexp_replace(lower(split_part(coalesce(new.email, ''), '@', 1)), '[^a-z0-9_]', '', 'g');
  if length(base) < 3 then base := 'vybe' || base; end if;
  base := left(base, 16);
  candidate := base;

  -- Handles are unique; walk a suffix until one is free rather than failing
  -- the sign-up over a name collision.
  while exists (select 1 from public.profiles where handle = candidate) loop
    n := n + 1;
    candidate := left(base, 16) || n::text;
  end loop;

  insert into public.profiles (id, handle, name)
  values (
    new.id,
    candidate,
    coalesce(new.raw_user_meta_data ->> 'display_name', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- storage --

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true), ('post-media', 'post-media', true)
on conflict (id) do nothing;

-- Uploads are namespaced by user id (`<uid>/<file>`), which is what makes the
-- owner check a path comparison rather than a lookup.
create policy avatars_read_all on storage.objects
  for select using (bucket_id = 'avatars');
create policy avatars_write_own on storage.objects
  for insert with check (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy avatars_update_own on storage.objects
  for update using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy avatars_delete_own on storage.objects
  for delete using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy post_media_read_all on storage.objects
  for select using (bucket_id = 'post-media');
create policy post_media_write_own on storage.objects
  for insert with check (
    bucket_id = 'post-media' and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Without a delete policy, replacing an avatar or discarding a draft's photos
-- leaves the old objects billable and unreachable forever.
create policy post_media_delete_own on storage.objects
  for delete using (
    bucket_id = 'post-media' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
