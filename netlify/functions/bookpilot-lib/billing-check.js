// The admin's "is billing set up right?" check, and the one-click creation of
// missing prices.
//
// Payments fail in quiet ways: a webhook that was never registered leaves
// people paying and still on the Free plan; a price whose amount differs from
// the plan table charges something other than what the screen showed. So this
// asks Stripe, with the key already on the server, and says what it found.
//
// It reads and reports; the only thing it can write is a price, and only from
// `createMissingPrices`, which the operator asks for by name.
//
// Every check is `ok`, `warn`, `fail` or `info`. What Stripe answered is shown
// to the operator only, never to an author.

import { env } from "./env.js";
import * as stripe from "./stripe.js";
import { keyMode } from "./billing-rules.js";

export const REQUIRED_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
];

const check = (id, label, status, detail) => ({ id, label, status, detail });

export const webhookUrl = () => `${env.siteUrl.replace(/\/$/, "")}/api/bp-stripe-webhook`;
export const lookupKey = (plan) => `bookpilot_${plan.id}_${plan.billing_interval || "month"}`;

/** Is a plan one that is charged for, and so needs a Stripe price? */
export const isPaid = (plan) => plan.is_active !== false && Number(plan.price_cents) > 0;

/** What is wrong with a Stripe price for a plan; an empty list means it matches. */
export function priceProblems(price, plan, { mode, automaticTax }) {
  const problems = [];
  if (price.active === false) problems.push("the price is archived in Stripe");
  const recurring = price.recurring;
  const wanted = plan.billing_interval || "month";
  if (price.type === "one_time" || !recurring) {
    problems.push("it is a one-off price, not a subscription");
  } else if (recurring.interval !== wanted || (recurring.interval_count ?? 1) !== 1) {
    problems.push(`it bills every ${recurring.interval_count ?? 1} ${recurring.interval}(s), the plan says every ${wanted}`);
  }
  if (String(price.currency || "").toLowerCase() !== String(plan.currency).toLowerCase()) {
    problems.push(`it is in ${String(price.currency).toUpperCase()}, the plan is in ${plan.currency}`);
  }
  if (price.unit_amount !== Number(plan.price_cents)) {
    problems.push(`Stripe charges ${price.unit_amount ?? "a variable amount"} but the plan says ${plan.price_cents} (both in cents)`);
  }
  if (mode && price.livemode !== undefined && price.livemode !== (mode === "live")) {
    problems.push(`it belongs to ${price.livemode ? "live" : "test"} mode but the key is a ${mode} key`);
  }
  if (automaticTax && price.tax_behavior === "unspecified") {
    problems.push("VAT collection is on but the price doesn't say whether it includes tax; set it to Exclusive");
  }
  if (price.tax_behavior === "inclusive") {
    problems.push("the price is tax-inclusive, but the terms say prices exclude VAT");
  }
  return problems;
}

/**
 * @param {{ plans: object[] }} input  rows of the plans table
 * @returns {Promise<{ mode: string|null, ready: boolean, checks: object[] }>}
 */
export async function checkBilling({ plans }) {
  const checks = [];
  const { mode, restricted } = keyMode(env.stripeSecret);

  // --- Keys ---------------------------------------------------------------
  if (!stripe.configured()) {
    checks.push(check("key", "Stripe secret key", "fail", "STRIPE_SECRET_KEY isn't set, so nobody can pay. Set it in the site's environment variables."));
  } else if (!mode) {
    checks.push(check("key", "Stripe secret key", "fail", "STRIPE_SECRET_KEY doesn't look like a Stripe secret key (it should start sk_test_, sk_live_, rk_test_ or rk_live_)."));
  } else {
    checks.push(check("key", "Stripe secret key", "ok",
      `A ${mode}-mode ${restricted ? "restricted" : "secret"} key is set.${mode === "test" ? " Test mode: no real payments are taken." : ""}`));
  }

  if (!env.stripeWebhookSecret) {
    checks.push(check("webhook-secret", "Webhook signing secret", "fail", "STRIPE_WEBHOOK_SECRET isn't set, so paid plans can never be applied. Copy it from the webhook endpoint in Stripe (it starts whsec_)."));
  } else if (!/^whsec_/.test(env.stripeWebhookSecret)) {
    checks.push(check("webhook-secret", "Webhook signing secret", "warn", "STRIPE_WEBHOOK_SECRET doesn't start with whsec_, which is how Stripe's signing secrets look."));
  } else {
    checks.push(check("webhook-secret", "Webhook signing secret", "ok", "Set. Whether it is the right one for this endpoint can only be proved by sending a test event from Stripe and seeing it accepted."));
  }

  if (!env.siteUrl.startsWith("https://")) {
    checks.push(check("site-url", "Site address", "warn", `Checkout returns people to ${env.siteUrl}, which isn't https. Set BOOKPILOT_SITE_URL to the public address.`));
  }

  if (!stripe.configured() || !mode) {
    return { mode, ready: false, checks };
  }

  // --- Webhook endpoint ---------------------------------------------------
  const endpoints = await stripe.listWebhookEndpoints();
  if (!endpoints.ok) {
    checks.push(check("webhook-endpoint", "Webhook endpoint", endpoints.status === 401 ? "fail" : "info",
      endpoints.status === 401
        ? "Stripe rejected the key. Check that STRIPE_SECRET_KEY is right."
        : `Couldn't list webhook endpoints (${endpoints.error}). A restricted key needs read access to webhook endpoints for this check; register the endpoint by hand.`));
  } else {
    const wanted = webhookUrl();
    const found = (endpoints.body?.data || []).find((e) => String(e.url).replace(/\/$/, "") === wanted);
    if (!found) {
      checks.push(check("webhook-endpoint", "Webhook endpoint", "fail", `No webhook endpoint points at ${wanted}. Add one in Stripe (Developers, Webhooks) for: ${REQUIRED_EVENTS.join(", ")}.`));
    } else {
      const enabled = found.enabled_events || [];
      const missing = enabled.includes("*") ? [] : REQUIRED_EVENTS.filter((e) => !enabled.includes(e));
      if (found.status !== "enabled") checks.push(check("webhook-endpoint", "Webhook endpoint", "fail", `The endpoint exists but Stripe has it ${found.status}.`));
      else if (missing.length) checks.push(check("webhook-endpoint", "Webhook endpoint", "fail", `The endpoint isn't sent: ${missing.join(", ")}. Without those, plans won't apply, renew or end.`));
      else checks.push(check("webhook-endpoint", "Webhook endpoint", "ok", "Registered, enabled, and sent all four events."));
    }
  }

  // --- Prices -------------------------------------------------------------
  const paid = plans.filter(isPaid);
  if (!paid.length) checks.push(check("prices", "Plan prices", "warn", "No active plan has a price above zero, so there is nothing to buy."));
  for (const plan of paid) {
    const label = `${plan.name} price`;
    if (!plan.stripe_price_id) {
      checks.push(check(`price:${plan.id}`, label, "fail", "No Stripe price id is set, so this plan can't be bought. Add one in the plans table below, or use Create missing prices."));
      continue;
    }
    const res = await stripe.getPrice(plan.stripe_price_id);
    if (!res.ok) {
      checks.push(check(`price:${plan.id}`, label, "fail", res.status === 404
        ? `${plan.stripe_price_id} doesn't exist in this Stripe account and mode. A price from the other mode, or another account, is a common cause.`
        : `Stripe wouldn't return ${plan.stripe_price_id} (${res.error}).`));
      continue;
    }
    const problems = priceProblems(res.body, plan, { mode, automaticTax: env.stripeAutomaticTax });
    checks.push(check(`price:${plan.id}`, label, problems.length ? "fail" : "ok",
      problems.length ? `${plan.stripe_price_id}: ${problems.join("; ")}.` : `${plan.stripe_price_id} matches the plan: ${(plan.price_cents / 100).toFixed(2)} ${plan.currency} per ${plan.billing_interval || "month"}.`));
  }

  // --- Customer portal ----------------------------------------------------
  const portal = await stripe.listPortalConfigurations();
  if (!portal.ok) {
    checks.push(check("portal", "Customer portal", "info", `Couldn't check the portal (${portal.error}).`));
  } else if (!(portal.body?.data || []).some((c) => c.is_active)) {
    checks.push(check("portal", "Customer portal", "fail", "The billing portal hasn't been configured, so Manage billing will fail. Set it up in Stripe (Settings, Billing, Customer portal), and let customers update their card and cancel."));
  } else {
    checks.push(check("portal", "Customer portal", "ok", "An active portal configuration exists."));
  }

  // --- VAT ----------------------------------------------------------------
  checks.push(env.stripeAutomaticTax
    ? check("tax", "VAT", "info", "Checkout collects VAT with Stripe Tax and asks for a billing address and an optional VAT number. This needs Stripe Tax set up, with your registrations, in the same Stripe account.")
    : check("tax", "VAT", "warn", "Checkout doesn't add VAT. The terms say prices exclude VAT and it is added where applicable, so if you must charge it, set up Stripe Tax and set STRIPE_AUTOMATIC_TAX=1. (If you are not VAT-registered, leave it off and change the wording in the terms.)"));

  const ready = !checks.some((c) => c.status === "fail");
  return { mode, ready, checks };
}

/**
 * Create the Stripe price for every paid plan that has none, and save its id.
 *
 * Safe to repeat. Each price carries a lookup key derived from its plan, and
 * Stripe keeps those unique, so a price made earlier (or by an interrupted
 * run) is found and used, after being checked, instead of made twice. Prices
 * are created tax-exclusive, matching the terms.
 *
 * @param {{ plans: object[], service: object }} input   `service` is the service-role db client
 * @returns {Promise<{ plan: string, status: "created"|"linked"|"conflict"|"failed", detail: string, priceId?: string }[]>}
 */
export async function createMissingPrices({ plans, service }) {
  const { mode } = keyMode(env.stripeSecret);
  const out = [];
  for (const plan of plans.filter((p) => isPaid(p) && !p.stripe_price_id)) {
    const key = lookupKey(plan);
    try {
      const existing = await stripe.findPriceByLookupKey(key);
      if (!existing.ok) { out.push({ plan: plan.id, status: "failed", detail: `Stripe wouldn't search prices (${existing.error}).` }); continue; }

      let price = existing.body?.data?.[0];
      let status = "linked";
      if (price) {
        const problems = priceProblems(price, plan, { mode, automaticTax: false });
        if (problems.length) {
          out.push({ plan: plan.id, status: "conflict", priceId: price.id, detail: `A price already uses the lookup key ${key} but ${problems.join("; ")}. Fix or archive it in Stripe, or set the right price id by hand.` });
          continue;
        }
      } else {
        price = await stripe.createPrice({
          currency: String(plan.currency).toLowerCase(),
          unit_amount: Number(plan.price_cents),
          recurring: { interval: plan.billing_interval || "month" },
          lookup_key: key,
          tax_behavior: "exclusive",
          product_data: { name: `BookPilot AI ${plan.name}`, metadata: { plan_id: plan.id } },
          metadata: { plan_id: plan.id },
        });
        status = "created";
      }
      await service.update("plans", { stripe_price_id: price.id }, { eq: { id: plan.id } });
      out.push({ plan: plan.id, status, priceId: price.id, detail: status === "created" ? `Created ${price.id}.` : `Found ${price.id} and linked it.` });
    } catch (err) {
      console.error("[bookpilot] creating a Stripe price failed:", plan.id, err?.message);
      out.push({ plan: plan.id, status: "failed", detail: "Stripe refused to create the price. See the function log for its message." });
    }
  }
  return out;
}
