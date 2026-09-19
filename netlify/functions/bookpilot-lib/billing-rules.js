// Billing decisions that do not need the network, so they can be tested.
//
// Stripe's objects change shape between API versions, and which version a
// webhook endpoint delivers depends on how the account was set up, so every
// reader here accepts both the older and the newer form rather than
// assuming one.

/** The price ids on a subscription, however many items it has. */
export function priceIds(subscription) {
  return (subscription?.items?.data || [])
    .map((item) => (typeof item?.price === "string" ? item.price : item?.price?.id))
    .filter(Boolean);
}

/**
 * Which plan a subscription is for. The price is the truth: a customer who
 * switches plans (through the billing portal, or the plan-change call here)
 * changes the price, and the metadata set at checkout goes stale. The
 * checkout's metadata is only the fallback, for a subscription whose price
 * is not one of ours.
 *
 * @param {object} subscription  a Stripe subscription
 * @param {{id: string, stripe_price_id: string|null}[]} plans  rows of the plans table
 * @returns {string|null} a plan id that exists, or null when it cannot be told
 */
export function planForSubscription(subscription, plans) {
  const byPrice = new Map(plans.filter((p) => p.stripe_price_id).map((p) => [p.stripe_price_id, p.id]));
  for (const id of priceIds(subscription)) {
    if (byPrice.has(id)) return byPrice.get(id);
  }
  const claimed = subscription?.metadata?.plan_id;
  return claimed && plans.some((p) => p.id === claimed) ? claimed : null;
}

/**
 * When the current period ends, as an ISO time. Older API versions put
 * `current_period_end` on the subscription; from 2025-03-31 it is on each
 * item, and the subscription's is the earliest of them.
 */
export function periodEnd(subscription) {
  const direct = Number(subscription?.current_period_end);
  const perItem = (subscription?.items?.data || []).map((i) => Number(i?.current_period_end)).filter(Number.isFinite);
  const seconds = Number.isFinite(direct) && direct > 0 ? direct : perItem.length ? Math.min(...perItem) : null;
  return seconds ? new Date(seconds * 1000).toISOString() : null;
}

/** The metadata copied from the subscription onto an invoice, in either API version's place. */
export function invoiceMetadata(invoice) {
  return invoice?.subscription_details?.metadata || invoice?.parent?.subscription_details?.metadata || {};
}

/** The customer id from an object whose `customer` is an id or an expanded object. */
export function customerId(object) {
  const c = object?.customer;
  return (typeof c === "string" ? c : c?.id) || null;
}

/**
 * Checkout options for collecting VAT. Off unless the operator has switched it
 * on, because Stripe refuses to create the session if Stripe Tax has not been
 * set up in the account, and would then break every purchase. The terms say
 * prices exclude VAT "which is added where applicable", and this is what adds
 * it.
 *
 * With an existing customer Stripe requires being told it may update the
 * customer's name and address from what is entered at checkout.
 */
export function taxParams({ enabled, hasCustomer }) {
  if (!enabled) return {};
  return {
    automatic_tax: { enabled: true },
    billing_address_collection: "required",
    tax_id_collection: { enabled: true },
    ...(hasCustomer ? { customer_update: { address: "auto", name: "auto" } } : {}),
  };
}

/** Is this subscription one that can be changed rather than bought again? */
export const isLiveSubscription = (row) =>
  Boolean(row?.stripe_subscription_id) && ["active", "trialing"].includes(row?.status);

/**
 * A Stripe secret key's mode, from its prefix alone. The key is never returned.
 * `sk_` is a full secret key and `rk_` a restricted one.
 */
export function keyMode(key) {
  const m = /^(sk|rk)_(live|test)_/.exec(String(key || ""));
  return m ? { mode: m[2], restricted: m[1] === "rk" } : { mode: null, restricted: false };
}
