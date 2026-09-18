// Campaign library, the ten-step builder, and campaign detail
// (spec §15, §16, §26).
//
// The rule the whole flow is built around: creating a campaign never
// spends money. Everything is created as a draft, pushed to Meta paused,
// and only starts delivering after an explicit, separately confirmed
// launch.

import { html, raw, $, setBusy } from "../core/dom.js";
import { API, isDemo } from "../core/api.js";
import * as store from "../core/store.js";
import { notify, confirmDialog } from "../core/toast.js";
import { navigate } from "../core/router.js";
import { OBJECTIVES, DESTINATIONS, PLATFORMS } from "./options.js";
import {
  pageHead, emptyState, statusBadge, statGrid, fmt, demoBadge, loading,
  confidenceBadge, scoreBadge,
} from "./shared.js";

// ---------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------

export async function renderList(container) {
  const [{ campaigns }, { books }, analytics] = await Promise.all([
    API.campaigns(),
    API.books(),
    API.analytics(90).catch(() => ({ campaigns: [] })),
  ]);
  store.set({ campaigns, books });

  if (!campaigns.length) {
    container.innerHTML =
      pageHead({ title: "Campaigns", description: "Every campaign is a test of one idea about your reader." }) +
      emptyState({
        icon: "▶",
        title: "No campaigns",
        text: books.length
          ? "Your book is ready. Let's find your readers."
          : "Add a book first — a campaign needs something to sell.",
        action: books.length
          ? '<a class="bp-btn bp-btn--primary" href="#/campaigns/new">Create campaign</a>'
          : '<a class="bp-btn bp-btn--primary" href="#/books/new">Add a book</a>',
      });
    return;
  }

  const metricsFor = (id) => (analytics.campaigns || []).find((row) => row.campaign.id === id)?.metrics;
  const bookTitle = (id) => books.find((b) => b.id === id)?.title || "—";

  container.innerHTML = html`
    ${raw(pageHead({
      title: "Campaigns",
      description: "Status, spend and what came back.",
      actions: `${demoBadge()}<a class="bp-btn bp-btn--primary" href="#/campaigns/new">Create campaign</a>`,
    }))}
    <div class="bp-card bp-card--flush">
      <div class="bp-table-wrap">
        <table class="bp-table">
          <thead>
            <tr>
              <th>Campaign</th><th>Book</th><th>Platform</th><th>Status</th>
              <th class="bp-num">Budget</th><th class="bp-num">Spend</th>
              <th class="bp-num">Sales</th><th class="bp-num">Revenue</th>
              <th class="bp-num">ROAS</th><th>Created</th>
            </tr>
          </thead>
          <tbody>
            ${raw(campaigns.map((campaign) => {
              const m = metricsFor(campaign.id);
              return html`<tr>
                <td><a href="#/campaigns/${campaign.id}">${campaign.name}</a></td>
                <td class="bp-small bp-muted">${bookTitle(campaign.book_id)}</td>
                <td class="bp-small">${fmt.platformName(campaign.platform)}</td>
                <td>${raw(statusBadge(campaign.status))}</td>
                <td class="bp-num">${fmt.money(campaign.daily_budget_cents, campaign.currency)}</td>
                <td class="bp-num">${m?.hasData ? fmt.money(m.spendCents, campaign.currency) : "—"}</td>
                <td class="bp-num">${m?.hasData ? fmt.number(m.conversions) : "—"}</td>
                <td class="bp-num">${m?.hasData ? fmt.money(m.revenueCents, campaign.currency) : "—"}</td>
                <td class="bp-num">${m?.hasData ? fmt.multiple(m.roas) : "—"}</td>
                <td class="bp-small bp-muted bp-nowrap">${fmt.date(campaign.created_at)}</td>
              </tr>`;
            }).join(""))}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------

const STEPS = [
  "Book", "Audience", "Angles", "Creatives", "Platform",
  "Budget", "Duration", "Destination", "Review", "Launch",
];

export async function renderWizard(container, params, query) {
  const [{ books }, { integrations, capabilities }] = await Promise.all([
    API.books(),
    API.integrations().catch(() => ({ integrations: [], capabilities: {} })),
  ]);

  if (!books.length) {
    container.innerHTML =
      pageHead({ title: "New campaign" }) +
      emptyState({
        icon: "▤",
        title: "Add a book first",
        text: "A campaign advertises something.",
        action: '<a class="bp-btn bp-btn--primary" href="#/books/new">Add a book</a>',
      });
    return;
  }

  const profile = store.get("profile");
  const state = {
    step: 0,
    bookId: query?.get("book") || books[0].id,
    personaIds: [],
    angleIds: [],
    creativeIds: query?.get("creative") ? [query.get("creative")] : [],
    platform: "meta",
    objective: "conversions",
    dailyBudgetCents: profile?.daily_budget_cents || 1000,
    durationDays: 14,
    destinationType: "website",
    destinationUrl: "",
    name: "",
    strategy: null,
    creatives: [],
  };

  const metaConnected = integrations.some((i) => i.provider === "meta" && i.status === "connected");

  async function loadBookContext() {
    const [strategy, { creatives }] = await Promise.all([
      API.strategy(state.bookId),
      API.creatives(`?book_id=${encodeURIComponent(state.bookId)}`),
    ]);
    state.strategy = strategy;
    state.creatives = creatives;
    const book = books.find((b) => b.id === state.bookId);
    if (!state.destinationUrl) state.destinationUrl = book?.sales_url || "";
    if (!state.name) state.name = `${book?.title || "Campaign"} — test`;
  }

  function rail() {
    return `<div class="bp-wizard__rail">${STEPS.map((label, index) => {
      const cls = index === state.step ? "bp-wizard__step--active" : index < state.step ? "bp-wizard__step--done" : "";
      return html`<span class="bp-wizard__step ${cls}">${index + 1}. ${label}</span>`;
    }).join("")}</div>`;
  }

  function footer({ nextLabel = "Continue", nextDisabled = false, back = true } = {}) {
    return `<div class="bp-wizard__footer">
      ${back ? '<button type="button" class="bp-btn bp-btn--ghost" data-back>Back</button>' : "<span></span>"}
      <button type="button" class="bp-btn bp-btn--primary" data-next ${nextDisabled ? "disabled" : ""}>${nextLabel}</button>
    </div>`;
  }

  function wire(body) {
    body.querySelector("[data-back]")?.addEventListener("click", () => {
      state.step = Math.max(0, state.step - 1);
      paint();
    });
    body.querySelector("[data-next]")?.addEventListener("click", async () => {
      if (!(await validateStep())) return;
      state.step = Math.min(STEPS.length - 1, state.step + 1);
      paint();
    });
  }

  async function validateStep() {
    if (state.step === 0) {
      await loadBookContext();
      if (!state.strategy.personas.length) {
        notify.error("This book has no reader personas yet. Generate them in AI Strategy first.");
        return false;
      }
    }
    if (state.step === 1 && !state.personaIds.length) {
      notify.error("Choose at least one audience.");
      return false;
    }
    if (state.step === 3 && !state.creativeIds.length) {
      notify.error("Choose at least one creative to run.");
      return false;
    }
    if (state.step === 7 && !state.destinationUrl) {
      notify.error("Where should the ads send people?");
      return false;
    }
    return true;
  }

  async function paint() {
    container.innerHTML = html`
      ${raw(pageHead({
        title: "New campaign",
        description: "Ten steps. Nothing spends until the last one, and that step asks twice.",
        actions: demoBadge(),
      }))}
      <div class="bp-wizard">${raw(rail())}<div id="wizard-body">${raw(loading(2))}</div></div>
    `;
    const body = $("#wizard-body");
    if (!state.strategy && state.step > 0) await loadBookContext();

    switch (state.step) {
      case 0: stepBook(body); break;
      case 1: stepAudience(body); break;
      case 2: stepAngles(body); break;
      case 3: stepCreatives(body); break;
      case 4: stepPlatform(body); break;
      case 5: stepBudget(body); break;
      case 6: stepDuration(body); break;
      case 7: stepDestination(body); break;
      case 8: stepReview(body); break;
      default: stepLaunch(body); break;
    }
    wire(body);
  }

  // --- Steps ----------------------------------------------------------

  function stepBook(body) {
    body.innerHTML = html`
      <div class="bp-card">
        <div class="bp-field">
          <label class="bp-label" for="w-book">Which book are you promoting?</label>
          <select class="bp-select" id="w-book">
            ${raw(books.map((b) => html`<option value="${b.id}" ${b.id === state.bookId ? "selected" : ""}>${b.title}</option>`).join(""))}
          </select>
        </div>
        <div class="bp-field">
          <label class="bp-label" for="w-name">Campaign name</label>
          <input class="bp-input" id="w-name" value="${state.name}" placeholder="What is this campaign testing?">
          <div class="bp-hint">Name it after the idea you're testing — you'll thank yourself in a month.</div>
        </div>
      </div>
      ${raw(footer({ back: false }))}
    `;
    $("#w-book").addEventListener("change", (event) => {
      state.bookId = event.target.value;
      state.strategy = null;
      state.personaIds = [];
      state.angleIds = [];
      state.creativeIds = [];
      state.name = "";
      paint();
    });
    $("#w-name").addEventListener("input", (event) => { state.name = event.target.value; });
  }

  function stepAudience(body) {
    body.innerHTML = html`
      <div class="bp-stack">
        <p class="bp-muted">
          Each audience becomes its own ad set, with the budget split between them. Start with one or
          two — splitting a small budget four ways means none of them gathers enough data to judge.
        </p>
        <div class="bp-stack-sm">
          ${raw(state.strategy.personas.map((persona) => html`
            <label class="bp-checkbox ${state.personaIds.includes(persona.id) ? "bp-checkbox--selected" : ""}">
              <input type="checkbox" value="${persona.id}" data-persona ${state.personaIds.includes(persona.id) ? "checked" : ""}>
              <span>
                <strong>${persona.name}</strong>
                <span class="bp-small bp-subtle"> · ${persona.age_range || ""}</span><br>
                <span class="bp-small bp-muted">${persona.description || ""}</span>
              </span>
            </label>`).join(""))}
        </div>
      </div>
      ${raw(footer())}
    `;
    body.querySelectorAll("[data-persona]").forEach((input) => {
      input.addEventListener("change", () => {
        state.personaIds = [...body.querySelectorAll("[data-persona]:checked")].map((i) => i.value);
        input.closest("label").classList.toggle("bp-checkbox--selected", input.checked);
      });
    });
  }

  function stepAngles(body) {
    body.innerHTML = html`
      <div class="bp-stack">
        <p class="bp-muted">
          Optional, but it's what makes the results readable: tagging the angles you're testing is how
          the advisor can later tell you that emotional beat practical.
        </p>
        <div class="bp-stack-sm">
          ${raw(state.strategy.angles.map((angle) => html`
            <label class="bp-checkbox ${state.angleIds.includes(angle.id) ? "bp-checkbox--selected" : ""}">
              <input type="checkbox" value="${angle.id}" data-angle ${state.angleIds.includes(angle.id) ? "checked" : ""}>
              <span>
                <strong>${angle.name}</strong>
                <span class="bp-badge" style="margin-left:6px">${fmt.titleCase(angle.category)}</span><br>
                <span class="bp-small bp-muted">“${angle.hook || ""}”</span>
              </span>
            </label>`).join(""))}
        </div>
      </div>
      ${raw(footer())}
    `;
    body.querySelectorAll("[data-angle]").forEach((input) => {
      input.addEventListener("change", () => {
        state.angleIds = [...body.querySelectorAll("[data-angle]:checked")].map((i) => i.value);
        input.closest("label").classList.toggle("bp-checkbox--selected", input.checked);
      });
    });
  }

  function stepCreatives(body) {
    if (!state.creatives.length) {
      body.innerHTML = `
        ${emptyState({
          icon: "◐",
          title: "No creatives for this book yet",
          text: "A campaign needs at least one ad to run.",
          action: `<a class="bp-btn bp-btn--primary" href="#/creatives/new?book=${state.bookId}">Create ads</a>`,
        })}
        ${footer({ nextDisabled: true })}`;
      return;
    }
    body.innerHTML = html`
      <div class="bp-stack">
        <p class="bp-muted">
          Three to five creatives per audience is the sweet spot: enough variety to learn something,
          few enough that each gets real delivery.
        </p>
        <div class="bp-grid bp-grid--cards">
          ${raw(state.creatives.map((creative) => html`
            <label class="bp-card bp-card--flush bp-creative" style="cursor:pointer;${state.creativeIds.includes(creative.id) ? "border-color:var(--bp-primary)" : ""}">
              <div class="bp-creative__preview">
                <span class="bp-badge bp-badge--accent" style="align-self:flex-start">${fmt.titleCase(creative.format)}</span>
                <div class="bp-creative__headline">${creative.headline || "Untitled"}</div>
              </div>
              <div class="bp-creative__body">
                <div class="bp-row bp-row--between">
                  ${raw(scoreBadge(creative.score))}
                  <input type="checkbox" value="${creative.id}" data-creative ${state.creativeIds.includes(creative.id) ? "checked" : ""}>
                </div>
              </div>
            </label>`).join(""))}
        </div>
      </div>
      ${raw(footer())}
    `;
    body.querySelectorAll("[data-creative]").forEach((input) => {
      input.addEventListener("change", () => {
        state.creativeIds = [...body.querySelectorAll("[data-creative]:checked")].map((i) => i.value);
        input.closest("label").style.borderColor = input.checked ? "var(--bp-primary)" : "";
      });
    });
  }

  function stepPlatform(body) {
    body.innerHTML = html`
      <div class="bp-stack">
        <div class="bp-card">
          <div class="bp-field">
            <label class="bp-label">Where should these ads run?</label>
            <div class="bp-stack-sm">
              <label class="bp-radio bp-radio--selected">
                <input type="radio" name="platform" value="meta" checked>
                <span><strong>Meta — Facebook and Instagram</strong><br>
                <span class="bp-small bp-muted">The only platform BookPilot can create campaigns on today.</span></span>
              </label>
              ${raw(PLATFORMS.filter((p) => !["meta", "instagram", "facebook"].includes(p.value)).map((p) => html`
                <label class="bp-radio" style="opacity:0.6">
                  <input type="radio" name="platform" value="${p.value}" disabled>
                  <span><strong>${p.label}</strong>
                    <span class="bp-badge" style="margin-left:6px">Coming later</span><br>
                    <span class="bp-small bp-muted">Planned. Nothing here pretends it works yet.</span></span>
                </label>`).join(""))}
            </div>
          </div>
          <div class="bp-field">
            <label class="bp-label" for="w-objective">What should Meta optimise for?</label>
            <select class="bp-select" id="w-objective">
              ${raw(OBJECTIVES.map((o) => html`<option value="${o.value}" ${o.value === state.objective ? "selected" : ""}>${o.label} — ${o.hint}</option>`).join(""))}
            </select>
          </div>
        </div>
        ${raw(metaConnected || !capabilities.meta ? "" : `
          <div class="bp-alert bp-alert--info">
            <span class="bp-alert__icon">◆</span>
            <div>
              <div class="bp-alert__title">Your Meta account isn't connected yet</div>
              <div class="bp-small">You can build the whole campaign now and connect Meta before launching.</div>
              <a class="bp-btn bp-btn--secondary bp-btn--sm" style="margin-top:var(--bp-3)" href="#/attribution">Connect Meta</a>
            </div>
          </div>`)}
      </div>
      ${raw(footer())}
    `;
    $("#w-objective").addEventListener("change", (event) => { state.objective = event.target.value; });
  }

  function stepBudget(body) {
    const options = [500, 1000, 2000, 5000, 10000];
    body.innerHTML = html`
      <div class="bp-stack">
        <div class="bp-stack-sm">
          ${raw(options.map((cents) => html`
            <label class="bp-radio ${cents === state.dailyBudgetCents ? "bp-radio--selected" : ""}">
              <input type="radio" name="budget" value="${cents}" ${cents === state.dailyBudgetCents ? "checked" : ""}>
              <span><strong>${fmt.money(cents)} per day</strong>
              <span class="bp-small bp-muted"> · ${fmt.money(cents * 30)} a month</span></span>
            </label>`).join(""))}
          <label class="bp-radio">
            <input type="radio" name="budget" value="custom">
            <span class="bp-flex-1"><strong>Custom</strong>
              <input class="bp-input" style="margin-top:8px" id="w-custom-budget" type="number" min="1" step="0.5"
                value="${(state.dailyBudgetCents / 100).toFixed(2)}"></span>
          </label>
        </div>
        <div class="bp-alert bp-alert--info">
          <span class="bp-alert__icon">◆</span>
          <div class="bp-small">
            This is what Meta bills you, not BookPilot. Split across ${state.personaIds.length || 1}
            ${state.personaIds.length === 1 ? "audience" : "audiences"}, that's about
            ${fmt.money(Math.floor(state.dailyBudgetCents / Math.max(state.personaIds.length, 1)))} each per day.
          </div>
        </div>
      </div>
      ${raw(footer())}
    `;
    body.querySelectorAll('input[name="budget"]').forEach((input) => {
      input.addEventListener("change", () => {
        state.dailyBudgetCents = input.value === "custom"
          ? Math.round(Number($("#w-custom-budget").value || 10) * 100)
          : Number(input.value);
      });
    });
    $("#w-custom-budget").addEventListener("input", (event) => {
      const custom = body.querySelector('input[value="custom"]');
      custom.checked = true;
      state.dailyBudgetCents = Math.round(Number(event.target.value || 10) * 100);
    });
  }

  function stepDuration(body) {
    const options = [7, 14, 30, 0];
    const label = (days) => (days === 0 ? "Run until I stop it" : `${days} days`);
    body.innerHTML = html`
      <div class="bp-stack">
        <p class="bp-muted">
          Meta needs roughly a week before its delivery settles. Anything shorter mostly measures the
          learning phase.
        </p>
        <div class="bp-stack-sm">
          ${raw(options.map((days) => html`
            <label class="bp-radio ${days === state.durationDays ? "bp-radio--selected" : ""}">
              <input type="radio" name="duration" value="${days}" ${days === state.durationDays ? "checked" : ""}>
              <span><strong>${label(days)}</strong>
              ${days ? raw(html`<span class="bp-small bp-muted"> · about ${fmt.money(state.dailyBudgetCents * days)} total</span>`) : ""}</span>
            </label>`).join(""))}
        </div>
      </div>
      ${raw(footer())}
    `;
    body.querySelectorAll('input[name="duration"]').forEach((input) => {
      input.addEventListener("change", () => { state.durationDays = Number(input.value); });
    });
  }

  function stepDestination(body) {
    body.innerHTML = html`
      <div class="bp-card">
        <div class="bp-field">
          <label class="bp-label">Where do the ads send people?</label>
          <div class="bp-stack-sm">
            ${raw(DESTINATIONS.map((d) => html`
              <label class="bp-radio ${d.value === state.destinationType ? "bp-radio--selected" : ""}">
                <input type="radio" name="destination" value="${d.value}" ${d.value === state.destinationType ? "checked" : ""}>
                <span><strong>${d.label}</strong><br><span class="bp-small bp-muted">${d.hint}</span></span>
              </label>`).join(""))}
          </div>
        </div>
        <div class="bp-field">
          <label class="bp-label" for="w-url">Destination URL</label>
          <input class="bp-input" id="w-url" type="url" value="${state.destinationUrl}" placeholder="https://">
          <div class="bp-hint">
            BookPilot adds UTM parameters automatically so each click can be traced back to the
            creative that earned it.
          </div>
        </div>
        <div class="bp-alert bp-alert--warning" id="amazon-note" hidden>
          <span class="bp-alert__icon">!</span>
          <div class="bp-small">
            Amazon does not report sales to third-party tools. Sending traffic there means BookPilot
            can show you clicks but not sales, unless you connect Amazon Attribution. Website
            destinations track the whole journey.
          </div>
        </div>
      </div>
      ${raw(footer())}
    `;
    const toggleNote = () => {
      $("#amazon-note").hidden = !["amazon", "kobo", "other"].includes(state.destinationType);
    };
    body.querySelectorAll('input[name="destination"]').forEach((input) => {
      input.addEventListener("change", () => {
        state.destinationType = input.value;
        toggleNote();
      });
    });
    $("#w-url").addEventListener("input", (event) => { state.destinationUrl = event.target.value.trim(); });
    toggleNote();
  }

  function stepReview(body) {
    const book = books.find((b) => b.id === state.bookId);
    const personas = state.strategy.personas.filter((p) => state.personaIds.includes(p.id));
    const creatives = state.creatives.filter((c) => state.creativeIds.includes(c.id));
    const total = state.durationDays ? state.dailyBudgetCents * state.durationDays : null;

    body.innerHTML = html`
      <div class="bp-stack">
        <div class="bp-card">
          <div class="bp-card__title" style="margin-bottom:var(--bp-4)">${state.name}</div>
          <dl class="bp-kv">
            <dt>Book</dt><dd>${book?.title}</dd>
            <dt>Platform</dt><dd>Meta — Facebook and Instagram</dd>
            <dt>Optimising for</dt><dd>${OBJECTIVES.find((o) => o.value === state.objective)?.label}</dd>
            <dt>Audiences</dt><dd>${personas.map((p) => p.name).join(", ") || "—"}</dd>
            <dt>Creatives</dt><dd>${creatives.length} (${creatives.length * personas.length} ads in total)</dd>
            <dt>Daily budget</dt><dd>${fmt.money(state.dailyBudgetCents)}</dd>
            <dt>Duration</dt><dd>${state.durationDays ? `${state.durationDays} days` : "Until you stop it"}</dd>
            <dt>Maximum spend</dt><dd>${total ? fmt.money(total) : "No end date set"}</dd>
            <dt>Destination</dt><dd class="bp-truncate">${state.destinationUrl}</dd>
          </dl>
        </div>
        <div class="bp-alert bp-alert--info">
          <span class="bp-alert__icon">◆</span>
          <div class="bp-small">
            Saving this creates a draft. Nothing is sent to Meta and nothing spends until you push and
            then launch it, and the launch asks you to confirm.
          </div>
        </div>
      </div>
      ${raw(footer({ nextLabel: "Save campaign" }))}
    `;

    body.querySelector("[data-next]").addEventListener(
      "click",
      async (event) => {
        event.stopImmediatePropagation();
        const button = event.currentTarget;
        setBusy(button, true, "Saving…");
        try {
          const payload = {
            book_id: state.bookId,
            name: state.name || `${book?.title} — campaign`,
            platform: "meta",
            objective: state.objective,
            daily_budget_cents: state.dailyBudgetCents,
            destination_type: state.destinationType,
            destination_url: state.destinationUrl,
            persona_ids: state.personaIds,
            creative_ids: state.creativeIds,
          };
          if (state.durationDays) {
            const start = new Date();
            const end = new Date(Date.now() + state.durationDays * 86_400_000);
            payload.start_date = start.toISOString().slice(0, 10);
            payload.end_date = end.toISOString().slice(0, 10);
          }
          const { campaign } = await API.createCampaign(payload);
          state.createdId = campaign.id;
          state.step = 9;
          paint();
        } catch (err) {
          notify.error(err.message);
          setBusy(button, false);
        }
      },
      { capture: true }
    );
  }

  function stepLaunch(body) {
    body.innerHTML = html`
      <div class="bp-card bp-center" style="padding:var(--bp-10)">
        <div style="font-size:1.8rem;margin-bottom:var(--bp-3)">✓</div>
        <h2 class="bp-display" style="font-size:1.5rem;margin-bottom:var(--bp-2)">Campaign saved as a draft</h2>
        <p class="bp-muted" style="max-width:46ch;margin:0 auto var(--bp-6)">
          ${isDemo()
            ? "In the demo workspace nothing is sent anywhere — this is where you'd connect Meta and launch."
            : "Next: connect your Meta ad account if you haven't, push the campaign across, and launch when you're ready. It's created paused, so nothing spends before you say so."}
        </p>
        <div class="bp-row" style="justify-content:center;flex-wrap:wrap">
          <a class="bp-btn bp-btn--primary" href="#/campaigns/${state.createdId || ""}">Open the campaign</a>
          <a class="bp-btn bp-btn--secondary" href="#/campaigns">All campaigns</a>
        </div>
      </div>
    `;
  }

  await paint();
}

// ---------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------

export async function renderDetail(container, params) {
  const [detail, performance, { integrations }] = await Promise.all([
    API.campaign(params.id),
    API.campaignPerformance(params.id).catch(() => null),
    API.integrations().catch(() => ({ integrations: [] })),
  ]);
  const campaign = detail.campaign;
  const { book } = await API.book(campaign.book_id);
  const metaConnected = integrations.some((i) => i.provider === "meta" && i.status === "connected");
  const perCreative = performance?.perCreative || [];

  const best = [...perCreative]
    .filter((row) => row.metrics.hasData && row.metrics.roas !== null)
    .sort((a, b) => b.metrics.roas - a.metrics.roas)[0];
  const worst = [...perCreative]
    .filter((row) => row.metrics.hasData && row.metrics.clicks > 20 && row.metrics.conversions === 0)[0];

  container.innerHTML = html`
    <div class="bp-row bp-row--between" style="margin-bottom:var(--bp-5)">
      <a class="bp-small bp-muted" href="#/campaigns">← All campaigns</a>
      ${raw(demoBadge())}
    </div>

    ${raw(pageHead({
      title: campaign.name,
      description: campaign.external_only
        ? `${book.title} · Runs on ${fmt.platformName(campaign.platform)} Ads Manager`
        : `${book.title} · ${fmt.money(campaign.daily_budget_cents, campaign.currency)}/day · ${fmt.platformName(campaign.platform)}`,
      actions: `${statusBadge(campaign.status)}
        <button type="button" class="bp-btn bp-btn--secondary bp-btn--sm" id="analyse-btn">Analyse · 10 credits</button>`,
    }))}

    ${raw(campaign.status === "draft" ? launchPanel(campaign, metaConnected) : "")}

    <div class="bp-stack-lg">
      <section>
        <h2 style="font-size:1.05rem;margin-bottom:var(--bp-3)">Performance</h2>
        ${raw(statGrid(performance?.totals, campaign.currency))}
      </section>

      ${raw(performance?.websiteAttributed?.hasData ? html`
        <section class="bp-card">
          <div class="bp-card__header">
            <div class="bp-card__title">Website-attributed sales</div>
            <span class="bp-badge bp-badge--info">Your own tracking</span>
          </div>
          <p class="bp-small bp-muted">
            Recorded by the BookPilot script on your site. Reported separately from Meta's own
            attribution, which counts differently — the two are never added together.
          </p>
          <dl class="bp-kv">
            <dt>Purchases</dt><dd>${fmt.number(performance.websiteAttributed.conversions)}</dd>
            <dt>Revenue</dt><dd>${fmt.money(performance.websiteAttributed.revenueCents, campaign.currency)}</dd>
          </dl>
        </section>` : "")}

      ${raw(perCreative.length ? html`
        <section>
          <div class="bp-row bp-row--between" style="margin-bottom:var(--bp-3)">
            <h2 style="font-size:1.05rem">Creative performance</h2>
            <a class="bp-small" href="#/analytics">Compare across campaigns →</a>
          </div>
          <div class="bp-card bp-card--flush">
            <div class="bp-table-wrap">
              <table class="bp-table">
                <thead>
                  <tr><th>Creative</th><th class="bp-num">Spend</th><th class="bp-num">Clicks</th>
                  <th class="bp-num">CTR</th><th class="bp-num">Sales</th><th class="bp-num">Revenue</th>
                  <th class="bp-num">ROAS</th><th>Evidence</th></tr>
                </thead>
                <tbody>
                  ${raw(perCreative.map((row) => {
                    const m = row.metrics;
                    const flag = best && row.creative_id === best.creative_id
                      ? '<span title="Best performer">🏆</span> '
                      : worst && row.creative_id === worst.creative_id
                        ? '<span title="Needs attention">⚠️</span> '
                        : "";
                    return html`<tr>
                      <td>${raw(flag)}<a href="#/creatives/${row.creative_id}">${row.creative?.headline || "Creative"}</a></td>
                      <td class="bp-num">${fmt.money(m.spendCents, campaign.currency)}</td>
                      <td class="bp-num">${fmt.number(m.clicks)}</td>
                      <td class="bp-num">${fmt.percent(m.ctr)}</td>
                      <td class="bp-num">${fmt.number(m.conversions)}</td>
                      <td class="bp-num">${fmt.money(m.revenueCents, campaign.currency)}</td>
                      <td class="bp-num">${fmt.multiple(m.roas)}</td>
                      <td>${raw(confidenceBadge(row.confidence))}</td>
                    </tr>`;
                  }).join(""))}
                </tbody>
              </table>
            </div>
          </div>
        </section>` : "")}

      <div id="analysis-output"></div>

      <section class="bp-card">
        <div class="bp-card__title" style="margin-bottom:var(--bp-3)">Campaign settings</div>
        <dl class="bp-kv">
          <dt>Objective</dt><dd>${OBJECTIVES.find((o) => o.value === campaign.objective)?.label || campaign.objective}</dd>
          <dt>Daily budget</dt><dd>${campaign.external_only ? `Set in ${fmt.platformName(campaign.platform)} Ads Manager` : fmt.money(campaign.daily_budget_cents, campaign.currency)}</dd>
          <dt>Runs</dt><dd>${campaign.start_date ? fmt.date(campaign.start_date) : "—"} → ${campaign.end_date ? fmt.date(campaign.end_date) : "no end date"}</dd>
          <dt>Destination</dt><dd class="bp-truncate">${campaign.destination_url || "—"}</dd>
          <dt>Audiences</dt><dd>${(detail.adSets || []).map((s) => s.name).join(", ") || "—"}</dd>
          ${raw(campaign.external_only
            ? html`<dt>Runs on</dt><dd>${fmt.platformName(campaign.platform)} Ads Manager. BookPilot tracks it and imports its reports, but can't launch, pause or change it.</dd>`
            : html`<dt>On Meta</dt><dd>${campaign.external_campaign_id ? "Yes" : "Not pushed yet"}</dd>`)}
        </dl>
        <div class="bp-row bp-row--wrap" style="margin-top:var(--bp-4)">
          <button type="button" class="bp-btn bp-btn--secondary bp-btn--sm" id="budget-btn">Budget advice · 2 credits</button>
          ${raw(campaign.external_campaign_id ? `
            <button type="button" class="bp-btn bp-btn--secondary bp-btn--sm" id="sync-btn">Sync from Meta</button>
            <button type="button" class="bp-btn bp-btn--${campaign.status === "active" ? "secondary" : "primary"} bp-btn--sm" id="toggle-btn">
              ${campaign.status === "active" ? "Pause campaign" : "Launch campaign"}
            </button>` : "")}
        </div>
      </section>
    </div>
  `;

  $("#analyse-btn").addEventListener("click", async (event) => {
    const output = $("#analysis-output");
    setBusy(event.currentTarget, true, "Reading the numbers…");
    output.innerHTML = loading(2);
    try {
      const { analysis } = await API.analyzeCampaign(campaign.id);
      output.innerHTML = analysisPanel(analysis);
    } catch (err) {
      output.innerHTML = "";
      notify.error(err.message);
    }
    setBusy(event.currentTarget, false);
  });

  $("#budget-btn").addEventListener("click", async (event) => {
    setBusy(event.currentTarget, true, "Calculating…");
    try {
      const result = await API.budgetAdvice(campaign.id);
      $("#analysis-output").innerHTML = budgetPanel(result, campaign.currency);
    } catch (err) {
      notify.error(err.message);
    }
    setBusy(event.currentTarget, false);
  });

  $("#sync-btn")?.addEventListener("click", async (event) => {
    setBusy(event.currentTarget, true, "Syncing…");
    try {
      const result = await API.metaSync(campaign.id);
      notify.success(`${result.synced} daily rows synced from Meta.`);
      renderDetail(container, params);
    } catch (err) {
      notify.error(err.message);
      setBusy(event.currentTarget, false);
    }
  });

  $("#toggle-btn")?.addEventListener("click", async (event) => {
    const goingLive = campaign.status !== "active";
    if (goingLive) {
      const confirmed = await confirmDialog({
        title: "Launch this campaign?",
        message: `Meta will start delivering these ads and billing you up to ${fmt.money(campaign.daily_budget_cents, campaign.currency)} per day. You can pause it at any time.`,
        confirmLabel: "Launch and start spending",
      });
      if (!confirmed) return;
    }
    setBusy(event.currentTarget, true, goingLive ? "Launching…" : "Pausing…");
    try {
      await API.metaStatus({
        campaign_id: campaign.id,
        status: goingLive ? "active" : "paused",
        confirm: true,
      });
      notify.success(goingLive ? "Campaign is live." : "Campaign paused.");
      renderDetail(container, params);
    } catch (err) {
      notify.error(err.message);
      setBusy(event.currentTarget, false);
    }
  });

  $("#push-btn")?.addEventListener("click", async (event) => {
    const pageId = $("#page-id")?.value?.trim();
    if (!pageId) return notify.error("Meta needs the Facebook Page these ads run from.");
    setBusy(event.currentTarget, true, "Creating on Meta…");
    try {
      const result = await API.metaPush({ campaign_id: campaign.id, page_id: pageId });
      notify.success(result.note || "Created on Meta, paused.");
      renderDetail(container, params);
    } catch (err) {
      notify.error(err.message);
      setBusy(event.currentTarget, false);
    }
  });
}

function launchPanel(campaign, metaConnected) {
  if (!metaConnected) {
    return `
      <div class="bp-alert bp-alert--info" style="margin-bottom:var(--bp-6)">
        <span class="bp-alert__icon">◆</span>
        <div>
          <div class="bp-alert__title">Connect a Meta ad account to launch</div>
          <div class="bp-small">
            This campaign is a complete draft. To run it, connect the ad account you already use —
            Meta bills you directly, and BookPilot never asks for your password.
          </div>
          <a class="bp-btn bp-btn--primary bp-btn--sm" style="margin-top:var(--bp-3)" href="#/attribution">Connect integration</a>
        </div>
      </div>`;
  }
  return html`
    <div class="bp-card" style="margin-bottom:var(--bp-6)">
      <div class="bp-card__header"><div class="bp-card__title">Push this campaign to Meta</div></div>
      <p class="bp-small bp-muted">
        Everything is created paused. Nothing spends until you launch it in the next step.
      </p>
      <div class="bp-field">
        <label class="bp-label" for="page-id">Facebook Page ID</label>
        <input class="bp-input" id="page-id" placeholder="e.g. 102938475610293">
        <div class="bp-hint">Meta requires ads to run from a Page. Find the ID in your Page's settings.</div>
      </div>
      <button type="button" class="bp-btn bp-btn--primary" id="push-btn">Create on Meta (paused)</button>
    </div>
  `;
}

const INSIGHT_ICON = { winner: "🏆", weak: "⚠️", opportunity: "💡", test: "🧪", warning: "❗" };

function analysisPanel(analysis) {
  return html`
    <section class="bp-card">
      <div class="bp-card__header">
        <div class="bp-card__title">AI analysis</div>
        ${raw(confidenceBadge(analysis.confidence))}
      </div>
      <p>${analysis.summary}</p>
      ${raw((analysis.insights || []).length ? `
        <div class="bp-stack-sm" style="margin-top:var(--bp-4)">
          ${(analysis.insights || []).map((insight) => html`
            <div class="bp-insight bp-insight--${insight.kind}">
              <span class="bp-insight__icon">${INSIGHT_ICON[insight.kind] || "•"}</span>
              <div>
                <strong>${insight.title}</strong>
                <div class="bp-small bp-muted">${insight.detail}</div>
                <div class="bp-tiny bp-subtle" style="margin-top:4px">${insight.metric}</div>
              </div>
            </div>`).join("")}
        </div>` : "")}
      ${raw((analysis.recommendations || []).length ? `
        <div style="margin-top:var(--bp-6)">
          <div class="bp-eyebrow" style="margin-bottom:var(--bp-3)">Recommended actions</div>
          <div class="bp-stack-sm">
            ${(analysis.recommendations || []).map((rec) => html`
              <div class="bp-panel">
                <div class="bp-row bp-row--between">
                  <strong>${rec.title}</strong>
                  ${raw(confidenceBadge(rec.confidence))}
                </div>
                <p class="bp-small bp-muted" style="margin:6px 0">${rec.reason}</p>
                <div class="bp-tiny bp-subtle">${rec.metrics}</div>
                <div class="bp-small" style="margin-top:6px"><strong>Next:</strong> ${rec.action}</div>
              </div>`).join("")}
          </div>
          <p class="bp-tiny bp-subtle" style="margin-top:var(--bp-3)">
            Recommendations only. BookPilot never changes a budget or pauses an ad on its own.
          </p>
        </div>` : "")}
    </section>
  `;
}

function budgetPanel(result, currency) {
  if (!result.recommendation) {
    return html`
      <section class="bp-card">
        <div class="bp-card__title" style="margin-bottom:var(--bp-3)">Budget advice</div>
        <p class="bp-muted">${result.reason}</p>
      </section>`;
  }
  const r = result.recommendation;
  const band = (label, cents) => html`
    <div class="bp-stat">
      <div class="bp-stat__label">${label}</div>
      <div class="bp-stat__value" style="font-size:1.3rem">${fmt.money(cents, currency)}</div>
      <div class="bp-stat__meta">per day</div>
    </div>`;
  return html`
    <section class="bp-card">
      <div class="bp-card__header">
        <div class="bp-card__title">Budget recommendation</div>
        ${raw(confidenceBadge(r.confidence))}
      </div>
      <div class="bp-stat-grid" style="margin-bottom:var(--bp-4)">
        ${raw(band("Conservative", r.conservative))}
        ${raw(band("Balanced", r.balanced))}
        ${raw(band("Aggressive", r.aggressive))}
      </div>
      <p class="bp-small bp-muted">${r.narrative?.reasoning || r.rationale}</p>
      ${r.narrative?.caveat ? raw(html`<p class="bp-small bp-subtle">${r.narrative.caveat}</p>`) : ""}
      <p class="bp-tiny bp-subtle">
        Estimates from this campaign's own numbers, not a guarantee. Advertising results depend on
        your book, your market and the season.
      </p>
    </section>
  `;
}
