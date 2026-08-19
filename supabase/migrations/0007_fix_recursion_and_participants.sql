-- Fix infinite recursion in conversation_participants and messages policies

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

-- 1. Conversation Participants Policies
drop policy if exists participants_select_policy on public.conversation_participants;
drop policy if exists participants_member_policy on public.conversation_participants;
drop policy if exists participants_insert_policy on public.conversation_participants;

create policy participants_insert_policy on public.conversation_participants
  for insert with check (auth.uid() is not null);

create policy participants_select_policy on public.conversation_participants
  for select using (
    user_id = (select auth.uid())
    or public.is_conversation_participant(conversation_id, (select auth.uid()))
  );

-- 2. Conversations Policies
drop policy if exists conversations_select_policy on public.conversations;
drop policy if exists conversations_update_policy on public.conversations;

create policy conversations_select_policy on public.conversations
  for select using (
    public.is_conversation_participant(id, (select auth.uid()))
  );

create policy conversations_update_policy on public.conversations
  for update using (
    public.is_conversation_participant(id, (select auth.uid()))
  );

-- 3. Messages Policies
drop policy if exists messages_select_policy on public.messages;
drop policy if exists messages_insert_policy on public.messages;

create policy messages_select_policy on public.messages
  for select using (
    public.is_conversation_participant(conversation_id, (select auth.uid()))
  );

create policy messages_insert_policy on public.messages
  for insert with check (
    sender_id = (select auth.uid())
    and public.is_conversation_participant(conversation_id, (select auth.uid()))
  );
