-- 020: KDP sales & royalties import.
--
-- Amazon Attribution (table amazon_attribution_metrics) only ever covers
-- sales an ad click led to. It says nothing about the book's organic
-- sales, its Kindle Unlimited royalties from readers who never clicked an
-- ad, or refunds — the numbers on the author's actual KDP payment. This
-- table holds that report instead, imported the same way: no Amazon API
-- offers a personal KDP dashboard's sales data, so CSV is the only door,
-- same as Attribution before it had a sync.
--
-- Kept as its own table rather than folded into amazon_attribution_metrics
-- because the two must never be summed: one is ad-attributed, the other is
-- everything, and conflating them would silently double an ad's sales into
-- "total" sales.

create table if not exists public.kdp_royalty_metrics (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  book_id            uuid references public.books(id) on delete set null,
  external_title     text not null default '',
  marketplace        text not null default '',
  metric_date        date not null,
  units_sold         bigint not null default 0,
  units_refunded     bigint not null default 0,
  net_units_sold     bigint not null default 0,
  royalty_cents      bigint not null default 0,
  kenp_pages_read    bigint not null default 0,
  kenp_royalty_cents bigint not null default 0,
  currency           text not null default 'EUR',
  imported_at        timestamptz not null default now()
);

-- One row per title per marketplace per day; re-importing an overlapping
-- range (KDP restates recent royalties, same as Attribution does) replaces
-- rather than adds.
create unique index if not exists kdp_royalty_import_key
  on public.kdp_royalty_metrics (user_id, external_title, marketplace, metric_date);

create index if not exists kdp_royalty_user_idx
  on public.kdp_royalty_metrics(user_id, metric_date desc);

alter table public.kdp_royalty_metrics enable row level security;
alter table public.kdp_royalty_metrics force row level security;

-- Same posture as amazon_attribution_metrics: read-only for the owner,
-- every write goes through the service role after the API has established
-- whose data it is.
drop policy if exists kdp_royalty_read on public.kdp_royalty_metrics;
create policy kdp_royalty_read on public.kdp_royalty_metrics
  for select using (user_id = auth.uid());
