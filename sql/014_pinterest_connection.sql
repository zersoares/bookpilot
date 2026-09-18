-- 014: Pinterest API connection.
--
-- The integrations table lists the providers it can hold a connection for.
-- Pinterest joins it (read-only: the app asks for the ads:read scope and
-- never writes to Pinterest). Tokens live in this table exactly as Meta's do:
-- server-only, never granted to clients, exposed to them only through the
-- integration_status view, which carries no token columns.
--
-- Nothing else changes. Campaigns created by a sync reuse external_only and
-- external_campaign_id from 011 and the original schema, and the figures
-- reuse source 'pinterest' from 013.

alter table public.integrations
  drop constraint if exists integrations_provider_check;
alter table public.integrations
  add constraint integrations_provider_check
  check (provider in ('meta','amazon_attribution','tiktok','google','pinterest'));
