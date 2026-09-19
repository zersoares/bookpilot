-- 016: Kindle pages read, from Amazon Attribution.
--
-- For books, Amazon Attribution reports the pages Kindle Unlimited readers
-- read within 14 days of an ad click, and its estimate of the royalties on
-- those pages. They are figures of their own: the royalties are an estimate
-- and are not part of product sales, so they get columns of their own rather
-- than being added into anything.
--
-- Existing rows, and reports that carry no Kindle columns, read as zero.
-- Nothing is granted or revoked; clients keep their read-only access to the
-- table under the existing policy.

alter table public.amazon_attribution_metrics
  add column if not exists kindle_pages_read bigint not null default 0,
  add column if not exists kindle_royalties_cents bigint not null default 0;
