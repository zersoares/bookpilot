// TikTok Ads and Google Ads on the Attribution page.
//
// BookPilot does not connect to these platforms' APIs; an author builds and
// runs ads in the platform itself. Two things make BookPilot useful anyway:
//
//   1. A tracked link — the ad's destination URL with BookPilot's campaign
//      id in it, so a sale on the author's own site is credited to the ad
//      that sent the visitor (see website tracking above).
//   2. A report import — spend, impressions, clicks and purchases from an
//      platform's CSV report, shown beside Meta in Analytics.
//
// The screen says plainly that BookPilot cannot see, launch or pause the
// campaign on the platform. Nothing is described as live that BookPilot cannot
// verify.

import { html, raw } from "../core/dom.js";
import { API } from "../core/api.js";
import { notify, confirmDialog } from "../core/toast.js";
import { fmt } from "./shared.js";
import { reportFor } from "../core/ad-report.js";
import { buildTrackedLink } from "../core/tracked-link.js";
import { MAX_FILE_BYTES, CURRENCIES, readFileText, stat } from "./import-shared.js";

// What differs between platforms on screen: names, and how to get a report.
const COPY = {
  tiktok: {
    title: "TikTok Ads",
    tool: "TikTok Ads Manager",
    campaigns: "TikTok campaigns",
    placeholderCampaign: "Spring launch — TikTok",
    placeholderReport: "Date,Campaign name,Cost,Impressions,Clicks (destination),…",
    headerHint: "Campaign name, Date, Cost, Impressions, Clicks, and your purchase count or value",
    steps: [
      "In TikTok Ads Manager, open Reports and create a campaign-level report (menu names change over time).",
      "Pick your date range and break it down <strong>by day</strong>. A report without a daily breakdown can't be placed on days, so it is refused.",
      "Include Cost, Impressions, Clicks, and your purchase count and value (often “Complete payment” and its value).",
      "Export as CSV and choose the file here. Importing the same days again replaces them.",
    ],
    overlap: "TikTok counts purchases its own way and can claim a sale your website or Meta also claims.",
    dayHint: "Export it again with the breakdown set to <em>by day</em>",
  },
  google: {
    title: "Google Ads",
    tool: "Google Ads",
    campaigns: "Google Ads campaigns",
    placeholderCampaign: "Book launch — Search",
    placeholderReport: "Day,Campaign,Clicks,Impr.,Cost,Conversions,Conv. value,…",
    headerHint: "Campaign, Day, Clicks, Impr., Cost, Conversions and Conv. value",
    steps: [
      "In Google Ads, open Campaigns and set the date range you want.",
      "Add the <strong>Day</strong> segment (Segment → Time → Day) so each row is one day, and make sure Clicks, Impr., Cost, Conversions and Conv. value are among the columns.",
      "Download the report as CSV (either “.csv” option works) and choose the file here. Importing the same days again replaces them.",
    ],
    overlap: "Google counts conversions its own way and can claim a sale your website or Meta also claims. Its Conversions column counts every conversion action your account tracks (sign-ups and add-to-carts too, not just purchases), and shared credit makes some of them fractions that are rounded to whole numbers per day. If yours counts more than purchases, choose a purchases-only column, or the numbers here will flatter the campaign.",
    dayHint: "Add the <em>Day</em> segment and export it again",
  },
  pinterest: {
    title: "Pinterest Ads",
    tool: "Pinterest Ads Manager",
    campaigns: "Pinterest campaigns",
    placeholderCampaign: "Book launch — Pinterest",
    placeholderReport: "Date,Campaign name,Spend in account currency,Impressions,Outbound clicks,Checkouts,…",
    headerHint: "Campaign name, Date, Spend, Impressions, Outbound clicks, and your checkouts or their value",
    steps: [
      "In Pinterest Ads Manager, open Reports and create a report at the campaign level (menu names change over time).",
      "Set the date range and the granularity to <strong>daily</strong>. A report without a daily breakdown can't be placed on days, so it is refused.",
      "Include Spend, Impressions, Outbound clicks, and Checkouts with their value if you track purchases.",
      "Download it as CSV and choose the file here. Importing the same days again replaces them.",
    ],
    overlap: "Pinterest counts conversions its own way, over a window after someone clicks or views, and can claim a sale your website or Meta also claims. Its Total conversions counts every conversion event you track (sign-ups and page visits too); use the Checkouts column for purchases, or the numbers here will flatter the campaign.",
    dayHint: "Set the report's granularity to <em>daily</em> and export it again",
  },
};

export function platformCard(platform, summary, tracking, { books = [], connect = "" } = {}) {
  const has = summary && summary.rows > 0;
  const copy = COPY[platform];
  return html`
    <section class="bp-card" data-platform-card data-platform="${platform}">
      <div class="bp-card__header">
        <div class="bp-card__title">${copy.title}</div>
        <span class="bp-badge ${has ? "bp-badge--success" : ""}">${has ? "Imported" : "No data yet"}</span>
      </div>
      <div class="bp-alert bp-alert--info" style="margin-bottom:var(--bp-4)">
        <span class="bp-alert__icon">◆</span>
        <div class="bp-small">
          <strong>How this works.</strong> You build and run your ads in ${copy.tool}; BookPilot
          doesn't connect to your ${copy.title} account, so it can't launch, pause or read a campaign there.
          What it does: give you a <strong>tracked link</strong> so sales on your own site are credited
          to the right ad, and <strong>import your report</strong> so ${copy.title} spend and
          results sit beside Meta in Analytics.
        </div>
      </div>

      ${raw(connect)}

      <h3 class="bp-small" style="margin:var(--bp-5) 0 var(--bp-2)"><strong>1. Tracked link</strong></h3>
      <div data-tt-links>${raw(linkForm(platform, tracking, books))}</div>

      <h3 class="bp-small" style="margin:var(--bp-6) 0 var(--bp-2)"><strong>2. Import a report</strong></h3>
      ${raw(has ? html`
        <dl class="bp-kv" style="margin-bottom:var(--bp-4)">
          <dt>Covers</dt><dd>${fmt.date(summary.from)} to ${fmt.date(summary.to)} · ${fmt.number(summary.days)} days</dd>
          <dt>${copy.campaigns}</dt><dd>${summary.campaigns.slice(0, 4).join(", ")}${summary.campaigns.length > 4 ? ` and ${summary.campaigns.length - 4} more` : ""}</dd>
          <dt>Last import</dt><dd>${summary.last_imported_at ? fmt.relativeTime(summary.last_imported_at) : "—"}</dd>
        </dl>` : "")}
      <div class="bp-row bp-row--wrap">
        <button type="button" class="bp-btn bp-btn--primary bp-btn--sm" data-tt="open">${has ? "Import another report" : "Import a report"}</button>
        ${raw(has ? '<button type="button" class="bp-btn bp-btn--danger bp-btn--sm" data-tt="remove">Remove imported data</button>' : "")}
      </div>
      <div data-tt-importer hidden style="margin-top:var(--bp-5)"></div>

      <details style="margin-top:var(--bp-4)">
        <summary class="bp-small" style="cursor:pointer">Where do I get the report?</summary>
        <ol class="bp-small bp-muted" style="margin:var(--bp-3) 0 0;padding-left:1.2em;display:grid;gap:6px">
          ${raw(copy.steps.map((step) => `<li>${step}</li>`).join(""))}
        </ol>
        <p class="bp-tiny bp-subtle" style="margin:var(--bp-3) 0 0">
          ${copy.overlap}
          Analytics shows each platform separately for that reason; your website tracking is the
          tie-breaker. Reach isn't imported, because unique reach can't be added up across ad groups.
        </p>
      </details>
    </section>
  `;
}

function linkForm(platform, tracking, books) {
  const copy = COPY[platform];
  const campaignOptions = tracking.map((c) => html`<option value="${c.id}">${c.name}</option>`).join("");
  return html`
    <p class="bp-small bp-muted" style="margin:0 0 var(--bp-3)">
      Use this as the destination URL of your ${copy.title} ad. It needs your tracking script on that page
      (see Website tracking above) to credit a sale.
    </p>
    <div class="bp-grid bp-grid--2" style="gap:var(--bp-3)">
      <label class="bp-field" style="margin:0">
        <span class="bp-label">BookPilot campaign for this ad</span>
        <select class="bp-select" data-tt-field="campaign">
          ${raw(tracking.length ? campaignOptions : `<option value="">No ${copy.title} campaign yet — create one</option>`)}
          <option value="__new">＋ New ${copy.title} campaign…</option>
        </select>
      </label>
      <label class="bp-field" style="margin:0">
        <span class="bp-label">Page the ad sends people to</span>
        <input class="bp-input" type="url" data-tt-field="url" placeholder="https://yoursite.com/my-book">
      </label>
    </div>
    <div data-tt-new hidden class="bp-panel" style="margin-top:var(--bp-3)">
      <div class="bp-grid bp-grid--3" style="gap:var(--bp-3)">
        <label class="bp-field" style="margin:0"><span class="bp-label">Campaign name</span>
          <input class="bp-input" data-tt-field="new-name" placeholder="${copy.placeholderCampaign}"></label>
        <label class="bp-field" style="margin:0"><span class="bp-label">Book</span>
          <select class="bp-select" data-tt-field="new-book">${raw(books.map((b) => html`<option value="${b.id}">${b.title}</option>`).join(""))}</select></label>
        <label class="bp-field" style="margin:0"><span class="bp-label">Currency</span>
          <select class="bp-select" data-tt-field="new-currency">${raw(CURRENCIES.map((c) => html`<option>${c}</option>`).join(""))}</select></label>
      </div>
      <button type="button" class="bp-btn bp-btn--secondary bp-btn--sm" data-tt="create" style="margin-top:var(--bp-3)"
        ${books.length ? "" : "disabled"}>Create campaign</button>
      ${raw(books.length ? "" : '<p class="bp-tiny bp-subtle" style="margin:6px 0 0">Add a book first: every campaign belongs to one.</p>')}
    </div>
    <div class="bp-row bp-row--wrap" style="margin-top:var(--bp-3)">
      <button type="button" class="bp-btn bp-btn--primary bp-btn--sm" data-tt="build">Build tracked link</button>
    </div>
    <div data-tt-result hidden style="margin-top:var(--bp-3)">
      <code class="bp-code" data-tt-link style="word-break:break-all"></code>
      <button type="button" class="bp-btn bp-btn--secondary bp-btn--sm" data-tt="copy" style="margin-top:var(--bp-2)">Copy link</button>
    </div>`;
}

/**
 * Wire the card. `done` re-renders the page after anything that changes
 * what is stored.
 */
export function wirePlatform(root, platform, { tracking = [], books = [], defaultCurrency = "EUR", done }) {
  const card = root.querySelector(`[data-platform-card][data-platform="${platform}"]`);
  if (!card) return;
  const importer = card.querySelector("[data-tt-importer]");
  const field = (name) => card.querySelector(`[data-tt-field="${name}"]`);
  const copy = COPY[platform];
  const reader = reportFor(platform);
  const { fields } = reader;
  const nameOf = (key) => fields.find((f) => f.key === key)?.label || key;

  const state = {
    report: null, mapping: null, dayFirst: true, fileName: "",
    currency: CURRENCIES.includes(defaultCurrency) ? defaultCurrency : "EUR", currencyFromReport: false,
    targets: {}, bookId: books[0]?.id || "", built: null,
  };

  // ---- tracked link --------------------------------------------------

  const syncNew = () => { card.querySelector("[data-tt-new]").hidden = field("campaign").value !== "__new"; };
  syncNew();

  // ---- importer --------------------------------------------------------

  function openSource() {
    importer.hidden = false;
    importer.innerHTML = html`
      <div class="bp-panel">
        <strong class="bp-small">Choose your report</strong>
        <div style="margin-top:var(--bp-3)">
          <input type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" data-tt="file" class="bp-input">
        </div>
        <details style="margin-top:var(--bp-3)">
          <summary class="bp-small" style="cursor:pointer">Or paste the report text</summary>
          <textarea class="bp-textarea" rows="6" data-tt="paste" style="margin-top:var(--bp-2)"
            placeholder="${copy.placeholderReport}"></textarea>
          <button type="button" class="bp-btn bp-btn--secondary bp-btn--sm" data-tt="read-paste" style="margin-top:var(--bp-2)">Read this text</button>
        </details>
      </div>
      <div data-tt-review style="margin-top:var(--bp-4)"></div>`;
  }

  function load(text, name) {
    const report = reader.readReport(text);
    state.fileName = name;
    const review = importer.querySelector("[data-tt-review]");
    if (!report.ok) {
      state.report = null;
      review.innerHTML = html`
        <div class="bp-alert bp-alert--warning"><span class="bp-alert__icon">!</span>
          <div class="bp-small"><strong>We couldn't find the column headings.</strong>
            The report needs a header row with at least two of: ${copy.headerHint}.
            Check that this is a ${copy.tool} report saved as CSV.</div>
        </div>`;
      return;
    }
    state.report = report;
    state.mapping = { ...report.mapping };
    state.dayFirst = report.dateFormat.dayFirst;
    // Some exports say which currency they are in; use it rather than ask.
    state.currencyFromReport = Boolean(report.currency && CURRENCIES.includes(report.currency));
    if (state.currencyFromReport) state.currency = report.currency;
    state.targets = {};
    renderReview();
  }

  function defaultTarget(name) {
    const match = tracking.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase());
    return match ? match.id : "__create";
  }

  function renderReview() {
    const { report, mapping } = state;
    const built = reader.buildRows(report.data, mapping, { dayFirst: state.dayFirst });
    state.built = built;
    for (const name of built.campaigns) if (state.targets[name] === undefined) state.targets[name] = defaultTarget(name);

    const hasMetric = fields.some((f) => f.metric && mapping[f.key] !== -1);
    const needsBook = built.campaigns.some((n) => state.targets[n] === "__create");
    const canImport = built.rows.length > 0 && hasMetric && (!needsBook || state.bookId);
    const options = (selected) => [
      `<option value="-1" ${selected === -1 ? "selected" : ""}>— not in this report —</option>`,
      ...report.headers.map((h, i) => html`<option value="${i}" ${selected === i ? "selected" : ""}>${h || `Column ${i + 1}`}</option>`),
    ].join("");

    importer.querySelector("[data-tt-review]").innerHTML = html`
      <div class="bp-panel">
        <strong class="bp-small">Check what we understood</strong>
        <p class="bp-tiny bp-subtle" style="margin:4px 0 var(--bp-3)">
          ${state.fileName ? `${state.fileName} · ` : ""}${fmt.number(report.data.length)} rows under these headings.
          ${copy.title}'s column names vary, so correct any we guessed wrong.
        </p>
        <div class="bp-grid bp-grid--2" style="gap:var(--bp-3)">
          ${raw(fields.map((f) => html`
            <label class="bp-field" style="margin:0"><span class="bp-label">${f.label}</span>
              <select class="bp-select" data-tt-map="${f.key}">${raw(options(mapping[f.key]))}</select></label>`).join(""))}
        </div>
        <div class="bp-grid bp-grid--2" style="gap:var(--bp-3);margin-top:var(--bp-3)">
          ${raw(mapping.date !== -1 && !report.dateFormat.certain ? html`
            <label class="bp-field" style="margin:0"><span class="bp-label">Date format</span>
              <select class="bp-select" data-tt="dayfirst">
                <option value="1" ${state.dayFirst ? "selected" : ""}>Day first (31/12/2026)</option>
                <option value="0" ${!state.dayFirst ? "selected" : ""}>Month first (12/31/2026)</option>
              </select>
              <span class="bp-tiny bp-subtle">Every date in this file could be read either way, so check the preview.</span></label>` : "")}
          <label class="bp-field" style="margin:0"><span class="bp-label">Currency of the report</span>
            <select class="bp-select" data-tt="currency">${raw(CURRENCIES.map((c) => html`<option ${c === state.currency ? "selected" : ""}>${c}</option>`).join(""))}</select>
            <span class="bp-tiny bp-subtle">${state.currencyFromReport ? "Read from the report." : `The currency of your ${copy.title} account.`}</span></label>
        </div>
      </div>

      <div class="bp-panel" style="margin-top:var(--bp-4)">
        <strong class="bp-small">Preview</strong>
        ${raw(built.needsDate
          ? `<div class="bp-alert bp-alert--warning" style="margin-top:var(--bp-2)"><span class="bp-alert__icon">!</span><div class="bp-small"><strong>This report has no date column.</strong> ${copy.dayHint}, so each figure can be placed on its day.</div></div>`
          : !hasMetric ? '<p class="bp-small bp-muted" style="margin-top:var(--bp-2)">Choose at least one figure column (cost, clicks…) above.</p>'
          : !built.rows.length ? html`<p class="bp-small bp-muted" style="margin-top:var(--bp-2)">No rows could be read with these settings.${built.skipped[0] ? ` For example, row ${built.skipped[0].line}: ${built.skipped[0].reason}.` : ""}</p>`
          : html`
            <p class="bp-tiny bp-subtle" style="margin:4px 0 var(--bp-3)">
              ${fmt.number(built.rows.length)} campaign-days across ${fmt.number(built.campaigns.length)} campaign${built.campaigns.length === 1 ? "" : "s"},
              ${fmt.date(built.from)} to ${fmt.date(built.to)}.
            </p>
            <div class="bp-grid bp-grid--3" style="gap:var(--bp-2)">
              ${raw(stat("Spend", fmt.money(built.totals.spend_cents, state.currency)))}
              ${raw(stat("Impressions", fmt.number(built.totals.impressions)))}
              ${raw(stat("Clicks", fmt.number(built.totals.clicks)))}
              ${raw(stat(nameOf("conversions"), fmt.number(built.totals.conversions)))}
              ${raw(stat(nameOf("revenue"), fmt.money(built.totals.revenue_cents, state.currency)))}
            </div>
            <div class="bp-table-wrap" style="margin-top:var(--bp-3)"><table class="bp-table">
              <thead><tr><th>Date</th><th>Campaign</th><th class="bp-num">Spend</th><th class="bp-num">Clicks</th><th class="bp-num">${nameOf("conversions").replace(/ \(.*\)$/, "")}</th></tr></thead>
              <tbody>${raw(built.rows.slice(0, 6).map((r) => html`<tr><td class="bp-small">${fmt.date(r.date)}</td><td class="bp-small">${r.campaign}</td>
                <td class="bp-small bp-num">${fmt.money(r.spend_cents, state.currency)}</td><td class="bp-small bp-num">${fmt.number(r.clicks)}</td>
                <td class="bp-small bp-num">${fmt.number(r.conversions)}</td></tr>`).join(""))}</tbody></table></div>
            ${raw(built.rows.length > 6 ? `<p class="bp-tiny bp-subtle" style="margin:6px 0 0">…and ${fmt.number(built.rows.length - 6)} more.</p>` : "")}`)}
        ${raw(built.skipped.length ? html`
          <div class="bp-alert bp-alert--info" style="margin-top:var(--bp-3)"><span class="bp-alert__icon">i</span>
            <div class="bp-small">${fmt.number(built.skipped.length)} row${built.skipped.length === 1 ? " was" : "s were"} left out.
              ${built.skipped.slice(0, 3).map((s) => `Row ${s.line}: ${s.reason}.`).join(" ")}
              Totals rows are left out on purpose, so nothing is counted twice.</div></div>` : "")}
      </div>

      ${raw(built.campaigns.length ? html`
        <div class="bp-panel" style="margin-top:var(--bp-4)">
          <strong class="bp-small">Where each ${copy.title} campaign goes</strong>
          <p class="bp-tiny bp-subtle" style="margin:4px 0 var(--bp-3)">Campaigns with the same name as one of yours are matched for you. Otherwise a new BookPilot campaign is created to hold the figures. BookPilot can't launch or change it on ${copy.tool}.</p>
          <div class="bp-stack-sm">
            ${raw(built.campaigns.slice(0, 40).map((name) => html`
              <label class="bp-row bp-row--between" style="gap:var(--bp-3)">
                <span class="bp-small" style="min-width:0;overflow-wrap:anywhere">${name}</span>
                <select class="bp-select" data-tt-target="${name}" style="max-width:55%">
                  <option value="__create" ${state.targets[name] === "__create" ? "selected" : ""}>Create a new campaign</option>
                  ${raw(tracking.map((c) => html`<option value="${c.id}" ${state.targets[name] === c.id ? "selected" : ""}>${c.name} (${c.currency})</option>`).join(""))}
                </select>
              </label>`).join(""))}
          </div>
          ${raw(built.campaigns.length > 40 ? '<p class="bp-tiny bp-subtle" style="margin:6px 0 0">This report has more than 40 campaigns; import it in smaller parts.</p>' : "")}
          ${raw(needsBook ? html`
            <label class="bp-field" style="margin:var(--bp-3) 0 0"><span class="bp-label">Book for the new campaigns</span>
              <select class="bp-select" data-tt="book">${raw(books.map((b) => html`<option value="${b.id}" ${b.id === state.bookId ? "selected" : ""}>${b.title}</option>`).join(""))}</select>
              ${raw(books.length ? "" : '<span class="bp-tiny bp-subtle">Add a book first: every campaign belongs to one.</span>')}</label>` : "")}
        </div>` : "")}

      <div class="bp-row bp-row--wrap" style="margin-top:var(--bp-4)">
        <button type="button" class="bp-btn bp-btn--primary" data-tt="import" ${canImport && built.campaigns.length <= 40 ? "" : "disabled"}>
          Import ${built.rows.length ? fmt.number(built.rows.length) : ""} campaign-days</button>
        <button type="button" class="bp-btn bp-btn--ghost" data-tt="cancel">Cancel</button>
      </div>`;
  }

  // ---- events ----------------------------------------------------------

  card.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-tt]")?.dataset.tt;
    if (!action) return;

    if (action === "create") {
      const button = event.target.closest("button");
      button.disabled = true;
      try {
        const { campaign } = await API.createPlatformCampaign(platform, {
          name: field("new-name").value.trim(), book_id: field("new-book").value, currency: field("new-currency").value,
          destination_url: field("url").value.trim() || undefined,
        });
        notify.success(`Created “${campaign.name}”. It's listed above.`);
        done?.();
      } catch (err) { notify.error(err.message); button.disabled = false; }
    } else if (action === "build") {
      try {
        const campaignId = field("campaign").value;
        if (campaignId === "__new") throw new Error("Create the campaign first, then build the link.");
        const link = buildTrackedLink({ url: field("url").value, platform, campaignId });
        card.querySelector("[data-tt-link]").textContent = link;
        card.querySelector("[data-tt-result]").hidden = false;
      } catch (err) { notify.error(err.message); }
    } else if (action === "copy") {
      try {
        await navigator.clipboard.writeText(card.querySelector("[data-tt-link]").textContent);
        notify.success("Copied to your clipboard.");
      } catch { notify.info("Select the link and copy it manually."); }
    } else if (action === "open") {
      openSource();
    } else if (action === "cancel") {
      importer.hidden = true; importer.innerHTML = "";
    } else if (action === "read-paste") {
      const text = importer.querySelector('[data-tt="paste"]').value;
      if (text.trim()) load(text, "Pasted text");
    } else if (action === "remove") {
      const ok = await confirmDialog({
        title: `Remove imported ${copy.title} data?`,
        message: `This deletes the ${copy.title} figures you imported from BookPilot. The campaigns you created for them, your ${copy.title} account and your reports are untouched, and you can import again.`,
        confirmLabel: "Remove", tone: "danger",
      });
      if (!ok) return;
      try { await API.platformRemove(platform); notify.success(`Imported ${copy.title} data removed.`); done?.(); }
      catch (err) { notify.error(err.message); }
    } else if (action === "import") {
      const button = event.target.closest("button");
      button.disabled = true;
      try {
        const targets = state.built.campaigns.map((campaign) =>
          state.targets[campaign] === "__create"
            ? { campaign, book_id: state.bookId }
            : { campaign, campaign_id: state.targets[campaign] });
        const result = await API.platformImport(platform, { rows: state.built.rows, currency: state.currency, targets });
        notify.success(`Imported ${fmt.number(result.imported)} campaign-days, ${fmt.date(result.from)} to ${fmt.date(result.to)}.`);
        done?.();
      } catch (err) { notify.error(err.message); button.disabled = false; }
    }
  });

  card.addEventListener("change", async (event) => {
    const t = event.target;
    if (t.matches('[data-tt-field="campaign"]')) { syncNew(); return; }
    if (t.matches('[data-tt="file"]')) {
      const file = t.files?.[0];
      if (!file) return;
      if (file.size > MAX_FILE_BYTES) { notify.error("That file is over 5 MB. Export a shorter date range."); return; }
      try { load(await readFileText(file), file.name); } catch { notify.error("We couldn't read that file."); }
      return;
    }
    if (!state.report) return;
    if (t.matches("[data-tt-map]")) state.mapping[t.dataset.ttMap] = Number(t.value);
    else if (t.matches('[data-tt="dayfirst"]')) state.dayFirst = t.value === "1";
    else if (t.matches('[data-tt="currency"]')) state.currency = t.value;
    else if (t.matches('[data-tt="book"]')) { state.bookId = t.value; return; }
    else if (t.matches("[data-tt-target]")) state.targets[t.dataset.ttTarget] = t.value;
    else return;
    renderReview();
  });
}
