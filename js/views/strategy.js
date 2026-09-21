// AI Strategy: analysis, reader personas and marketing angles
// (spec §9, §10, §11).
//
// One page, three tabs, in the order the work happens — you cannot
// write angles for a reader you haven't identified, and the UI says so
// rather than letting someone generate in the wrong order.

import { html, raw, $, setBusy } from "../core/dom.js";
import { API } from "../core/api.js";
import * as store from "../core/store.js";
import { notify } from "../core/toast.js";
import { navigate } from "../core/router.js";
import { refreshAccount } from "../core/session.js";
import { pageHead, emptyState, bullets, chips, paragraphs, fmt, demoBadge, loading } from "./shared.js";

const ANGLE_LABELS = {
  emotional: "Emotional", problem_solution: "Problem / solution", curiosity: "Curiosity",
  transformation: "Transformation", educational: "Educational", identity: "Identity",
  storytelling: "Storytelling", social_proof: "Social proof", authority: "Authority",
  contrarian: "Contrarian", inspirational: "Inspirational", practical: "Practical",
};

let activeTab = "analysis";

export async function render(container, params) {
  const { books } = await API.books();
  store.set({ books });

  if (!books.length) {
    container.innerHTML =
      pageHead({ title: "AI Strategy", description: "Reader intelligence starts from a book." }) +
      emptyState({
        icon: "✦",
        title: "No books yet",
        text: "Add a book and BookPilot will work out who buys it.",
        action: '<a class="bp-btn bp-btn--primary" href="#/books/new">Add your first book</a>',
      });
    return;
  }

  const bookId = params?.bookId || books[0].id;
  const book = books.find((b) => b.id === bookId) || books[0];

  // One mutable holder rather than a value captured per render: a
  // generation changes what every tab should show, and a tab handler
  // that closed over the first fetch would keep offering "analyse this
  // book first" after the analysis had already run.
  const state = { book, strategy: await API.strategy(book.id) };

  container.innerHTML = html`
    ${raw(pageHead({
      title: "AI Strategy",
      description: "What the book promises, who buys it, and the angles worth testing.",
      actions: `${demoBadge()}${books.length > 1
        ? `<select class="bp-select" id="book-picker" style="width:auto">${books
            .map((b) => html`<option value="${b.id}" ${b.id === book.id ? "selected" : ""}>${b.title}</option>`)
            .join("")}</select>`
        : ""}`,
    }))}

    <div class="bp-tabs" style="margin-bottom:var(--bp-6)" id="strategy-tabs"></div>
    <div id="strategy-body"></div>
  `;

  $("#book-picker")?.addEventListener("change", (event) => {
    navigate(`/strategy/${event.target.value}`);
  });

  const body = $("#strategy-body");
  const tabs = $("#strategy-tabs");

  async function reload() {
    state.strategy = await API.strategy(state.book.id);
  }

  function paintTabs() {
    const { personas, angles } = state.strategy;
    tabs.innerHTML = [
      ["analysis", "Book analysis", ""],
      ["personas", "Reader personas", personas.length ? ` (${personas.length})` : ""],
      ["angles", "Marketing angles", angles.length ? ` (${angles.length})` : ""],
    ]
      .map(([key, label, count]) => html`
        <button type="button" class="bp-tab ${key === activeTab ? "bp-tab--active" : ""}" data-tab="${key}">
          ${label}${count}
        </button>`)
      .join("");
    tabs.querySelectorAll(".bp-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        activeTab = tab.dataset.tab;
        paint();
      });
    });
  }

  function paint() {
    paintTabs();
    const context = { state, reload, paint, body };
    if (activeTab === "analysis") renderAnalysis(context);
    else if (activeTab === "personas") renderPersonas(context);
    else renderAngles(context);
  }

  // Land on the first thing that still needs doing.
  if (!state.strategy.analysis) activeTab = "analysis";
  else if (!state.strategy.personas.length) activeTab = "personas";
  else if (!state.strategy.angles.length) activeTab = "angles";
  paint();
}

/** Wraps a generate button: busy state, credit refresh, error toast. */
function onGenerate(button, label, run) {
  button.addEventListener("click", async () => {
    setBusy(button, true, label);
    try {
      await run();
      await refreshAccount();
    } catch (err) {
      notify.error(err.message);
      setBusy(button, false);
    }
  });
}

// ---------------------------------------------------------------------

function renderAnalysis({ state, reload, paint, body }) {
  const analysis = state.strategy.analysis;
  const book = state.book;

  if (!analysis) {
    body.innerHTML = emptyState({
      icon: "✦",
      title: "Analyse this book",
      text:
        "BookPilot reads the title, description, genre and any sample text you've added, then works " +
        "out how the book should be sold — and shows its reasoning, so you can disagree with it.",
      action: '<button type="button" class="bp-btn bp-btn--primary" id="run-analysis">Run analysis · 10 credits</button>',
    });
    onGenerate($("#run-analysis"), "Reading your book, up to a minute…", async () => {
      body.innerHTML = loading(4);
      await API.analyzeBook(book.id);
      await reload();
      paint();
      notify.success("Analysis complete.");
    });
    return;
  }

  body.innerHTML = html`
    <div class="bp-stack-lg">
      <section class="bp-card">
        <div class="bp-card__header">
          <div class="bp-card__title">Positioning</div>
          <span class="bp-tiny bp-subtle">${fmt.date(analysis.created_at)}</span>
        </div>
        ${raw(paragraphs(analysis.positioning))}
        <div class="bp-panel" style="margin-top:var(--bp-4)">
          <div class="bp-eyebrow">Core promise</div>
          <p class="bp-display" style="font-size:1.2rem;margin:6px 0 0">${analysis.core_promise || ""}</p>
        </div>
      </section>

      <div class="bp-grid bp-grid--2">
        <section class="bp-card">
          <div class="bp-card__title" style="margin-bottom:var(--bp-3)">The reader's problem</div>
          <p class="bp-small bp-muted">${analysis.reader_problem || "Insufficient data."}</p>
        </section>
        <section class="bp-card">
          <div class="bp-card__title" style="margin-bottom:var(--bp-3)">The transformation</div>
          <p class="bp-small bp-muted">${analysis.transformation || "Insufficient data."}</p>
        </section>
      </div>

      <div class="bp-grid bp-grid--3">
        <section class="bp-card">
          <div class="bp-card__title" style="margin-bottom:var(--bp-3)">Themes</div>
          ${raw(chips(analysis.themes))}
        </section>
        <section class="bp-card">
          <div class="bp-card__title" style="margin-bottom:var(--bp-3)">Why people buy</div>
          ${raw(bullets(analysis.purchase_motivations))}
        </section>
        <section class="bp-card">
          <div class="bp-card__title" style="margin-bottom:var(--bp-3)">What stops them</div>
          ${raw(bullets(analysis.objections))}
        </section>
      </div>

      <section class="bp-card">
        <div class="bp-card__title" style="margin-bottom:var(--bp-3)">Marketing opportunities</div>
        ${raw(bullets(analysis.opportunities))}
      </section>

      ${analysis.reasoning ? raw(html`
        <section class="bp-panel">
          <div class="bp-eyebrow">How it reached this</div>
          <p class="bp-small bp-muted" style="margin:6px 0 0">${analysis.reasoning}</p>
        </section>`) : ""}

      <div class="bp-row">
        <button type="button" class="bp-btn bp-btn--secondary bp-btn--sm" id="rerun">Re-run analysis · 10 credits</button>
        <button type="button" class="bp-btn bp-btn--primary bp-btn--sm" id="to-personas">Continue to readers</button>
      </div>
    </div>
  `;

  onGenerate($("#rerun"), "Re-reading…", async () => {
    await API.analyzeBook(book.id);
    await reload();
    paint();
    notify.success("Analysis refreshed.");
  });
  $("#to-personas").addEventListener("click", () => {
    document.querySelector('[data-tab="personas"]')?.click();
  });
}

// ---------------------------------------------------------------------

function renderPersonas({ state, reload, paint, body }) {
  const { strategy, book } = state;

  if (!strategy.analysis) {
    body.innerHTML = emptyState({
      icon: "✦",
      title: "Analyse the book first",
      text: "Personas are built from the analysis — who the book is for follows from what it promises.",
      action: '<button type="button" class="bp-btn bp-btn--primary" data-tab-jump>Go to analysis</button>',
    });
    body.querySelector("[data-tab-jump]").addEventListener("click", () =>
      document.querySelector('[data-tab="analysis"]').click()
    );
    return;
  }

  if (!strategy.personas.length) {
    body.innerHTML = emptyState({
      icon: "◕",
      title: "Meet your readers",
      text:
        "Three to five reader personas, each specific enough to write an ad for and to translate " +
        "into targeting on an ad platform.",
      action: '<button type="button" class="bp-btn bp-btn--primary" id="run-personas">Generate personas · 10 credits</button>',
    });
    onGenerate($("#run-personas"), "Finding your readers, up to a minute…", async () => {
      body.innerHTML = loading(3);
      await API.generatePersonas(book.id, 4);
      await reload();
      paint();
      notify.success("Personas ready.");
    });
    return;
  }

  body.innerHTML = html`
    <div class="bp-stack">
      <div class="bp-row bp-row--between">
        <p class="bp-small bp-muted" style="margin:0">
          Built from interests and life stage. Never from health, religion, ethnicity or other
          protected characteristics.
        </p>
        <button type="button" class="bp-btn bp-btn--ghost bp-btn--sm" id="regen-personas">Regenerate · 10 credits</button>
      </div>
      <div class="bp-grid bp-grid--2">
        ${raw(strategy.personas.map(personaCard).join(""))}
      </div>
      <div class="bp-row">
        <button type="button" class="bp-btn bp-btn--primary bp-btn--sm" id="to-angles">Continue to angles</button>
      </div>
    </div>
  `;

  onGenerate($("#regen-personas"), "Regenerating, up to a minute…", async () => {
    await API.generatePersonas(book.id, 4);
    await reload();
    paint();
    notify.success("Personas regenerated.");
  });
  $("#to-angles").addEventListener("click", () =>
    document.querySelector('[data-tab="angles"]').click()
  );
}

function personaCard(persona) {
  return html`
    <article class="bp-card bp-persona">
      <div class="bp-persona__name">${persona.name}</div>
      <div class="bp-small bp-subtle">${persona.age_range || ""}${persona.demographics ? ` · ${persona.demographics}` : ""}</div>
      <p class="bp-small bp-muted" style="margin-top:var(--bp-3)">${persona.description || ""}</p>
      ${raw(chips(persona.interests, { limit: 6 }))}
      <dl>
        <div><dt>Pain points</dt><dd>${raw(bullets(persona.pain_points, { limit: 4 }))}</dd></div>
        <div><dt>What she wants</dt><dd>${raw(bullets(persona.desires, { limit: 4 }))}</dd></div>
        <div><dt>What stops her</dt><dd>${raw(bullets(persona.objections, { limit: 3 }))}</dd></div>
      </dl>
      ${persona.messaging ? raw(html`
        <div class="bp-panel" style="margin-top:var(--bp-4)">
          <div class="bp-eyebrow">Suggested message</div>
          <p class="bp-display" style="font-size:1.05rem;margin:6px 0 0">“${persona.messaging}”</p>
        </div>`) : ""}
    </article>
  `;
}

// ---------------------------------------------------------------------

function renderAngles({ state, reload, paint, body }) {
  const { strategy, book } = state;

  if (!strategy.personas.length) {
    body.innerHTML = emptyState({
      icon: "◑",
      title: "Generate personas first",
      text: "An angle is written for a specific reader. Without one, it's just a slogan.",
      action: '<button type="button" class="bp-btn bp-btn--primary" data-tab-jump>Go to personas</button>',
    });
    body.querySelector("[data-tab-jump]").addEventListener("click", () =>
      document.querySelector('[data-tab="personas"]').click()
    );
    return;
  }

  if (!strategy.angles.length) {
    body.innerHTML = emptyState({
      icon: "◑",
      title: "Find your angles",
      text:
        "Ten or more testable hypotheses about why someone buys this book, spread across emotional, " +
        "curiosity, transformation, practical and other categories.",
      action: '<button type="button" class="bp-btn bp-btn--primary" id="run-angles">Generate angles · 5 credits</button>',
    });
    onGenerate($("#run-angles"), "Writing angles, up to a minute…", async () => {
      body.innerHTML = loading(4);
      await API.generateAngles(book.id, 10);
      await reload();
      paint();
      notify.success("Angles ready.");
    });
    return;
  }

  const personaName = (id) => strategy.personas.find((p) => p.id === id)?.name;
  const categories = [...new Set(strategy.angles.map((a) => a.category))];

  body.innerHTML = html`
    <div class="bp-stack">
      <div class="bp-row bp-row--between bp-row--wrap">
        <div class="bp-chips">
          <span class="bp-chip bp-chip--active" data-filter="">All (${strategy.angles.length})</span>
          ${raw(categories.map((c) => html`<span class="bp-chip" data-filter="${c}">${ANGLE_LABELS[c] || c}</span>`).join(""))}
        </div>
        <button type="button" class="bp-btn bp-btn--ghost bp-btn--sm" id="regen-angles">Regenerate · 5 credits</button>
      </div>
      <div class="bp-grid bp-grid--2" id="angle-grid">
        ${raw(strategy.angles.map((angle) => angleCard(angle, personaName(angle.persona_id), book.id)).join(""))}
      </div>
    </div>
  `;

  body.querySelectorAll("[data-filter]").forEach((chip) => {
    chip.addEventListener("click", () => {
      body.querySelectorAll("[data-filter]").forEach((c) => c.classList.remove("bp-chip--active"));
      chip.classList.add("bp-chip--active");
      const filter = chip.dataset.filter;
      body.querySelectorAll("#angle-grid > article").forEach((card) => {
        card.hidden = Boolean(filter) && card.dataset.category !== filter;
      });
    });
  });

  onGenerate($("#regen-angles"), "Regenerating, up to a minute…", async () => {
    await API.generateAngles(book.id, 10);
    await reload();
    paint();
    notify.success("Angles regenerated.");
  });
}

function angleCard(angle, personaName, bookId) {
  return html`
    <article class="bp-card bp-angle" data-category="${angle.category}">
      <div class="bp-row bp-row--between">
        <strong>${angle.name}</strong>
        <span class="bp-badge">${ANGLE_LABELS[angle.category] || angle.category}</span>
      </div>
      <div class="bp-angle__hook">“${angle.hook || ""}”</div>
      <p class="bp-small bp-muted" style="margin:0">${angle.explanation || ""}</p>
      <dl class="bp-kv bp-tiny" style="margin:0">
        ${personaName ? raw(html`<dt>For</dt><dd>${personaName}</dd>`) : ""}
        ${angle.cta ? raw(html`<dt>Call to action</dt><dd>${angle.cta}</dd>`) : ""}
        ${angle.format_hint ? raw(html`<dt>Suggested format</dt><dd>${angle.format_hint}</dd>`) : ""}
      </dl>
      <a class="bp-btn bp-btn--secondary bp-btn--sm" href="#/creatives/new?book=${bookId}&angle=${angle.id}">
        Create ads from this angle
      </a>
    </article>
  `;
}
