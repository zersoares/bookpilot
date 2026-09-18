-- 012: Google Ads report import.
--
-- Same shape as TikTok (011): a report imported from Google Ads lands as
-- campaign-and-day rows with source 'google', under campaigns marked
-- external_only. The only schema change is letting the source value in.

alter table public.performance_metrics
  drop constraint if exists performance_metrics_source_check;
alter table public.performance_metrics
  add constraint performance_metrics_source_check
  check (source in ('meta','tiktok','google','website','amazon_attribution','demo'));
