// Importing an Amazon Attribution report.
//
// BookPilot cannot read Amazon Attribution data itself — that needs
// approved Amazon Ads API access — but the Attribution console lets an
// advertiser download reports as CSV. This is the door for that file:
// choose it, check what BookPilot understood, import.
//
// The screen shows its working. Amazon's exports vary, so the columns are
// a guess the author can correct, the preview totals are computed before
// anything is stored, and rows that were left out are listed with the
// reason. Imported figures stay labelled Amazon-attributed and are never
// added to Meta or website numbers.

import { html, raw } from "../core/dom.js";
import { API } from "../core/api.js";
import { notify, confirmDialog } from "../core/toast.js";
import { fmt } from "./shared.js";
import { FIELDS, readReport, buildRows } from "../core/amazon-report.js";
import { MAX_FILE_BYTES, CURRENCIES, readFileText, stat } from "./import-shared.js";

/** The card's static part: what is imported, and the buttons. */
export function amazonImportBlock(summary) {
  const has = summary && summary.rows > 0;
  return html`
    ${raw(has ? html`
      <dl class="bp-kv" style="margin-bottom:var(--bp-4)">
        <dt>Covers</dt><dd>${fmt.date(summary.from)} to ${fmt.date(summary.to)} · ${fmt.number(summary.days)} days</dd>
        <dt>Amazon campaigns</dt><dd>${summary.campaigns.slice(0, 4).join(", ")}${summary.campaigns.length > 4 ? ` and ${summary.campaigns.length - 4} more` : ""}</dd>
        <dt>Last import</dt><dd>${summary.last_imported_at ? fmt.relativeTime(summary.last_imported_at) : "—"}</dd>
      </dl>` : "")}
    <div class="bp-row bp-row--wrap">
      <button type="button" class="bp-btn bp-btn--primary bp-btn--sm" data-amazon="open">${has ? "Import another report" : "Import a report"}</button>
      ${raw(has ? '<button type="button" class="bp-btn bp-btn--danger bp-btn--sm" data-amazon="remove">Remove imported data</button>' : "")}
    </div>
    <div data-amazon-importer hidden style="margin-top:var(--bp-5)"></div>
    <details style="margin-top:var(--bp-4)">
      <summary class="bp-small" style="cursor:pointer">Where do I get the report?</summary>
      <ol class="bp-small bp-muted" style="margin:var(--bp-3) 0 0;padding-left:1.2em;display:grid;gap:6px">
        <li>In the Amazon Attribution console, open your reports (menu names differ a little between marketplaces).</li>
        <li>Choose the date range you want, and a <strong>daily</strong> breakdown if it offers one. A report with no dates can still be imported, but all of it is recorded on a single day you choose.</li>
        <li>Download it as CSV and choose the file here. Reports over ${"3,000"} campaign-days can be imported in date ranges.</li>
      </ol>
      <p class="bp-tiny bp-subtle" style="margin:var(--bp-3) 0 0">
        Importing the same days again replaces them, so it is safe to download an overlapping range
        when Amazon updates recent figures. Nothing leaves your browser except the rows you confirm.
      </p>
    </details>
  `;
}

/**
 * Wire the importer. `done` is called after a successful import or
 * removal, so the page can re-render with the new summary.
 */
export function wireAmazonImport(root, { campaigns = [], defaultCurrency = "EUR", done }) {
  const importer = root.querySelector("[data-amazon-importer]");
  if (!importer) return;

  const state = {
    report: null,
    mapping: null,
    dayFirst: true,
    undatedDate: "",
    currency: CURRENCIES.includes(defaultCurrency) ? defaultCurrency : "EUR",
    links: {},
    fileName: "",
  };

  function openSource() {
    importer.hidden = false;
    importer.innerHTML = html`
      <div class="bp-panel">
        <strong class="bp-small">1. Choose your report</strong>
        <div style="margin-top:var(--bp-3)">
          <input type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" data-amazon="file" class="bp-input">
        </div>
        <details style="margin-top:var(--bp-3)">
          <summary class="bp-small" style="cursor:pointer">Or paste the report text</summary>
          <textarea class="bp-textarea" rows="6" data-amazon="paste" style="margin-top:var(--bp-2)"
            placeholder="Date,Campaign,Click-throughs,Detail page views,…"></textarea>
          <button type="button" class="bp-btn bp-btn--secondary bp-btn--sm" data-amazon="read-paste" style="margin-top:var(--bp-2)">Read this text</button>
        </details>
      </div>
      <div data-amazon-review style="margin-top:var(--bp-4)"></div>`;
  }

  function load(text, name) {
    const report = readReport(text);
    state.fileName = name;
    if (!report.ok) {
      state.report = null;
      importer.querySelector("[data-amazon-review]").innerHTML = html`
        <div class="bp-alert bp-alert--warning">
          <span class="bp-alert__icon">!</span>
          <div class="bp-small">
            <strong>We couldn't find the column headings.</strong>
            The report needs a header row with at least two of: Campaign, Date, Clicks (or Click-throughs),
            Detail page views, Add to cart, Purchases, Units sold, Product sales. Check that this is an
            Amazon Attribution campaign report saved as CSV.
          </div>
        </div>`;
      return;
    }
    state.report = report;
    state.mapping = { ...report.mapping };
    state.dayFirst = report.dateFormat.dayFirst;
    state.undatedDate = "";
    state.links = {};
    review();
  }

  function autoLinks(names) {
    // Link an Amazon campaign to a BookPilot one only when the names are
    // the same; anything looser is a guess about where money went.
    for (const name of names) {
      if (state.links[name] !== undefined) continue;
      const match = campaigns.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase());
      state.links[name] = match ? match.id : "";
    }
  }

  function review() {
    const { report, mapping } = state;
    const built = buildRows(report.data, mapping, { dayFirst: state.dayFirst, undatedDate: state.undatedDate || null });
    autoLinks(built.campaigns);

    const hasMetric = FIELDS.some((f) => f.metric && mapping[f.key] !== -1);
    const dated = mapping.date !== -1;
    const canImport = built.rows.length > 0 && hasMetric && (dated || state.undatedDate);
    const options = (selected) => [
      `<option value="-1" ${selected === -1 ? "selected" : ""}>— not in this report —</option>`,
      ...report.headers.map((h, i) => html`<option value="${i}" ${selected === i ? "selected" : ""}>${h || `Column ${i + 1}`}</option>`),
    ].join("");

    const target = importer.querySelector("[data-amazon-review]");
    target.innerHTML = html`
      <div class="bp-panel">
        <strong class="bp-small">2. Check what we understood</strong>
        <p class="bp-tiny bp-subtle" style="margin:4px 0 var(--bp-3)">
          ${state.fileName ? `${state.fileName} · ` : ""}${fmt.number(report.data.length)} rows under these headings.
          Amazon's column names vary, so correct any we guessed wrong.
        </p>
        <div class="bp-grid bp-grid--2" style="gap:var(--bp-3)">
          ${raw(FIELDS.map((f) => html`
            <label class="bp-field" style="margin:0">
              <span class="bp-label">${f.label}</span>
              <select class="bp-select" data-amazon-map="${f.key}">${raw(options(mapping[f.key]))}</select>
            </label>`).join(""))}
        </div>

        <div class="bp-grid bp-grid--2" style="gap:var(--bp-3);margin-top:var(--bp-3)">
          ${raw(dated
            ? (state.report.dateFormat.certain ? "" : html`
              <label class="bp-field" style="margin:0">
                <span class="bp-label">Date format</span>
                <select class="bp-select" data-amazon="dayfirst">
                  <option value="1" ${state.dayFirst ? "selected" : ""}>Day first (31/12/2026)</option>
                  <option value="0" ${!state.dayFirst ? "selected" : ""}>Month first (12/31/2026)</option>
                </select>
                <span class="bp-tiny bp-subtle">Every date in this file could be read either way, so check the preview below.</span>
              </label>`)
            : html`
              <label class="bp-field" style="margin:0">
                <span class="bp-label">This report has no dates. Record it on</span>
                <input class="bp-input" type="date" data-amazon="undated" value="${state.undatedDate}">
                <span class="bp-tiny bp-subtle">All of it lands on this one day, so it will not show a daily trend.</span>
              </label>`)}
          <label class="bp-field" style="margin:0">
            <span class="bp-label">Currency of the sales figures</span>
            <select class="bp-select" data-amazon="currency">
              ${raw(CURRENCIES.map((c) => html`<option ${c === state.currency ? "selected" : ""}>${c}</option>`).join(""))}
            </select>
          </label>
        </div>
      </div>

      <div class="bp-panel" style="margin-top:var(--bp-4)">
        <strong class="bp-small">3. Preview</strong>
        ${raw(!hasMetric ? '<p class="bp-small bp-muted" style="margin-top:var(--bp-2)">Choose at least one figure column (clicks, purchases…) above.</p>'
          : !built.rows.length ? html`<p class="bp-small bp-muted" style="margin-top:var(--bp-2)">No rows could be read with these settings.${built.skipped[0] ? ` For example, row ${built.skipped[0].line}: ${built.skipped[0].reason}.` : ""}</p>`
          : html`
            <p class="bp-tiny bp-subtle" style="margin:4px 0 var(--bp-3)">
              ${fmt.number(built.rows.length)} campaign-days across ${fmt.number(built.campaigns.length)} campaign${built.campaigns.length === 1 ? "" : "s"},
              ${fmt.date(built.from)} to ${fmt.date(built.to)}.
            </p>
            <div class="bp-grid bp-grid--3" style="gap:var(--bp-2)">
              ${raw(stat("Clicks", fmt.number(built.totals.clicks)))}
              ${raw(stat("Detail page views", fmt.number(built.totals.detail_page_views)))}
              ${raw(stat("Add to cart", fmt.number(built.totals.add_to_carts)))}
              ${raw(stat("Purchases", fmt.number(built.totals.purchases)))}
              ${raw(stat("Units sold", fmt.number(built.totals.units_sold)))}
              ${raw(stat("Product sales", fmt.money(built.totals.product_sales_cents, state.currency)))}
            </div>
            <div class="bp-table-wrap" style="margin-top:var(--bp-3)">
              <table class="bp-table">
                <thead><tr><th>Date</th><th>Campaign</th><th class="bp-num">Clicks</th><th class="bp-num">Purchases</th><th class="bp-num">Sales</th></tr></thead>
                <tbody>${raw(built.rows.slice(0, 6).map((r) => html`
                  <tr><td class="bp-small">${fmt.date(r.date)}</td><td class="bp-small">${r.campaign}</td>
                    <td class="bp-small bp-num">${fmt.number(r.clicks)}</td><td class="bp-small bp-num">${fmt.number(r.purchases)}</td>
                    <td class="bp-small bp-num">${fmt.money(r.product_sales_cents, state.currency)}</td></tr>`).join(""))}</tbody>
              </table>
            </div>
            ${raw(built.rows.length > 6 ? `<p class="bp-tiny bp-subtle" style="margin:6px 0 0">…and ${fmt.number(built.rows.length - 6)} more.</p>` : "")}`)}
        ${raw(built.skipped.length ? html`
          <div class="bp-alert bp-alert--info" style="margin-top:var(--bp-3)">
            <span class="bp-alert__icon">i</span>
            <div class="bp-small">${fmt.number(built.skipped.length)} row${built.skipped.length === 1 ? " was" : "s were"} left out.
              ${built.skipped.slice(0, 3).map((s) => `Row ${s.line}: ${s.reason}.`).join(" ")}
              Totals rows are left out on purpose, so nothing is counted twice.</div>
          </div>` : "")}
      </div>

      ${raw(built.campaigns.length && campaigns.length ? html`
        <div class="bp-panel" style="margin-top:var(--bp-4)">
          <strong class="bp-small">4. Link to your campaigns <span class="bp-tiny bp-subtle">(optional)</span></strong>
          <p class="bp-tiny bp-subtle" style="margin:4px 0 var(--bp-3)">Only campaigns with the same name are linked for you. Amazon's figures stay separate either way.</p>
          <div class="bp-stack-sm">
            ${raw(built.campaigns.slice(0, 20).map((name) => html`
              <label class="bp-row bp-row--between" style="gap:var(--bp-3)">
                <span class="bp-small" style="min-width:0;overflow-wrap:anywhere">${name}</span>
                <select class="bp-select" data-amazon-link="${name}" style="max-width:55%">
                  <option value="">Not linked</option>
                  ${raw(campaigns.map((c) => html`<option value="${c.id}" ${state.links[name] === c.id ? "selected" : ""}>${c.name}</option>`).join(""))}
                </select>
              </label>`).join(""))}
          </div>
          ${raw(built.campaigns.length > 20 ? `<p class="bp-tiny bp-subtle" style="margin:6px 0 0">Linking is offered for the first 20 campaigns.</p>` : "")}
        </div>` : "")}

      <div class="bp-row bp-row--wrap" style="margin-top:var(--bp-4)">
        <button type="button" class="bp-btn bp-btn--primary" data-amazon="import" ${canImport ? "" : "disabled"}>
          Import ${built.rows.length ? fmt.number(built.rows.length) : ""} campaign-days
        </button>
        <button type="button" class="bp-btn bp-btn--ghost" data-amazon="cancel">Cancel</button>
      </div>`;
    state.built = built;
  }

  root.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-amazon]")?.dataset.amazon;
    if (!action) return;
    if (action === "open") {
      openSource();
    } else if (action === "cancel") {
      importer.hidden = true;
      importer.innerHTML = "";
    } else if (action === "read-paste") {
      const text = importer.querySelector('[data-amazon="paste"]').value;
      if (text.trim()) load(text, "Pasted text");
    } else if (action === "remove") {
      const ok = await confirmDialog({
        title: "Remove imported Amazon data?",
        message: "This deletes every imported Amazon Attribution row from BookPilot. Your Amazon account and your reports are untouched, and you can import them again.",
        confirmLabel: "Remove",
        tone: "danger",
      });
      if (!ok) return;
      try {
        await API.amazonRemove();
        notify.success("Imported Amazon data removed.");
        done?.();
      } catch (err) { notify.error(err.message); }
    } else if (action === "import") {
      const button = event.target.closest("button");
      button.disabled = true;
      try {
        const links = Object.entries(state.links)
          .filter(([name, id]) => id && state.built.campaigns.includes(name))
          .map(([campaign, campaign_id]) => ({ campaign, campaign_id }));
        const result = await API.amazonImport({ rows: state.built.rows, currency: state.currency, links });
        notify.success(`Imported ${fmt.number(result.imported)} campaign-days, ${fmt.date(result.from)} to ${fmt.date(result.to)}.`);
        done?.();
      } catch (err) {
        notify.error(err.message);
        button.disabled = false;
      }
    }
  });

  root.addEventListener("change", async (event) => {
    const t = event.target;
    if (t.matches('[data-amazon="file"]')) {
      const file = t.files?.[0];
      if (!file) return;
      if (file.size > MAX_FILE_BYTES) { notify.error("That file is over 5 MB. Export a shorter date range."); return; }
      try { load(await readFileText(file), file.name); } catch { notify.error("We couldn't read that file."); }
      return;
    }
    if (!state.report) return;
    if (t.matches("[data-amazon-map]")) state.mapping[t.dataset.amazonMap] = Number(t.value);
    else if (t.matches('[data-amazon="dayfirst"]')) state.dayFirst = t.value === "1";
    else if (t.matches('[data-amazon="undated"]')) state.undatedDate = t.value;
    else if (t.matches('[data-amazon="currency"]')) state.currency = t.value;
    else if (t.matches("[data-amazon-link]")) { state.links[t.dataset.amazonLink] = t.value; return; }
    else return;
    review();
  });
}
