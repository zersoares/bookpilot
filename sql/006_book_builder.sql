-- =====================================================================
-- BookPilot — Book Builder
--
-- The authoring half of the product: a book project carries its own
-- positioning, blueprint, Book Bible, manuscript, visuals, design,
-- cover, quality reports, exports and marketing assets.
--
-- Apply after 005_hardening.sql. Every statement is idempotent.
--
-- Two rules this file keeps to, both inherited from 001-005:
--
--   * RLS is on for every table, and every policy is scoped through
--     public.bb_can_access_project(). A mistake in an API filter cannot
--     leak another author's manuscript, because Postgres would refuse.
--   * Nothing a client may write is trusted. Columns that record what
--     the *server* did -- word counts it derived, export byte sizes,
--     quality scores -- are revoked from `authenticated` in 007.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Reference data: design themes and templates
-- ---------------------------------------------------------------------

-- A theme is a complete interior design: page geometry, type scale,
-- chapter-opener treatment and accent. The document engine
-- (netlify/functions/bookpilot-lib/doc/themes.js) holds the canonical
-- definitions; this table exists so an operator can add or retire one
-- without a deploy, and so a project can reference it.
create table if not exists public.book_design_themes (
  id             text primary key,               -- 'editorial' | 'luxury' | ...
  name           text not null,
  tagline        text,
  description    text,
  body_font      text not null default 'serif',  -- serif | sans
  heading_font   text not null default 'serif',
  base_font_pt   numeric not null default 11,
  leading        numeric not null default 1.5,
  accent_color   text not null default '#3f3aa8',
  chapter_style  text not null default 'numbered',
  settings       jsonb not null default '{}'::jsonb,
  is_active      boolean not null default true,
  sort_order     integer not null default 0,
  updated_at     timestamptz not null default now()
);

-- A template is a starting structure for a kind of book: the chapter
-- architecture the Book Architect begins from, plus sensible defaults.
create table if not exists public.book_templates (
  id            text primary key,
  category      text not null,                   -- Business | Self-help | ...
  name          text not null,
  description   text,
  theme_id      text references public.book_design_themes(id) on delete set null,
  audience_hint text,
  purpose       text,
  writing_style text,
  target_pages  integer,
  structure     jsonb not null default '{}'::jsonb,   -- { parts: [...] }
  is_premium    boolean not null default false,
  is_active     boolean not null default true,
  sort_order    integer not null default 0,
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Brand kits (spec 27)
-- ---------------------------------------------------------------------

create table if not exists public.brand_kits (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  name             text not null,
  logo_url         text,
  colors           jsonb not null default '[]'::jsonb,   -- ["#123456", ...]
  fonts            jsonb not null default '{}'::jsonb,   -- { heading, body }
  author_photo_url text,
  author_bio       text,
  company_name     text,
  company_details  text,
  is_default       boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists brand_kits_user_idx on public.brand_kits(user_id);

-- ---------------------------------------------------------------------
-- The project
-- ---------------------------------------------------------------------

create table if not exists public.book_projects (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,

  -- What the author asked for, kept verbatim: every later stage is
  -- derived from it and it is what a "start again" returns to.
  idea            text not null check (char_length(idea) between 10 and 4000),

  title           text not null default 'Untitled book',
  subtitle        text,
  author_name     text,
  genre           text,
  audience        text,
  language        text not null default 'en',
  purpose         text,                          -- sell | authority | educate | ...
  writing_style   text,                          -- professional | conversational | ...
  tone            text,
  target_pages    integer check (target_pages between 10 and 1200),
  target_words    integer check (target_words between 2000 and 400000),

  status          text not null default 'draft'
                    check (status in ('draft','positioning','architecture','writing',
                                      'editing','designing','ready','published','archived')),
  -- Per-stage state: { positioning: 'approved', blueprint: 'draft', ... }
  -- The workspace reads this to decide what to offer next (spec 40).
  stages          jsonb not null default '{}'::jsonb,

  theme_id        text references public.book_design_themes(id) on delete set null,
  template_id     text references public.book_templates(id) on delete set null,
  brand_kit_id    uuid references public.brand_kits(id) on delete set null,
  trim_size       text not null default '6x9',   -- 6x9 | 5.5x8.5 | a4 | letter
  design          jsonb not null default '{}'::jsonb,   -- per-project overrides
  metadata        jsonb not null default '{}'::jsonb,   -- ISBN, publisher, keywords...

  -- A finished project can become a BookPilot marketing book. The link
  -- is one-way and optional; deleting the marketing book leaves the
  -- manuscript alone.
  book_id         uuid references public.books(id) on delete set null,

  is_demo         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists book_projects_user_idx on public.book_projects(user_id, updated_at desc);

-- ---------------------------------------------------------------------
-- Positioning (spec 5, step 2)
-- ---------------------------------------------------------------------

create table if not exists public.book_positioning (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.book_projects(id) on delete cascade,
  title_ideas       text[] not null default '{}',
  subtitle_ideas    text[] not null default '{}',
  promise           text,
  target_reader     text,
  reader_problem    text,
  transformation    text,
  unique_angle      text,
  category          text,
  comparable_titles text[] not null default '{}',
  reasoning         text,
  model             text,
  approved_at       timestamptz,
  created_at        timestamptz not null default now()
);

create index if not exists book_positioning_project_idx
  on public.book_positioning(project_id, created_at desc);

-- ---------------------------------------------------------------------
-- The Book Bible (spec 8)
--
-- One row per project, referenced by every generation. This is what
-- keeps chapter 9 from contradicting chapter 2.
-- ---------------------------------------------------------------------

create table if not exists public.book_bible (
  project_id         uuid primary key references public.book_projects(id) on delete cascade,
  audience           text,
  tone               text,
  writing_style      text,
  promise            text,
  transformation     text,
  voice_rules        text[] not null default '{}',
  terminology        jsonb not null default '[]'::jsonb,  -- [{term, definition}]
  key_concepts       text[] not null default '{}',
  recurring_examples jsonb not null default '[]'::jsonb,
  characters         jsonb not null default '[]'::jsonb,
  facts              jsonb not null default '[]'::jsonb,  -- [{claim, status, source}]
  visual_style       text,
  image_style        text,
  brand_colors       text[] not null default '{}',
  typography         jsonb not null default '{}'::jsonb,
  chapter_summaries  jsonb not null default '[]'::jsonb,  -- maintained as chapters land
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Blueprint: parts and chapters (spec 6, 7)
-- ---------------------------------------------------------------------

create table if not exists public.book_parts (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.book_projects(id) on delete cascade,
  number     integer,
  title      text not null,
  purpose    text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists book_parts_project_idx on public.book_parts(project_id, sort_order);

create table if not exists public.book_chapters (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.book_projects(id) on delete cascade,
  part_id     uuid references public.book_parts(id) on delete set null,

  -- What this section *is* in the book, which decides how it is laid
  -- out and where it sorts. Front and back matter live in the same
  -- table as chapters so the manuscript is one ordered sequence.
  kind        text not null default 'chapter'
                check (kind in ('front','introduction','chapter','conclusion','back','bonus')),
  front_type  text,     -- half_title | title_page | copyright | dedication | epigraph |
                        -- toc | foreword | about_author | resources | references |
                        -- glossary | notes | workbook | cta
  number      integer,
  title       text not null,
  subtitle    text,

  -- Architecture: what the chapter is for, before a word is written.
  purpose     text,
  promise     text,
  key_concepts         text[] not null default '{}',
  target_words         integer,
  estimated_pages      integer,
  visual_opportunities jsonb not null default '[]'::jsonb,
  exercises            jsonb not null default '[]'::jsonb,
  case_studies         jsonb not null default '[]'::jsonb,

  -- Manuscript. Stored as the restricted Markdown subset the document
  -- engine understands (see doc/markdown.js), never HTML.
  content     text,
  word_count  integer not null default 0,
  status      text not null default 'planned'
                check (status in ('planned','drafting','draft','reviewed','approved','final')),
  quality     jsonb,       -- last Editorial Director report for this chapter
  include     boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists book_chapters_project_idx on public.book_chapters(project_id, sort_order);

-- Word count is derived from the text, so the client does not get to
-- assert it: a manuscript that claims 80,000 words and holds 300 would
-- make every page estimate and every progress figure a lie.
create or replace function public.bb_set_word_count()
returns trigger
language plpgsql
security invoker
set search_path = public
as $fn$
begin
  if coalesce(trim(new.content), '') = '' then
    new.word_count := 0;
  else
    new.word_count := coalesce(
      array_length(regexp_split_to_array(trim(new.content), '\s+'), 1), 0);
  end if;
  return new;
end;
$fn$;

drop trigger if exists bb_chapters_word_count on public.book_chapters;
create trigger bb_chapters_word_count
  before insert or update of content on public.book_chapters
  for each row execute function public.bb_set_word_count();

-- ---------------------------------------------------------------------
-- Versioning (spec 30) -- nothing is ever overwritten silently
-- ---------------------------------------------------------------------

create table if not exists public.book_chapter_versions (
  id         uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.book_chapters(id) on delete cascade,
  project_id uuid not null references public.book_projects(id) on delete cascade,
  version    integer not null,
  label      text,
  content    text,
  word_count integer not null default 0,
  action     text,        -- 'generate' | 'rewrite' | 'expand' | 'manual' | 'restore'
  model      text,
  created_at timestamptz not null default now()
);

create index if not exists book_chapter_versions_idx
  on public.book_chapter_versions(chapter_id, version desc);

create table if not exists public.book_project_versions (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.book_projects(id) on delete cascade,
  version    integer not null,
  label      text,
  note       text,
  snapshot   jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists book_project_versions_idx
  on public.book_project_versions(project_id, version desc);

-- ---------------------------------------------------------------------
-- Research (spec 12)
--
-- Sources are recorded, never invented. `kind` separates a fact from an
-- interpretation, and `verification` starts at 'unverified' -- the
-- product asks the author to check, it does not vouch.
-- ---------------------------------------------------------------------

create table if not exists public.book_research_sources (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.book_projects(id) on delete cascade,
  chapter_id   uuid references public.book_chapters(id) on delete set null,
  title        text not null,
  author_org   text,
  published_on text,
  url          text,
  summary      text,
  claim        text,
  kind         text not null default 'fact'
                 check (kind in ('fact','interpretation','example','opinion')),
  verification text not null default 'unverified'
                 check (verification in ('unverified','verified','disputed')),
  notes        text,
  accessed_on  date,
  created_at   timestamptz not null default now()
);

create index if not exists book_research_project_idx on public.book_research_sources(project_id);

-- ---------------------------------------------------------------------
-- Visuals and images (spec 13, 14)
-- ---------------------------------------------------------------------

create table if not exists public.book_visuals (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.book_projects(id) on delete cascade,
  chapter_id uuid references public.book_chapters(id) on delete cascade,
  kind       text not null default 'illustration'
               check (kind in ('illustration','diagram','infographic','timeline','process',
                               'comparison','table','checklist','quote_card','chapter_opener',
                               'concept','case_study')),
  title      text,
  purpose    text,
  placement  text,          -- e.g. "after the third section"
  brief      text,          -- art direction, in words
  prompt     text,          -- the image prompt, when this needs a renderer
  alt_text   text,
  caption    text,
  -- Structured content for the visuals the document engine draws itself
  -- (diagram, timeline, process, comparison, table, checklist, quote).
  data       jsonb not null default '{}'::jsonb,
  image_id   uuid,
  status     text not null default 'suggested'
               check (status in ('suggested','approved','rendered','skipped')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists book_visuals_project_idx on public.book_visuals(project_id, sort_order);
create index if not exists book_visuals_chapter_idx on public.book_visuals(chapter_id);

create table if not exists public.book_images (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.book_projects(id) on delete cascade,
  visual_id    uuid references public.book_visuals(id) on delete set null,
  chapter_id   uuid references public.book_chapters(id) on delete set null,
  prompt       text not null,
  style        text,
  aspect_ratio text default '3:2',
  provider     text,
  model        text,
  url          text,
  width        integer,
  height       integer,
  -- 'unavailable' is a real state, not a failure: the prompt and the
  -- art direction exist, and no image provider is configured to render
  -- them. The UI says exactly that rather than showing a placeholder.
  status       text not null default 'unavailable'
                 check (status in ('unavailable','pending','ready','failed','supplied')),
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists book_images_project_idx on public.book_images(project_id, created_at desc);

-- ---------------------------------------------------------------------
-- Covers (spec 18, 19)
-- ---------------------------------------------------------------------

create table if not exists public.book_covers (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.book_projects(id) on delete cascade,
  concept_name  text not null,
  rationale     text,
  genre_signals text[] not null default '{}',
  palette       jsonb not null default '[]'::jsonb,
  layout        jsonb not null default '{}'::jsonb,   -- type sizes, positions, alignment
  title_text    text,
  subtitle_text text,
  author_text   text,
  spine_text    text,
  back_blurb    text,
  image_id      uuid references public.book_images(id) on delete set null,
  image_url     text,
  check_report  jsonb,
  is_selected   boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists book_covers_project_idx on public.book_covers(project_id, created_at desc);

-- ---------------------------------------------------------------------
-- Quality, exports, marketing
-- ---------------------------------------------------------------------

create table if not exists public.book_quality_reports (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.book_projects(id) on delete cascade,
  scope      text not null default 'book',    -- book | chapter | cover
  chapter_id uuid references public.book_chapters(id) on delete cascade,
  readiness  integer check (readiness between 0 and 100),
  scores     jsonb not null default '{}'::jsonb,
  issues     jsonb not null default '[]'::jsonb,
  summary    text,
  model      text,
  created_at timestamptz not null default now()
);

create index if not exists book_quality_project_idx
  on public.book_quality_reports(project_id, created_at desc);

-- An export row is a record that a file was built, not the file. The
-- document is generated on request and streamed to the browser; this
-- table is the history (what, when, how big, how many pages).
create table if not exists public.book_exports (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.book_projects(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  format     text not null check (format in ('pdf_digital','pdf_print','epub','docx','html')),
  status     text not null default 'ready' check (status in ('pending','ready','failed')),
  file_name  text,
  byte_size  bigint,
  page_count integer,
  watermark  boolean not null default false,
  metadata   jsonb not null default '{}'::jsonb,
  error      text,
  created_at timestamptz not null default now()
);

create index if not exists book_exports_project_idx on public.book_exports(project_id, created_at desc);

create table if not exists public.book_marketing_assets (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.book_projects(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  channel    text not null,        -- instagram | facebook | linkedin | pinterest | email | ...
  kind       text not null,        -- post | script | sequence | description | landing_page | ...
  title      text,
  content    text,
  body       jsonb not null default '{}'::jsonb,
  status     text not null default 'draft' check (status in ('draft','approved','used','archived')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists book_marketing_project_idx
  on public.book_marketing_assets(project_id, channel, sort_order);

-- ---------------------------------------------------------------------
-- updated_at triggers, reusing the existing helper from 001_schema.sql
-- ---------------------------------------------------------------------

do $seed$
declare t text;
begin
  foreach t in array array[
    'brand_kits','book_projects','book_bible','book_chapters','book_visuals','book_covers'
  ]
  loop
    execute format('drop trigger if exists bb_touch_%1$s on public.%1$s;', t);
    execute format(
      'create trigger bb_touch_%1$s before update on public.%1$s
       for each row execute function public.bp_touch_updated_at();', t);
  end loop;
end;
$seed$;
