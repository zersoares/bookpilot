// The money rules of /seller-terms, as pure functions with no I/O, so every
// number can be tested against the terms' own worked example.
//
// All amounts are integer cents. Nothing here touches Stripe or the database.

export const SHARES = Object.freeze({ own: 70, bookpilot: 35 }); // terms 5.1
export const REFUND_WINDOW_DAYS = 14; // terms 2 and 9
export const MIN_PAYOUT_CENTS = 2000; // terms 10: EUR 20
const DAY_MS = 86_400_000;

/** Net Amount = Price − VAT in the price − the payment-processing fee (terms 2). */
export function netAmount({ priceCents, vatCents = 0, feeCents = 0 }) {
  return Math.max(0, priceCents - vatCents - feeCents);
}

/**
 * The author's share of a Net Amount. Rounded DOWN to the cent so BookPilot
 * never pays out a fraction of a cent it does not have.
 * Terms 5.3: net 9.40 → 70% = 6.58, 35% = 3.29.
 */
export function shareOf(netCents, audience) {
  const pct = SHARES[audience];
  if (!pct) throw new Error(`unknown audience: ${audience}`);
  return Math.floor((netCents * pct) / 100);
}

/**
 * Own-audience only when the reader started the purchase from a link that
 * carries THIS book's seller's code (terms 5.2). Everything else — no code,
 * someone else's code, a mistyped code — is a BookPilot-audience sale, so an
 * author cannot raise their own share by guessing.
 */
export function classifyAudience({ ref, sellerRefCode }) {
  const a = String(ref || "").trim().toLowerCase();
  const b = String(sellerRefCode || "").trim().toLowerCase();
  return a && b && a === b ? "own" : "bookpilot";
}

export function eligibleAt(soldAt) {
  return new Date(new Date(soldAt).getTime() + REFUND_WINDOW_DAYS * DAY_MS);
}

/** A share after a partial refund: reduced in proportion to what was refunded. */
export function shareAfterRefund({ shareCents, priceCents, refundedCents }) {
  if (!priceCents || refundedCents <= 0) return shareCents;
  if (refundedCents >= priceCents) return 0;
  return Math.floor((shareCents * (priceCents - refundedCents)) / priceCents);
}

/**
 * What to pay one author now.
 *
 * A sale counts when it is still `pending`, its refund window has passed, and
 * it is not under review. Clawbacks from refunds that arrived after an earlier
 * payout are deducted first (terms 9.1). Below the minimum nothing is paid and
 * the balance simply carries to the next month (terms 10).
 *
 * @returns {{ amountCents:number, saleIds:string[], clawbackIds:string[], carried:boolean }}
 */
export function planPayout(sales, now = new Date()) {
  const due = sales.filter(
    (s) => s.status === "pending" && new Date(s.eligible_at).getTime() <= now.getTime()
  );
  const gross = due.reduce((n, s) => n + (s.share_cents || 0), 0);
  const claws = sales.filter((s) => s.clawback_cents > 0 && !s.clawback_settled);
  const clawTotal = claws.reduce((n, s) => n + s.clawback_cents, 0);
  const amountCents = gross - clawTotal;
  if (amountCents < MIN_PAYOUT_CENTS) {
    return { amountCents: 0, saleIds: [], clawbackIds: [], carried: gross > 0 || clawTotal > 0 };
  }
  return {
    amountCents,
    saleIds: due.map((s) => s.id),
    clawbackIds: claws.map((s) => s.id),
    carried: false,
  };
}

/** The statement period a payout belongs to, e.g. "2026-12". */
export function periodOf(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
