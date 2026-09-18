-- 010: Amazon Attribution import.
--
-- Imports arrive as one row per Amazon campaign per day, and an author will
-- re-download overlapping ranges (Amazon restates recent days). Re-importing
-- must replace, never add to, what is already there, which needs a unique
-- key to upsert against.
--
-- external_campaign was nullable; a NULL never conflicts with itself, so it
-- could not be part of that key. It becomes '' by default (the importer
-- always names a campaign, using a placeholder when the report has none).
--
-- Nothing is granted or revoked. Clients keep read-only access under the
-- existing policy; only the service role writes, after the API has
-- established whose data it is.

update public.amazon_attribution_metrics
   set external_campaign = ''
 where external_campaign is null;

alter table public.amazon_attribution_metrics
  alter column external_campaign set default '',
  alter column external_campaign set not null;

create unique index if not exists amazon_metrics_import_key
  on public.amazon_attribution_metrics (user_id, external_campaign, metric_date);
