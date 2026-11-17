-- =====================================================================
-- BookPilot — seller payments (the 70% / 35% shares)
--
-- Implements /seller-terms. BookPilot is the seller to the reader, so a
-- sale is charged on BookPilot's own Stripe account; the author's share is
-- recorded here and paid out later by a Stripe transfer:
--
--   * Own-audience sale ........ 70% of the Net Amount   (terms 5.1)
--   * BookPilot-audience sale .. 35% of the Net Amount   (terms 5.1)
--   * Net Amount = price - VAT in the price - the Stripe fee on that sale
--   * Refund window 14 days; payouts monthly for sales older than that, once
--     the balance is at least EUR 20 (terms 9, 10)
--
-- Authors can read their own rows. Nothing here is writable by a signed-in
-- person: sellers are approved by hand (terms 3.1, "by invitation") and every
-- money row is written by the server with the service role.
--
-- Run after 023. Safe to run more than once.
-- =====================================================================

-- One row per approved seller. `approved` is flipped by the operator only.
create table if not exists public.seller_accounts (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  approved           boolean not null default false,
  approved_at        timestamptz,
  -- Public code for the author's own links (?ref=CODE). A sale that carries it
  -- is an own-audience sale (terms 5.2); every other sale is BookPilot's.
  ref_code           text not null unique
                       default substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
  stripe_account_id  text unique,
  details_submitted  boolean not null default false,
  payouts_enabled    boolean not null default false,
  country            text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- A book the operator has approved for sale (terms 3.1: approval is per book).
create table if not exists public.seller_books (
  book_id      uuid primary key references public.books(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  price_cents  integer not null check (price_cents between 100 and 50000),
  currency     text not null default 'EUR' check (currency = 'EUR'),
  status       text not null default 'pending' check (status in ('pending','approved','paused')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists seller_books_user_idx on public.seller_books(user_id);

-- The ledger: one row per sale.
create table if not exists public.seller_sales (
  id                   uuid primary key default gen_random_uuid(),
  stripe_session_id    text not null unique,      -- makes the webhook idempotent
  stripe_payment_intent text,
  stripe_charge_id     text unique,
  book_id              uuid references public.books(id) on delete set null,
  seller_user_id       uuid not null references auth.users(id) on delete restrict,
  reader_email         text,                      -- never shown to the author
  audience             text not null check (audience in ('own','bookpilot')),
  share_pct            integer not null check (share_pct in (70, 35)),
  currency             text not null default 'EUR',
  price_cents          integer not null check (price_cents >= 0),
  vat_cents            integer not null default 0 check (vat_cents >= 0),
  fee_cents            integer not null default 0 check (fee_cents >= 0),
  net_cents            integer not null,          -- price - vat - fee
  share_cents          integer not null,          -- floor(net * pct / 100)
  refunded_cents       integer not null default 0 check (refunded_cents >= 0),
  -- pending: waiting out the refund window / minimum; paid: in a payout;
  -- refunded: fully refunded, share is zero; review: needs the operator
  -- (a fee that is not in the sale currency, a dispute).
  status               text not null default 'pending'
                         check (status in ('pending','paid','refunded','review')),
  review_reason        text,
  sold_at              timestamptz not null default now(),
  eligible_at          timestamptz not null,      -- sold_at + 14 days
  payout_id            uuid,
  -- Set when a refund arrives after the share was already paid out; the next
  -- payout deducts it (terms 9.1).
  clawback_cents       integer not null default 0 check (clawback_cents >= 0),
  clawback_settled     boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists seller_sales_seller_idx on public.seller_sales(seller_user_id, sold_at desc);
create index if not exists seller_sales_due_idx on public.seller_sales(status, eligible_at);

create table if not exists public.seller_payouts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete restrict,
  period           text not null,                 -- e.g. 2026-12
  amount_cents     integer not null check (amount_cents > 0),
  currency         text not null default 'EUR',
  stripe_transfer_id text unique,
  status           text not null default 'created' check (status in ('created','failed')),
  created_at       timestamptz not null default now(),
  unique (user_id, period)
);

alter table public.seller_sales
  drop constraint if exists seller_sales_payout_fk;
alter table public.seller_sales
  add constraint seller_sales_payout_fk foreign key (payout_id)
  references public.seller_payouts(id) on delete set null;

-- ---------------------------------------------------------------------
-- Row-level security: owners read their own rows, nobody writes.
-- ---------------------------------------------------------------------
alter table public.seller_accounts enable row level security;
alter table public.seller_books enable row level security;
alter table public.seller_sales enable row level security;
alter table public.seller_payouts enable row level security;

drop policy if exists seller_accounts_own on public.seller_accounts;
create policy seller_accounts_own on public.seller_accounts for select using (user_id = auth.uid());
drop policy if exists seller_books_own on public.seller_books;
create policy seller_books_own on public.seller_books for select using (user_id = auth.uid());
drop policy if exists seller_sales_own on public.seller_sales;
create policy seller_sales_own on public.seller_sales for select using (seller_user_id = auth.uid());
drop policy if exists seller_payouts_own on public.seller_payouts;
create policy seller_payouts_own on public.seller_payouts for select using (user_id = auth.uid());

-- Grants. A bare PUBLIC grant survives a REVOKE from anon/authenticated, so
-- revoke from PUBLIC explicitly, then grant back only what is read.
revoke all on public.seller_accounts, public.seller_books, public.seller_sales, public.seller_payouts from public;
revoke all on public.seller_accounts, public.seller_books, public.seller_sales, public.seller_payouts from anon, authenticated;

grant select (user_id, approved, ref_code, details_submitted, payouts_enabled, country, created_at)
  on public.seller_accounts to authenticated;
grant select on public.seller_books to authenticated;
-- Column grant: reader_email, the Stripe ids and the review notes stay private.
grant select (id, book_id, audience, share_pct, currency, price_cents, vat_cents, fee_cents, net_cents,
              share_cents, refunded_cents, status, sold_at, eligible_at, payout_id, clawback_cents)
  on public.seller_sales to authenticated;
grant select (id, period, amount_cents, currency, status, created_at)
  on public.seller_payouts to authenticated;
