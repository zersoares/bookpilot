// A sale saved before Stripe attached its fee is completed later, not left in review.

import test from "node:test";
import assert from "node:assert/strict";
import { recordSale, resolvePendingFees, FEE_PENDING } from "../netlify/functions/bookpilot-lib/seller-ledger.js";
import { runPayouts } from "../netlify/functions/bookpilot-seller-payouts.mjs";

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
const session = { id: "cs_1", payment_status: "paid", payment_intent: "pi_1", amount_total: 1200, currency: "eur", total_details: { amount_tax: 0 }, customer_details: { email: "r@example.com" }, metadata: { kind: "seller_sale", book_id: "b", seller_user_id: "u1", audience: "own" } };
const noFee = { async getPaymentIntent() { return { latest_charge: { id: "ch_1", balance_transaction: null } }; } };
const withFee = (fee, cur = "eur") => ({ async getPaymentIntent() { return { latest_charge: { id: "ch_1", balance_transaction: { fee, currency: cur } } }; } });

async function held() {
  const db = memoryDb();
  await recordSale(session, { db, stripe: noFee });
  assert.equal(db.t.seller_sales[0].status, "review");
  assert.equal(db.t.seller_sales[0].review_reason, FEE_PENDING);
  return db;
}

test("once the fee exists the sale gets the real net amount and share and is released", async () => {
  const db = await held();
  const out = await resolvePendingFees({ db, stripe: withFee(40) });
  const s = db.t.seller_sales[0];
  assert.equal(out[0].resolved, true);
  assert.equal(s.fee_cents, 40);
  assert.equal(s.net_cents, 1160);
  assert.equal(s.share_cents, 812); // floor(1160 * 0.70)
  assert.equal(s.status, "pending");
  assert.equal(s.review_reason, null);
  assert.equal(s.stripe_charge_id, "ch_1");
});

test("while the fee is still missing the sale stays held", async () => {
  const db = await held();
  const out = await resolvePendingFees({ db, stripe: noFee });
  assert.equal(out[0].skipped, "fee still not available");
  assert.equal(db.t.seller_sales[0].status, "review");
});

test("a fee in another currency keeps it held with a clear reason", async () => {
  const db = await held();
  await resolvePendingFees({ db, stripe: withFee(40, "usd") });
  assert.equal(db.t.seller_sales[0].status, "review");
  assert.match(db.t.seller_sales[0].review_reason, /fee in usd/);
});

test("a Stripe error leaves the sale untouched for the next run", async () => {
  const db = await held();
  const out = await resolvePendingFees({ db, stripe: { async getPaymentIntent() { throw new Error("down"); } } });
  assert.equal(out[0].skipped, "stripe unreachable");
  assert.equal(db.t.seller_sales[0].status, "review");
});

test("a partial refund taken while it was held is applied to the recomputed share", async () => {
  const db = await held();
  Object.assign(db.t.seller_sales[0], { refunded_cents: 600, share_cents: 420 });
  await resolvePendingFees({ db, stripe: withFee(40) });
  assert.equal(db.t.seller_sales[0].share_cents, 406); // half of 812
});

test("other review reasons (a dispute) are never released by this step", async () => {
  const db = await held();
  Object.assign(db.t.seller_sales[0], { review_reason: "payment disputed" });
  assert.deepEqual(await resolvePendingFees({ db, stripe: withFee(40) }), []);
  assert.equal(db.t.seller_sales[0].status, "review");
});

test("the payout run resolves held fees first", async () => {
  const db = await held();
  db.t.seller_accounts.push({ user_id: "u1", approved: true, stripe_account_id: "acct_1", payouts_enabled: true });
  await runPayouts({ db, stripeApi: withFee(40), live: false, now: new Date("2027-01-01T06:00:00Z") });
  assert.equal(db.t.seller_sales[0].status, "pending");
  assert.equal(db.t.seller_sales[0].share_cents, 812);
});
