-- =====================================================================
-- BookPilot — Book Builder AI steps as background jobs
--
-- 019 moved the AI Strategy steps off the web request because they outlast
-- it. The Book Builder's own agents (positioning, blueprint, Book Bible,
-- chapters, review, covers, ...) have the same problem and were never moved:
-- positioning takes about 26 seconds, the blueprint longer, and a
-- synchronous function is stopped at 30 (the AI request itself at 25). On the
-- live site the blueprint failed every time.
--
-- These steps now run through the same ai_jobs table. Two things differ from
-- the AI Strategy jobs:
--
--   project_id   the Book Builder project the step belongs to (those jobs
--                belong to a books row; book_id stays null here).
--   result       the handler's JSON answer. The Book Builder pages read the
--                generated row straight from the response, so the page needs
--                it back once the job is done. Only the person who started
--                the job can read it (the existing owner-read policy).
--
-- Run after 019_ai_jobs.sql. Safe to run more than once.
-- =====================================================================

alter table public.ai_jobs
  add column if not exists project_id uuid references public.book_projects(id) on delete cascade,
  add column if not exists result jsonb;

create index if not exists ai_jobs_project_idx on public.ai_jobs (project_id);
