-- =====================================================================
-- BookPilot — background AI jobs
--
-- The AI Strategy steps (analysis, reader personas, marketing angles) take
-- longer than a web request is allowed to. Measured against the live gateway,
-- book_analysis on opus-5 at high effort takes 29 to 34 seconds; the platform
-- kills a synchronous function at 30 and the request timeout is 25. Every
-- attempt therefore timed out, was refunded, and left the author with nothing.
--
-- These steps now run as background jobs: the page creates a row here, starts
-- a background function (which may run for minutes), and polls this table for
-- the outcome. The generated rows land in their usual tables exactly as
-- before; this table only records progress and the result of the attempt.
--
-- Only the server writes here. A signed-in person may read their own jobs.
--
-- Run after 018_brand_assets_storage.sql. Safe to run more than once.
-- =====================================================================

create table if not exists public.ai_jobs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  operation     text not null,                       -- route name: analyze | personas | angles
  book_id       uuid references public.books(id) on delete cascade,
  params        jsonb not null default '{}'::jsonb,  -- e.g. { "count": 4 }
  status        text not null default 'queued'
                check (status in ('queued', 'running', 'done', 'failed')),
  credits_used  integer,
  error_code    text,
  error_message text,                                -- plain language, safe to show
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz
);

create index if not exists ai_jobs_user_created_idx on public.ai_jobs (user_id, created_at desc);
create index if not exists ai_jobs_book_idx on public.ai_jobs (book_id);

alter table public.ai_jobs enable row level security;

drop policy if exists "ai_jobs_owner_read" on public.ai_jobs;
create policy "ai_jobs_owner_read" on public.ai_jobs
  for select to authenticated
  using (user_id = (select auth.uid()));

-- New tables in the public schema are granted to anon and authenticated by
-- default. Take everything away, then give back only what is needed: reading
-- your own rows (the policy above still applies). Writes are server-side only.
revoke all on public.ai_jobs from anon, authenticated;
grant select on public.ai_jobs to authenticated;
