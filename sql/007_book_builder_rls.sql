-- =====================================================================
-- BookPilot — Book Builder row level security
--
-- Same posture as 002_rls.sql: deny by default, every policy scoped to
-- auth.uid(), and column grants where RLS alone is too coarse.
--
-- Run after 006_book_builder.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Access predicate. SECURITY DEFINER so a policy on a child table can
-- consult book_projects without recursing through its policy.
-- ---------------------------------------------------------------------

create or replace function public.bb_can_access_project(project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.book_projects p
    where p.id = project
      and (p.user_id = auth.uid() or public.bp_is_org_member(p.organization_id))
  );
$fn$;

-- CREATE FUNCTION grants EXECUTE to PUBLIC, and every role inherits it.
-- This one only answers a boolean about rows the caller could read
-- anyway, so it is not the hole that 005 closed -- but it takes a uuid
-- from an untrusted caller, so keep it to the roles that need it.
revoke execute on function public.bb_can_access_project(uuid) from public;
grant execute on function public.bb_can_access_project(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- RLS on. A table added later without a policy is simply unreadable,
-- which is the safe direction to fail.
-- ---------------------------------------------------------------------

do $rls$
declare t text;
begin
  foreach t in array array[
    'book_design_themes','book_templates','brand_kits','book_projects',
    'book_positioning','book_bible','book_parts','book_chapters',
    'book_chapter_versions','book_project_versions','book_research_sources',
    'book_visuals','book_images','book_covers','book_quality_reports',
    'book_exports','book_marketing_assets'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('alter table public.%I force row level security;', t);
  end loop;
end;
$rls$;

-- ---------------------------------------------------------------------
-- Reference data: readable by anyone, writable by admins only.
-- ---------------------------------------------------------------------

drop policy if exists book_design_themes_read on public.book_design_themes;
create policy book_design_themes_read on public.book_design_themes
  for select using (is_active or public.bp_is_admin());

drop policy if exists book_design_themes_admin on public.book_design_themes;
create policy book_design_themes_admin on public.book_design_themes
  for all using (public.bp_is_admin()) with check (public.bp_is_admin());

drop policy if exists book_templates_read on public.book_templates;
create policy book_templates_read on public.book_templates
  for select using (is_active or public.bp_is_admin());

drop policy if exists book_templates_admin on public.book_templates;
create policy book_templates_admin on public.book_templates
  for all using (public.bp_is_admin()) with check (public.bp_is_admin());

-- ---------------------------------------------------------------------
-- Brand kits and projects
-- ---------------------------------------------------------------------

drop policy if exists brand_kits_access on public.brand_kits;
create policy brand_kits_access on public.brand_kits
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists book_projects_read on public.book_projects;
create policy book_projects_read on public.book_projects
  for select using (user_id = auth.uid() or public.bp_is_org_member(organization_id));

drop policy if exists book_projects_insert on public.book_projects;
create policy book_projects_insert on public.book_projects
  for insert with check (user_id = auth.uid());

drop policy if exists book_projects_update on public.book_projects;
create policy book_projects_update on public.book_projects
  for update using (user_id = auth.uid() or public.bp_is_org_member(organization_id))
  with check (user_id = auth.uid() or public.bp_is_org_member(organization_id));

drop policy if exists book_projects_delete on public.book_projects;
create policy book_projects_delete on public.book_projects
  for delete using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Everything that hangs off a project inherits the project's rule.
-- ---------------------------------------------------------------------

do $child$
declare t text;
begin
  foreach t in array array[
    'book_bible','book_parts','book_chapters','book_research_sources',
    'book_visuals','book_images','book_covers','book_marketing_assets'
  ]
  loop
    execute format('drop policy if exists %1$s_access on public.%1$s;', t);
    execute format(
      'create policy %1$s_access on public.%1$s
       for all using (public.bb_can_access_project(project_id))
       with check (public.bb_can_access_project(project_id));', t);
  end loop;
end;
$child$;

-- Positioning is written by the server after a generation. The author
-- reads it and approves it; they do not compose one by hand.
drop policy if exists book_positioning_read on public.book_positioning;
create policy book_positioning_read on public.book_positioning
  for select using (public.bb_can_access_project(project_id));

drop policy if exists book_positioning_update on public.book_positioning;
create policy book_positioning_update on public.book_positioning
  for update using (public.bb_can_access_project(project_id))
  with check (public.bb_can_access_project(project_id));

drop policy if exists book_positioning_insert on public.book_positioning;
create policy book_positioning_insert on public.book_positioning
  for insert with check (public.bb_can_access_project(project_id));

-- Versions are append-only from the client: a restore writes a new
-- version rather than editing an old one, so history cannot be rewritten
-- to hide what a generation replaced (spec 30).
do $ver$
declare t text;
begin
  foreach t in array array['book_chapter_versions','book_project_versions']
  loop
    execute format('drop policy if exists %1$s_read on public.%1$s;', t);
    execute format(
      'create policy %1$s_read on public.%1$s
       for select using (public.bb_can_access_project(project_id));', t);
    execute format('drop policy if exists %1$s_insert on public.%1$s;', t);
    execute format(
      'create policy %1$s_insert on public.%1$s
       for insert with check (public.bb_can_access_project(project_id));', t);
  end loop;
end;
$ver$;

revoke update, delete on public.book_chapter_versions from anon, authenticated;
revoke update, delete on public.book_project_versions from anon, authenticated;

-- Quality reports and export records are statements about what the
-- server found and produced. A client that could write them could claim
-- a 100% publication-readiness score on an empty manuscript.
drop policy if exists book_quality_reports_read on public.book_quality_reports;
create policy book_quality_reports_read on public.book_quality_reports
  for select using (public.bb_can_access_project(project_id));

drop policy if exists book_exports_read on public.book_exports;
create policy book_exports_read on public.book_exports
  for select using (user_id = auth.uid() or public.bb_can_access_project(project_id));

revoke insert, update, delete on public.book_quality_reports from anon, authenticated;
revoke insert, update, delete on public.book_exports from anon, authenticated;

-- ---------------------------------------------------------------------
-- Column grants: the parts of a row the server owns
-- ---------------------------------------------------------------------

-- `word_count` is derived by a trigger from `content`. The trigger only
-- fires when content is part of the statement, so without this a client
-- could PATCH word_count alone and every page estimate downstream would
-- inherit the lie. `quality` is the Editorial Director's verdict.
revoke update on public.book_chapters from anon, authenticated;
grant update (
  part_id, kind, front_type, number, title, subtitle, purpose, promise,
  key_concepts, target_words, estimated_pages, visual_opportunities,
  exercises, case_studies, content, status, include, sort_order, updated_at
) on public.book_chapters to authenticated;

-- `check_report` is the cover review the server ran.
revoke update on public.book_covers from anon, authenticated;
grant update (
  concept_name, rationale, genre_signals, palette, layout, title_text,
  subtitle_text, author_text, spine_text, back_blurb, image_id, image_url,
  is_selected, updated_at
) on public.book_covers to authenticated;

-- `approved_at` is the only thing an author changes on a positioning row.
revoke update on public.book_positioning from anon, authenticated;
grant update (approved_at) on public.book_positioning to authenticated;

-- `is_demo` and `book_id` are set by the server: the first labels the
-- sample project, the second records a real row in `books`.
revoke update on public.book_projects from anon, authenticated;
grant update (
  idea, title, subtitle, author_name, genre, audience, language, purpose,
  writing_style, tone, target_pages, target_words, status, stages, theme_id,
  template_id, brand_kit_id, trim_size, design, metadata, organization_id, updated_at
) on public.book_projects to authenticated;
