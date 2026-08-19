-- ============================================================================
-- Migration: 0015_schedule_sweep.sql
--
-- Schedules the sweeper, which is the thing that makes `0012` true.
--
-- ## Why this is not optional
--
-- `0012` created `sweep_expired_messages()` and folded it into `sweep_expired()`
-- — and nothing ever called them. `pg_cron` was never installed on this
-- project, so `cron.job` does not exist and the functions have sat there since
-- they were written, deleting nothing.
--
-- Meanwhile the chat screen tells people their messages are kept for seven days
-- and then deleted. That was a promise the product was making and the server
-- was not keeping: every direct message ever sent is still in the table. This
-- is the migration that closes the gap, and it is a privacy fix rather than a
-- piece of housekeeping.
--
-- Expired stories are swept by the same call, so a story past its 24 hours
-- currently stops being *visible* — `stories_read_policy` checks `expires_at` —
-- while the row and its media keep existing. Same shape of problem, quieter.
--
-- ## Notes
--
-- `cron.schedule` upserts on the job name, so re-running this is safe and
-- changes the schedule rather than stacking a second job beside the first.
--
-- At seventeen minutes past the hour, not on the hour: nothing else here runs
-- on a schedule yet, but the top of the hour is where every scheduled job in
-- every system ends up by default, and an hourly delete that takes locks is
-- worth keeping away from that.
--
-- If `create extension` is refused, enable pg_cron from Dashboard → Database →
-- Extensions and re-run — the rest of this file is then self-sufficient.
-- ============================================================================

begin;

create extension if not exists pg_cron;

-- The sweeper is `security definer` and revoked from `public`, `anon` and
-- `authenticated` by `0012`, so the scheduler is the only caller there is.
grant usage on schema cron to postgres;

select cron.schedule(
  'vybe-sweep',
  '17 * * * *',
  $$select public.sweep_expired()$$
);

commit;
