// BookPilot AI — billing.
//
//   /api/bp-billing/*
//
// Checkout and the customer portal. Plan state is never set from here:
// it is set by the webhook after Stripe confirms payment, so a user who
// closes the checkout tab at the right moment does not end up on a plan
// they didn't pay for.

import { withGuards, json, readJson, pathSegments } from "./bookpilot-lib/http.js";
import { authenticate } from "./bookpilot-lib/auth.js";
import { dbAsService } from "./bookpilot-lib/db.js";
import { AppError, Errors } from "./bookpilot-lib/errors.js";
import { env } from "./bookpilot-lib/env.js";
import { memoryLimit } from "./bookpilot-lib/ratelimit.js";
import * as stripe from "./bookpilot-lib/stripe.js";
import * as v from "./bookpilot-lib/validate.js";
import { taxParams, isLiveSubscription, priceIds } from "./bookpilot-lib/billing-rules.js";

const PREFIX = "/api/bp-billing";

async function startCheckout(ctx, body) {
  if (!stripe.configured()) throw Errors.notConfigured("Billing");

  const planId = v.str(body.plan_id, "Plan", { max: 40, required: true });
  const plan = await dbAsService().selectOne("plans", { eq: { id: planId, is_active: true } });
  if (!plan) throw Errors.notFound("plan");
  if (plan.price_cents === 0) throw Errors.invalid("The free plan doesn't need checkout.");
  if (!plan.stripe_price_id) {
    throw Errors.notConfigured(`The ${plan.name} plan's price`);
  }

  const subscription = await ctx.db.selectOne("subscriptions", { eq: { user_id: ctx.user.id } });
  // A second checkout would start a second subscription and bill for both.
  // Someone who already pays changes plan instead.
  if (isLiveSubscription(subscription)) {
    throw new AppError(
      "already_subscribed",
      "You already have a subscription, so switching plans changes it rather than starting another. Use the plan buttons on the Billing page, or Manage billing.",
      409
    );
  }
  const appUrl = `${env.siteUrl.replace(/\/$/, "")}/app.html`;

  const session = await stripe.createCheckoutSession({
    mode: "subscription",
    line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
    success_url: `${appUrl}#/billing?checkout=success`,
    cancel_url: `${appUrl}#/billing?checkout=cancelled`,
    client_reference_id: ctx.user.id,
    ...(subscription?.stripe_customer_id
      ? { customer: subscription.stripe_customer_id }
      : { customer_email: ctx.profile.email || ctx.user.email }),
    // The webhook reads these back — it is the only place the plan is
    // applied, and it must not have to guess who paid.
    subscription_data: { metadata: { user_id: ctx.user.id, plan_id: plan.id } },
    metadata: { user_id: ctx.user.id, plan_id: plan.id },
    ...taxParams({ enabled: env.stripeAutomaticTax, hasCustomer: Boolean(subscription?.stripe_customer_id) }),
  });

  return json({ url: session.url });
}

/**
 * Move someone who already pays to another plan, in place. Stripe prorates
 * the difference onto the next invoice. This changes only the Stripe
 * subscription; the plan and credits change when the webhook reports it,
 * like every other plan change, so nothing here can grant a plan by itself.
 */
async function changePlan(ctx, body) {
  if (!stripe.configured()) throw Errors.notConfigured("Billing");

  const planId = v.str(body.plan_id, "Plan", { max: 40, required: true });
  const plan = await dbAsService().selectOne("plans", { eq: { id: planId, is_active: true } });
  if (!plan) throw Errors.notFound("plan");
  if (plan.price_cents === 0) {
    throw Errors.invalid("To go back to the free plan, cancel your subscription from Manage billing.");
  }
  if (!plan.stripe_price_id) throw Errors.notConfigured(`The ${plan.name} plan's price`);

  const row = await ctx.db.selectOne("subscriptions", { eq: { user_id: ctx.user.id } });
  if (!isLiveSubscription(row)) throw Errors.invalid("You don't have an active subscription to change. Choose a plan to subscribe.");

  const subscription = await stripe.getSubscription(row.stripe_subscription_id);
  const items = subscription?.items?.data || [];
  // One item, which is what checkout creates. Anything else was set up by hand
  // in Stripe and is not this code's to rearrange.
  if (items.length !== 1) throw Errors.invalid("Your subscription has been set up in a way that can only be changed from Manage billing.");
  if (priceIds(subscription)[0] === plan.stripe_price_id) throw Errors.invalid(`You're already on the ${plan.name} plan.`);

  await stripe.changeSubscriptionPrice(subscription.id, items[0].id, plan.stripe_price_id, { user_id: ctx.user.id, plan_id: plan.id });
  return json({ requested: true, plan_id: plan.id });
}

async function openPortal(ctx) {
  if (!stripe.configured()) throw Errors.notConfigured("Billing");
  const subscription = await ctx.db.selectOne("subscriptions", { eq: { user_id: ctx.user.id } });
  if (!subscription?.stripe_customer_id) {
    throw Errors.invalid("There's no billing account to manage yet.");
  }
  const session = await stripe.createPortalSession({
    customer: subscription.stripe_customer_id,
    return_url: `${env.siteUrl.replace(/\/$/, "")}/app.html#/billing`,
  });
  return json({ url: session.url });
}

async function summary(ctx) {
  const [subscription, plans, usage] = await Promise.all([
    ctx.db.selectOne("subscriptions", { eq: { user_id: ctx.user.id } }),
    dbAsService().select("plans", { select: "*", eq: { is_active: true }, order: "sort_order" }),
    ctx.db.select("ai_usage", {
      select: "operation,credits_used,created_at",
      eq: { user_id: ctx.user.id },
      order: "created_at.desc",
      limit: 50,
    }),
  ]);
  return json({
    subscription,
    plans,
    credits: ctx.profile.ai_credits,
    planId: ctx.profile.plan_id,
    recentUsage: usage,
    billingAvailable: stripe.configured(),
  });
}

export default withGuards(async (req) => {
  const [action] = pathSegments(req, PREFIX);
  const ctx = await authenticate(req);
  memoryLimit(`billing:${ctx.user.id}`, 30, 60_000);

  if (req.method === "GET" && (action === "summary" || !action)) return summary(ctx);
  if (req.method === "POST" && action === "checkout") return startCheckout(ctx, await readJson(req));
  if (req.method === "POST" && action === "portal") return openPortal(ctx);
  if (req.method === "POST" && action === "change-plan") return changePlan(ctx, await readJson(req));

  throw Errors.notFound("endpoint");
});

export const config = { path: "/api/bp-billing/*" };
