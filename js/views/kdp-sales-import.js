// Importing a KDP sales & royalties report.
//
// Amazon offers no third-party API for a personal KDP dashboard, so this
// is the only door: download the "Prior Months' Royalties" (or eBook
// Royalty) report from KDP Reports as CSV, choose it, check what BookPilot
// understood, import.
//
// Unlike Amazon Attribution, this report is the whole book — every sale,
// not just the ones an ad led to — which is what makes profit per ad euro
// possible: royalties earned against what was spent to earn them. The two
// are never added together or confused for one another on screen.

import { html, raw } from "../core/dom.js";
import { API } from "../core/api.js";
import { notify, confirmDialog } from "../core/toast.js";
import { fmt } from "./shared.js";
import { FIELDS, readReport, buildRows } from "../core/kdp-sales-report.js";
import { MAX_FILE_BYTES, CURRENCIES, readFileText, stat } from "./import-shared.js";

/** The card's static part: what is imported, and the buttons. */
export function kdpSalesImportBlock(summary) {
  const has = summary && summary.rows > 0;
  return html`
    ${raw(has ? html`
      <dl class="bp-kv" style="margin-bottom:var(--bp-4)">
        <dt>Covers</dt><dd>${fmt.date(summary.from)} to ${fmt.date(summary.to)} · ${fmt.number(summary.days)} days</dd>
        <dt>Titles</dt><dd>${summary.titles.slice(0, 4).join(", ")}${summary.titles.length > 4 ? ` and ${summary.titles.length - 4} more` : ""}</dd>
        <dt>Last import</dt><dd>${summary.last_imported_at ? fmt.relativeTime(summary.last_imported_at) : "—"}</dd>
      </dl>` : "")}
    <div class="bp-row bp-row--wrap">
      <button type="button" class="bp-btn bp-btn--primary bp-btn--sm" data-kdp="open">${has ? "Import another report" : "Import a report"}</button>
      ${raw(has ? '<button type="button" class="bp-btn bp-btn--danger bp-btn--sm" data-kdp="remove">Remove imported data</button>' : "")}
    </div>
    <div data-kdp-importer hidden style="margin-top:var(--bp-5)"></div>
    <details style="margin-top:var(--bp-4)">
      <summary class="bp-small" style="cursor:pointer">Where do I get the report?</summary>
      <ol class="bp-small bp-muted" style="margin:var(--bp-3) 0 0;padding-left:1.2em;display:grid;gap:6px">
        <li>In KDP Reports, open <strong>Sales Dashboard</strong> (or, for the figures your payment is
          based on, <strong>Prior Months' Royalties</strong>) and choose eBook or paperback royalties.</li>
        <li>Choose the date range you want, and a <strong>daily</strong> breakdown if it offers one. A
          report with no dates can still be imported, but all of it is recorded on a single day you choose.</li>
        <li>Download it as CSV and choose the file here. Reports over ${"3,000"} title-days can be imported in date ranges.</li>
      </ol>
      <p class="bp-tiny bp-subtle" style="margin:var(--bp-3) 0 0">
        Importing the same days again replaces them, so it is safe to download an overlapping range
        when KDP updates recent figures. Nothing leaves your browser except the rows you confirm.
      </p>
    </details>
  `;
}

/**
 * Wire the importer. `done` is called after a successful import or
 * removal, so the page can re-render with the new summary.
 */
export function wireKdpSalesImport(root, { books = [], defaultCurrency = "EUR", done }) {
  const importer = root.querySelector("[data-kdp-importer]");
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
          <input type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" data-kdp="file" class="bp-input">
        </div>
        <details style="margin-top:var(--bp-3)">
          <summary class="bp-small" style="cursor:pointer">Or paste the report text</summary>
          <textarea class="bp-textarea" rows="6" data-kdp="paste" style="margin-top:var(--bp-2)"
            placeholder="Title,Marketplace,Royalty Date,Net Units Sold,Royalty,…"></textarea>
          <button type="button" class="bp-btn bp-btn--secondary bp-btn--sm" data-kdp="read-paste" style="margin-top:var(--bp-2)">Read this text</button>
        </details>
      </div>
      <div data-kdp-review style="margin-top:var(--bp-4)"></div>`;
  }

  function load(text, name) {
    const report = readReport(text);
    state.fileName = name;
    if (!report.ok) {
      state.report = null;
      importer.querySelector("[data-kdp-review]").innerHTML = html`
        <div class="bp-alert bp-alert--warning">
          <span class="bp-alert__icon">!</span>
          <div class="bp-small">
            <strong>We couldn't find the column headings.</strong>
            The report needs a header row with at least two of: Title, Marketplace, Royalty Date,
            Units Sold, Net Units Sold, Royalty, Kindle pages read. Check that this is a KDP sales or
            royalty report saved as CSV.
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

  function autoLinks(titles) {
    // Link a KDP title to a BookPilot book only when the names are the
    // same; anything looser is a guess about which book earned what.
    for (const title of titles) {
      if (state.links[title] !== undefined) continue;
      const match = books.find((b) => (b.title || "").trim().toLowerCase() === title.trim().toLowerCase());
      state.links[title] = match ? match.id : "";
    }
  }

  function review() {
    const { report, mapping } = state;
    const built = buildRows(report.data, mapping, { dayFirst: state.dayFirst, undatedDate: state.undatedDate || null });
    autoLinks(built.titles);

    const hasMetric = FIELDS.some((f) => f.metric && mapping[f.key] !== -1);
    const dated = mapping.date !== -1;
    const canImport = built.rows.length > 0 && hasMetric && (dated || state.undatedDate);
    const options = (selected) => [
      `<option value="-1" ${selected === -1 ? "selected" : ""}>— not in this report —</option>`,
      ...report.headers.map((h, i) => html`<option value="${i}" ${selected === i ? "selected" : ""}>${h || `Column ${i + 1}`}</option>`),
    ].join("");

    const target = importer.querySelector("[data-kdp-review]");
    target.innerHTML = html`
      <div class="bp-panel">
        <strong class="bp-small">2. Check what we understood</strong>
        <p class="bp-tiny bp-subtle" style="margin:4px 0 var(--bp-3)">
          ${state.fileName ? `${state.fileName} · ` : ""}${fmt.number(report.data.length)} rows under these headings.
          KDP's column names vary between report types, so correct any we guessed wrong.
        </p>
        <div class="bp-grid bp-grid--2" style="gap:var(--bp-3)">
          ${raw(FIELDS.map((f) => html`
            <label class="bp-field" style="margin:0">
              <span class="bp-label">${f.label}</span>
              <select class="bp-select" data-kdp-map="${f.key}">${raw(options(mapping[f.key]))}</select>
            </label>`).join(""))}
        </div>

        <div class="bp-grid bp-grid--2" style="gap:var(--bp-3);margin-top:var(--bp-3)">
          ${raw(dated
            ? (state.report.dateFormat.certain ? "" : html`
              <label class="bp-field" style="margin:0">
                <span class="bp-label">Date format</span>
                <select class="bp-select" data-kdp="dayfirst">
                  <option value="1" ${state.dayFirst ? "selected" : ""}>Day first (31/12/2026)</option>
                  <option value="0" ${!state.dayFirst ? "selected" : ""}>Month first (12/31/2026)</option>
                </select>
                <span class="bp-tiny bp-subtle">Every date in this file could be read either way, so check the preview below.</span>
              </label>`)
            : html`
              <label class="bp-field" style="margin:0">
                <span class="bp-label">This report has no dates. Record it on</span>
                <input class="bp-input" type="date" data-kdp="undated" value="${state.undatedDate}">
                <span class="bp-tiny bp-subtle">All of it lands on this one day, so it will not show a daily trend.</span>
              </label>`)}
          <label class="bp-field" style="margin:0">
            <span class="bp-label">Currency of the royalty figures</span>
            <select class="bp-select" data-kdp="currency">
              ${raw(CURRENCIES.map((c) => html`<option ${c === state.currency ? "selected" : ""}>${c}</option>`).join(""))}
            </select>
          </label>
        </div>
      </div>

      <div class="bp-panel" style="margin-top:var(--bp-4)">
        <strong class="bp-small">3. Preview</strong>
        ${raw(!hasMetric ? '<p class="bp-small bp-muted" style="margin-top:var(--bp-2)">Choose at least one figure column (units sold, royalty…) above.</p>'
          : !built.rows.length ? html`<p class="bp-small bp-muted" style="margin-top:var(--bp-2)">No rows could be read with these settings.${built.skipped[0] ? ` For example, row ${built.skipped[0].line}: ${built.skipped[0].reason}.` : ""}</p>`
          : html`
            <p class="bp-tiny bp-subtle" style="margin:4px 0 var(--bp-3)">
              ${fmt.number(built.rows.length)} title-days across ${fmt.number(built.titles.length)} title${built.titles.length === 1 ? "" : "s"},
              ${fmt.date(built.from)} to ${fmt.date(built.to)}.
            </p>
            <div class="bp-grid bp-grid--3" style="gap:var(--bp-2)">
              ${raw(stat("Units sold", fmt.number(built.totals.units_sold)))}
              ${raw(stat("Units refunded", fmt.number(built.totals.units_refunded)))}
              ${raw(stat("Net units sold", fmt.number(built.totals.net_units_sold)))}
              ${raw(stat("Royalty", fmt.money(built.totals.royalty_cents, state.currency)))}
              ${raw(built.totals.kenp_pages_read ? stat("Kindle pages read", fmt.number(built.totals.kenp_pages_read)) : "")}
              ${raw(built.totals.kenp_royalty_cents ? stat("Est. page-read royalty", fmt.money(built.totals.kenp_royalty_cents, state.currency)) : "")}
            </div>
            <div class="bp-table-wrap" style="margin-top:var(--bp-3)">
              <table class="bp-table">
                <thead><tr><th>Date</th><th>Title</th><th>Marketplace</th><th class="bp-num">Net units</th><th class="bp-num">Royalty</th></tr></thead>
                <tbody>${raw(built.rows.slice(0, 6).map((r) => html`
                  <tr><td class="bp-small">${fmt.date(r.date)}</td><td class="bp-small">${r.title}</td><td class="bp-small">${r.marketplace}</td>
                    <td class="bp-small bp-num">${fmt.number(r.net_units_sold)}</td>
                    <td class="bp-small bp-num">${fmt.money(r.royalty_cents, state.currency)}</td></tr>`).join(""))}</tbody>
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

      ${raw(built.titles.length && books.length ? html`
        <div class="bp-panel" style="margin-top:var(--bp-4)">
          <strong class="bp-small">4. Link to your books <span class="bp-tiny bp-subtle">(optional)</span></strong>
          <p class="bp-tiny bp-subtle" style="margin:4px 0 var(--bp-3)">Only titles that match a book's name are linked for you. Royalty figures stay separate either way.</p>
          <div class="bp-stack-sm">
            ${raw(built.titles.slice(0, 20).map((title) => html`
              <label class="bp-row bp-row--between" style="gap:var(--bp-3)">
                <span class="bp-small" style="min-width:0;overflow-wrap:anywhere">${title}</span>
                <select class="bp-select" data-kdp-link="${title}" style="max-width:55%">
                  <option value="">Not linked</option>
                  ${raw(books.map((b) => html`<option value="${b.id}" ${state.links[title] === b.id ? "selected" : ""}>${b.title}</option>`).join(""))}
                </select>
              </label>`).join(""))}
          </div>
          ${raw(built.titles.length > 20 ? `<p class="bp-tiny bp-subtle" style="margin:6px 0 0">Linking is offered for the first 20 titles.</p>` : "")}
        </div>` : "")}

      <div class="bp-row bp-row--wrap" style="margin-top:var(--bp-4)">
        <button type="button" class="bp-btn bp-btn--primary" data-kdp="import" ${canImport ? "" : "disabled"}>
          Import ${built.rows.length ? fmt.number(built.rows.length) : ""} title-days
        </button>
        <button type="button" class="bp-btn bp-btn--ghost" data-kdp="cancel">Cancel</button>
      </div>`;
    state.built = built;
  }

  root.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-kdp]")?.dataset.kdp;
    if (!action) return;
    if (action === "open") {
      openSource();
    } else if (action === "cancel") {
      importer.hidden = true;
      importer.innerHTML = "";
    } else if (action === "read-paste") {
      const text = importer.querySelector('[data-kdp="paste"]').value;
      if (text.trim()) load(text, "Pasted text");
    } else if (action === "remove") {
      const ok = await confirmDialog({
        title: "Remove imported KDP data?",
        message: "This deletes every imported KDP sales row from BookPilot. Your KDP account and your reports are untouched, and you can import them again.",
        confirmLabel: "Remove",
        tone: "danger",
      });
      if (!ok) return;
      try {
        await API.kdpSalesRemove();
        notify.success("Imported KDP data removed.");
        done?.();
      } catch (err) { notify.error(err.message); }
    } else if (action === "import") {
      const button = event.target.closest("button");
      button.disabled = true;
      try {
        const links = Object.entries(state.links)
          .filter(([title, id]) => id && state.built.titles.includes(title))
          .map(([title, book_id]) => ({ title, book_id }));
        const result = await API.kdpSalesImport({ rows: state.built.rows, currency: state.currency, links });
        notify.success(`Imported ${fmt.number(result.imported)} title-days, ${fmt.date(result.from)} to ${fmt.date(result.to)}.`);
        done?.();
      } catch (err) {
        notify.error(err.message);
        button.disabled = false;
      }
    }
  });

  root.addEventListener("change", async (event) => {
    const t = event.target;
    if (t.matches('[data-kdp="file"]')) {
      const file = t.files?.[0];
      if (!file) return;
      if (file.size > MAX_FILE_BYTES) { notify.error("That file is over 5 MB. Export a shorter date range."); return; }
      try { load(await readFileText(file), file.name); } catch { notify.error("We couldn't read that file."); }
      return;
    }
    if (!state.report) return;
    if (t.matches("[data-kdp-map]")) state.mapping[t.dataset.kdpMap] = Number(t.value);
    else if (t.matches('[data-kdp="dayfirst"]')) state.dayFirst = t.value === "1";
    else if (t.matches('[data-kdp="undated"]')) state.undatedDate = t.value;
    else if (t.matches('[data-kdp="currency"]')) state.currency = t.value;
    else if (t.matches("[data-kdp-link]")) { state.links[t.dataset.kdpLink] = t.value; return; }
    else return;
    review();
  });
}
