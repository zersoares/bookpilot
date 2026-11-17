// The 70% / 35% seller payments: every number is checked against the worked
// example in /seller-terms (section 5.3), and the ledger and payout code runs
// against an in-memory database and a fake Stripe, so nothing here moves money.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  SHARES, MIN_PAYOUT_CENTS, netAmount, shareOf, classifyAudience, eligibleAt,
  shareAfterRefund, planPayout, periodOf,
} from "../netlify/functions/bookpilot-lib/seller-rules.js";
import { recordSale, applyRefund, holdForDispute, syncAccount } from "../netlify/functions/bookpilot-lib/seller-ledger.js";
import { runPayouts } from "../netlify/functions/bookpilot-seller-payouts.mjs";

// --- a tiny in-memory stand-in for the database helper ---------------------
function memoryDb(seed = {}) {
  const t = { seller_sales: [], seller_payouts: [], seller_accounts: [], ...seed };
  let n = 0;
  const match = (row, eq = {}) => Object.entries(eq).every(([k, v]) => row[k] === v);
  return {
    t,
    async select(table, o = {}) { return t[table].filter((r) => match(r, o.eq)); },
    async selectOne(table, o = {}) { return t[table].find((r) => match(r, o.eq)) || null; },
    async insert(table, row) { const r = { id: `id${++n}`, ...row }; t[table].push(r); return r; },
    async update(table, patch, o = {}) { const r = t[table].find((x) => match(x, o.eq)); if (r) Object.assign(r, patch); return r || null; },
  };
}

// --- the terms' own example (5.3) -----------------------------------------
test("terms 5.3: EUR 12.00 with 2.00 VAT and 0.60 fee has a Net Amount of 9.40", () => {
  assert.equal(netAmount({ priceCents: 1200, vatCents: 200, feeCents: 60 }), 940);
});

test("terms 5.3: the own-audience share is 6.58 and the BookPilot-audience share is 3.29", () => {
  assert.equal(shareOf(940, "own"), 658);
  assert.equal(shareOf(940, "bookpilot"), 329);
});

test("the shares are exactly 70 and 35", () => {
  assert.deepEqual({ ...SHARES }, { own: 70, bookpilot: 35 });
});

test("shares round down, never up, and never exceed the Net Amount", () => {
  assert.equal(shareOf(333, "own"), 233); // 233.1
  assert.equal(shareOf(333, "bookpilot"), 116); // 116.55
  for (let net = 0; net < 5000; net += 7) assert.ok(shareOf(net, "own") <= net);
});

test("an unknown audience is refused rather than guessed", () => {
  assert.throws(() => shareOf(100, "partner"));
});

// --- classification (5.2) --------------------------------------------------
test("own audience only when the code is this seller's; everything else is BookPilot's", () => {
  assert.equal(classifyAudience({ ref: "ABC123", sellerRefCode: "abc123" }), "own");
  assert.equal(classifyAudience({ ref: "", sellerRefCode: "abc123" }), "bookpilot");
  assert.equal(classifyAudience({ ref: undefined, sellerRefCode: "abc123" }), "bookpilot");
  assert.equal(classifyAudience({ ref: "someone-else", sellerRefCode: "abc123" }), "bookpilot");
  assert.equal(classifyAudience({ ref: "abc123", sellerRefCode: "" }), "bookpilot");
});

// --- refunds and the window (9, 2) -----------------------------------------
test("the refund window is 14 days", () => {
  const sold = new Date("2026-12-01T10:00:00Z");
  assert.equal(eligibleAt(sold).toISOString(), "2026-12-15T10:00:00.000Z");
});

test("a partial refund shrinks the share in proportion; a full refund zeroes it", () => {
  assert.equal(shareAfterRefund({ shareCents: 658, priceCents: 1200, refundedCents: 600 }), 329);
  assert.equal(shareAfterRefund({ shareCents: 658, priceCents: 1200, refundedCents: 1200 }), 0);
  assert.equal(shareAfterRefund({ shareCents: 658, priceCents: 1200, refundedCents: 0 }), 658);
});

// --- payout planning (10) --------------------------------------------------
const NOW = new Date("2026-12-20T00:00:00Z");
const sale = (o) => ({ id: "s", status: "pending", share_cents: 0, eligible_at: "2026-12-10T00:00:00Z", clawback_cents: 0, clawback_settled: false, ...o });

test("sales still inside the refund window are not paid", () => {
  const p = planPayout([sale({ id: "a", share_cents: 5000, eligible_at: "2026-12-25T00:00:00Z" })], NOW);
  assert.equal(p.amountCents, 0);
});

test("below EUR 20 nothing is paid and the balance carries over", () => {
  const p = planPayout([sale({ id: "a", share_cents: MIN_PAYOUT_CENTS - 1 })], NOW);
  assert.equal(p.amountCents, 0);
  assert.equal(p.carried, true);
});

test("at EUR 20 or more the due sales are paid together", () => {
  const p = planPayout([sale({ id: "a", share_cents: 1500 }), sale({ id: "b", share_cents: 500 })], NOW);
  assert.equal(p.amountCents, 2000);
  assert.deepEqual(p.saleIds, ["a", "b"]);
});

test("paid, refunded and under-review sales are never paid again", () => {
  const p = planPayout([
    sale({ id: "a", status: "paid", share_cents: 9000 }),
    sale({ id: "b", status: "refunded", share_cents: 9000 }),
    sale({ id: "c", status: "review", share_cents: 9000 }),
    sale({ id: "d", share_cents: 2500 }),
  ], NOW);
  assert.deepEqual(p.saleIds, ["d"]);
});

test("a clawback from a refund after an earlier payout is deducted first", () => {
  const p = planPayout([
    sale({ id: "a", share_cents: 3000 }),
    sale({ id: "old", status: "paid", share_cents: 600, clawback_cents: 600 }),
  ], NOW);
  assert.equal(p.amountCents, 2400);
  assert.deepEqual(p.clawbackIds, ["old"]);
});

test("the statement period is the calendar month", () => {
  assert.equal(periodOf(new Date("2026-12-01T06:00:00Z")), "2026-12");
});

// --- the ledger (webhook side) --------------------------------------------
const session = (o = {}) => ({
  id: "cs_1", payment_status: "paid", payment_intent: "pi_1", amount_total: 1200, currency: "eur",
  total_details: { amount_tax: 200 }, customer_details: { email: "reader@example.com" },
  metadata: { kind: "seller_sale", book_id: "book1", seller_user_id: "u1", audience: "own" }, ...o,
});
const fakeStripe = (fee = 60, cur = "eur") => ({
  async getPaymentIntent() { return { latest_charge: { id: "ch_1", balance_transaction: { fee, currency: cur } } }; },
});

test("a paid seller checkout becomes a ledger row with the terms' numbers", async () => {
  const db = memoryDb();
  await recordSale(session(), { db, stripe: fakeStripe() });
  const [row] = db.t.seller_sales;
  assert.equal(row.net_cents, 940);
  assert.equal(row.share_cents, 658);
  assert.equal(row.share_pct, 70);
  assert.equal(row.status, "pending");
});

test("a BookPilot-audience sale is 35%", async () => {
  const db = memoryDb();
  await recordSale(session({ metadata: { kind: "seller_sale", book_id: "b", seller_user_id: "u1", audience: "bookpilot" } }), { db, stripe: fakeStripe() });
  assert.equal(db.t.seller_sales[0].share_cents, 329);
  assert.equal(db.t.seller_sales[0].share_pct, 35);
});

test("the audience cannot be anything but the two defined values", async () => {
  const db = memoryDb();
  await recordSale(session({ metadata: { kind: "seller_sale", book_id: "b", seller_user_id: "u1", audience: "100%" } }), { db, stripe: fakeStripe() });
  assert.equal(db.t.seller_sales[0].audience, "bookpilot");
});

test("a retried webhook does not record the sale twice", async () => {
  const db = memoryDb();
  await recordSale(session(), { db, stripe: fakeStripe() });
  const again = await recordSale(session(), { db, stripe: fakeStripe() });
  assert.equal(db.t.seller_sales.length, 1);
  assert.ok(again.skipped);
});

test("an unpaid session and a non-seller session are ignored", async () => {
  const db = memoryDb();
  await recordSale(session({ payment_status: "unpaid" }), { db, stripe: fakeStripe() });
  await recordSale(session({ metadata: { kind: "plan" } }), { db, stripe: fakeStripe() });
  assert.equal(db.t.seller_sales.length, 0);
});

test("a fee in another currency holds the sale for review instead of guessing", async () => {
  const db = memoryDb();
  await recordSale(session(), { db, stripe: fakeStripe(60, "usd") });
  assert.equal(db.t.seller_sales[0].status, "review");
});

test("a full refund before payout zeroes the share and marks the sale refunded", async () => {
  const db = memoryDb();
  await recordSale(session(), { db, stripe: fakeStripe() });
  await applyRefund({ id: "ch_1", amount_refunded: 1200 }, { db });
  assert.equal(db.t.seller_sales[0].status, "refunded");
  assert.equal(db.t.seller_sales[0].share_cents, 0);
});

test("a refund after payout becomes a clawback for the next payout", async () => {
  const db = memoryDb();
  await recordSale(session(), { db, stripe: fakeStripe() });
  db.t.seller_sales[0].status = "paid";
  await applyRefund({ id: "ch_1", amount_refunded: 1200 }, { db });
  assert.equal(db.t.seller_sales[0].clawback_cents, 658);
  assert.equal(db.t.seller_sales[0].clawback_settled, false);
});

test("the same refund event twice changes nothing the second time", async () => {
  const db = memoryDb();
  await recordSale(session(), { db, stripe: fakeStripe() });
  await applyRefund({ id: "ch_1", amount_refunded: 600 }, { db });
  const once = db.t.seller_sales[0].share_cents;
  await applyRefund({ id: "ch_1", amount_refunded: 600 }, { db });
  assert.equal(db.t.seller_sales[0].share_cents, once);
});

test("a dispute freezes a pending sale", async () => {
  const db = memoryDb();
  await recordSale(session(), { db, stripe: fakeStripe() });
  await holdForDispute({ charge: "ch_1" }, { db });
  assert.equal(db.t.seller_sales[0].status, "review");
});

test("account.updated marks a seller payable only when transfers are active", async () => {
  const db = memoryDb({ seller_accounts: [{ user_id: "u1", stripe_account_id: "acct_1", payouts_enabled: false }] });
  await syncAccount({ id: "acct_1", details_submitted: true, capabilities: { transfers: "inactive" } }, { db });
  assert.equal(db.t.seller_accounts[0].payouts_enabled, false);
  await syncAccount({ id: "acct_1", details_submitted: true, capabilities: { transfers: "active" } }, { db });
  assert.equal(db.t.seller_accounts[0].payouts_enabled, true);
});

// --- the payout run --------------------------------------------------------
function dueDb() {
  return memoryDb({
    seller_accounts: [{ user_id: "u1", stripe_account_id: "acct_1", payouts_enabled: true, approved: true }],
    seller_sales: [{ id: "s1", seller_user_id: "u1", status: "pending", share_cents: 2500, eligible_at: "2026-12-10T00:00:00Z", clawback_cents: 0, clawback_settled: false }],
  });
}
const spyStripe = () => { const calls = []; return { calls, async createTransfer(p, key) { calls.push({ p, key }); return { id: "tr_1" }; } }; };

test("a dry run reports the payout but sends nothing and changes nothing", async () => {
  const db = dueDb(); const stripeApi = spyStripe();
  const report = await runPayouts({ db, stripeApi, live: false, now: NOW });
  assert.equal(stripeApi.calls.length, 0);
  assert.equal(report[0].dryRun, true);
  assert.equal(db.t.seller_sales[0].status, "pending");
  assert.equal(db.t.seller_payouts.length, 0);
});

test("a live run sends one idempotent transfer and marks the sales paid", async () => {
  const db = dueDb(); const stripeApi = spyStripe();
  await runPayouts({ db, stripeApi, live: true, now: NOW });
  assert.equal(stripeApi.calls.length, 1);
  assert.equal(stripeApi.calls[0].p.amount, 2500);
  assert.equal(stripeApi.calls[0].p.destination, "acct_1");
  assert.equal(stripeApi.calls[0].key, "bp-payout-u1-2026-12");
  assert.equal(db.t.seller_sales[0].status, "paid");
});

test("running the payout twice in a month pays once", async () => {
  const db = dueDb(); const stripeApi = spyStripe();
  await runPayouts({ db, stripeApi, live: true, now: NOW });
  await runPayouts({ db, stripeApi, live: true, now: NOW });
  assert.equal(stripeApi.calls.length, 1);
});

test("a seller who has not finished payout details is skipped, not paid", async () => {
  const db = dueDb(); db.t.seller_accounts[0].payouts_enabled = false; const stripeApi = spyStripe();
  await runPayouts({ db, stripeApi, live: true, now: NOW });
  assert.equal(stripeApi.calls.length, 0);
});

test("a failed transfer leaves the sales pending so they are retried", async () => {
  const db = dueDb();
  const stripeApi = { async createTransfer() { throw new Error("boom"); } };
  await runPayouts({ db, stripeApi, live: true, now: NOW });
  assert.equal(db.t.seller_sales[0].status, "pending");
  assert.equal(db.t.seller_payouts[0].status, "failed");
});

// --- wiring and safety checks on the source -------------------------------
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("the webhook routes seller sales, refunds, disputes and account updates to the ledger", () => {
  const src = read("netlify/functions/bookpilot-stripe-webhook.mjs");
  for (const s of ['kind === "seller_sale"', "charge.refunded", "charge.dispute.created", "account.updated"]) assert.ok(src.includes(s), s);
});

test("the seller checkout takes the price and the share from the server, not the browser", () => {
  const src = read("netlify/functions/bookpilot-seller.mjs");
  assert.ok(src.includes("offer.price_cents"));
  assert.ok(src.includes('status: "approved"'));
  assert.ok(!/body\.(price|amount|audience|share)/.test(src), "the request body must not set price, amount, audience or share");
});

test("payouts are a dry run unless SELLER_PAYOUTS_LIVE is set, and are schedule-only", () => {
  const src = read("netlify/functions/bookpilot-seller-payouts.mjs");
  assert.ok(src.includes("env.sellerPayoutsLive"));
  assert.ok(!src.includes("path:"), "no public URL");
  assert.ok(read("netlify/functions/bookpilot-lib/env.js").includes('read("SELLER_PAYOUTS_LIVE")'));
});

test("the migration locks the money tables to read-only and hides reader emails", () => {
  const sql = read("sql/024_seller_payments.sql");
  assert.ok(sql.includes("revoke all on public.seller_accounts"));
  assert.ok(/from public;/.test(sql), "revokes the bare PUBLIC grant too");
  assert.ok(!/grant (insert|update|delete)/i.test(sql), "no write grants to signed-in people");
  const colGrant = sql.match(/grant select \(id, book_id[\s\S]*?on public\.seller_sales/)[0];
  assert.ok(!colGrant.includes("reader_email") && !colGrant.includes("stripe_"));
  for (const t of ["seller_accounts", "seller_books", "seller_sales", "seller_payouts"]) {
    assert.ok(sql.includes(`alter table public.${t} enable row level security`), t);
  }
});
