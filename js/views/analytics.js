// Analytics (spec §19, §20).
//
// Two questions, in order: how is the money doing, and which creative is
// responsible. Anything with a zero denominator reads "N/A", and a
// campaign with no delivery reads "not enough data" — never a row of
// zeroes that looks like a verdict.

import { html, raw, $ } from "../core/dom.js";
import { API } from "../core/api.js";
import * as store from "../core/store.js";
import { navigate } from "../core/router.js";
import { pageHead, emptyState, statGrid, confidenceBadge, fmt, demoBadge, scoreBadge } from "./shared.js";

let sortKey = "roas";
let sortDir = "desc";

export async function render(container, params, query) {
  const days = Number(query?.get("days")) || 30;
  const analytics = await API.analytics(days);
  const currency = store.get("profile")?.currency || "EUR";

  if (!analytics.campaigns?.length) {
    container.innerHTML =
      pageHead({ title: "Analytics", description: "Spend, sales and return on ad spend." }) +
      emptyState({
        icon: "▦",
        title: "No performance data",
        text: "Your campaign hasn't generated enough data yet. Numbers appear here once ads have been delivering for a day or two.",
        action: '<a class="bp-btn bp-btn--primary" href="#/campaigns/new">Create a campaign</a>',
      });
    return;
  }

  container.innerHTML = html`
    ${raw(pageHead({
      title: "Analytics",
      description: `Last ${days} days across every campaign.`,
      actions: `${demoBadge()}
        <select class="bp-select" id="range" style="width:auto">
          <option value="7" ${days === 7 ? "selected" : ""}>Last 7 days</option>
          <option value="30" ${days === 30 ? "selected" : ""}>Last 30 days</option>
          <option value="90" ${days === 90 ? "selected" : ""}>Last 90 days</option>
        </select>`,
    }))}

    <div class="bp-stack-lg">
      <section>${raw(statGrid(analytics.totals, currency))}</section>

      ${raw(analytics.platforms?.length > 1 || analytics.platforms?.some((p) => p.source !== "meta") ? platformPanel(analytics.platforms, currency) : "")}

      ${raw(analytics.profit ? profitPanel(analytics.profit) : "")}

      ${raw(analytics.amazon ? amazonPanel(analytics.amazon, currency) : "")}

      ${raw(analytics.kdpSales ? kdpSalesPanel(analytics.kdpSales, currency) : "")}

      <section>
        <div class="bp-row bp-row--between" style="margin-bottom:var(--bp-3)">
          <h2 style="font-size:1.05rem">Creative performance</h2>
          <span class="bp-tiny bp-subtle">Sorted by ${sortKey.toUpperCase()}</span>
        </div>
        <div id="creative-table"></div>
      </section>

      <section>
        <h2 style="font-size:1.05rem;margin-bottom:var(--bp-3)">By campaign</h2>
        <div class="bp-card bp-card--flush">
          <div class="bp-table-wrap">
            <table class="bp-table">
              <thead>
                <tr><th>Campaign</th><th class="bp-num">Spend</th><th class="bp-num">Clicks</th>
                <th class="bp-num">CTR</th><th class="bp-num">CPC</th><th class="bp-num">Sales</th>
                <th class="bp-num">CPA</th><th class="bp-num">Revenue</th><th class="bp-num">ROAS</th></tr>
              </thead>
              <tbody>
                ${raw(analytics.campaigns.map(({ campaign, metrics: m }) => html`<tr>
                  <td><a href="#/campaigns/${campaign.id}">${campaign.name}</a></td>
                  <td class="bp-num">${m.hasData ? fmt.money(m.spendCents, campaign.currency) : "—"}</td>
                  <td class="bp-num">${m.hasData ? fmt.number(m.clicks) : "—"}</td>
                  <td class="bp-num">${fmt.percent(m.ctr)}</td>
                  <td class="bp-num">${m.cpc === null ? "N/A" : fmt.money(Math.round(m.cpc), campaign.currency)}</td>
                  <td class="bp-num">${m.hasData ? fmt.number(m.conversions) : "—"}</td>
                  <td class="bp-num">${m.cpa === null ? "N/A" : fmt.money(Math.round(m.cpa), campaign.currency)}</td>
                  <td class="bp-num">${m.hasData ? fmt.money(m.revenueCents, campaign.currency) : "—"}</td>
                  <td class="bp-num">${fmt.multiple(m.roas)}</td>
                </tr>`).join(""))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <p class="bp-tiny bp-subtle">
        Rates are calculated from delivered data only. A rate whose denominator is zero shows as N/A
        rather than 0 — an ad with no impressions has an unknown click-through rate, not a bad one.
      </p>
    </div>
  `;

  $("#range").addEventListener("change", (event) => {
    navigate(`/analytics?days=${event.target.value}`);
  });

  paintCreatives(analytics.creatives || [], currency);
}

function paintCreatives(rows, currency) {
  const target = $("#creative-table");
  if (!rows.length) {
    target.innerHTML = emptyState({
      icon: "◐",
      title: "No creative-level data yet",
      text: "Once ads have delivered, each creative's own numbers appear here so you can see which one is doing the work.",
    });
    return;
  }

  const value = (row) => {
    const m = row.metrics;
    switch (sortKey) {
      case "spend": return m.spendCents;
      case "clicks": return m.clicks;
      case "ctr": return m.ctr ?? -1;
      case "conversions": return m.conversions;
      case "revenue": return m.revenueCents;
      default: return m.roas ?? -1;
    }
  };
  const sorted = [...rows].sort((a, b) => (sortDir === "desc" ? value(b) - value(a) : value(a) - value(b)));

  // Only call a winner when there is enough evidence to mean it. A "best
  // performer" badge on 12 clicks is how authors end up scaling noise.
  const eligible = sorted.filter((row) => row.confidence !== "insufficient" && row.metrics.roas !== null);
  const best = eligible.length > 1 ? eligible[0] : null;
  const worst = sorted.find((row) => row.metrics.clicks >= 40 && row.metrics.conversions === 0);

  const header = (key, label, numeric = true) => html`
    <th class="${numeric ? "bp-num" : ""}" data-sortable data-key="${key}">
      ${label}${sortKey === key ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
    </th>`;

  target.innerHTML = html`
    <div class="bp-card bp-card--flush">
      <div class="bp-table-wrap">
        <table class="bp-table">
          <thead>
            <tr>
              <th>Creative</th>
              ${raw(header("spend", "Spend"))}
              ${raw(header("clicks", "Clicks"))}
              ${raw(header("ctr", "CTR"))}
              ${raw(header("conversions", "Purchases"))}
              ${raw(header("revenue", "Revenue"))}
              ${raw(header("roas", "ROAS"))}
              <th>Score</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            ${raw(sorted.map((row) => {
              const m = row.metrics;
              const flag = best && row.creative?.id === best.creative?.id
                ? '<span title="Best performer">🏆</span> '
                : worst && row.creative?.id === worst.creative?.id
                  ? '<span title="Needs attention">⚠️</span> '
                  : "";
              return html`<tr>
                <td>${raw(flag)}<a href="#/creatives/${row.creative?.id}">${row.creative?.headline || "Creative"}</a></td>
                <td class="bp-num">${fmt.money(m.spendCents, currency)}</td>
                <td class="bp-num">${fmt.number(m.clicks)}</td>
                <td class="bp-num">${fmt.percent(m.ctr)}</td>
                <td class="bp-num">${fmt.number(m.conversions)}</td>
                <td class="bp-num">${fmt.money(m.revenueCents, currency)}</td>
                <td class="bp-num">${fmt.multiple(m.roas)}</td>
                <td>${raw(scoreBadge(row.creative?.score))}</td>
                <td>${raw(confidenceBadge(row.confidence))}</td>
              </tr>`;
            }).join(""))}
          </tbody>
        </table>
      </div>
    </div>
    ${raw(best ? html`
      <p class="bp-tiny bp-subtle" style="margin-top:var(--bp-3)">
        🏆 marks the strongest performer with enough delivery to be worth acting on. ⚠️ marks a
        creative that has taken real traffic without a recorded sale.
      </p>` : `
      <p class="bp-tiny bp-subtle" style="margin-top:var(--bp-3)">
        No creative has enough delivery yet to be called a winner, so none is marked.
      </p>`)}
  `;

  target.querySelectorAll("[data-sortable]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.key;
      if (sortKey === key) sortDir = sortDir === "desc" ? "asc" : "desc";
      else { sortKey = key; sortDir = "desc"; }
      paintCreatives(rows, currency);
    });
  });
}

const PLATFORM_NAME = { meta: "Meta (Facebook & Instagram)", tiktok: "TikTok", google: "Google Ads", pinterest: "Pinterest" };

function platformPanel(platforms, currency) {
  return html`
    <section>
      <h2 style="font-size:1.05rem;margin-bottom:var(--bp-3)">By platform</h2>
      <div class="bp-card bp-card--flush">
        <div class="bp-table-wrap">
          <table class="bp-table">
            <thead><tr><th>Platform</th><th class="bp-num">Spend</th><th class="bp-num">Clicks</th><th class="bp-num">CTR</th>
              <th class="bp-num">CPC</th><th class="bp-num">Sales</th><th class="bp-num">CPA</th><th class="bp-num">Revenue</th><th class="bp-num">ROAS</th></tr></thead>
            <tbody>
              ${raw(platforms.map(({ source, metrics: m }) => html`<tr>
                <td>${PLATFORM_NAME[source] || source}</td>
                <td class="bp-num">${fmt.money(m.spendCents, currency)}</td>
                <td class="bp-num">${fmt.number(m.clicks)}</td>
                <td class="bp-num">${fmt.percent(m.ctr)}</td>
                <td class="bp-num">${m.cpc === null ? "N/A" : fmt.money(Math.round(m.cpc), currency)}</td>
                <td class="bp-num">${fmt.number(m.conversions)}</td>
                <td class="bp-num">${m.cpa === null ? "N/A" : fmt.money(Math.round(m.cpa), currency)}</td>
                <td class="bp-num">${fmt.money(m.revenueCents, currency)}</td>
                <td class="bp-num">${m.roas === null ? "N/A" : fmt.multiple(m.roas)}</td>
              </tr>`).join(""))}
            </tbody>
          </table>
        </div>
      </div>
      <p class="bp-tiny bp-subtle" style="margin:var(--bp-2) 0 0">
        Each platform counts sales its own way and can claim a sale another also claims, so the totals above
        can count one sale twice. Figures assume one currency: campaigns in different currencies are not converted.
      </p>
    </section>
  `;
}

function amazonPanel(amazon, currency) {
  const shownCurrency = amazon.currency || currency;
  return html`
    <section class="bp-card">
      <div class="bp-card__header">
        <div class="bp-card__title">Amazon-attributed</div>
        <span class="bp-badge bp-badge--info">Amazon Attribution</span>
      </div>
      <p class="bp-small bp-muted">
        Imported from Amazon Attribution and reported on its own. Amazon counts conversions
        differently from Meta and from your website, so these figures are never added to the totals
        above.${amazon.from ? ` Covers ${fmt.date(amazon.from)} to ${fmt.date(amazon.to)}, from the report${amazon.importedAt ? ` imported ${fmt.relativeTime(amazon.importedAt)}` : "s you imported"}.` : ""}
        <a href="#/attribution">Import another report</a>
      </p>
      <div class="bp-stat-grid">
        <div class="bp-stat"><div class="bp-stat__label">Clicks</div><div class="bp-stat__value">${fmt.number(amazon.clicks)}</div></div>
        <div class="bp-stat"><div class="bp-stat__label">Detail page views</div><div class="bp-stat__value">${fmt.number(amazon.detailPageViews)}</div></div>
        <div class="bp-stat"><div class="bp-stat__label">Add to cart</div><div class="bp-stat__value">${fmt.number(amazon.addToCarts)}</div></div>
        <div class="bp-stat"><div class="bp-stat__label">Purchases</div><div class="bp-stat__value">${fmt.number(amazon.purchases)}</div></div>
        <div class="bp-stat"><div class="bp-stat__label">Units sold</div><div class="bp-stat__value">${fmt.number(amazon.unitsSold)}</div></div>
        <div class="bp-stat"><div class="bp-stat__label">Product sales</div><div class="bp-stat__value">${amazon.mixedCurrencies ? "Mixed currencies" : fmt.money(amazon.productSalesCents, shownCurrency)}</div></div>
        ${raw(amazon.kindlePagesRead ? html`<div class="bp-stat"><div class="bp-stat__label">Kindle pages read</div><div class="bp-stat__value">${fmt.number(amazon.kindlePagesRead)}</div></div>` : "")}
        ${raw(amazon.kindleRoyaltiesCents ? html`<div class="bp-stat"><div class="bp-stat__label">Est. page-read royalties</div><div class="bp-stat__value">${amazon.mixedCurrencies ? "Mixed currencies" : fmt.money(amazon.kindleRoyaltiesCents, shownCurrency)}</div></div>` : "")}
      </div>
      ${raw(amazon.kindlePagesRead || amazon.kindleRoyaltiesCents ? '<p class="bp-tiny bp-subtle" style="margin:var(--bp-3) 0 0">Kindle pages read are pages read by Kindle Unlimited readers within 14 days of an ad click. The royalties are Amazon\'s estimate for those pages and are not included in product sales.</p>' : "")}
    </section>
  `;
}

/**
 * Real, actual-money profit: royalties earned (imported from KDP) against
 * what was spent to earn them — the one figure no ad platform can show,
 * because a platform only ever reports what it claims credit for.
 */
function profitPanel(profit) {
  const positive = profit.netCents >= 0;
  return html`
    <section class="bp-card">
      <div class="bp-card__header">
        <div class="bp-card__title">Profit — royalties vs. ad spend</div>
        <span class="bp-badge ${positive ? "bp-badge--success" : "bp-badge--warning"}">${positive ? "In profit" : "Behind"}</span>
      </div>
      <p class="bp-small bp-muted">
        Your imported KDP royalties for this period, minus what you spent across every ad platform in
        the same window. This is the whole book's royalties, not just ad-attributed sales, against the
        whole ad spend — so it is the closest thing here to "did this actually make money", not just
        "did this ad get credited with a sale".
      </p>
      <div class="bp-stat-grid" style="margin-top:var(--bp-3)">
        <div class="bp-stat"><div class="bp-stat__label">Royalties earned</div><div class="bp-stat__value">${fmt.money(profit.royaltyCents, profit.currency)}</div></div>
        <div class="bp-stat"><div class="bp-stat__label">Ad spend</div><div class="bp-stat__value">${fmt.money(profit.spendCents, profit.currency)}</div></div>
        <div class="bp-stat"><div class="bp-stat__label">Net</div><div class="bp-stat__value" style="color:${positive ? "var(--bp-success)" : "var(--bp-danger)"}">${positive ? "+" : ""}${fmt.money(profit.netCents, profit.currency)}</div></div>
      </div>
      <p class="bp-tiny bp-subtle" style="margin-top:var(--bp-3)">
        Royalties are what KDP reports for every sale, on any channel, in this window — not only the
        ones an ad is claimed to have caused. Spend is your ad platforms' totals for the same window.
        Shown only when both are in the same currency.
      </p>
    </section>
  `;
}

function kdpSalesPanel(kdp, currency) {
  const shownCurrency = kdp.currency || currency;
  return html`
    <section class="bp-card">
      <div class="bp-card__header">
        <div class="bp-card__title">KDP sales &amp; royalties</div>
        <span class="bp-badge bp-badge--info">Whole-book, not ad-attributed</span>
      </div>
      <p class="bp-small bp-muted">
        Imported from your KDP sales or royalty report. This covers every sale of the book, whichever
        channel it came from — never added to the ad-platform totals above, which only count sales a
        platform claims credit for.${kdp.from ? ` Covers ${fmt.date(kdp.from)} to ${fmt.date(kdp.to)}, from the report${kdp.importedAt ? ` imported ${fmt.relativeTime(kdp.importedAt)}` : "s you imported"}.` : ""}
        <a href="#/attribution">Import another report</a>
      </p>
      <div class="bp-stat-grid">
        <div class="bp-stat"><div class="bp-stat__label">Units sold</div><div class="bp-stat__value">${fmt.number(kdp.unitsSold)}</div></div>
        <div class="bp-stat"><div class="bp-stat__label">Units refunded</div><div class="bp-stat__value">${fmt.number(kdp.unitsRefunded)}</div></div>
        <div class="bp-stat"><div class="bp-stat__label">Net units sold</div><div class="bp-stat__value">${fmt.number(kdp.netUnitsSold)}</div></div>
        <div class="bp-stat"><div class="bp-stat__label">Royalty</div><div class="bp-stat__value">${kdp.mixedCurrencies ? "Mixed currencies" : fmt.money(kdp.royaltyCents, shownCurrency)}</div></div>
        ${raw(kdp.kenpPagesRead ? html`<div class="bp-stat"><div class="bp-stat__label">Kindle pages read</div><div class="bp-stat__value">${fmt.number(kdp.kenpPagesRead)}</div></div>` : "")}
        ${raw(kdp.kenpRoyaltyCents ? html`<div class="bp-stat"><div class="bp-stat__label">Est. page-read royalty</div><div class="bp-stat__value">${kdp.mixedCurrencies ? "Mixed currencies" : fmt.money(kdp.kenpRoyaltyCents, shownCurrency)}</div></div>` : "")}
      </div>
    </section>
  `;
}
