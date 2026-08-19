-- ============================================================================
-- Migration: 0011_create_conversation_rpc.sql
--
-- Opening a DM becomes one atomic function call instead of four round trips
-- against three sets of policies.
--
-- ## Why
--
-- The client did: look for an existing thread → insert a `conversations` row →
-- read its id back → insert two `conversation_participants` rows. That is
-- fragile in a way that produced "Could not open that chat. Check your
-- connection", which is a message about the network for a problem that has
-- nothing to do with it:
--
--   * The insert must satisfy `conversations_insert_policy`, and the
--     `RETURNING id` that PostgREST appends must *additionally* satisfy
--     `conversations_select_policy` — which grants on being a participant. At
--     that instant no participant rows exist yet, so the row being created is
--     invisible to its own creator.
--   * The participant inserts are a separate statement, so a failure there
--     leaves a conversation nobody can see or reach, and the client has to
--     clean it up by hand.
--   * It is four sequential requests to open a chat.
--
-- `security definer` steps outside RLS for the one operation where the policies
-- are provably circular. Everything it would have checked is checked here
-- explicitly, and it can only ever act as the caller: `auth.uid()` is read
-- inside the function, never passed in, so there is no argument that lets one
-- account open a conversation as another.
-- ============================================================================

begin;

create or replace function public.create_direct_conversation(target_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me       uuid := auth.uid();
  existing uuid;
  new_id   uuid;
begin
  if me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if target_user_id is null or target_user_id = me then
    raise exception 'A conversation needs two different people' using errcode = '22023';
  end if;
  -- The target has to be real. Without this the function is a way to create
  -- rows referencing arbitrary uuids and find out which ones exist.
  if not exists (select 1 from public.profiles where id = target_user_id) then
    raise exception 'No such account' using errcode = '23503';
  end if;

  -- An existing one-to-one thread wins. Group threads are excluded: sharing a
  -- post into a Circle group and then trying to DM one of its members must not
  -- reuse the group.
  select cp.conversation_id into existing
  from public.conversation_participants cp
  join public.conversations c on c.id = cp.conversation_id
  where cp.user_id = target_user_id
    and c.is_group = false
    and exists (
      select 1 from public.conversation_participants mine
      where mine.conversation_id = cp.conversation_id and mine.user_id = me
    )
  limit 1;

  if existing is not null then
    return existing;
  end if;

  -- One statement each, one transaction: a failure anywhere rolls the whole
  -- thing back rather than leaving an unreachable conversation behind.
  insert into public.conversations (is_group, created_by)
  values (false, me)
  returning id into new_id;

  insert into public.conversation_participants (conversation_id, user_id)
  values (new_id, me), (new_id, target_user_id);

  return new_id;
end;
$$;

-- Callable by signed-in users only. `security definer` functions are executable
-- by `public` unless told otherwise, and this one writes.
revoke all on function public.create_direct_conversation(uuid) from public, anon;
grant execute on function public.create_direct_conversation(uuid) to authenticated;

commit;
