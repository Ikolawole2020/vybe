-- ============================================================================
-- Migration: 0012_message_retention.sql
--
-- Direct messages are kept for seven days and then deleted.
--
-- This is a product decision with a privacy argument behind it: a chat history
-- that lives forever is a liability that grows every day, for the people in it
-- and for whoever ends up holding the database. Nothing is stored on the device
-- either — see the persistence note in `useVybe` — so seven days is genuinely
-- how long a message exists anywhere.
--
-- Enforced on the server, not the client. A client-side filter would only hide
-- old messages while the rows sat there, which is the opposite of the promise
-- being made.
-- ============================================================================

begin;

-- The sweeper deletes by age across all conversations, so the index it needs is
-- on `created_at` alone. `messages_conv_idx` from 0006 leads with
-- `conversation_id` and cannot serve this scan.
create index if not exists messages_created_at_idx on public.messages (created_at);

/**
 * How long a message lives. One place, so the sweeper and anything that later
 * wants to warn about expiry cannot disagree about the number.
 */
create or replace function public.message_retention_days()
returns int language sql immutable as $$ select 7 $$;

create or replace function public.sweep_expired_messages()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  removed integer;
begin
  -- Batched rather than one unbounded DELETE. A first run against a table that
  -- has been accumulating takes a long lock and blocks every send in the
  -- product while it runs; ten thousand rows a pass keeps each statement short,
  -- and the sweep is hourly so it catches up quickly.
  with doomed as (
    select ctid from public.messages
    where created_at < now() - (public.message_retention_days() || ' days')::interval
    limit 10000
  )
  delete from public.messages m using doomed d where m.ctid = d.ctid;

  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.sweep_expired_messages() from public, anon, authenticated;

/**
 * Folded into the existing sweep so there is one thing to schedule.
 *
 * Redefined rather than edited in place because `0008` created it — this is the
 * whole body, with messages added. Schedule it hourly:
 *
 *   select cron.schedule('vybe-sweep', '17 * * * *', 'select public.sweep_expired()');
 */
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
  perform public.sweep_expired_messages();
end;
$$;

revoke all on function public.sweep_expired() from public, anon, authenticated;

-- A conversation whose messages have all aged out is an empty row in everyone's
-- inbox. Dropping the ones with nothing left in them keeps the list honest.
create or replace function public.sweep_empty_conversations()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.conversations c
  where c.updated_at < now() - (public.message_retention_days() || ' days')::interval
    and not exists (select 1 from public.messages m where m.conversation_id = c.id);
end;
$$;

revoke all on function public.sweep_empty_conversations() from public, anon, authenticated;

commit;
