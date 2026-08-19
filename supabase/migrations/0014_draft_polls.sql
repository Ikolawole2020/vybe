-- ============================================================================
-- Migration: 0014_draft_polls.sql
--
-- A draft can carry its poll.
--
-- `0013` made polls real; this closes the one hole left in them. The composer
-- saves on close rather than discarding — a draft is cheap, retyping a post is
-- not — and that path kept the text, the photos, the topics and the audience
-- and silently dropped the question and its answers. The user found out by
-- reopening their own draft.
--
-- One nullable jsonb column rather than a `draft_polls` table. A draft is
-- already stored as one self-contained row precisely so that restoring it is
-- one read, and a poll that only exists inside an unpublished draft has nothing
-- to reference it, nothing to tally, and no reason to be queryable on its own.
-- It becomes a real `polls` row at the moment the post does.
--
-- Shape, matching what `polls.options` holds so the promotion is a copy:
--
--     {"question": "Which one?", "options": [{"id": "opt1", "text": "This"}]}
--
-- Null means no poll. `drafts_owner_only` already covers the column; RLS is on
-- the row, and there is nothing here a draft's owner should not see.
-- ============================================================================

begin;

alter table public.drafts
  add column if not exists poll jsonb;

commit;
