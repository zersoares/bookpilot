// Dashboard home (spec §42).
//
// Answers three questions in the first screenful, in this order:
// what is happening, what is working, and what to do next. Anything
// that doesn't serve one of those three belongs on another page.

import { html, raw, $ } from "../core/dom.js";
import { API, isDemo } from "../core/api.js";
import * as store from "../core/store.js";
import { notify } from "../core/toast.js";
import { openLearnPanel } from "../core/learn.js";
import { pageHead, statGrid, emptyState, fmt, cover, statusBadge, confidenceBadge, demoBadge } from "./shared.js";

export async function render(container) {
  const [{ books }, { campaigns }, analytics, { recommendations }] = await Promise.all([
    API.books(),
    API.campaigns(),
    API.analytics(30).catch(() => ({ totals: null, creatives: [] })),
    API.recommendations().catch(() => ({ recommendations: [] })),
  ]);
  store.set({ books, campaigns });

  const profile = store.get("profile");
  const firstName = (profile?.full_name || "").split(" ")[0];

  if (!books.length) return renderFirstRun(container, firstName);

  const currency = profile?.currency || "EUR";
  const active = campaigns.filter((c) => c.status === "active");
  const bestCreative = [...(analytics.creatives || [])]
    .filter((row) => row.metrics?.hasData && row.metrics.roas !== null)
    .sort((a, b) => b.metrics.roas - a.metrics.roas)[0];
  const topRecommendation = recommendations[0];

  container.innerHTML = html`
    ${raw(pageHead({
      title: firstName ? `Good to see you, ${firstName}` : "Overview",
      description: "What's happening, what's working, and what to do next.",
      actions: `
        <button type="button" class="bp-btn bp-btn--ghost" id="open-learn">How BookPilot works</button>
        <a class="bp-btn bp-btn--primary" href="#/campaigns/new">Create new campaign</a>
      `,
    }))}

    <div class="bp-stack-lg">
      <section>
        <div class="bp-row bp-row--between" style="margin-bottom:var(--bp-3)">
          <h2 style="font-size:1.05rem">Last 30 days</h2>
          <div class="bp-row">${raw(demoBadge())}<a class="bp-small" href="#/analytics">Full analytics →</a></div>
        </div>
        ${raw(statGrid(analytics.totals, currency))}
      </section>

      <div class="bp-grid bp-grid--2">
        <section class="bp-card">
          <div class="bp-card__header">
            <div class="bp-card__title">What's working</div>
            ${raw(bestCreative ? confidenceBadge(bestCreative.confidence) : "")}
          </div>
          ${raw(bestCreative
            ? html`
              <div class="bp-stack-sm">
                <div class="bp-display" style="font-size:1.1rem">“${bestCreative.creative?.headline || "Untitled creative"}”</div>
                <div class="bp-row bp-row--wrap bp-small bp-muted">
                  <span><strong>${fmt.multiple(bestCreative.metrics.roas)}</strong> ROAS</span>
                  <span>${fmt.number(bestCreative.metrics.conversions)} sales</span>
                  <span>${fmt.money(Math.round(bestCreative.metrics.cpa), currency)} per sale</span>
                </div>
                <p class="bp-tiny bp-subtle" style="margin:0">
                  Best performer of the last 30 days, by return on ad spend.
                </p>
                <a class="bp-btn bp-btn--secondary bp-btn--sm" href="#/creatives">See all creatives</a>
              </div>`
            : `<p class="bp-small bp-muted">No creative has enough delivery yet to call a winner. Give a campaign a few days and this fills in.</p>`)}
        </section>

        <section class="bp-card">
          <div class="bp-card__header">
            <div class="bp-card__title">What to do next</div>
            ${raw(topRecommendation ? confidenceBadge(topRecommendation.confidence) : "")}
          </div>
          ${raw(topRecommendation
            ? html`
              <div class="bp-stack-sm">
                <strong>${topRecommendation.title}</strong>
                <p class="bp-small bp-muted" style="margin:0">${topRecommendation.reason || ""}</p>
                ${topRecommendation.metrics?.supporting
                  ? raw(html`<p class="bp-tiny bp-subtle" style="margin:0">${topRecommendation.metrics.supporting}</p>`)
                  : ""}
                <div class="bp-row">
                  <a class="bp-btn bp-btn--primary bp-btn--sm" href="#/advisor">Ask the advisor</a>
                  <button type="button" class="bp-btn bp-btn--ghost bp-btn--sm" data-dismiss="${topRecommendation.id}">Dismiss</button>
                </div>
              </div>`
            : `<div class="bp-stack-sm">
                 <p class="bp-small bp-muted" style="margin:0">
                   Nothing needs your attention right now. When a creative pulls ahead — or stops
                   working — the advisor will say so here.
                 </p>
                 <a class="bp-btn bp-btn--secondary bp-btn--sm" href="#/advisor">Open the AI Advisor</a>
               </div>`)}
        </section>
      </div>

      <section>
        <div class="bp-row bp-row--between" style="margin-bottom:var(--bp-3)">
          <h2 style="font-size:1.05rem">Your books</h2>
          <a class="bp-small" href="#/books">All books →</a>
        </div>
        <div class="bp-grid bp-grid--cards">
          ${raw(books.slice(0, 3).map((book) => bookTile(book, campaigns, currency)).join(""))}
        </div>
      </section>

      <section>
        <div class="bp-row bp-row--between" style="margin-bottom:var(--bp-3)">
          <h2 style="font-size:1.05rem">Campaigns</h2>
          <a class="bp-small" href="#/campaigns">All campaigns →</a>
        </div>
        ${raw(campaigns.length
          ? `<div class="bp-card bp-card--flush"><div class="bp-table-wrap"><table class="bp-table">
               <thead><tr><th>Campaign</th><th>Status</th><th>Budget</th><th class="bp-num">Spend</th><th class="bp-num">Sales</th><th class="bp-num">ROAS</th></tr></thead>
               <tbody>${campaigns.slice(0, 5).map((campaign) => {
                 const row = (analytics.campaigns || []).find((c) => c.campaign.id === campaign.id);
                 const m = row?.metrics;
                 return html`<tr>
                   <td><a href="#/campaigns/${campaign.id}">${campaign.name}</a></td>
                   <td>${raw(statusBadge(campaign.status))}</td>
                   <td>${fmt.money(campaign.daily_budget_cents, campaign.currency)}/day</td>
                   <td class="bp-num">${m ? fmt.money(m.spendCents, campaign.currency) : "—"}</td>
                   <td class="bp-num">${m ? fmt.number(m.conversions) : "—"}</td>
                   <td class="bp-num">${m ? fmt.multiple(m.roas) : "—"}</td>
                 </tr>`;
               }).join("")}</tbody>
             </table></div></div>`
          : emptyState({
              icon: "▶",
              title: "No campaigns yet",
              text: "Your book is ready. Let's find your readers.",
              action: '<a class="bp-btn bp-btn--primary" href="#/campaigns/new">Create campaign</a>',
            }))}
      </section>
    </div>
  `;

  container.querySelectorAll("[data-dismiss]").forEach((button) => {
    button.addEventListener("click", async () => {
      await API.resolveRecommendation(button.dataset.dismiss, "dismissed");
      notify.info("Dismissed.");
      render(container);
    });
  });

  $("#open-learn", container)?.addEventListener("click", () => openLearnPanel());
}

function bookTile(book, campaigns, currency) {
  const bookCampaigns = campaigns.filter((c) => c.book_id === book.id);
  const activeCount = bookCampaigns.filter((c) => c.status === "active").length;
  return html`
    <a class="bp-card bp-card--interactive bp-book-card" href="#/books/${book.id}" style="color:inherit">
      <div class="bp-book-card__cover">${raw(cover(book))}</div>
      <div class="bp-book-card__body">
        <strong class="bp-clamp-2">${book.title}</strong>
        <div class="bp-small bp-muted" style="margin-top:4px">${book.genre || "Genre not set"}</div>
        <div class="bp-row bp-row--wrap" style="margin-top:var(--bp-3);gap:6px">
          ${raw(statusBadge(book.status))}
          ${activeCount ? raw(html`<span class="bp-badge bp-badge--success">${activeCount} active</span>`) : ""}
        </div>
        <div class="bp-tiny bp-subtle" style="margin-top:var(--bp-2)">
          ${book.price_cents !== null && book.price_cents !== undefined
            ? fmt.money(book.price_cents, book.currency || currency)
            : "No price set"}
        </div>
      </div>
    </a>
  `;
}

function renderFirstRun(container, firstName) {
  container.innerHTML = html`
    ${raw(pageHead({
      title: firstName ? `Welcome, ${firstName}` : "Welcome to BookPilot AI",
      description: "One book is all it takes to get started.",
      actions: '<button type="button" class="bp-btn bp-btn--ghost" id="open-learn">How BookPilot works</button>',
    }))}
    ${raw(emptyState({
      icon: "▤",
      title: "No books yet",
      text: "Your next bestseller starts here. Add your book and we'll work out who buys it.",
      action: '<a class="bp-btn bp-btn--primary bp-btn--lg" href="#/books/new">Add your first book</a>',
    }))}
    ${isDemo() ? "" : raw(`
      <p class="bp-small bp-center bp-muted" style="margin-top:var(--bp-5)">
        Want to look around first? <a href="/app.html?demo=1#/overview">Open the demo workspace</a>.
      </p>`)}
  `;
  $("#open-learn", container)?.addEventListener("click", () => openLearnPanel());
}
