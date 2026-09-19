// BookPilot AI — Stripe webhook.
//
//   /api/bp-stripe-webhook
//
// The only place a paid plan is granted. Requests are rejected unless
// they carry a valid Stripe signature, so the endpoint being public
// doesn't make plans free.
//
// Which plan a subscription is for is read from its price, not from the
// metadata set at checkout: a customer who switches plans changes the price,
// and metadata copied at checkout would still name the old plan. A
// subscription whose plan cannot be told is left alone and logged, never
// guessed at.

import { json } from "./bookpilot-lib/http.js";
import { dbAsService } from "./bookpilot-lib/db.js";
import * as stripe from "./bookpilot-lib/stripe.js";
import * as audit from "./bookpilot-lib/audit.js";
import { planForSubscription, periodEnd, invoiceMetadata, customerId } from "./bookpilot-lib/billing-rules.js";

async function applyPlan(userId, planId, subscription) {
  const service = dbAsService();
  await service.upsert(
    "subscriptions",
    {
      user_id: userId,
      plan_id: planId,
      status: subscription?.status || "active",
      stripe_customer_id: customerId(subscription),
      stripe_subscription_id: subscription?.id || null,
      current_period_end: periodEnd(subscription),
      cancel_at_period_end: Boolean(subscription?.cancel_at_period_end),
    },
    { onConflict: "user_id", returning: false }
  );
  await service.rpc("bp_apply_plan", { p_user: userId, p_plan: planId });
  await service.insert(
    "notifications",
    {
      user_id: userId,
      type: "billing",
      title: "Subscription updated",
      message: `Your plan is now ${planId.replace("_", " ")}.`,
      link: "#/billing",
    },
    { returning: false }
  );
  await audit.record(userId, "billing.plan_applied", { entity: "subscription", detail: { planId } });
}

async function downgrade(userId, reason) {
  const service = dbAsService();
  await service.update("subscriptions", { status: reason }, { eq: { user_id: userId } });
  await service.rpc("bp_apply_plan", { p_user: userId, p_plan: "free" });
  await service.insert(
    "notifications",
    {
      user_id: userId,
      type: "payment_issue",
      title: reason === "past_due" ? "Payment issue" : "Subscription ended",
      message:
        reason === "past_due"
          ? "We couldn't take your last payment. Update your card to keep your plan."
          : "Your subscription has ended and your account is back on the Free plan.",
      link: "#/billing",
    },
    { returning: false }
  );
  await audit.record(userId, "billing.downgraded", { detail: { reason } });
}

/**
 * Whose event this is. Checkout sets the user on the subscription and the
 * session, but a subscription made or changed elsewhere (the Stripe
 * dashboard, the billing portal) may not carry it, so fall back to the
 * customer we stored when they first paid.
 */
async function userFor(object, metadata = object.metadata) {
  const direct = metadata?.user_id || object.client_reference_id;
  if (direct) return direct;
  const customer = customerId(object);
  if (!customer) return null;
  const row = await dbAsService().selectOne("subscriptions", { eq: { stripe_customer_id: customer } });
  return row?.user_id || null;
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: { message: "Method not allowed" } }, 405);

  const raw = await req.text();
  const signature = req.headers.get("stripe-signature");

  let valid = false;
  try {
    valid = await stripe.verifyWebhook(raw, signature);
  } catch (err) {
    console.error("[bookpilot] webhook not configured:", err.message);
    return json({ error: { message: "Not configured" } }, 501);
  }
  if (!valid) {
    console.warn("[bookpilot] rejected Stripe webhook with bad signature");
    return json({ error: { message: "Invalid signature" } }, 400);
  }

  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return json({ error: { message: "Invalid payload" } }, 400);
  }

  try {
    const object = event.data?.object || {};

    switch (event.type) {
      case "checkout.session.completed": {
        // Only subscriptions: a one-off payment made through the same Stripe
        // account is none of this product's business.
        if (object.mode && object.mode !== "subscription") break;
        const userId = await userFor(object);
        if (!userId) break;
        const subscription = object.subscription ? await stripe.getSubscription(object.subscription) : null;
        const plans = await dbAsService().select("plans", { select: "id,stripe_price_id" });
        const planId = planForSubscription(subscription || {}, plans)
          || (plans.some((p) => p.id === object.metadata?.plan_id) ? object.metadata.plan_id : null);
        if (!planId) {
          console.warn("[bookpilot] checkout completed but its plan could not be told; left unchanged");
          break;
        }
        await applyPlan(userId, planId, { ...subscription, customer: object.customer });
        break;
      }
      case "customer.subscription.updated": {
        const userId = await userFor(object);
        if (!userId) break;
        if (object.status === "active" || object.status === "trialing") {
          const plans = await dbAsService().select("plans", { select: "id,stripe_price_id" });
          const planId = planForSubscription(object, plans);
          if (!planId) {
            console.warn("[bookpilot] subscription updated but its plan could not be told; left unchanged");
            break;
          }
          await applyPlan(userId, planId, object);
        } else if (object.status === "past_due" || object.status === "unpaid") {
          await downgrade(userId, "past_due");
        }
        break;
      }
      case "customer.subscription.deleted": {
        const userId = await userFor(object);
        if (userId) await downgrade(userId, "cancelled");
        break;
      }
      case "invoice.payment_failed": {
        const userId = await userFor(object, invoiceMetadata(object));
        if (userId) await downgrade(userId, "past_due");
        break;
      }
      default:
        break;
    }
  } catch (err) {
    // Returning 500 makes Stripe retry, which is what we want for a
    // transient database failure.
    console.error("[bookpilot] webhook handling failed:", event.type, err);
    return json({ received: false }, 500);
  }

  return json({ received: true });
};

export const config = { path: "/api/bp-stripe-webhook" };
