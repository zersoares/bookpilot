// Amazon Ads starter kit: a keyword plan and a downloadable Sponsored
// Products bulksheet, built from the book's own metadata.
//
// Deliberately not "keyword research": nobody outside Amazon has real
// search volume for Amazon's own search bar, and this claims none. What
// it replaces is the blank spreadsheet an author faces on day one of
// setting up ads — a reasonable starting list to prune, not a finished
// campaign.

import { html, raw, $, setBusy } from "../core/dom.js";
import { API } from "../core/api.js";
import { notify } from "../core/toast.js";
import { pageHead, demoBadge } from "./shared.js";
import { generateKeywordPlan, asinFromUrl, buildBulksheetCsv } from "../core/amazon-keywords.js";

const DEFAULT_DAILY_BUDGET_CENTS = 1000; // a common, low-risk starting daily budget
const DEFAULT_BID_CENTS = 45; // a commonly recommended starting bid for KDP ads

function slug(text) {
  return String(text || "").trim().slice(0, 60) || "New campaign";
}

export async function render(container, params) {
  const { book } = await API.book(params.id);
  const plan = generateKeywordPlan(book);
  const asin = asinFromUrl(book.sales_url);

  const state = {
    exact: new Map(plan.exact.map((k) => [k, true])),
    phrase: new Map(plan.phrase.map((k) => [k, true])),
    broad: new Map(plan.broad.map((k) => [k, true])),
    negative: new Map(plan.negative.map((k) => [k, true])),
    asin: asin || "",
  };

  container.innerHTML = html`
    <div class="bp-row bp-row--between" style="margin-bottom:var(--bp-5)">
      <a class="bp-small bp-muted" href="#/books/${book.id}">← ${book.title}</a>
      ${raw(demoBadge())}
    </div>
    ${raw(pageHead({
      title: "Amazon Ads starter kit",
      description: "A keyword list and a ready-to-review Sponsored Products bulksheet — a starting point to prune, not finished research.",
    }))}

    <div class="bp-alert bp-alert--info" style="margin-bottom:var(--bp-5)">
      <span class="bp-alert__icon">◆</span>
      <div class="bp-small">
        <strong>What this is and isn't.</strong> Amazon doesn't share real search volume with anyone
        outside Amazon, so this is not keyword research — no tool that isn't Amazon itself can honestly
        claim that. What it is: your book's own title and author, plus phrases typical of its category,
        laid out the way Amazon's bulk-upload file expects, so you start from a real list instead of a
        blank spreadsheet. Uncheck anything that doesn't fit, add your own below, then review it in your
        Amazon Ads account before it spends a cent — the campaign downloads <strong>paused</strong>.
      </div>
    </div>

    <div class="bp-card" style="margin-bottom:var(--bp-5)">
      <div class="bp-card__header"><div class="bp-card__title">Campaign settings</div></div>
      <div class="bp-grid bp-grid--2" style="gap:var(--bp-3)">
        <label class="bp-field" style="margin:0">
          <span class="bp-label">Campaign name</span>
          <input class="bp-input" id="ak-name" maxlength="128" value="${slug(`${book.title} — Sponsored Products`)}">
        </label>
        <label class="bp-field" style="margin:0">
          <span class="bp-label">ASIN <span class="bp-tiny bp-subtle">(the product this campaign advertises)</span></span>
          <input class="bp-input" id="ak-asin" maxlength="10" value="${state.asin}" placeholder="B0XXXXXXXX"
            style="text-transform:uppercase">
        </label>
        <label class="bp-field" style="margin:0">
          <span class="bp-label">Daily budget</span>
          <input class="bp-input" type="number" id="ak-budget" min="1" step="0.01" value="${(DEFAULT_DAILY_BUDGET_CENTS / 100).toFixed(2)}">
        </label>
        <label class="bp-field" style="margin:0">
          <span class="bp-label">Default bid</span>
          <input class="bp-input" type="number" id="ak-bid" min="0.02" step="0.01" value="${(DEFAULT_BID_CENTS / 100).toFixed(2)}">
        </label>
      </div>
      ${raw(!asin ? html`<p class="bp-tiny bp-subtle" style="margin-top:var(--bp-3)">
        We couldn't find an ASIN in this book's sales URL — enter it yourself, or leave it blank and add
        the product ad yourself in Amazon Ads after uploading.</p>` : "")}
    </div>

    <div class="bp-grid bp-grid--2" style="gap:var(--bp-4)">
      ${raw(keywordCard("exact", "Exact match", "Your book and author, word for word. Usually the cheapest, most relevant clicks.", plan.exact))}
      ${raw(keywordCard("phrase", "Phrase match", "Pulled from your subtitle and description. Broader than exact, still on-topic.", plan.phrase))}
      ${raw(keywordCard("broad", "Broad match — category", "Typical searches in your genre. The widest net; watch this group's spend first.", plan.broad))}
      ${raw(keywordCard("negative", "Negative keywords", "Excluded everywhere in this campaign — intent that's never a sale.", plan.negative))}
    </div>

    <div class="bp-row bp-row--wrap" style="margin-top:var(--bp-5)">
      <button type="button" class="bp-btn bp-btn--primary" id="ak-download">Download bulksheet CSV</button>
    </div>
    <p class="bp-tiny bp-subtle" style="margin-top:var(--bp-3)">
      Fields and column names follow Amazon's own bulk-operations guide for creating a new manual
      Sponsored Products campaign. Amazon's exact template can vary by marketplace and change over time,
      so open it next to a bulksheet freshly downloaded from your own Ads console before uploading — if
      a header doesn't line up, use Amazon's template and copy these rows in rather than force this one.
    </p>
  `;

  container.querySelectorAll("[data-ak-list]").forEach((list) => {
    const key = list.dataset.akList;
    list.addEventListener("change", (event) => {
      const item = event.target.closest("[data-ak-kw]");
      if (!item) return;
      state[key].set(item.dataset.akKw, event.target.checked);
    });
  });

  container.querySelectorAll("[data-ak-add]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const key = form.dataset.akAdd;
      const input = form.querySelector("input");
      const value = input.value.trim().toLowerCase();
      if (!value || state[key].has(value)) { input.value = ""; return; }
      state[key].set(value, true);
      input.value = "";
      const ul = container.querySelector(`[data-ak-list="${key}"]`);
      ul.insertAdjacentHTML("beforeend", keywordRow(key, value, true));
    });
  });

  $("#ak-download").addEventListener("click", (event) => {
    const name = $("#ak-name").value.trim();
    if (!name) { notify.error("Give the campaign a name first."); return; }
    const budget = Math.round(parseFloat($("#ak-budget").value || "0") * 100);
    const bid = Math.round(parseFloat($("#ak-bid").value || "0") * 100);
    if (!budget || budget < 100) { notify.error("Daily budget must be at least the equivalent of $1.00."); return; }
    if (!bid || bid < 2) { notify.error("Default bid must be at least a couple of cents."); return; }

    const asinValue = $("#ak-asin").value.trim().toUpperCase();
    if (asinValue && !/^[A-Z0-9]{10}$/.test(asinValue)) {
      notify.error("That doesn't look like a 10-character ASIN.");
      return;
    }

    const kept = (key) => [...state[key]].filter(([, on]) => on).map(([k]) => k);
    const csv = buildBulksheetCsv({
      campaignName: name,
      dailyBudgetCents: budget,
      defaultBidCents: bid,
      asin: asinValue || null,
      keywords: { exact: kept("exact"), phrase: kept("phrase"), broad: kept("broad"), negative: kept("negative") },
    });

    const button = event.currentTarget;
    setBusy(button, true, "Preparing…");
    try {
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-bulksheet.csv`;
      a.click();
      URL.revokeObjectURL(url);
      notify.success("Bulksheet downloaded.");
    } finally {
      setBusy(button, false);
    }
  });
}

function keywordRow(listKey, keyword, checked) {
  return html`
    <li class="bp-row" style="gap:8px;padding:4px 0">
      <label class="bp-row" style="gap:8px;flex:1;cursor:pointer">
        <input type="checkbox" data-ak-kw="${keyword}" ${checked ? "checked" : ""}>
        <span class="bp-small">${keyword}</span>
      </label>
    </li>`;
}

function keywordCard(key, title, blurb, keywords) {
  return html`
    <section class="bp-card">
      <div class="bp-card__header"><div class="bp-card__title">${title}</div><span class="bp-tiny bp-subtle">${keywords.length}</span></div>
      <p class="bp-tiny bp-subtle" style="margin:0 0 var(--bp-3)">${blurb}</p>
      ${raw(keywords.length
        ? `<ul data-ak-list="${key}" style="list-style:none;margin:0;padding:0;max-height:260px;overflow-y:auto">${keywords.map((k) => keywordRow(key, k, true)).join("")}</ul>`
        : `<ul data-ak-list="${key}" style="list-style:none;margin:0;padding:0"></ul><p class="bp-small bp-muted">Nothing generated for this book yet — add your own below.</p>`)}
      <form data-ak-add="${key}" class="bp-row" style="gap:8px;margin-top:var(--bp-3)">
        <input class="bp-input" placeholder="Add a keyword…" maxlength="80" style="flex:1;padding:6px 10px">
        <button type="submit" class="bp-btn bp-btn--secondary bp-btn--sm">Add</button>
      </form>
    </section>
  `;
}
