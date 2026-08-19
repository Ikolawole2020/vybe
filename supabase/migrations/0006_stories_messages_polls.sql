-- ============================================================================
-- Migration: 0006_stories_messages_polls.sql
-- Description: Schemas for Ephemeral Stories, Direct Messages, and In-Post Polls
-- Run with: supabase db push   (or execute in the Supabase SQL editor)
-- ============================================================================

-- ------------------------------------------------------------------ Stories --

create table if not exists public.stories (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '24 hours')
);

create table if not exists public.story_items (
  id              uuid primary key default gen_random_uuid(),
  story_id        uuid not null references public.stories (id) on delete cascade,
  author_id       uuid not null references public.profiles (id) on delete cascade,
  media_url       text not null,
  kind            text not null default 'photo' check (kind in ('photo', 'video')),
  caption         text,
  hidden_user_ids uuid[] default array[]::uuid[],
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '24 hours')
);

-- Performance index for reading unexpired stories
create index if not exists story_items_active_idx
  on public.story_items (author_id, expires_at desc, created_at desc);

-- ---------------------------------------------------------- Direct Messages --

create table if not exists public.conversations (
  id          uuid primary key default gen_random_uuid(),
  is_group    boolean not null default false,
  title       text,
  circle_id   uuid references public.circles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.conversation_participants (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  last_read_at    timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null references public.profiles (id) on delete cascade,
  body            text not null default '',
  voice_url       text,
  voice_duration  int,
  shared_post_id  uuid references public.posts (id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists messages_conv_idx
  on public.messages (conversation_id, created_at asc);

-- -------------------------------------------------------------------- Polls --

create table if not exists public.polls (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.posts (id) on delete cascade,
  question    text not null,
  options     jsonb not null default '[]'::jsonb, -- e.g. [{"id": "opt1", "text": "Choice A"}]
  created_at  timestamptz not null default now()
);

create table if not exists public.poll_votes (
  poll_id     uuid not null references public.polls (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  option_id   text not null,
  created_at  timestamptz not null default now(),
  primary key (poll_id, user_id)
);

-- ----------------------------------------------------- Row Level Security --

alter table public.stories enable row level security;
alter table public.story_items enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;
alter table public.polls enable row level security;
alter table public.poll_votes enable row level security;

-- Story RLS: Authors can insert/delete; Users can view unexpired stories unless hidden
drop policy if exists stories_author_policy on public.stories;
create policy stories_author_policy on public.stories
  for all using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));

drop policy if exists stories_read_policy on public.stories;
create policy stories_read_policy on public.stories
  for select using (expires_at > now());

drop policy if exists story_items_author_policy on public.story_items;
create policy story_items_author_policy on public.story_items
  for all using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));

drop policy if exists story_items_read_policy on public.story_items;
create policy story_items_read_policy on public.story_items
  for select using (
    expires_at > now() and (
      author_id = (select auth.uid()) or
      not ((select auth.uid()) = any(hidden_user_ids))
    )
  );

-- Messaging RLS: Authenticated conversation creation; Participant-only viewing and sending
drop policy if exists conversations_member_policy on public.conversations;
drop policy if exists conversations_insert_policy on public.conversations;
create policy conversations_insert_policy on public.conversations
  for insert with check (auth.uid() is not null);

create or replace function public.is_conversation_participant(_conversation_id uuid, _user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.conversation_participants
    where conversation_id = _conversation_id
      and user_id = _user_id
  );
$$;

drop policy if exists conversations_select_policy on public.conversations;
create policy conversations_select_policy on public.conversations
  for select using (
    public.is_conversation_participant(id, (select auth.uid()))
  );

drop policy if exists conversations_update_policy on public.conversations;
create policy conversations_update_policy on public.conversations
  for update using (
    public.is_conversation_participant(id, (select auth.uid()))
  );

drop policy if exists participants_member_policy on public.conversation_participants;
drop policy if exists participants_insert_policy on public.conversation_participants;
create policy participants_insert_policy on public.conversation_participants
  for insert with check (auth.uid() is not null);

drop policy if exists participants_select_policy on public.conversation_participants;
create policy participants_select_policy on public.conversation_participants
  for select using (
    user_id = (select auth.uid())
    or public.is_conversation_participant(conversation_id, (select auth.uid()))
  );

drop policy if exists messages_member_policy on public.messages;
drop policy if exists messages_insert_policy on public.messages;
create policy messages_insert_policy on public.messages
  for insert with check (
    sender_id = (select auth.uid())
    and public.is_conversation_participant(conversation_id, (select auth.uid()))
  );

drop policy if exists messages_select_policy on public.messages;
create policy messages_select_policy on public.messages
  for select using (
    public.is_conversation_participant(conversation_id, (select auth.uid()))
  );

-- Polls RLS: Public reading; Authenticated voting
drop policy if exists polls_read_policy on public.polls;
create policy polls_read_policy on public.polls
  for select using (true);

drop policy if exists polls_insert_policy on public.polls;
create policy polls_insert_policy on public.polls
  for insert with check (
    exists (select 1 from public.posts where id = polls.post_id and author_id = (select auth.uid()))
  );

drop policy if exists poll_votes_policy on public.poll_votes;
create policy poll_votes_policy on public.poll_votes
  for all using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
