-- =====================================================================
-- BookPilot — storage for brand images (logo, author photo)
--
-- The Brand Kit lets a person upload an image instead of pasting a link.
-- The file goes to this bucket and its public address is what gets saved in
-- brand_kits.logo_url / author_photo_url.
--
--   * The bucket is public: a logo or author photo ends up inside a
--     published book, so its address has to open for anyone.
--   * PNG, JPEG and WebP only, 2 MB each. SVG is refused on purpose — a
--     public SVG can carry script. The browser shrinks and re-encodes every
--     image first (js/core/upload.js); the bucket enforces the same limits
--     again because the browser is not a trust boundary.
--   * A signed-in person can read, add and delete files only inside a
--     folder named after their own user id, and at most 50 files in it, so
--     a free account cannot be used as free file hosting.
--
-- js/core/image-plan.js holds the matching limits;
-- tests/brand-upload.test.mjs fails if they drift apart.
--
-- Run after 017_more_book_templates.sql. Safe to run more than once.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('brand-assets', 'brand-assets', true, 2097152,
        array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "brand_assets_own_select" on storage.objects;
create policy "brand_assets_own_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'brand-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- How many files the caller already has here. This has to be a function:
-- a policy on storage.objects that counts rows in storage.objects itself
-- makes Postgres refuse to evaluate it ("infinite recursion detected in
-- policy for relation objects", surfaced by Storage as a 400/503 on every
-- upload). SECURITY DEFINER reads the table without going back through the
-- policies. It takes no argument and uses the caller's own id, so it can only
-- ever count the caller's own folder.
create or replace function public.brand_asset_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from storage.objects o
  where o.bucket_id = 'brand-assets'
    and (storage.foldername(o.name))[1] = (select auth.uid())::text;
$$;

-- Supabase grants new functions to anon and authenticated by name, and to
-- everyone via PUBLIC; take both away, then give back only what is needed.
revoke all on function public.brand_asset_count() from public, anon;
grant execute on function public.brand_asset_count() to authenticated;

drop policy if exists "brand_assets_own_insert" on storage.objects;
create policy "brand_assets_own_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'brand-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.brand_asset_count() < 50
  );

drop policy if exists "brand_assets_own_delete" on storage.objects;
create policy "brand_assets_own_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'brand-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
