-- Your algorithm, stored where you can reach it.
--
-- Until now the six dials, every topic weight, the timed boosts and the whole
-- ledger lived only in AsyncStorage on one handset. That made the product's
-- central claim — your algorithm is yours, legible, and reversible — true only
-- on the phone you happened to tune it on. Sign in elsewhere and the feed was
-- back to defaults; delete the app and months of adjustments were gone; two
-- accounts on one device shared a single set of dials.
--
-- Run with: supabase db push   (or paste into the SQL editor)

-- ------------------------------------------------------------- algo state --

/**
 * One row per person.
 *
 * The shapes are jsonb rather than columns because they are read and written as
 * a unit by the client and never queried field-by-field on the server. A
 * `topic_weights` column per topic would also mean a migration every time a
 * subject is added, and the subject list is expected to grow.
 */
create table if not exists public.algo_state (
  user_id        uuid primary key references public.profiles (id) on delete cascade,

  -- { topicId: -1..1 }
  topic_weights  jsonb not null default '{}'::jsonb,
  -- { authorId: -1..1 }
  author_weights jsonb not null default '{}'::jsonb,
  -- The six dials, each 0..1.
  dials          jsonb not null default '{}'::jsonb,
  -- Time-boxed overrides; expiry is enforced by the client at read time.
  modes          jsonb not null default '[]'::jsonb,

  -- Drives last-write-wins between devices. Set by the client on every write so
  -- a device can tell whether the server holds something newer than its cache.
  updated_at     timestamptz not null default now()
);

alter table public.algo_state enable row level security;

-- Nobody else, ever — not even to read. How a feed is tuned is not a fact about
-- a person that anyone else is entitled to.
drop policy if exists algo_state_owner_only on public.algo_state;
create policy algo_state_owner_only on public.algo_state
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ----------------------------------------------------------------- ledger --

/**
 * Every change made to the algorithm, and how to undo it.
 *
 * The client generates the id so an entry can be written optimistically and
 * updated later by the same id without a round trip in between.
 */
create table if not exists public.algo_ledger (
  id         text primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  at         timestamptz not null default now(),
  summary    text not null,
  source     text not null,
  -- The inverse patch. Applying it is what undo does.
  revert     jsonb not null default '{}'::jsonb,
  undone     boolean not null default false
);

create index if not exists algo_ledger_user_idx on public.algo_ledger (user_id, at desc);

alter table public.algo_ledger enable row level security;

drop policy if exists algo_ledger_owner_only on public.algo_ledger;
create policy algo_ledger_owner_only on public.algo_ledger
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
