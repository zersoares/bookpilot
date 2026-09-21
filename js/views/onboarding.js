// Onboarding (spec §8).
//
// Six steps, ending with the book's marketing profile — which is the
// first moment the product proves it understood the book. Everything
// before it exists to make that moment possible, so each step asks for
// as little as it can get away with.

import { html, raw, $, formData, setBusy } from "../core/dom.js";
import { API } from "../core/api.js";
import { refreshAccount } from "../core/session.js";
import * as store from "../core/store.js";
import { notify } from "../core/toast.js";
import { GENRE_OPTIONS, CURRENCIES } from "./options.js";
import { fmt, paragraphs, bullets } from "./shared.js";
import { imageField, bindImageFields } from "./image-field.js";
import { normaliseUrl } from "../core/image-plan.js";

const TOTAL_STEPS = 6;
let draft = { promoting: "book", bookId: null };

function pips(step) {
  return `<div class="bp-onboarding__steps">${Array.from(
    { length: TOTAL_STEPS },
    (_, i) => `<div class="bp-onboarding__pip ${i < step ? "bp-onboarding__pip--done" : ""}"></div>`
  ).join("")}</div>`;
}

function frame(step, title, subtitle, body) {
  return html`
    <div class="bp-onboarding">
      ${raw(pips(step))}
      <p class="bp-eyebrow">Step ${step} of ${TOTAL_STEPS}</p>
      <h1 class="bp-display" style="font-size:1.9rem;margin:var(--bp-2) 0 var(--bp-3)">${title}</h1>
      <p class="bp-lead" style="margin-bottom:var(--bp-8)">${subtitle}</p>
      ${raw(body)}
    </div>
  `;
}

async function saveStep(step, patch = {}) {
  await API.updateMe({ onboarding_step: step, ...patch });
  await refreshAccount();
}

export async function render(container) {
  const profile = store.get("profile");
  const step = Math.max(1, Math.min(profile?.onboarding_step || 1, TOTAL_STEPS));
  return renderStep(container, step);
}

async function renderStep(container, step) {
  switch (step) {
    case 1: return stepWelcome(container);
    case 2: return stepPromoting(container);
    case 3: return stepBook(container);
    case 4: return stepGoal(container);
    case 5: return stepBudget(container);
    default: return stepProfile(container);
  }
}

function stepWelcome(container) {
  container.innerHTML = frame(
    1,
    "Welcome to BookPilot AI",
    "Five short questions and one book. In about ten minutes you'll have a reader profile, a set of marketing angles and a campaign ready to review.",
    `<div class="bp-card bp-stack">
       <div class="bp-row bp-row--top"><span>①</span><div><strong>Tell us about your book</strong><br><span class="bp-small bp-muted">Title, description, genre, price and where it's sold.</span></div></div>
       <div class="bp-row bp-row--top"><span>②</span><div><strong>We'll work out who buys it</strong><br><span class="bp-small bp-muted">Reader personas with the reasoning behind them.</span></div></div>
       <div class="bp-row bp-row--top"><span>③</span><div><strong>You choose what to test</strong><br><span class="bp-small bp-muted">Marketing angles, then copy and creatives for the ones you like.</span></div></div>
     </div>
     <button type="button" class="bp-btn bp-btn--primary bp-btn--lg" style="margin-top:var(--bp-6)" id="next">Get started</button>`
  );
  $("#next").addEventListener("click", async () => {
    await saveStep(2);
    renderStep(container, 2);
  });
}

function stepPromoting(container) {
  const option = (value, label, description) => html`
    <label class="bp-radio" data-value="${value}">
      <input type="radio" name="promoting" value="${value}" ${value === "book" ? "checked" : ""}>
      <span><strong>${label}</strong><br><span class="bp-small bp-muted">${description}</span></span>
    </label>`;

  container.innerHTML = frame(
    2,
    "What are you promoting?",
    "This only changes the words we use — you can add anything later.",
    `<div class="bp-stack-sm">
       ${option("book", "A book", "One title you want to sell more of.")}
       ${option("books", "Several books", "A series or a backlist.")}
       ${option("product", "A digital product", "A course, a workbook or a template pack.")}
     </div>
     <div class="bp-wizard__footer">
       <button type="button" class="bp-btn bp-btn--ghost" id="back">Back</button>
       <button type="button" class="bp-btn bp-btn--primary" id="next">Continue</button>
     </div>`
  );
  $("#back").addEventListener("click", () => renderStep(container, 1));
  $("#next").addEventListener("click", async () => {
    draft.promoting = container.querySelector('input[name="promoting"]:checked')?.value || "book";
    await saveStep(3, { author_type: draft.promoting === "product" ? "creator" : "author" });
    renderStep(container, 3);
  });
}

function stepBook(container) {
  const noun = draft.promoting === "product" ? "product" : "book";
  container.innerHTML = frame(
    3,
    `Add your ${noun}`,
    "The description matters most — it's what the analysis reads. Paste the one from your sales page.",
    html`<form id="book-form" class="bp-card">
       <div class="bp-field">
         <label class="bp-label" for="title">Title</label>
         <input class="bp-input" id="title" name="title" required maxlength="300">
       </div>
       <div class="bp-field">
         <label class="bp-label" for="subtitle">Subtitle <span class="bp-subtle">(optional)</span></label>
         <input class="bp-input" id="subtitle" name="subtitle" maxlength="300">
       </div>
       <div class="bp-field-row">
         <div class="bp-field">
           <label class="bp-label" for="author_name">Author name</label>
           <input class="bp-input" id="author_name" name="author_name" maxlength="200">
         </div>
         <div class="bp-field">
           <label class="bp-label" for="genre">Genre</label>
           <select class="bp-select" id="genre" name="genre">${raw(GENRE_OPTIONS)}</select>
         </div>
       </div>
       <div class="bp-field">
         <label class="bp-label" for="description">Description</label>
         <textarea class="bp-textarea" id="description" name="description" rows="6" maxlength="8000"
           placeholder="What the ${noun} is about, who it's for and what changes for the reader."></textarea>
         <div class="bp-hint">Two or three paragraphs is plenty. The more specific, the better the personas.</div>
       </div>
       <div class="bp-field-row">
         <div class="bp-field">
           <label class="bp-label" for="price">Price</label>
           <input class="bp-input" id="price" name="price" type="number" min="0" step="0.01" placeholder="8.99">
         </div>
         <div class="bp-field">
           <label class="bp-label" for="currency">Currency</label>
           <select class="bp-select" id="currency" name="currency">${raw(CURRENCIES)}</select>
         </div>
       </div>
       <div class="bp-field">
         <label class="bp-label" for="sales_url">Where can people buy it?</label>
         <input class="bp-input" id="sales_url" name="sales_url" type="url" placeholder="https://">
         <div class="bp-hint">Your own site, Amazon, Kobo — wherever the ads should send people.</div>
       </div>
       ${raw(imageField({ id: "cover_url", label: "Cover image URL", kind: "cover", optional: true }))}
       <details style="margin-top:var(--bp-4)">
         <summary class="bp-small" style="cursor:pointer">Add a sample chapter, bio or reviews (optional)</summary>
         <div class="bp-field" style="margin-top:var(--bp-4)">
           <label class="bp-label" for="sample_text">Sample text</label>
           <textarea class="bp-textarea" id="sample_text" name="sample_text" rows="5" maxlength="40000"
             placeholder="Paste an excerpt — the opening pages are ideal."></textarea>
         </div>
         <div class="bp-field">
           <label class="bp-label" for="author_bio">Author bio</label>
           <textarea class="bp-textarea" id="author_bio" name="author_bio" rows="3" maxlength="4000"></textarea>
         </div>
         <div class="bp-field">
           <label class="bp-label" for="reviews_text">Real reviews you've received</label>
           <textarea class="bp-textarea" id="reviews_text" name="reviews_text" rows="3" maxlength="8000"
             placeholder="Paste them verbatim."></textarea>
           <div class="bp-hint">Only real ones. Nothing here will invent a review you didn't get.</div>
         </div>
       </details>
       <div class="bp-wizard__footer">
         <button type="button" class="bp-btn bp-btn--ghost" id="back">Back</button>
         <button type="submit" class="bp-btn bp-btn--primary">Save and continue</button>
       </div>
     </form>`
  );

  $("#back").addEventListener("click", () => renderStep(container, 2));
  bindImageFields(container);
  $("#book-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = formData(event.target);
    const button = event.target.querySelector('button[type="submit"]');
    setBusy(button, true, "Saving…");
    try {
      const payload = {
        title: values.title,
        subtitle: values.subtitle || null,
        author_name: values.author_name || null,
        genre: values.genre || null,
        description: values.description || null,
        currency: values.currency || "EUR",
        sales_url: values.sales_url || null,
        cover_url: normaliseUrl(values.cover_url),
        sample_text: values.sample_text || null,
        author_bio: values.author_bio || null,
        reviews_text: values.reviews_text || null,
      };
      if (values.price) payload.price_cents = Math.round(Number(values.price) * 100);
      const { book } = await API.createBook(payload);
      draft.bookId = book.id;
      await saveStep(4);
      renderStep(container, 4);
    } catch (err) {
      notify.error(err.message);
      setBusy(button, false);
    }
  });
}

function stepGoal(container) {
  const goals = [
    ["Sell more books", "Steady sales on a title that's already out."],
    ["Launch a new book", "A push around a publication date."],
    ["Build an audience", "Readers now, sales later."],
    ["Promote a bestseller", "More from a title that's already working."],
    ["Test a new market", "A country or a reader group you haven't tried."],
  ];
  container.innerHTML = frame(
    4,
    "What's your primary goal?",
    "This shapes what the campaign optimises for and what the advisor tells you to watch.",
    `<div class="bp-stack-sm">
       ${goals.map(([label, description], index) => html`
         <label class="bp-radio">
           <input type="radio" name="goal" value="${label}" ${index === 0 ? "checked" : ""}>
           <span><strong>${label}</strong><br><span class="bp-small bp-muted">${description}</span></span>
         </label>`).join("")}
     </div>
     <div class="bp-wizard__footer">
       <button type="button" class="bp-btn bp-btn--ghost" id="back">Back</button>
       <button type="button" class="bp-btn bp-btn--primary" id="next">Continue</button>
     </div>`
  );
  $("#back").addEventListener("click", () => renderStep(container, 3));
  $("#next").addEventListener("click", async () => {
    const goal = container.querySelector('input[name="goal"]:checked')?.value;
    await saveStep(5, { primary_goal: goal });
    renderStep(container, 5);
  });
}

function stepBudget(container) {
  const budgets = [500, 1000, 2000, 5000, 10000];
  container.innerHTML = frame(
    5,
    "What's your advertising budget?",
    "A daily figure, paid to the ad platform — not to BookPilot. You can change it any time, and nothing spends until you launch a campaign.",
    `<div class="bp-stack-sm">
       ${budgets.map((cents, index) => html`
         <label class="bp-radio">
           <input type="radio" name="budget" value="${cents}" ${index === 1 ? "checked" : ""}>
           <span><strong>${fmt.money(cents)} per day</strong>
           <span class="bp-small bp-muted"> · about ${fmt.money(cents * 30)} a month</span></span>
         </label>`).join("")}
       <label class="bp-radio">
         <input type="radio" name="budget" value="custom">
         <span class="bp-flex-1"><strong>Something else</strong>
           <input class="bp-input" style="margin-top:8px" id="custom-budget" type="number" min="1" step="0.5" placeholder="Daily budget">
         </span>
       </label>
     </div>
     <div class="bp-alert bp-alert--info" style="margin-top:var(--bp-5)">
       <span class="bp-alert__icon">◆</span>
       <div class="bp-small">
         At €5–€10 a day a campaign needs one to two weeks before its numbers mean anything.
         Below that, you'll mostly be reading noise.
       </div>
     </div>
     <div class="bp-wizard__footer">
       <button type="button" class="bp-btn bp-btn--ghost" id="back">Back</button>
       <button type="button" class="bp-btn bp-btn--primary" id="next">Continue</button>
     </div>`
  );
  $("#back").addEventListener("click", () => renderStep(container, 4));
  $("#next").addEventListener("click", async () => {
    const choice = container.querySelector('input[name="budget"]:checked')?.value;
    const cents = choice === "custom"
      ? Math.round(Number($("#custom-budget").value || 10) * 100)
      : Number(choice);
    await saveStep(6, { daily_budget_cents: cents });
    renderStep(container, 6);
  });
}

/**
 * The payoff step: run the analysis and show the marketing profile.
 * If the AI isn't configured on this deployment, say so plainly and let
 * the author into the app rather than blocking on it.
 */
async function stepProfile(container) {
  const books = draft.bookId ? null : (await API.books()).books;
  const bookId = draft.bookId || books?.[0]?.id;

  if (!bookId) {
    container.innerHTML = frame(6, "Almost there", "Add a book and we'll build its marketing profile.",
      `<a class="bp-btn bp-btn--primary" href="#/books/new">Add your book</a>`);
    return;
  }

  container.innerHTML = frame(
    6,
    "Building your book marketing profile",
    "Reading the description, working out who buys a book like this, and why.",
    `<div class="bp-card bp-stack">
       <div class="bp-row"><span class="bp-spinner"></span> <span>Analysing the book…</span></div>
       <div class="bp-skeleton" style="height:14px;width:70%"></div>
       <div class="bp-skeleton" style="height:14px;width:90%"></div>
       <div class="bp-skeleton" style="height:14px;width:55%"></div>
     </div>`
  );

  try {
    const { analysis } = await API.analyzeBook(bookId);
    await refreshAccount();
    container.innerHTML = frame(
      6,
      "Your book marketing profile",
      "This is the hypothesis everything else is built on. Disagree with any of it and you can regenerate or edit it later.",
      `<div class="bp-card bp-stack-lg">
         <div>
           <div class="bp-eyebrow">Positioning</div>
           ${paragraphs(analysis.positioning)}
         </div>
         <div>
           <div class="bp-eyebrow">Core promise</div>
           <p class="bp-display" style="font-size:1.2rem;margin:6px 0 0">${analysis.core_promise || ""}</p>
         </div>
         <div class="bp-grid bp-grid--2">
           <div>
             <div class="bp-eyebrow">The reader's problem</div>
             <p class="bp-small bp-muted">${analysis.reader_problem || ""}</p>
           </div>
           <div>
             <div class="bp-eyebrow">The transformation</div>
             <p class="bp-small bp-muted">${analysis.transformation || ""}</p>
           </div>
         </div>
         <div>
           <div class="bp-eyebrow">Why people buy this</div>
           ${bullets(analysis.purchase_motivations)}
         </div>
         <div>
           <div class="bp-eyebrow">What stops them</div>
           ${bullets(analysis.objections)}
         </div>
       </div>
       <div class="bp-wizard__footer">
         <a class="bp-btn bp-btn--ghost" href="#/overview">Go to my dashboard</a>
         <a class="bp-btn bp-btn--primary" href="#/strategy/${bookId}">Meet your readers</a>
       </div>`
    );
  } catch (err) {
    container.innerHTML = frame(
      6,
      "Your book is saved",
      "We couldn't run the analysis just now — nothing was charged, and you can run it from the book's page whenever you like.",
      `<div class="bp-alert bp-alert--warning">
         <span class="bp-alert__icon">!</span>
         <div><div class="bp-alert__title">Analysis unavailable</div><div class="bp-small">${err.message}</div></div>
       </div>
       <div class="bp-wizard__footer">
         <span></span>
         <a class="bp-btn bp-btn--primary" href="#/overview">Go to my dashboard</a>
       </div>`
    );
  }
}
