// Billing, plans and AI credits (spec §29, §30).

import { html, raw, $, setBusy } from "../core/dom.js";
import { API, isDemo } from "../core/api.js";
import * as store from "../core/store.js";
import { notify, confirmDialog } from "../core/toast.js";
import { pageHead, fmt, demoBadge } from "./shared.js";

const OPERATION_LABELS = {
  book_analysis: "Book analysis",
  reader_personas: "Reader personas",
  marketing_angles: "Marketing angles",
  ad_copy: "Ad copy",
  creative_concept: "Creative concept",
  creative_image: "Image creative",
  creative_image_advanced: "Advanced image creative",
  video_concept: "Video concept / script",
  video_generation: "Video generation",
  creative_scoring: "Creative scoring",
  advisor_message: "AI Advisor message",
  performance_analysis: "Campaign analysis",
  budget_recommendation: "Budget recommendation",
};

export async function render(container, params, query) {
  const [billing, config] = await Promise.all([
    API.billing(),
    API.config().catch(() => ({ creditCosts: {} })),
  ]);

  const checkout = query?.get("checkout") || new URLSearchParams(location.search).get("checkout");
  if (checkout === "success") notify.success("Payment received — your plan is updated.");
  if (checkout === "cancelled") notify.info("Checkout cancelled. Nothing was charged.");

  const profile = store.get("profile");
  const currentPlan = billing.plans.find((p) => p.id === billing.planId);
  const costs = config.creditCosts || {};

  container.innerHTML = html`
    ${raw(pageHead({
      title: "Billing & credits",
      description: "Your plan, what's left this month, and where it went.",
      actions: demoBadge(),
    }))}

    <div class="bp-stack-lg">
      <section class="bp-grid bp-grid--2">
        <div class="bp-card">
          <div class="bp-card__header">
            <div class="bp-card__title">Current plan</div>
            <span class="bp-badge bp-badge--primary">${currentPlan?.name || "Free"}</span>
          </div>
          <dl class="bp-kv">
            <dt>Price</dt><dd>${currentPlan ? fmt.money(currentPlan.price_cents, currentPlan.currency) : "€0.00"} per month</dd>
            <dt>Books</dt><dd>${currentPlan?.book_limit === null ? "Unlimited" : fmt.number(currentPlan?.book_limit ?? 1)}</dd>
            <dt>Credits</dt><dd>${fmt.number(currentPlan?.monthly_credits ?? 0)} per month</dd>
            <dt>Status</dt><dd>${billing.subscription?.status ? fmt.titleCase(billing.subscription.status) : "Free plan"}</dd>
            ${billing.subscription?.current_period_end
              ? raw(html`<dt>Renews</dt><dd>${fmt.date(billing.subscription.current_period_end)}</dd>`)
              : ""}
          </dl>
          ${raw(billing.billingAvailable && billing.subscription?.stripe_customer_id
            ? '<button type="button" class="bp-btn bp-btn--secondary bp-btn--sm" style="margin-top:var(--bp-4)" id="portal-btn">Manage billing</button>'
            : "")}
        </div>

        <div class="bp-card">
          <div class="bp-card__header"><div class="bp-card__title">AI credits</div></div>
          <div class="bp-stat__value" style="font-size:2.2rem">${fmt.number(profile?.ai_credits ?? billing.credits)}</div>
          <p class="bp-small bp-muted">remaining this month</p>
          <div class="bp-progress" style="margin-top:var(--bp-3)">
            <div class="bp-progress__bar" style="width:${currentPlan?.monthly_credits
              ? Math.min(100, Math.round(((profile?.ai_credits ?? 0) / currentPlan.monthly_credits) * 100))
              : 0}%"></div>
          </div>
          <details style="margin-top:var(--bp-4)">
            <summary class="bp-small" style="cursor:pointer">What each operation costs</summary>
            <dl class="bp-kv bp-small" style="margin-top:var(--bp-3)">
              ${raw(Object.entries(costs).map(([operation, credits]) => html`
                <dt>${OPERATION_LABELS[operation] || fmt.titleCase(operation)}</dt>
                <dd>${credits} ${credits === 1 ? "credit" : "credits"}</dd>`).join(""))}
            </dl>
          </details>
        </div>
      </section>

      <section>
        <h2 style="font-size:1.05rem;margin-bottom:var(--bp-3)">Plans</h2>
        ${raw(!billing.billingAvailable ? `
          <div class="bp-alert bp-alert--info" style="margin-bottom:var(--bp-4)">
            <span class="bp-alert__icon">◆</span>
            <div class="bp-small">
              ${isDemo()
                ? "Checkout is switched off in the demo workspace — no card, nothing to cancel."
                : "Payments aren't configured on this deployment yet, so upgrading isn't available. The plans below are what will be offered."}
            </div>
          </div>` : "")}
        <div class="bp-pricing">
          ${raw(billing.plans.map((plan) => planCard(plan, billing, currentPlan)).join(""))}
        </div>
        <p class="bp-tiny bp-subtle" style="margin-top:var(--bp-4)">
          Prices exclude VAT. Your advertising budget is separate and is paid to the ad platform, not
          to BookPilot.
        </p>
      </section>

      ${raw(billing.recentUsage?.length ? html`
        <section>
          <h2 style="font-size:1.05rem;margin-bottom:var(--bp-3)">Recent AI usage</h2>
          <div class="bp-card bp-card--flush">
            <div class="bp-table-wrap">
              <table class="bp-table">
                <thead><tr><th>Operation</th><th class="bp-num">Credits</th><th>When</th></tr></thead>
                <tbody>
                  ${raw(billing.recentUsage.slice(0, 25).map((row) => html`<tr>
                    <td>${OPERATION_LABELS[row.operation] || fmt.titleCase(row.operation)}</td>
                    <td class="bp-num">${row.credits_used}</td>
                    <td class="bp-small bp-muted">${fmt.relativeTime(row.created_at)}</td>
                  </tr>`).join(""))}
                </tbody>
              </table>
            </div>
          </div>
        </section>` : "")}
    </div>
  `;

  $("#portal-btn")?.addEventListener("click", async (event) => {
    setBusy(event.currentTarget, true, "Opening…");
    try {
      const { url } = await API.portal();
      location.href = url;
    } catch (err) {
      notify.error(err.message);
      setBusy(event.currentTarget, false);
    }
  });

  container.querySelectorAll("[data-plan]").forEach((button) => {
    button.addEventListener("click", async () => {
      const plan = billing.plans.find((p) => p.id === button.dataset.plan);
      // Someone who already pays changes their subscription; sending them to
      // checkout again would start a second one and bill for both.
      const subscribed = ["active", "trialing"].includes(billing.subscription?.status) && billing.subscription?.stripe_subscription_id;
      if (subscribed) {
        const ok = await confirmDialog({
          title: `Switch to ${plan?.name || "this plan"}?`,
          message: `Your plan changes to ${plan?.name || "the new plan"} at ${plan ? fmt.money(plan.price_cents, plan.currency) : "its price"} a month. Stripe works out the difference for the rest of this billing period and adds or credits it on your next invoice.`,
          confirmLabel: "Switch plan",
        });
        if (!ok) return;
        setBusy(button, true, "Switching…");
        try {
          await API.changePlan(button.dataset.plan);
          notify.success("Plan change sent. Your plan updates in a moment.");
          // The plan itself is applied when Stripe confirms, a moment later.
          setTimeout(() => render(container, params, query), 3000);
        } catch (err) {
          notify.error(err.message);
          setBusy(button, false);
        }
        return;
      }
      setBusy(button, true, "Opening checkout…");
      try {
        const { url } = await API.checkout(button.dataset.plan);
        location.href = url;
      } catch (err) {
        notify.error(err.message);
        setBusy(button, false);
      }
    });
  });
}

function planCard(plan, billing, currentPlan) {
  const isCurrent = plan.id === billing.planId;
  const isUpgrade = (plan.price_cents || 0) > (currentPlan?.price_cents || 0);
  return html`
    <article class="bp-plan ${plan.id === "author" ? "bp-plan--featured" : ""}">
      <div class="bp-row bp-row--between">
        <div class="bp-plan__name">${plan.name}</div>
        ${isCurrent ? raw('<span class="bp-badge bp-badge--primary">Current</span>') : ""}
      </div>
      <div class="bp-plan__price">${fmt.money(plan.price_cents, plan.currency, { decimals: 0 })}</div>
      <div class="bp-plan__period">per month</div>
      <ul class="bp-plan__features">
        ${raw((plan.features || []).map((feature) => html`<li>${feature}</li>`).join(""))}
      </ul>
      ${raw(isCurrent
        ? '<button type="button" class="bp-btn bp-btn--secondary bp-btn--block" disabled>Your plan</button>'
        : billing.billingAvailable && plan.price_cents > 0
          ? html`<button type="button" class="bp-btn bp-btn--${isUpgrade ? "primary" : "secondary"} bp-btn--block" data-plan="${plan.id}">
              ${isUpgrade ? `Upgrade to ${plan.name}` : `Switch to ${plan.name}`}
            </button>`
          : '<button type="button" class="bp-btn bp-btn--secondary bp-btn--block" disabled>Unavailable</button>')}
    </article>
  `;
}
