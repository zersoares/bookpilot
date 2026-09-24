-- 022: AI-content provenance, for KDP's disclosure requirement.
--
-- Amazon requires authors to declare whether a book contains AI-GENERATED
-- text (an AI tool produced the actual words) as distinct from merely
-- AI-ASSISTED text (the author wrote it; AI only edited, brainstormed or
-- checked grammar) — and its own guidance says extensive human editing
-- afterward does not reclassify AI-generated text back to human-authored.
-- That makes this a sticky, per-chapter flag, not something that can be
-- reconstructed after the fact from a diff.
--
-- book_chapter_versions already records an action ('generate'|'rewrite'|
-- 'expand'|'manual'|'restore') and a model — but only for a chapter that
-- already had content before the change. A chapter's very first draft,
-- the most common case in a product whose whole premise is "AI writes
-- it", never had prior content, so it was never snapshotted and this
-- signal was never captured. Two new columns close that gap going
-- forward; the backfill below is the best honest answer for what already
-- exists.

alter table public.book_chapters
  add column if not exists ai_generated boolean not null default false,
  add column if not exists ai_models    text[]  not null default '{}';

comment on column public.book_chapters.ai_generated is
  'Whether any AI tool ever produced the actual text of this section (not merely edited author-written text). Sticky: an author''s later hand-edit never clears it, matching KDP''s own disclosure rule.';
comment on column public.book_chapters.ai_models is
  'Every distinct model that has generated or rewritten this section''s text, for the author''s own record.';

-- Backfill: BookPilot's primary path is "Write here, or ask the Book
-- Writer for a first draft" — a chapter that already has content but no
-- version history is far more often an untouched first AI draft than a
-- single manual save that happened not to need a second edit, and the
-- two are genuinely indistinguishable from history alone. KDP's own
-- guidance is to disclose when in doubt, so every chapter that already
-- has content is flagged; an author certain a specific chapter is
-- entirely their own words can clear the flag themselves from the
-- Publish screen. A chapter with a recorded 'manual'-only history and no
-- generate/rewrite/expand ever recorded is the one case with positive
-- evidence the other way, so it is left unflagged.
update public.book_chapters c
set ai_generated = true
where coalesce(c.word_count, 0) > 0
  and not exists (
    select 1 from public.book_chapter_versions v
    where v.chapter_id = c.id
  );

update public.book_chapters c
set ai_generated = true,
    ai_models = (
      select coalesce(array_agg(distinct v.model), '{}')
      from public.book_chapter_versions v
      where v.chapter_id = c.id and v.model is not null
    )
where exists (
  select 1 from public.book_chapter_versions v
  where v.chapter_id = c.id and v.action in ('generate', 'rewrite', 'expand')
);
