-- 021: Reader-magnet landing pages.
--
-- A public, shareable page per book (/l/:slug) with an email-capture
-- form: the piece the product was missing next to ad creation. Sending
-- ad traffic straight to Amazon loses the reader relationship; this is
-- where an author sends it instead, and what builds the list they own.
--
-- Two tables: the page itself (owner-configured, one per book) and the
-- leads it collects. The public page is served by a function running as
-- the service role — it reads across every author's published pages by
-- slug, which no per-user RLS policy could allow — so RLS here only ever
-- has to protect the *owner's* view of their own data.

create table if not exists public.landing_pages (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  book_id       uuid not null references public.books(id) on delete cascade,
  slug          text not null,
  headline      text,
  subhead       text,
  cta_label     text not null default 'Get the book',
  cta_url       text,
  magnet_enabled boolean not null default true,
  magnet_label  text not null default 'Send me the first chapter',
  magnet_url    text,
  published     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (book_id)
);

-- Slugs are looked up across every author, so they must be globally
-- unique, not just per-owner. lower() because "My-Book" and "my-book"
-- would otherwise both resolve and collide on a case-insensitive host.
create unique index if not exists landing_pages_slug_idx
  on public.landing_pages (lower(slug));

create index if not exists landing_pages_user_idx on public.landing_pages(user_id);

create table if not exists public.landing_page_leads (
  id                uuid primary key default gen_random_uuid(),
  landing_page_id   uuid not null references public.landing_pages(id) on delete cascade,
  -- Denormalised so the owner's RLS policy needs no join, and so a lead
  -- survives being readable even if the page it came from is deleted
  -- later (on delete cascade already removes it with the page, but the
  -- column also makes "all my leads across every page" a plain query).
  user_id           uuid not null references auth.users(id) on delete cascade,
  email             text not null,
  created_at        timestamptz not null default now()
);

-- One row per address per page: a reader who submits twice (a bounced
-- confirmation, a retried request) updates the timestamp, not the count.
-- A plain column pair, not lower(email): the application always lower-
-- cases before writing, and PostgREST's upsert needs a literal conflict
-- target it can name in ON CONFLICT, not an expression index.
create unique index if not exists landing_leads_unique_idx
  on public.landing_page_leads (landing_page_id, email);

create index if not exists landing_leads_user_idx
  on public.landing_page_leads(user_id, created_at desc);

alter table public.landing_pages enable row level security;
alter table public.landing_pages force row level security;
alter table public.landing_page_leads enable row level security;
alter table public.landing_page_leads force row level security;

-- The owner manages their own page directly (no service role needed for
-- the authed CRUD in bookpilot-api.mjs, unlike the public GET/POST path).
drop policy if exists landing_pages_owner on public.landing_pages;
create policy landing_pages_owner on public.landing_pages
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Leads are read-only for the owner. They are never written through the
-- user-scoped client: the public subscribe endpoint has no session to
-- scope to, so it writes as the service role, same as tracking_events.
drop policy if exists landing_leads_read on public.landing_page_leads;
create policy landing_leads_read on public.landing_page_leads
  for select using (user_id = auth.uid());
