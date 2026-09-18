-- 009: Tracking diagnostics.
--
-- The collector answers 202 to every request so it cannot be used to probe
-- for live keys, which means an author whose site is on a different domain
-- than the one registered sees nothing at all: no error, no events. These
-- two columns let the collector leave a single breadcrumb — the hostname a
-- valid key was last used from when it did not match — so the Attribution
-- screen can say "your key was used from shop.example.org, but you
-- registered example.com".
--
-- Only a website's own hostname is stored, never anything about a visitor.
-- Nothing is granted or revoked: the columns inherit the table's existing
-- row-level policy (owner only), and only the service role writes them.

alter table public.tracking_sites
  add column if not exists last_rejected_host text,
  add column if not exists last_rejected_at   timestamptz;

comment on column public.tracking_sites.last_rejected_host is
  'Hostname a valid key was last used from when it did not match the registered domain. A website domain, not visitor data.';
