-- Only confirmed accounts become people.
--
-- 0001 hung profile provisioning on `after insert on auth.users`, which fires
-- at sign-up — before the emailed code is typed. 0001's own comment argued that
-- an abandoned sign-up holding its handle was "the cheaper failure". It is not:
-- an abandoned sign-up became a person in the directory, listed beside real
-- accounts, permanently, having never proved they own the address. One was
-- created in testing within a day.
--
-- Provisioning now happens at confirmation instead. `ensureMyProfile` in the
-- client is the backstop for anyone who reaches a session by another route
-- (phone, OAuth), since being signed in is itself proof of confirmation.
--
-- Run with: supabase db push   (or paste into the SQL editor)

/**
 * Idempotent now, which it has to be: `ensureMyProfile` may have already
 * created the row from the client, and a duplicate-key error raised inside this
 * trigger would abort the confirmation itself — locking the user out of the
 * account they just proved they own.
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
  if exists (select 1 from public.profiles where id = new.id) then
    return new;
  end if;

  base := regexp_replace(lower(split_part(coalesce(new.email, ''), '@', 1)), '[^a-z0-9_]', '', 'g');
  if length(base) < 3 then base := 'vybe' || base; end if;
  base := left(base, 16);
  candidate := base;

  while exists (select 1 from public.profiles where handle = candidate) loop
    n := n + 1;
    candidate := left(base, 16) || n::text;
  end loop;

  insert into public.profiles (id, handle, name)
  values (
    new.id,
    candidate,
    coalesce(new.raw_user_meta_data ->> 'display_name', '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- Both are dropped, not just the one being replaced: re-running the file must
-- not fail on the trigger it created last time.
drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists on_auth_user_confirmed on auth.users;

-- Confirmed on arrival: an OAuth account, or a project with confirmation off.
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  when (new.email_confirmed_at is not null)
  execute function public.handle_new_user();

-- The ordinary path: signed up, then typed the code.
create trigger on_auth_user_confirmed
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.handle_new_user();
