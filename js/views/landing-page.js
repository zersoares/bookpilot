// The reader-magnet landing page: the piece the product was missing
// next to ad creation. Sending ad traffic straight to Amazon loses the
// reader relationship; this is where an author sends it instead, and
// the page that builds the list they own.
//
// One editor screen: create or edit the page's copy and links, see its
// public address, and read the leads it has collected. The actual public
// page is server-rendered elsewhere (netlify/functions/bookpilot-lp.mjs)
// — this view only ever talks to the authed CRUD API.

import { html, raw, $, formData, setBusy } from "../core/dom.js";
import { API } from "../core/api.js";
import { notify, confirmDialog } from "../core/toast.js";
import { navigate } from "../core/router.js";
import { pageHead, fmt, demoBadge, emptyState } from "./shared.js";
import { slugify } from "../core/landing.js";

const SITE_ORIGIN = "https://bookpilot.org";

export async function render(container, params) {
  const [{ book }, { page }] = await Promise.all([
    API.book(params.id),
    API.landingPage(params.id),
  ]);

  container.innerHTML = html`
    <div class="bp-row bp-row--between" style="margin-bottom:var(--bp-5)">
      <a class="bp-small bp-muted" href="#/books/${book.id}">← ${book.title}</a>
      ${raw(demoBadge())}
    </div>
    ${raw(pageHead({
      title: "Landing page",
      description: "A page to send readers, ad clicks and bio links to — one place to build your list instead of losing it to Amazon.",
    }))}

    <div class="bp-stack-lg">
      <div id="lp-form-target"></div>
      <div id="lp-leads-target"></div>
    </div>
  `;

  paintForm(book, page);
  if (page) paintLeads(page);
}

function paintForm(book, page) {
  const target = $("#lp-form-target");
  const editing = Boolean(page);
  const slug = page?.slug || "";
  const publicUrl = slug ? `${SITE_ORIGIN}/l/${slug}` : "";

  target.innerHTML = html`
    ${raw(editing ? html`
      <section class="bp-card">
        <div class="bp-card__header">
          <div class="bp-card__title">Your page</div>
          <span class="bp-badge ${page.published ? "bp-badge--success" : ""}">${page.published ? "Live" : "Unpublished"}</span>
        </div>
        <p class="bp-small bp-muted" style="word-break:break-all">
          <a href="${publicUrl}" target="_blank" rel="noopener noreferrer">${publicUrl}</a>
        </p>
        <div class="bp-row bp-row--wrap">
          <button type="button" class="bp-btn bp-btn--secondary bp-btn--sm" data-lp="copy" data-url="${publicUrl}">Copy link</button>
          <a class="bp-btn bp-btn--secondary bp-btn--sm" href="${publicUrl}" target="_blank" rel="noopener noreferrer">Open page ↗</a>
          <button type="button" class="bp-btn bp-btn--danger bp-btn--sm" data-lp="delete">Delete page</button>
        </div>
      </section>
    ` : "")}

    <section class="bp-card" style="margin-top:${editing ? "var(--bp-4)" : "0"}">
      <div class="bp-card__header"><div class="bp-card__title">${editing ? "Edit page" : "Create your landing page"}</div></div>
      <form id="lp-form" class="bp-stack">
        <div class="bp-grid bp-grid--2" style="gap:var(--bp-3)">
          <label class="bp-field" style="margin:0">
            <span class="bp-label">Headline</span>
            <input class="bp-input" name="headline" maxlength="200" value="${page?.headline || ""}" placeholder="${book.title}">
          </label>
          <label class="bp-field" style="margin:0">
            <span class="bp-label">Page address</span>
            <div class="bp-row" style="gap:0;align-items:center">
              <span class="bp-tiny bp-subtle" style="white-space:nowrap">bookpilot.org/l/</span>
              <input class="bp-input" id="lp-slug" name="slug" maxlength="60" value="${slug}"
                placeholder="${slugify(book.title)}" style="flex:1">
            </div>
            <span class="bp-tiny bp-subtle" id="lp-slug-status">${editing ? "" : "Leave blank to generate one from the title."}</span>
          </label>
        </div>

        <label class="bp-field">
          <span class="bp-label">Subhead</span>
          <input class="bp-input" name="subhead" maxlength="300" value="${page?.subhead || book.subtitle || ""}" placeholder="A one-line reason to keep reading">
        </label>

        <div class="bp-grid bp-grid--2" style="gap:var(--bp-3)">
          <label class="bp-field" style="margin:0">
            <span class="bp-label">Button text</span>
            <input class="bp-input" name="cta_label" maxlength="40" value="${page?.cta_label || "Get the book"}">
          </label>
          <label class="bp-field" style="margin:0">
            <span class="bp-label">Button link</span>
            <input class="bp-input" type="url" name="cta_url" maxlength="2048" value="${page?.cta_url || book.sales_url || ""}" placeholder="https://amazon.com/dp/…">
          </label>
        </div>

        <div class="bp-panel">
          <label class="bp-row bp-row--between" style="cursor:pointer">
            <span class="bp-small"><strong>Collect emails with a reader magnet</strong></span>
            <select class="bp-select" name="magnet_enabled" style="width:auto">
              <option value="true" ${page?.magnet_enabled !== false ? "selected" : ""}>On</option>
              <option value="false" ${page?.magnet_enabled === false ? "selected" : ""}>Off</option>
            </select>
          </label>
          <div class="bp-grid bp-grid--2" style="gap:var(--bp-3);margin-top:var(--bp-3)">
            <label class="bp-field" style="margin:0">
              <span class="bp-label">Email form button text</span>
              <input class="bp-input" name="magnet_label" maxlength="60" value="${page?.magnet_label || "Send me the first chapter"}">
            </label>
            <label class="bp-field" style="margin:0">
              <span class="bp-label">Download link <span class="bp-tiny bp-subtle">(optional)</span></span>
              <input class="bp-input" type="url" name="magnet_url" maxlength="2048" value="${page?.magnet_url || ""}" placeholder="https://…">
            </label>
          </div>
          <p class="bp-tiny bp-subtle" style="margin:var(--bp-3) 0 0">
            A reader who signs up sees this link right away — paste in a Google Drive, Dropbox or
            BookFunnel link to your sample chapter. Leave it blank to just say thanks and add them to
            your list; you still get every address, to email yourself from Kit, Mailchimp or wherever
            you already send newsletters.
          </p>
        </div>

        ${raw(editing ? html`
          <label class="bp-field">
            <span class="bp-label">Status</span>
            <select class="bp-select" name="published" style="width:auto">
              <option value="true" ${page.published ? "selected" : ""}>Published — visible to anyone with the link</option>
              <option value="false" ${!page.published ? "selected" : ""}>Unpublished — the link shows "not found"</option>
            </select>
          </label>
        ` : "")}

        <div class="bp-row bp-row--wrap">
          <button type="submit" class="bp-btn bp-btn--primary">${editing ? "Save changes" : "Create page"}</button>
        </div>
      </form>
    </section>
  `;

  const slugInput = $("#lp-slug");
  const slugStatus = $("#lp-slug-status");
  let slugTimer = null;
  slugInput.addEventListener("input", () => {
    clearTimeout(slugTimer);
    const value = slugInput.value.trim();
    if (!value) { slugStatus.textContent = editing ? "" : "Leave blank to generate one from the title."; return; }
    slugStatus.textContent = "Checking…";
    slugTimer = setTimeout(async () => {
      try {
        const { available } = await API.landingPageSlugAvailable(value, page?.id);
        slugStatus.textContent = available ? "Available." : "Already taken — try another.";
        slugStatus.style.color = available ? "var(--bp-success)" : "var(--bp-danger)";
      } catch {
        slugStatus.textContent = "";
      }
    }, 400);
  });

  $("#lp-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = formData(event.target);
    const payload = {
      headline: values.headline, subhead: values.subhead,
      cta_label: values.cta_label, cta_url: values.cta_url || null,
      magnet_enabled: values.magnet_enabled === "true",
      magnet_label: values.magnet_label, magnet_url: values.magnet_url || null,
      ...(values.slug ? { slug: values.slug } : {}),
      ...(editing ? { published: values.published === "true" } : {}),
    };
    const button = event.target.querySelector('button[type="submit"]');
    setBusy(button, true, editing ? "Saving…" : "Creating…");
    try {
      if (editing) {
        const { page: updated } = await API.updateLandingPage(page.id, payload);
        notify.success("Landing page updated.");
        paintForm(book, updated);
        paintLeads(updated);
      } else {
        const { page: created } = await API.createLandingPage({ ...payload, book_id: book.id });
        notify.success("Landing page created.");
        navigate(`/books/${book.id}/landing`, { replace: true });
        paintForm(book, created);
        paintLeads(created);
      }
    } catch (err) {
      notify.error(err.message);
    } finally {
      setBusy(button, false);
    }
  });

  target.querySelectorAll("[data-lp]").forEach((el) => {
    el.addEventListener("click", async () => {
      const action = el.dataset.lp;
      if (action === "copy") {
        try {
          await navigator.clipboard.writeText(el.dataset.url);
          notify.success("Link copied.");
        } catch {
          notify.info("Select the link and copy it manually.");
        }
      } else if (action === "delete") {
        const confirmed = await confirmDialog({
          title: "Delete this landing page?",
          message: "The public link stops working right away. Leads you already collected stay in your account, but you won't be able to see which page they came from once it's gone.",
          confirmLabel: "Delete page",
          tone: "danger",
        });
        if (!confirmed) return;
        await API.deleteLandingPage(page.id);
        notify.success("Landing page deleted.");
        navigate(`/books/${book.id}`, { replace: true });
      }
    });
  });
}

function paintLeads(page) {
  const container = document.querySelector("#lp-leads-target");
  if (!container) return;
  container.innerHTML = html`
    <section class="bp-card">
      <div class="bp-card__header">
        <div class="bp-card__title">Leads</div>
        <button type="button" class="bp-btn bp-btn--secondary bp-btn--sm" id="lp-export" disabled>Export CSV</button>
      </div>
      <div id="lp-leads-body"><div class="bp-small bp-muted">Loading…</div></div>
    </section>
  `;

  API.landingPageLeads(page.id).then(({ leads }) => {
    const body = container.querySelector("#lp-leads-body");
    const exportBtn = container.querySelector("#lp-export");
    if (!leads.length) {
      body.innerHTML = emptyState({
        icon: "✉",
        title: "No signups yet",
        text: "Once someone submits the form on your page, their address appears here — and you can export the list any time to import into your own email tool.",
      });
      return;
    }
    exportBtn.disabled = false;
    body.innerHTML = html`
      <p class="bp-tiny bp-subtle" style="margin-bottom:var(--bp-3)">${fmt.number(leads.length)} address${leads.length === 1 ? "" : "es"}, newest first.</p>
      <div class="bp-table-wrap">
        <table class="bp-table">
          <thead><tr><th>Email</th><th>Collected</th></tr></thead>
          <tbody>${raw(leads.slice(0, 200).map((lead) => html`
            <tr><td class="bp-small">${lead.email}</td><td class="bp-small bp-subtle">${fmt.relativeTime(lead.created_at)}</td></tr>
          `).join(""))}</tbody>
        </table>
      </div>
      ${raw(leads.length > 200 ? `<p class="bp-tiny bp-subtle" style="margin-top:6px">Showing the first 200 — export CSV for the full list.</p>` : "")}
    `;

    exportBtn.addEventListener("click", () => {
      const rows = [["email", "collected_at"], ...leads.map((l) => [l.email, l.created_at])];
      const csv = rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\r\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${page.slug}-leads.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }).catch(() => {
    container.querySelector("#lp-leads-body").innerHTML =
      '<p class="bp-small bp-muted">Couldn\'t load leads right now.</p>';
  });
}
