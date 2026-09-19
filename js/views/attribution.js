// Integrations and attribution (spec §16, §17, §18).
//
// Three things live here: the Meta connection, the website tracking
// script, and Amazon Attribution. The honesty rules for this page:
//
//   - A capability the deployment doesn't have says so, and offers
//     "Connect integration" rather than a button that fails.
//   - Amazon is not presented as something BookPilot can read sales
//     from. It can import Amazon Attribution data if the author has an
//     eligible account, and that is a different, smaller claim.
//   - Website-attributed and Amazon-attributed numbers are labelled
//     everywhere they appear and never summed together.

import { html, raw, $, formData, setBusy } from "../core/dom.js";
import { API, isDemo } from "../core/api.js";
import { notify, confirmDialog } from "../core/toast.js";
import { pageHead, fmt, demoBadge } from "./shared.js";
import { healthBadge, wireTrackingChecks } from "./tracking-check.js";
import { amazonImportBlock, wireAmazonImport } from "./amazon-import.js";
import { platformCard, wirePlatform } from "./platform-card.js";
import { platformConnectBlock, wirePlatformConnect } from "./platform-connect.js";

export async function render(container, params, query) {
  const empty = { summary: null, campaigns: [] };
  const [{ integrations, capabilities }, { sites }, { summary: amazonSummary }, { campaigns }, tiktok, google, pinterest, { books }] = await Promise.all([
    API.integrations(),
    API.trackingSites().catch(() => ({ sites: [] })),
    API.amazonSummary().catch(() => ({ summary: null })),
    API.campaigns().catch(() => ({ campaigns: [] })),
    API.platformSummary("tiktok").catch(() => empty),
    API.platformSummary("google").catch(() => empty),
    API.platformSummary("pinterest").catch(() => empty),
    API.books().catch(() => ({ books: [] })),
  ]);

  // One status per site, fetched up front so each card can show whether
  // its script is actually reporting. A failure leaves that card without
  // a badge rather than blocking the page.
  const statuses = {};
  await Promise.all(sites.map(async (site) => {
    try { statuses[site.id] = await API.trackingStatus(site.id); } catch { /* shown as unavailable */ }
  }));

  const meta = integrations.find((i) => i.provider === "meta");

  // The Meta OAuth callback comes back with a status in the query string.
  const metaResult = query?.get("meta") || new URLSearchParams(location.search).get("meta");
  if (metaResult === "connected") notify.success("Meta account connected.");
  if (metaResult === "failed") notify.error("We couldn't connect your Meta account. Please try again.");
  if (metaResult === "declined") notify.info("Meta connection cancelled.");

  const pinterestResult = query?.get("pinterest") || new URLSearchParams(location.search).get("pinterest");
  if (pinterestResult === "connected") notify.success("Pinterest connected. Choose your ad account and sync.");
  if (pinterestResult === "failed") notify.error("We couldn't connect your Pinterest account. Please try again.");
  if (pinterestResult === "declined") notify.info("Pinterest connection cancelled.");

  const tiktokResult = query?.get("tiktok") || new URLSearchParams(location.search).get("tiktok");
  if (tiktokResult === "connected") notify.success("TikTok connected. Choose your ad account and sync.");
  if (tiktokResult === "failed") notify.error("We couldn't connect your TikTok account. Please try again.");

  const amazonResult = query?.get("amazon") || new URLSearchParams(location.search).get("amazon");
  if (amazonResult === "connected") notify.success("Amazon Ads connected. Choose your account and sync.");
  if (amazonResult === "failed") notify.error("We couldn't connect your Amazon Ads account. Please try again.");
  if (amazonResult === "declined") notify.info("Amazon Ads connection cancelled.");

  const googleResult = query?.get("google") || new URLSearchParams(location.search).get("google");
  if (googleResult === "connected") notify.success("Google Ads connected. Choose your account and sync.");
  if (googleResult === "failed") notify.error("We couldn't connect your Google Ads account. Please try again.");
  if (googleResult === "declined") notify.info("Google Ads connection cancelled.");

  container.innerHTML = html`
    ${raw(pageHead({
      title: "Attribution & integrations",
      description: "Where your ads run, and how sales find their way back to the ad that caused them.",
      actions: demoBadge(),
    }))}

    <div class="bp-stack-lg">
      ${raw(metaCard(meta, capabilities))}
      ${raw(trackingCard(sites, statuses))}
      ${raw(platformCard("tiktok", tiktok.summary, tiktok.campaigns, {
        books,
        connect: platformConnectBlock("tiktok", integrations.find((i) => i.provider === "tiktok"), capabilities, { books }),
      }))}
      ${raw(platformCard("google", google.summary, google.campaigns, {
        books,
        connect: platformConnectBlock("google", integrations.find((i) => i.provider === "google"), capabilities, { books }),
      }))}
      ${raw(platformCard("pinterest", pinterest.summary, pinterest.campaigns, {
        books,
        connect: platformConnectBlock("pinterest", integrations.find((i) => i.provider === "pinterest"), capabilities, { books }),
      }))}
      ${raw(amazonCard(amazonSummary, platformConnectBlock("amazon", integrations.find((i) => i.provider === "amazon_attribution"), capabilities, { books })))}
    </div>
  `;

  wireTrackingChecks(container, statuses);
  for (const [platform, data] of [["tiktok", tiktok], ["google", google], ["pinterest", pinterest]]) {
    wirePlatform(container, platform, {
      tracking: data.campaigns,
      books,
      defaultCurrency: data.campaigns[0]?.currency || campaigns[0]?.currency || "EUR",
      done: () => render(container, params, query),
    });
  }
  for (const platform of ["tiktok", "google", "pinterest", "amazon"]) {
    wirePlatformConnect(container, platform, { done: () => render(container, params, query) });
  }
  wireAmazonImport(container, {
    campaigns: campaigns.filter((c) => !c.is_demo || isDemo()),
    defaultCurrency: campaigns[0]?.currency || "EUR",
    done: () => render(container, params, query),
  });

  $("#connect-meta")?.addEventListener("click", async (event) => {
    setBusy(event.currentTarget, true, "Opening Meta…");
    try {
      const { url } = await API.metaAuthorizeUrl();
      location.href = url;
    } catch (err) {
      notify.error(err.message);
      setBusy(event.currentTarget, false);
    }
  });

  $("#disconnect-meta")?.addEventListener("click", async () => {
    const confirmed = await confirmDialog({
      title: "Disconnect Meta?",
      message:
        "BookPilot will stop syncing performance data. Campaigns already running on Meta keep running — you'd pause those in Ads Manager.",
      confirmLabel: "Disconnect",
      tone: "danger",
    });
    if (!confirmed) return;
    await API.disconnect("meta");
    notify.success("Meta disconnected.");
    render(container, params, query);
  });

  $("#meta-accounts")?.addEventListener("click", async (event) => {
    setBusy(event.currentTarget, true, "Loading…");
    try {
      const { accounts, selected } = await API.metaAccounts();
      const target = $("#account-list");
      target.innerHTML = accounts.length
        ? accounts
            .map((account) => html`
              <label class="bp-radio ${account.id === selected ? "bp-radio--selected" : ""}">
                <input type="radio" name="ad-account" value="${account.id}" data-name="${account.name}" ${account.id === selected ? "checked" : ""}>
                <span><strong>${account.name}</strong>
                  <span class="bp-small bp-subtle"> · ${account.currency} · ${account.active ? "active" : "inactive"}</span></span>
              </label>`)
            .join("") +
          '<button type="button" class="bp-btn bp-btn--primary bp-btn--sm" id="save-account" style="margin-top:var(--bp-3)">Use this account</button>'
        : '<p class="bp-small bp-muted">No ad accounts found on that Meta profile.</p>';

      target.querySelector("#save-account")?.addEventListener("click", async () => {
        const chosen = target.querySelector('input[name="ad-account"]:checked');
        if (!chosen) return;
        await API.metaSelectAccount({ account_id: chosen.value, account_name: chosen.dataset.name });
        notify.success("Ad account saved.");
        render(container, params, query);
      });
    } catch (err) {
      notify.error(err.message);
    }
    setBusy(event.currentTarget, false);
  });

  $("#site-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = formData(event.target);
    const button = event.target.querySelector('button[type="submit"]');
    setBusy(button, true, "Creating…");
    try {
      await API.createTrackingSite(values);
      notify.success("Tracking key created.");
      render(container, params, query);
    } catch (err) {
      notify.error(err.message);
      setBusy(button, false);
    }
  });

  container.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy);
        notify.success("Copied to your clipboard.");
      } catch {
        notify.info("Select the snippet and copy it manually.");
      }
    });
  });

  container.querySelectorAll("[data-remove-site]").forEach((button) => {
    button.addEventListener("click", async () => {
      const confirmed = await confirmDialog({
        title: "Remove this tracking key?",
        message: "Any site still using it will stop reporting sales. Events already recorded are kept.",
        confirmLabel: "Remove",
        tone: "danger",
      });
      if (!confirmed) return;
      await API.deleteTrackingSite(button.dataset.removeSite);
      render(container, params, query);
    });
  });
}

function metaCard(meta, capabilities) {
  const connected = meta?.status === "connected";

  if (!capabilities?.meta) {
    return html`
      <section class="bp-card">
        <div class="bp-card__header">
          <div class="bp-card__title">Meta — Facebook &amp; Instagram</div>
          <span class="bp-badge">${isDemo() ? "Not in the demo" : "Not configured"}</span>
        </div>
        <p class="bp-small bp-muted">
          ${isDemo()
            ? "The demo workspace isn't connected to any ad account — that's the point of it. Create a free account to connect yours."
            : "This deployment doesn't have Meta app credentials configured yet, so the connection can't be offered. The integration is built and waiting on them."}
        </p>
        ${raw(isDemo() ? '<a class="bp-btn bp-btn--primary bp-btn--sm" href="#/signup">Create a free account</a>' : "")}
      </section>`;
  }

  return html`
    <section class="bp-card">
      <div class="bp-card__header">
        <div class="bp-card__title">Meta — Facebook &amp; Instagram</div>
        <span class="bp-badge ${connected ? "bp-badge--success" : ""}">${connected ? "Connected" : "Not connected"}</span>
      </div>
      ${raw(connected
        ? html`
          <dl class="bp-kv">
            <dt>Ad account</dt><dd>${meta.account_name || meta.account_id || "Not chosen yet"}</dd>
            <dt>Last synced</dt><dd>${meta.last_synced_at ? fmt.relativeTime(meta.last_synced_at) : "Never"}</dd>
            <dt>Access expires</dt><dd>${meta.expires_at ? fmt.date(meta.expires_at) : "—"}</dd>
          </dl>
          ${meta.last_error ? raw(html`<div class="bp-alert bp-alert--warning" style="margin-top:var(--bp-4)">
            <span class="bp-alert__icon">!</span><div class="bp-small">${meta.last_error}</div></div>`) : ""}
          <div class="bp-row bp-row--wrap" style="margin-top:var(--bp-4)">
            <button type="button" class="bp-btn bp-btn--secondary bp-btn--sm" id="meta-accounts">Choose ad account</button>
            <button type="button" class="bp-btn bp-btn--danger bp-btn--sm" id="disconnect-meta">Disconnect</button>
          </div>
          <div id="account-list" class="bp-stack-sm" style="margin-top:var(--bp-4)"></div>`
        : html`
          <p class="bp-small bp-muted">
            Connect the ad account you already use. Meta bills you directly, BookPilot never sees or
            stores your password, and campaigns are always created paused.
          </p>
          <button type="button" class="bp-btn bp-btn--primary bp-btn--sm" id="connect-meta">Connect Meta account</button>`)}
    </section>
  `;
}

function trackingCard(sites, statuses = {}) {
  const origin = location.origin;
  return html`
    <section class="bp-card">
      <div class="bp-card__header">
        <div class="bp-card__title">Website tracking</div>
        <span class="bp-badge ${sites.length ? "bp-badge--success" : ""}">${sites.length ? `${sites.length} site${sites.length === 1 ? "" : "s"}` : "Not set up"}</span>
      </div>
      <p class="bp-small bp-muted">
        If you sell from your own site, this is what closes the loop: a small script that reports
        page views, checkouts and purchases back against the ad that produced them. It stores no IP
        address, no user agent and no cookie — only which campaign and creative a purchase came from.
      </p>

      ${raw(sites.length
        ? `<div class="bp-stack-sm" style="margin:var(--bp-4) 0">${sites.map((site) => html`
            <div class="bp-panel" data-site-card>
              <div class="bp-row bp-row--between">
                <div>
                  <strong class="bp-small">${site.name}</strong>
                  <div class="bp-tiny bp-subtle">${site.domain}</div>
                </div>
                <span data-site-health>${raw(statuses[site.id] ? healthBadge(statuses[site.id]) : "")}</span>
                <button type="button" class="bp-btn bp-btn--ghost bp-btn--sm" data-remove-site="${site.id}">Remove</button>
              </div>
              <code class="bp-code" style="margin-top:var(--bp-3)">&lt;script async src="${origin}/track/bp.js" data-key="${site.public_key}"&gt;&lt;/script&gt;</code>
              <button type="button" class="bp-btn bp-btn--secondary bp-btn--sm" style="margin-top:var(--bp-2)"
                data-copy='<script async src="${origin}/track/bp.js" data-key="${site.public_key}"></script>'>Copy snippet</button>
              <details data-check-site="${site.id}" style="margin-top:var(--bp-4);border-top:1px solid var(--bp-border);padding-top:var(--bp-3)">
                <summary class="bp-small" style="cursor:pointer"><strong>Check installation</strong></summary>
                <div data-check-body style="margin-top:var(--bp-3)"></div>
              </details>
            </div>`).join("")}</div>`
        : "")}

      <form id="site-form" class="bp-field-row" style="margin-top:var(--bp-4);align-items:end">
        <div class="bp-field" style="margin:0">
          <label class="bp-label" for="site-name">Site name</label>
          <input class="bp-input" id="site-name" name="name" placeholder="My author website" required>
        </div>
        <div class="bp-field" style="margin:0">
          <label class="bp-label" for="site-domain">Domain</label>
          <input class="bp-input" id="site-domain" name="domain" placeholder="example.com" required>
        </div>
        <button type="submit" class="bp-btn bp-btn--primary">Create tracking key</button>
      </form>

      <details style="margin-top:var(--bp-5)">
        <summary class="bp-small" style="cursor:pointer">How to record a purchase</summary>
        <p class="bp-small bp-muted" style="margin-top:var(--bp-3)">
          Page views are tracked automatically. Call this on your thank-you page, with the order
          total:
        </p>
        <code class="bp-code">bookpilot('purchase', { value: 8.99, currency: 'EUR' });</code>
        <p class="bp-tiny bp-subtle" style="margin-top:var(--bp-3)">
          You are the controller of your visitors' data on your own site. Where your cookie or
          consent policy requires it, gate the script behind consent — it reads a
          <code>window.bookpilotConsent</code> flag for exactly that. This is not legal advice.
        </p>
      </details>
    </section>
  `;
}

function amazonCard(summary, connect = "") {
  const has = summary && summary.rows > 0;
  return html`
    <section class="bp-card" data-platform-card data-platform="amazon">
      <div class="bp-card__header">
        <div class="bp-card__title">Amazon Attribution</div>
        <span class="bp-badge ${has ? "bp-badge--success" : ""}">${has ? "Imported" : "No data yet"}</span>
      </div>
      <div class="bp-alert bp-alert--info" style="margin-bottom:var(--bp-4)">
        <span class="bp-alert__icon">◆</span>
        <div class="bp-small">
          <strong>What this can and can't do.</strong> Amazon does not report your KDP sales to
          third-party tools, and no advertising platform can change that. What it does offer is
          Amazon Attribution: if you have an eligible account, you can connect it, or download its
          reports (clicks, detail-page views, add-to-carts and purchases) and import them here, next
          to your ad spend.
          Those figures stay labelled as Amazon-attributed and are never merged with sales tracked on
          your own website or reported by Meta.
        </div>
      </div>
      ${raw(connect)}
      ${raw(connect ? '<h3 class="bp-small" style="margin:var(--bp-5) 0 var(--bp-2)"><strong>Or import a report</strong></h3>' : "")}
      ${raw(amazonImportBlock(summary))}
    </section>
  `;
}
