// Admin dashboard (spec §31).
//
// Reachable only when the caller's own profile row says role = 'admin'.
// The server re-checks that on every request with the caller's own JWT —
// hiding the nav link is a convenience, not the control.

import { html, raw, $, setBusy } from "../core/dom.js";
import { API } from "../core/api.js";
import { notify, confirmDialog, openModal } from "../core/toast.js";
import { pageHead, fmt, loading, errorBox } from "./shared.js";

let tab = "overview";

export async function render(container) {
  container.innerHTML = html`
    ${raw(pageHead({
      title: "Admin",
      description: "Usage, plans, credit costs, prompts and feature flags.",
    }))}
    <div class="bp-tabs" style="margin-bottom:var(--bp-6)">
      <button type="button" class="bp-tab" data-tab="overview">Overview</button>
      <button type="button" class="bp-tab" data-tab="users">Users</button>
      <button type="button" class="bp-tab" data-tab="plans">Plans &amp; credits</button>
      <button type="button" class="bp-tab" data-tab="prompts">AI prompts</button>
      <button type="button" class="bp-tab" data-tab="flags">Flags &amp; settings</button>
    </div>
    <div id="admin-body">${raw(loading(3))}</div>
  `;

  const paint = async () => {
    container.querySelectorAll(".bp-tab").forEach((button) => {
      button.classList.toggle("bp-tab--active", button.dataset.tab === tab);
    });
    const body = $("#admin-body");
    body.innerHTML = loading(3);
    try {
      if (tab === "overview") await renderOverview(body);
      else if (tab === "users") await renderUsers(body);
      else if (tab === "plans") await renderPlans(body);
      else if (tab === "prompts") await renderPrompts(body, paint);
      else await renderFlags(body);
    } catch (err) {
      body.innerHTML = errorBox(err.message);
    }
  };

  container.querySelectorAll(".bp-tab").forEach((button) => {
    button.addEventListener("click", () => {
      tab = button.dataset.tab;
      paint();
    });
  });

  await paint();
}

async function renderOverview(body) {
  const { stats } = await API.adminOverview();
  const stat = (label, value, meta = "") => html`
    <div class="bp-stat">
      <div class="bp-stat__label">${label}</div>
      <div class="bp-stat__value">${value}</div>
      ${meta ? raw(html`<div class="bp-stat__meta">${meta}</div>`) : ""}
    </div>`;

  body.innerHTML = html`
    <div class="bp-stack-lg">
      <section>
        <h2 style="font-size:1.05rem;margin-bottom:var(--bp-3)">Accounts</h2>
        <div class="bp-stat-grid">
          ${raw(stat("Total users", fmt.number(stats.total_users)))}
          ${raw(stat("New (30 days)", fmt.number(stats.new_users_30d)))}
          ${raw(stat("Active (30 days)", fmt.number(stats.active_users_30d), "used AI at least once"))}
          ${raw(stat("Paying", fmt.number(stats.paying_users)))}
          ${raw(stat("MRR", fmt.money(stats.mrr_cents)))}
        </div>
      </section>

      <section>
        <h2 style="font-size:1.05rem;margin-bottom:var(--bp-3)">AI usage</h2>
        <div class="bp-stat-grid">
          ${raw(stat("Credits (30 days)", fmt.number(stats.credits_30d)))}
          ${raw(stat("Generations (30 days)", fmt.number(stats.ai_calls_30d)))}
          ${raw(stat("Failures (30 days)", fmt.number(stats.ai_failures_30d), "refunded automatically"))}
        </div>
      </section>

      <section>
        <h2 style="font-size:1.05rem;margin-bottom:var(--bp-3)">Product</h2>
        <div class="bp-stat-grid">
          ${raw(stat("Books", fmt.number(stats.books)))}
          ${raw(stat("Campaigns", fmt.number(stats.campaigns)))}
          ${raw(stat("Live campaigns", fmt.number(stats.live_campaigns)))}
          ${raw(stat("Ad spend tracked", fmt.money(stats.ad_spend_cents), "excludes demo data"))}
          ${raw(stat("Conversion events", fmt.number(stats.conversion_events)))}
        </div>
      </section>
    </div>
  `;
}

async function renderUsers(body) {
  const { users } = await API.adminUsers();
  body.innerHTML = html`
    <div class="bp-card bp-card--flush">
      <div class="bp-table-wrap">
        <table class="bp-table">
          <thead><tr><th>Name</th><th>Email</th><th>Country</th><th>Plan</th>
          <th class="bp-num">Credits</th><th>Role</th><th>Joined</th><th>Onboarded</th></tr></thead>
          <tbody>
            ${raw(users.map((user) => html`<tr>
              <td>${user.full_name || "—"}</td>
              <td class="bp-small bp-muted">${user.email || "—"}</td>
              <td class="bp-small">${user.country || "—"}</td>
              <td>${fmt.titleCase(user.plan_id)}</td>
              <td class="bp-num">${fmt.number(user.ai_credits)}</td>
              <td>${user.role === "admin" ? raw('<span class="bp-badge bp-badge--primary">Admin</span>') : "User"}</td>
              <td class="bp-small bp-muted bp-nowrap">${fmt.date(user.created_at)}</td>
              <td class="bp-small">${user.onboarding_step >= 6 ? "Yes" : `Step ${user.onboarding_step}`}</td>
            </tr>`).join(""))}
          </tbody>
        </table>
      </div>
    </div>
    <p class="bp-tiny bp-subtle" style="margin-top:var(--bp-3)">
      Newest 50 accounts. This list intentionally shows no book content — support does not need to
      read someone's manuscript to help them.
    </p>
  `;
}

const CHECK_LABEL = { ok: "OK", warn: "Check", fail: "Fix", info: "Note" };
const CHECK_TONE = { ok: "success", warn: "warning", fail: "danger", info: "" };

function billingCheckResult(result) {
  return html`
    <p class="bp-small" style="margin:0 0 var(--bp-3)">
      ${result.ready
        ? raw("<strong>Ready to take payments.</strong>")
        : raw("<strong>Not ready yet.</strong>")}
      ${result.mode ? ` Stripe key mode: ${result.mode}.` : ""}
    </p>
    <ul style="list-style:none;margin:0;padding:0;display:grid;gap:var(--bp-3)">
      ${raw(result.checks.map((c) => html`
        <li class="bp-row" style="align-items:flex-start;gap:var(--bp-3)">
          <span class="bp-badge ${CHECK_TONE[c.status] ? `bp-badge--${CHECK_TONE[c.status]}` : ""}" style="flex:none;min-width:3.4em;justify-content:center">${CHECK_LABEL[c.status]}</span>
          <div class="bp-small"><strong>${c.label}.</strong> ${c.detail}</div>
        </li>`).join(""))}
    </ul>`;
}

async function renderPlans(body) {
  const { plans, creditCosts } = await API.adminSettings();

  body.innerHTML = html`
    <div class="bp-stack-lg">
      <section>
        <h2 style="font-size:1.05rem;margin-bottom:var(--bp-3)">Billing setup</h2>
        <div class="bp-card">
          <p class="bp-small bp-muted" style="margin:0 0 var(--bp-3)">
            Asks Stripe, with the key this site is using, whether payments will work: the keys, the
            webhook, each plan's price and the billing portal. It changes nothing.
          </p>
          <div class="bp-row bp-row--wrap">
            <button type="button" class="bp-btn bp-btn--primary bp-btn--sm" id="billing-check">Check billing setup</button>
            <button type="button" class="bp-btn bp-btn--secondary bp-btn--sm" id="billing-create" hidden>Create missing prices in Stripe</button>
          </div>
          <div id="billing-check-result" role="status" aria-live="polite" style="margin-top:var(--bp-4)"></div>
        </div>
      </section>

      <section>
        <h2 style="font-size:1.05rem;margin-bottom:var(--bp-3)">Plans</h2>
        <div class="bp-card bp-card--flush">
          <div class="bp-table-wrap">
            <table class="bp-table">
              <thead><tr><th>Plan</th><th class="bp-num">Price</th><th class="bp-num">Books</th>
              <th class="bp-num">Creatives/mo</th><th class="bp-num">Credits/mo</th><th>Stripe price</th><th></th></tr></thead>
              <tbody>
                ${raw(plans.map((plan) => html`<tr data-plan-row="${plan.id}">
                  <td><strong>${plan.name}</strong></td>
                  <td class="bp-num"><input class="bp-input bp-num" style="width:96px" type="number" min="0" step="1" data-field="price_cents" value="${plan.price_cents}"></td>
                  <td class="bp-num"><input class="bp-input bp-num" style="width:76px" type="number" min="0" data-field="book_limit" value="${plan.book_limit ?? ""}" placeholder="∞"></td>
                  <td class="bp-num"><input class="bp-input bp-num" style="width:76px" type="number" min="0" data-field="creative_limit" value="${plan.creative_limit ?? ""}" placeholder="∞"></td>
                  <td class="bp-num"><input class="bp-input bp-num" style="width:86px" type="number" min="0" data-field="monthly_credits" value="${plan.monthly_credits}"></td>
                  <td><input class="bp-input" style="width:170px" data-field="stripe_price_id" value="${plan.stripe_price_id || ""}" placeholder="price_…"></td>
                  <td><button type="button" class="bp-btn bp-btn--secondary bp-btn--sm" data-save-plan="${plan.id}">Save</button></td>
                </tr>`).join(""))}
              </tbody>
            </table>
          </div>
        </div>
        <p class="bp-tiny bp-subtle" style="margin-top:var(--bp-3)">
          Price is in cents. Leave a limit blank for unlimited. A plan can't be bought until its
          Stripe price id is set.
        </p>
      </section>

      <section>
        <h2 style="font-size:1.05rem;margin-bottom:var(--bp-3)">Credit costs</h2>
        <div class="bp-card bp-card--flush">
          <div class="bp-table-wrap">
            <table class="bp-table">
              <thead><tr><th>Operation</th><th class="bp-num">Credits</th><th></th></tr></thead>
              <tbody>
                ${raw(creditCosts.map((cost) => html`<tr data-cost-row="${cost.operation}">
                  <td>${cost.label}<div class="bp-tiny bp-subtle">${cost.operation}</div></td>
                  <td class="bp-num"><input class="bp-input bp-num" style="width:76px" type="number" min="0" max="1000" data-field="credits" value="${cost.credits}"></td>
                  <td><button type="button" class="bp-btn bp-btn--secondary bp-btn--sm" data-save-cost="${cost.operation}">Save</button></td>
                </tr>`).join(""))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  `;

  const checkButton = body.querySelector("#billing-check");
  const createButton = body.querySelector("#billing-create");
  const resultBox = body.querySelector("#billing-check-result");
  let lastMode = null;

  checkButton.addEventListener("click", async () => {
    setBusy(checkButton, true, "Checking");
    resultBox.innerHTML = "";
    try {
      const result = await API.adminBillingCheck();
      lastMode = result.mode;
      resultBox.innerHTML = billingCheckResult(result);
      // Offered only when a plan is missing its price, which is what it fixes.
      createButton.hidden = !result.checks.some((c) => c.id.startsWith("price:") && c.status === "fail" && /No Stripe price id/.test(c.detail));
    } catch (err) {
      notify.error(err.message);
    }
    setBusy(checkButton, false);
  });

  createButton.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Create prices in Stripe?",
      message: `This creates a monthly price, with its product, in your ${lastMode || "Stripe"}${lastMode ? "-mode" : ""} account for every paid plan that has none, using the plan's price and currency, and saves the ids. ${lastMode === "live" ? "This is your live account. " : ""}Prices made earlier are found and reused, not duplicated.`,
      confirmLabel: "Create prices",
    });
    if (!ok) return;
    setBusy(createButton, true, "Creating");
    try {
      const { results } = await API.adminCreatePrices();
      const summary = results.map((r) => `${r.plan}: ${r.detail}`).join(" ");
      if (results.every((r) => r.status === "created" || r.status === "linked")) notify.success(summary || "Nothing to create.");
      else notify.error(summary);
      renderPlans(body);
    } catch (err) {
      notify.error(err.message);
    }
    setBusy(createButton, false);
  });

  body.querySelectorAll("[data-save-plan]").forEach((button) => {
    button.addEventListener("click", async () => {
      const row = button.closest("[data-plan-row]");
      const read = (field) => row.querySelector(`[data-field="${field}"]`).value;
      const patch = {
        price_cents: Number(read("price_cents")),
        monthly_credits: Number(read("monthly_credits")),
        book_limit: read("book_limit") === "" ? null : Number(read("book_limit")),
        creative_limit: read("creative_limit") === "" ? null : Number(read("creative_limit")),
        stripe_price_id: read("stripe_price_id") || null,
      };
      setBusy(button, true, "Saving");
      try {
        await API.adminUpdatePlan(button.dataset.savePlan, patch);
        notify.success("Plan updated.");
      } catch (err) {
        notify.error(err.message);
      }
      setBusy(button, false);
    });
  });

  body.querySelectorAll("[data-save-cost]").forEach((button) => {
    button.addEventListener("click", async () => {
      const row = button.closest("[data-cost-row]");
      setBusy(button, true, "Saving");
      try {
        await API.adminUpdateCost(button.dataset.saveCost, Number(row.querySelector('[data-field="credits"]').value));
        notify.success("Credit cost updated.");
      } catch (err) {
        notify.error(err.message);
      }
      setBusy(button, false);
    });
  });
}

async function renderPrompts(body, repaint) {
  const { prompts } = await API.adminPrompts();
  const anyOverridden = prompts.some((p) => p.overridden);

  body.innerHTML = html`
    <div class="bp-stack">
      <div class="bp-alert bp-alert--info">
        <span class="bp-alert__icon">◆</span>
        <div class="bp-small">
          Prompts ship with the code so a change to what the AI is told shows up in a code review.
          Publishing the defaults copies them into the database, after which edits here take effect
          without a deploy. Every prompt inherits the same advertising-content rules — no invented
          reviews, awards or sales figures, no guaranteed outcomes, no targeting on protected
          characteristics — and those rules are not editable from this screen.
        </div>
      </div>

      ${raw(anyOverridden ? "" : `
        <button type="button" class="bp-btn bp-btn--primary bp-btn--sm" id="publish-defaults" style="align-self:flex-start">
          Publish defaults to the editable registry
        </button>`)}

      <div class="bp-card bp-card--flush">
        <div class="bp-table-wrap">
          <table class="bp-table">
            <thead><tr><th>Prompt</th><th>Model</th><th>Effort</th><th class="bp-num">Max tokens</th><th>Source</th><th></th></tr></thead>
            <tbody>
              ${raw(prompts.map((prompt) => html`<tr>
                <td><strong>${prompt.label}</strong><div class="bp-tiny bp-subtle">${prompt.key}</div></td>
                <td class="bp-small">${prompt.stored?.model || prompt.model}</td>
                <td class="bp-small">${prompt.stored?.effort || prompt.effort}</td>
                <td class="bp-num">${prompt.stored?.max_tokens || prompt.max_tokens}</td>
                <td>${prompt.overridden
                  ? raw('<span class="bp-badge bp-badge--warning">Database override</span>')
                  : raw('<span class="bp-badge">Bundled default</span>')}</td>
                <td><button type="button" class="bp-btn bp-btn--secondary bp-btn--sm" data-view="${prompt.key}">View</button></td>
              </tr>`).join(""))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  $("#publish-defaults")?.addEventListener("click", async (event) => {
    const confirmed = await confirmDialog({
      title: "Publish default prompts?",
      message:
        "This copies every bundled prompt into the database so they can be edited here. Afterwards, the database version is what runs.",
      confirmLabel: "Publish",
    });
    if (!confirmed) return;
    setBusy(event.currentTarget, true, "Publishing…");
    try {
      await API.adminPublishPrompts();
      notify.success("Defaults published.");
      repaint();
    } catch (err) {
      notify.error(err.message);
      setBusy(event.currentTarget, false);
    }
  });

  body.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      const prompt = prompts.find((p) => p.key === button.dataset.view);
      const stored = prompt.stored || prompt;
      const { root, close } = openModal(html`
        <div class="bp-modal__header"><h3>${prompt.label}</h3></div>
        <div class="bp-field">
          <label class="bp-label" for="p-system">System prompt</label>
          <textarea class="bp-textarea" id="p-system" rows="12" ${prompt.overridden ? "" : "readonly"}>${stored.system_prompt}</textarea>
        </div>
        <div class="bp-field">
          <label class="bp-label" for="p-user">User template</label>
          <textarea class="bp-textarea" id="p-user" rows="8" ${prompt.overridden ? "" : "readonly"}>${stored.user_template}</textarea>
        </div>
        <div class="bp-field-row">
          <div class="bp-field">
            <label class="bp-label" for="p-model">Model</label>
            <select class="bp-select" id="p-model" ${prompt.overridden ? "" : "disabled"}>
              ${raw(["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"].map((m) => html`<option value="${m}">${m}</option>`).join(""))}
            </select>
          </div>
          <div class="bp-field">
            <label class="bp-label" for="p-effort">Effort</label>
            <select class="bp-select" id="p-effort" ${prompt.overridden ? "" : "disabled"}>
              ${raw(["low", "medium", "high", "xhigh", "max"].map((e) => html`<option value="${e}">${e}</option>`).join(""))}
            </select>
          </div>
          <div class="bp-field">
            <label class="bp-label" for="p-tokens">Max tokens</label>
            <input class="bp-input" id="p-tokens" type="number" min="512" max="16000" value="${stored.max_tokens}" ${prompt.overridden ? "" : "disabled"}>
          </div>
        </div>
        ${prompt.overridden ? "" : `
          <p class="bp-small bp-muted">
            Read-only: this prompt is running from the bundled default. Publish the defaults first to
            make it editable.
          </p>`}
        <div class="bp-modal__footer">
          <button type="button" class="bp-btn bp-btn--ghost" data-close>Close</button>
          ${prompt.overridden ? '<button type="button" class="bp-btn bp-btn--primary" id="save-prompt">Save</button>' : ""}
        </div>
      `, { wide: true });

      root.querySelector("#p-model").value = stored.model;
      root.querySelector("#p-effort").value = stored.effort;

      root.querySelector("#save-prompt")?.addEventListener("click", async (event) => {
        setBusy(event.currentTarget, true, "Saving…");
        try {
          await API.adminUpdatePrompt(prompt.key, {
            system_prompt: root.querySelector("#p-system").value,
            user_template: root.querySelector("#p-user").value,
            model: root.querySelector("#p-model").value,
            effort: root.querySelector("#p-effort").value,
            max_tokens: Number(root.querySelector("#p-tokens").value),
          });
          notify.success("Prompt saved.");
          close();
          repaint();
        } catch (err) {
          notify.error(err.message);
          setBusy(event.currentTarget, false);
        }
      });
    });
  });
}

async function renderFlags(body) {
  const { flags, settings } = await API.adminSettings();

  body.innerHTML = html`
    <div class="bp-stack-lg">
      <section>
        <h2 style="font-size:1.05rem;margin-bottom:var(--bp-3)">Feature flags</h2>
        <div class="bp-stack-sm">
          ${raw(flags.map((flag) => html`
            <label class="bp-checkbox ${flag.enabled ? "bp-checkbox--selected" : ""}">
              <input type="checkbox" data-flag="${flag.key}" ${flag.enabled ? "checked" : ""}>
              <span><strong class="bp-small">${fmt.titleCase(flag.key)}</strong><br>
              <span class="bp-small bp-muted">${flag.description || ""}</span></span>
            </label>`).join(""))}
        </div>
        <p class="bp-tiny bp-subtle" style="margin-top:var(--bp-3)">
          A flag only enables a feature whose credentials are configured on the server. Turning one on
          without them leaves the UI showing "Connect integration" rather than a control that fails.
        </p>
      </section>

      <section>
        <h2 style="font-size:1.05rem;margin-bottom:var(--bp-3)">System settings</h2>
        <div class="bp-card bp-card--flush">
          <div class="bp-table-wrap">
            <table class="bp-table">
              <thead><tr><th>Key</th><th>Value</th><th></th></tr></thead>
              <tbody>
                ${raw(settings.map((setting) => html`<tr data-setting-row="${setting.key}">
                  <td><code class="bp-mono">${setting.key}</code></td>
                  <td><input class="bp-input" data-field="value" value="${JSON.stringify(setting.value)}"></td>
                  <td><button type="button" class="bp-btn bp-btn--secondary bp-btn--sm" data-save-setting="${setting.key}">Save</button></td>
                </tr>`).join(""))}
              </tbody>
            </table>
          </div>
        </div>
        <p class="bp-tiny bp-subtle" style="margin-top:var(--bp-3)">
          Values are JSON. <code class="bp-mono">ai_model</code> only accepts a model the server
          allows; anything else falls back to the default rather than failing every generation.
        </p>
      </section>
    </div>
  `;

  body.querySelectorAll("[data-flag]").forEach((input) => {
    input.addEventListener("change", async () => {
      try {
        await API.adminUpdateFlag(input.dataset.flag, input.checked);
        input.closest("label").classList.toggle("bp-checkbox--selected", input.checked);
        notify.success("Flag updated.");
      } catch (err) {
        input.checked = !input.checked;
        notify.error(err.message);
      }
    });
  });

  body.querySelectorAll("[data-save-setting]").forEach((button) => {
    button.addEventListener("click", async () => {
      const row = button.closest("[data-setting-row]");
      const text = row.querySelector('[data-field="value"]').value;
      let value;
      try {
        value = JSON.parse(text);
      } catch {
        notify.error("That isn't valid JSON. Strings need quotes around them.");
        return;
      }
      setBusy(button, true, "Saving");
      try {
        await API.adminUpdateSetting(button.dataset.saveSetting, value);
        notify.success("Setting saved.");
      } catch (err) {
        notify.error(err.message);
      }
      setBusy(button, false);
    });
  });
}
