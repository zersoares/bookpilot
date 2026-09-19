-- 015: Amazon Attribution API connection.
--
-- Amazon's Ads API is regional: a login, its tokens and its profiles all
-- belong to one region, each with its own hosts, so a connection has to
-- remember which. It is written by the server only, like the tokens beside
-- it, and is not added to the integration_status view (the browser has no use
-- for it; the account's name already carries the marketplace).
--
-- The provider list already includes 'amazon_attribution' and the figures
-- go in the existing amazon_attribution_metrics table, so nothing else
-- changes. Clients still have no grant on integrations.

alter table public.integrations
  add column if not exists region text
  check (region is null or region in ('na','eu'));
