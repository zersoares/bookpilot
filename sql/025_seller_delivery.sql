-- =====================================================================
-- BookPilot — delivery of a seller's book after purchase
--
-- Adds, to 024:
--   * seller_books.file_path / file_name / file_type — the file a reader gets,
--     stored in a PRIVATE bucket. Nobody can read it directly; the server hands
--     out a 5-minute signed link after checking the sale is still valid.
--   * seller_sales.download_count / receipt_sent_at — the download limit and
--     whether the buyer's receipt email went out.
--
-- Run after 024_seller_payments.sql. Safe to run more than once.
-- =====================================================================

alter table public.seller_books
  add column if not exists file_path text,
  add column if not exists file_name text,
  add column if not exists file_type text;

alter table public.seller_sales
  add column if not exists download_count integer not null default 0 check (download_count >= 0),
  add column if not exists receipt_sent_at timestamptz;

-- A private bucket: no policies are created, so only the service role (the
-- server) can read or write objects in it.
insert into storage.buckets (id, name, public, file_size_limit)
values ('seller-files', 'seller-files', false, 52428800)   -- 50 MB
on conflict (id) do update set public = false, file_size_limit = 52428800;
