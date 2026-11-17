// BookPilot AI — monthly seller payouts (terms 10).
//
// Runs on the 1st of each month. For every approved seller whose Stripe account
// can receive transfers, it pays the shares of sales older than the 14-day
// refund window, minus any clawbacks from later refunds, when the total is at
// least EUR 20. Anything below the minimum simply carries to the next month.
//
// This moves real money, so it is a DRY RUN unless SELLER_PAYOUTS_LIVE=true:
// it logs exactly what it would send and changes nothing. Each transfer uses
// an idempotency key per seller and month, and `seller_payouts` is unique on
// (user, period), so running it twice cannot pay twice.
//
// Scheduled only (no public URL, so nobody can trigger it). To run it by hand,
// use "Run now" on the function in the Netlify dashboard.

import { dbAsService } from "./bookpilot-lib/db.js";
import * as stripe from "./bookpilot-lib/stripe.js";
import { env } from "./bookpilot-lib/env.js";
import { planPayout, periodOf } from "./bookpilot-lib/seller-rules.js";
import { resolvePendingFees } from "./bookpilot-lib/seller-ledger.js";

export async function runPayouts({ db, stripeApi, live, now = new Date() }) {
  const period = periodOf(now);
  // Complete any sale saved before Stripe had attached its fee, so it is paid on the real figure.
  const resolved = await resolvePendingFees({ db, stripe: stripeApi });
  if (resolved.length) console.log("[bookpilot] seller fees resolved", JSON.stringify(resolved));
  const sellers = await db.select("seller_accounts", { select: "user_id,stripe_account_id,payouts_enabled", eq: { approved: true } });
  const report = [];
  for (const seller of sellers) {
    if (!seller.stripe_account_id || !seller.payouts_enabled) {
      report.push({ user: seller.user_id, skipped: "payout details not complete" });
      continue;
    }
    const already = await db.selectOne("seller_payouts", { eq: { user_id: seller.user_id, period } });
    if (already) {
      report.push({ user: seller.user_id, skipped: `already paid for ${period}` });
      continue;
    }
    const sales = await db.select("seller_sales", { select: "*", eq: { seller_user_id: seller.user_id } });
    const plan = planPayout(sales, now);
    if (!plan.amountCents) {
      report.push({ user: seller.user_id, skipped: plan.carried ? "below the EUR 20 minimum, carried over" : "nothing due" });
      continue;
    }
    if (!live) {
      report.push({ user: seller.user_id, dryRun: true, amountCents: plan.amountCents, sales: plan.saleIds.length });
      continue;
    }
    // Record intent first, then move money, then link the transfer. If the
    // process dies in between, the unique (user, period) row plus the
    // idempotency key make the retry safe.
    const payout = await db.insert("seller_payouts", {
      user_id: seller.user_id,
      period,
      amount_cents: plan.amountCents,
      currency: "EUR",
      status: "created",
    });
    try {
      const transfer = await stripeApi.createTransfer(
        {
          amount: plan.amountCents,
          currency: "eur",
          destination: seller.stripe_account_id,
          transfer_group: `payout_${period}`,
          description: `BookPilot seller payout ${period}`,
          metadata: { user_id: seller.user_id, period, payout_id: payout.id },
        },
        `bp-payout-${seller.user_id}-${period}`
      );
      await db.update("seller_payouts", { stripe_transfer_id: transfer.id }, { eq: { id: payout.id } });
      for (const id of plan.saleIds) await db.update("seller_sales", { status: "paid", payout_id: payout.id, updated_at: now.toISOString() }, { eq: { id } });
      for (const id of plan.clawbackIds) await db.update("seller_sales", { clawback_settled: true, updated_at: now.toISOString() }, { eq: { id } });
      report.push({ user: seller.user_id, paid: true, amountCents: plan.amountCents, transfer: transfer.id });
    } catch (err) {
      console.error("[bookpilot] seller payout failed:", seller.user_id, err?.message);
      await db.update("seller_payouts", { status: "failed" }, { eq: { id: payout.id } });
      report.push({ user: seller.user_id, failed: true });
    }
  }
  return report;
}

export default async () => {
  if (!stripe.configured()) {
    console.warn("[bookpilot] seller payouts: Stripe is not configured");
    return new Response(JSON.stringify({ error: "not_configured" }), { status: 501 });
  }
  const report = await runPayouts({ db: dbAsService(), stripeApi: stripe, live: env.sellerPayoutsLive });
  console.log("[bookpilot] seller payouts", env.sellerPayoutsLive ? "LIVE" : "dry run", JSON.stringify(report));
  return new Response(JSON.stringify({ live: env.sellerPayoutsLive, report }), { headers: { "Content-Type": "application/json" } });
};

export const config = { schedule: "0 6 1 * *" };
