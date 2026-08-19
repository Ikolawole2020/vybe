-- ============================================================================
-- Migration: 0013_poll_results.sql
--
-- Tallies for in-post polls, plus the caller's own vote, in one call.
--
-- ## Why this cannot be a plain select
--
-- `0006` created `polls` and `poll_votes` and then nothing ever read them. The
-- obvious client-side fix — select the votes and count them in JS — cannot
-- work, and the reason is the policy, not the payload:
--
--     create policy poll_votes_policy on public.poll_votes
--       for all using (user_id = (select auth.uid()));
--
-- A voter can see exactly one row per poll: their own. Counting client-side
-- therefore yields 1 or 0 for every option, forever. That policy is right —
-- who voted for what is nobody else's business — so the count has to be
-- computed on the server, where the individual rows stay unread.
--
-- `security definer` is what steps over that policy, and it is scoped to the
-- one thing it has to do: return numbers, never rows. No option is ever
-- attributable to a person; the only per-person fact that comes back is
-- `my_option_id`, which is the caller's own vote, read via `auth.uid()` inside
-- the function rather than taken as an argument.
--
-- ## It tallies; it does not discover
--
-- The function takes the post ids the caller already holds — a list that came
-- back from a feed query and is therefore already filtered by the posts
-- policies — and answers for those. It deliberately does not re-implement the
-- Boundary, because a second copy of an audience rule is a second chance to get
-- it wrong. Nothing here is exposed that `polls_read_policy` (`using (true)`)
-- does not already make world-readable; only the aggregate is added.
--
-- No index is added: `poll_votes` is keyed `(poll_id, user_id)`, so the primary
-- key already serves every lookup below.
-- ============================================================================

begin;

create or replace function public.poll_results(p_post_ids uuid[])
returns table (
  poll_id      uuid,
  post_id      uuid,
  question     text,
  options      jsonb,
  tallies      jsonb,
  my_option_id text,
  total_votes  integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    p.id,
    p.post_id,
    p.question,
    p.options,
    -- `{"opt1": 3, "opt2": 5}`. Options nobody picked are absent rather than
    -- zero, which the client reads as zero — a poll with an untouched option is
    -- the normal case, not a missing one.
    coalesce(
      (
        select jsonb_object_agg(t.option_id, t.n)
        from (
          select v.option_id, count(*)::int as n
          from public.poll_votes v
          where v.poll_id = p.id
          group by v.option_id
        ) t
      ),
      '{}'::jsonb
    ),
    (
      select v.option_id
      from public.poll_votes v
      where v.poll_id = p.id and v.user_id = auth.uid()
    ),
    (select count(*)::int from public.poll_votes v where v.poll_id = p.id)
  from public.polls p
  where p.post_id = any(p_post_ids);
$$;

-- A `security definer` function is executable by `public` unless told
-- otherwise. Signed-out readers get no tallies: `my_option_id` would be null
-- for all of them anyway, and there is no anonymous surface that shows a poll.
revoke all on function public.poll_results(uuid[]) from public, anon;
grant execute on function public.poll_results(uuid[]) to authenticated;

commit;
