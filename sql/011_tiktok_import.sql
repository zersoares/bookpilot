-- 011: TikTok Ads (report import and tracking campaigns).
--
-- BookPilot cannot create or read campaigns on TikTok; the author runs
-- them in TikTok Ads Manager. Two things make that workable:
--
--  1. A "tracking campaign": a BookPilot campaign that exists so links and
--     imported figures have somewhere to belong. `external_only` marks one
--     as run elsewhere, so no screen offers to launch or pause it on Meta.
--  2. Performance rows with source 'tiktok', imported from an Ads Manager
--     report at campaign-and-day level (ad_id is NULL).
--
-- Re-importing a day must replace it. The existing unique key cannot do
-- that for ad_id IS NULL rows, because NULLs never conflict; the second
-- index treats them as equal, so an upsert on these four columns works.

alter table public.campaigns
  add column if not exists external_only boolean not null default false;

comment on column public.campaigns.external_only is
  'Runs on another platform (e.g. TikTok). BookPilot tracks and reports it but can never launch, pause or sync it.';

alter table public.performance_metrics
  drop constraint if exists performance_metrics_source_check;
alter table public.performance_metrics
  add constraint performance_metrics_source_check
  check (source in ('meta','tiktok','website','amazon_attribution','demo'));

create unique index if not exists performance_metrics_day_key
  on public.performance_metrics (campaign_id, ad_id, metric_date, source) nulls not distinct;
