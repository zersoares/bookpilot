// Writes the seller ledger from Stripe events. Called by the existing webhook
// (bookpilot-stripe-webhook.mjs) after it has verified the signature.
//
// Every function takes its collaborators as arguments (`db`, `stripe`) so the
// money logic can be tested without a network or a database.

import { netAmount, shareOf, shareAfterRefund, eligibleAt, SHARES } from "./seller-rules.js";

/**
 * A completed Checkout Session for a seller's book becomes one ledger row.
 * Idempotent: Stripe retries webhooks, and `stripe_session_id` is unique, so a
 * repeat finds the row and does nothing.
 *
 * The Net Amount needs the Stripe fee on the charge, which only exists on the
 * balance transaction, so the PaymentIntent is read back with it expanded.
 */
export async function recordSale(session, { db, stripe }) {
  const meta = session.metadata || {};
  if (meta.kind !== "seller_sale") return { skipped: "not a seller sale" };
  if (session.payment_status && session.payment_status !== "paid") return { skipped: "not paid yet" };

  const existing = await db.selectOne("seller_sales", { eq: { stripe_session_id: session.id } });
  if (existing) return { skipped: "already recorded", id: existing.id, sale: existing };

  const audience = meta.audience === "own" ? "own" : "bookpilot";
  const priceCents = session.amount_total ?? 0;
  const vatCents = session.total_details?.amount_tax ?? 0;
  const currency = String(session.currency || "eur").toUpperCase();

  let feeCents = 0;
  let chargeId = null;
  let reviewReason = null;
  if (session.payment_intent) {
    const pi = await stripe.getPaymentIntent(session.payment_intent);
    const charge = pi?.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
    chargeId = charge?.id || null;
    const bt = charge?.balance_transaction && typeof charge.balance_transaction === "object" ? charge.balance_transaction : null;
    if (!bt) reviewReason = FEE_PENDING;
    else if (String(bt.currency || "").toUpperCase() !== currency) reviewReason = `fee in ${bt.currency}, sale in ${currency}`;
    else feeCents = bt.fee || 0;
  }

  const netCents = netAmount({ priceCents, vatCents, feeCents });
  const shareCents = shareOf(netCents, audience);
  const soldAt = new Date();
  const row = await db.insert("seller_sales", {
    stripe_session_id: session.id,
    stripe_payment_intent: session.payment_intent || null,
    stripe_charge_id: chargeId,
    book_id: meta.book_id || null,
    seller_user_id: meta.seller_user_id,
    reader_email: session.customer_details?.email || null,
    audience,
    share_pct: SHARES[audience],
    currency,
    price_cents: priceCents,
    vat_cents: vatCents,
    fee_cents: feeCents,
    net_cents: netCents,
    share_cents: shareCents,
    // A sale whose fee could not be read is held for the operator rather than
    // paid on a guess; the statement would otherwise overpay by the fee.
    status: reviewReason ? "review" : "pending",
    review_reason: reviewReason,
    sold_at: soldAt.toISOString(),
    eligible_at: eligibleAt(soldAt).toISOString(),
  });
  return { recorded: row?.id, sale: row };
}

export const FEE_PENDING = "Stripe fee not available yet";

/**
 * Sales saved while Stripe had not yet attached the fee (review reason
 * FEE_PENDING) are completed here: read the fee back, recompute the Net Amount
 * and share, and release the sale to `pending`. Run before every payout, so a
 * sale is never paid on a guessed fee and never stays stuck.
 */
export async function resolvePendingFees({ db, stripe }) {
  const held = await db.select("seller_sales", { select: "*", eq: { status: "review", review_reason: FEE_PENDING } });
  const out = [];
  for (const sale of held) {
    if (!sale.stripe_payment_intent) { out.push({ id: sale.id, skipped: "no payment intent" }); continue; }
    let pi;
    try { pi = await stripe.getPaymentIntent(sale.stripe_payment_intent); } catch { out.push({ id: sale.id, skipped: "stripe unreachable" }); continue; }
    const charge = pi?.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
    const bt = charge?.balance_transaction && typeof charge.balance_transaction === "object" ? charge.balance_transaction : null;
    if (!bt) { out.push({ id: sale.id, skipped: "fee still not available" }); continue; }
    const now = new Date().toISOString();
    if (String(bt.currency || "").toUpperCase() !== String(sale.currency).toUpperCase()) {
      await db.update("seller_sales", { review_reason: `fee in ${bt.currency}, sale in ${sale.currency}`, updated_at: now }, { eq: { id: sale.id } });
      out.push({ id: sale.id, skipped: "fee currency differs" });
      continue;
    }
    const feeCents = bt.fee || 0;
    const netCents = netAmount({ priceCents: sale.price_cents, vatCents: sale.vat_cents, feeCents });
    const full = shareOf(netCents, sale.audience);
    const shareCents = sale.refunded_cents > 0
      ? shareAfterRefund({ shareCents: full, priceCents: sale.price_cents, refundedCents: sale.refunded_cents })
      : full;
    await db.update(
      "seller_sales",
      { fee_cents: feeCents, net_cents: netCents, share_cents: shareCents, stripe_charge_id: sale.stripe_charge_id || charge.id || null, status: "pending", review_reason: null, updated_at: now },
      { eq: { id: sale.id } }
    );
    out.push({ id: sale.id, resolved: true, feeCents, shareCents });
  }
  return out;
}

/**
 * A refund (terms 9): full or partial. The author's share shrinks in
 * proportion. If the share was already paid out, the reduction becomes a
 * clawback that the next payout deducts.
 */
export async function applyRefund(charge, { db }) {
  if (!charge?.id) return { skipped: "no charge" };
  const sale = await db.selectOne("seller_sales", { eq: { stripe_charge_id: charge.id } });
  if (!sale) return { skipped: "not a seller sale" };

  const refunded = Math.min(charge.amount_refunded || 0, sale.price_cents);
  if (refunded <= sale.refunded_cents) return { skipped: "nothing new refunded" };

  const originalShare = shareOf(sale.net_cents, sale.audience);
  const newShare = shareAfterRefund({ shareCents: originalShare, priceCents: sale.price_cents, refundedCents: refunded });
  const reduction = sale.share_cents - newShare;
  const full = refunded >= sale.price_cents;

  const patch = {
    refunded_cents: refunded,
    share_cents: newShare,
    updated_at: new Date().toISOString(),
  };
  if (sale.status === "paid") {
    // Already paid out: record what must come back out of the next payout.
    patch.clawback_cents = (sale.clawback_cents || 0) + Math.max(0, reduction);
    patch.clawback_settled = false;
  } else if (full) {
    patch.status = "refunded";
  }
  await db.update("seller_sales", patch, { eq: { id: sale.id } });
  return { updated: sale.id, reduction };
}

/** A dispute freezes the sale until the operator looks at it. */
export async function holdForDispute(dispute, { db }) {
  const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
  if (!chargeId) return { skipped: "no charge" };
  const sale = await db.selectOne("seller_sales", { eq: { stripe_charge_id: chargeId } });
  if (!sale || sale.status !== "pending") return { skipped: "nothing to hold" };
  await db.update(
    "seller_sales",
    { status: "review", review_reason: "payment disputed", updated_at: new Date().toISOString() },
    { eq: { id: sale.id } }
  );
  return { held: sale.id };
}

/** Keep the seller's payout-readiness in step with Stripe (account.updated). */
export async function syncAccount(account, { db }) {
  if (!account?.id) return { skipped: "no account" };
  const row = await db.selectOne("seller_accounts", { eq: { stripe_account_id: account.id } });
  if (!row) return { skipped: "unknown account" };
  await db.update(
    "seller_accounts",
    {
      details_submitted: Boolean(account.details_submitted),
      payouts_enabled: Boolean(account.capabilities?.transfers === "active" && account.payouts_enabled !== false),
      updated_at: new Date().toISOString(),
    },
    { eq: { user_id: row.user_id } }
  );
  return { synced: row.user_id };
}
