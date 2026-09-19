// Automatic sync for platforms with a read-only API connection (Pinterest,
// TikTok, Google Ads, Amazon Attribution), shown on each platform's card.
//
// BookPilot only ever reads, and the screen says so before it asks for
// anything. For Pinterest and TikTok that is also what the permission
// enforces: they offer read-only scopes and BookPilot asks for nothing more.
// Google and Amazon offer no read-only scope for their Ads APIs, only one that
// also allows changes, so for them the panel does not claim the permission is
// read-only. It says what the consent screen will say, and states the
// promise as BookPilot's own behaviour, which a test enforces in code. The
// CSV import below the panel stays as the way in when this is not set up, or
// as a fallback.
//
// Honest about its own state: when the deployment has no app credentials for
// the platform, this says so rather than offering a button that fails.

import { html, raw } from "../core/dom.js";
import { API, isDemo } from "../core/api.js";
import { notify, confirmDialog } from "../core/toast.js";
import { fmt } from "./shared.js";

/** What differs between platforms in what the panel says. */
const COPY = {
  pinterest: {
    name: "Pinterest",
    pulls: "campaign spend, clicks and purchases",
    permission: html`<strong>one read-only permission</strong> (<code>ads:read</code>)`,
    promise: html`It can see your campaign figures and can't create, change, pause or spend on anything.`,
    billing: "Pinterest bills you directly, and BookPilot never sees your password.",
    windowNote: "Pinterest allows up to 90 days.",
    footnote: "Figures use Pinterest's default conversion windows (30 days after a click) and count <strong>checkouts</strong> as purchases. Importing a report for the same days replaces them.",
    expiry: (i) => (i.expires_at ? fmt.date(i.expires_at) : "—"),
    disconnect: "BookPilot forgets the connection and stops syncing. Figures already imported stay. Pinterest keeps a record that BookPilot was allowed access, so to remove it there too, do so in your Pinterest account's connected-apps settings.",
  },
  google: {
    name: "Google Ads",
    pulls: "campaign spend, clicks and purchases",
    // Google's API has one permission and it allows changes. So the promise
    // is stated as BookPilot's own behaviour, and the consent screen's
    // stronger wording is disclosed before the author reaches it.
    permission: html`<strong>the one permission Google has for its Ads API</strong>`,
    promise: html`Google doesn't offer a read-only version, so its consent screen will say BookPilot can view <em>and manage</em> your Google Ads accounts. <strong>BookPilot only reads:</strong> it never creates, changes, pauses or spends on anything, and you can remove its access at any time in your Google Account's security settings.`,
    billing: "Google bills you directly, and BookPilot never sees your password.",
    windowNote: "Up to 90 days.",
    footnote: "Figures are cost, impressions and clicks by day in your account's time zone, up to yesterday, with each campaign's real status. <strong>Purchases</strong> are conversions in the Purchase category only, so sign-ups and add-to-carts aren't counted as sales: check that your sale conversion action is categorised as Purchase in Google Ads. Only accounts you can open directly are listed, not ones reached only through a manager (MCC) account. Importing a report for the same days replaces them.",
    expiry: () => "Renews automatically; stops if you remove access in your Google Account",
    disconnect: "BookPilot revokes its access at Google and forgets the connection. Figures already imported stay. If the revoke can't be completed (the token may already be dead), the connection is forgotten here regardless.",
  },
  amazon: {
    name: "Amazon",
    pulls: "your Amazon Attribution figures (clicks, detail-page views, add-to-carts, purchases, units and sales)",
    // Amazon's Ads API has one permission and it is named for managing
    // campaigns. Stated as BookPilot's own behaviour, like Google's.
    regions: { na: "North America (Amazon.com, Amazon.ca)", eu: "Europe (Amazon.co.uk, .de, .fr, .it, .es)" },
    noBook: true, // nothing is created in BookPilot, so no book is needed
    permission: html`<strong>the one permission Amazon has for its Ads API</strong>`,
    promise: html`Amazon doesn't offer a read-only version, so its consent screen will describe it as managing your advertising campaigns. <strong>BookPilot only reads:</strong> it never creates, changes or spends on anything, and you can remove its access at any time in your Amazon account.`,
    billing: "BookPilot never sees your Amazon password.",
    windowNote: "Up to 90 days.",
    footnote: "These are <strong>Amazon-attributed</strong> figures, not your KDP sales: purchases on Amazon within 14 days of an ad click, for the books your campaign promotes (not other books by you), counted on the day they happened, in your account's currency. They stay separate from Meta and website numbers. Amazon's API names each campaign only by an ID, so campaigns appear as the publisher and that ID. Amazon restates recent days, so <strong>a sync replaces the Amazon figures already stored for the same days in the same currency</strong>, imported reports included.",
    expiry: () => "Renews automatically; stops if you remove access in your Amazon account",
    disconnect: "BookPilot forgets the connection and stops syncing. Figures already imported stay. Amazon doesn't let an app revoke its own access, so to remove it there too, do so in your Amazon account's Login with Amazon settings.",
  },
  tiktok: {
    name: "TikTok",
    pulls: "campaign spend, clicks and purchases",
    permission: html`<strong>two read-only permissions</strong>, Reporting and Ad Account Information`,
    promise: html`It can see your campaign figures and your account's currency and time zone, and can't create, change, pause or spend on anything.`,
    billing: "TikTok bills you directly, and BookPilot never sees your password.",
    windowNote: "TikTok reports at most 30 days at a time, so 90 days takes three requests.",
    footnote: "Figures are your <strong>website purchases</strong> (Complete payment) and Clicks (destination), by day in your ad account's time zone, up to yesterday. TikTok isn't asked for campaign status, so it's inferred from recent spend. Importing a report for the same days replaces them.",
    expiry: () => "Doesn't expire; stops if you remove access in TikTok",
    disconnect: "BookPilot revokes its access token at TikTok and forgets the connection. Figures already imported stay. If the revoke can't be completed (the token may already be dead), the connection is forgotten here regardless.",
  },
};

export function platformConnectBlock(platform, integration, capabilities, { books = [] } = {}) {
  const copy = COPY[platform];
  const head = html`<h3 class="bp-small" style="margin:var(--bp-4) 0 var(--bp-2)"><strong>Automatic sync</strong></h3>`;

  if (!capabilities?.[platform]) {
    return html`
      <div data-pc>
        ${raw(head)}
        <p class="bp-small bp-muted" style="margin:0">
          ${isDemo()
            ? "The demo workspace isn't connected to any ad account. Create a free account to connect yours, or import a report below."
            : "Automatic sync isn't set up on this deployment yet. Import a report below and your figures appear the same way."}
        </p>
      </div>`;
  }

  const connected = integration?.status === "connected";
  if (!connected) {
    return html`
      <div data-pc>
        ${raw(head)}
        <p class="bp-small bp-muted" style="margin:0 0 var(--bp-3)">
          Connect your ${copy.name} ad account and BookPilot pulls ${copy.pulls} by
          day, so you don't have to download reports. It uses ${raw(copy.permission)}. ${raw(copy.promise)}
          ${copy.billing}
        </p>
        ${raw(integration?.status === "expired" ? html`<div class="bp-alert bp-alert--warning" style="margin-bottom:var(--bp-3)"><span class="bp-alert__icon">!</span><div class="bp-small">${integration.last_error || `Your ${copy.name} connection expired.`} Connect again to keep syncing.</div></div>` : "")}
        ${raw(copy.regions ? html`
          <label class="bp-field" style="margin:0 0 var(--bp-3)"><span class="bp-label">Your Amazon marketplace</span>
            <select class="bp-select" data-pc-field="region">${raw(Object.entries(copy.regions).map(([key, label]) => html`<option value="${key}">${label}</option>`).join(""))}</select>
            <span class="bp-tiny bp-subtle">Amazon keeps a separate login for each region. Choose the one your Amazon Attribution account is in.</span></label>` : "")}
        <button type="button" class="bp-btn bp-btn--primary bp-btn--sm" data-pc-action="connect">Connect ${copy.name}</button>
      </div>`;
  }

  return html`
    <div data-pc>
      ${raw(head)}
      <dl class="bp-kv">
        <dt>Ad account</dt><dd>${integration.account_name || integration.account_id || "Not chosen yet"}</dd>
        <dt>Last synced</dt><dd>${integration.last_synced_at ? fmt.relativeTime(integration.last_synced_at) : "Never"}</dd>
        <dt>Access expires</dt><dd>${copy.expiry(integration)}</dd>
      </dl>
      ${raw(integration.last_error ? html`<div class="bp-alert bp-alert--warning" style="margin-top:var(--bp-3)"><span class="bp-alert__icon">!</span><div class="bp-small">${integration.last_error}</div></div>` : "")}
      ${raw(integration.account_id ? html`
        <div class="bp-grid bp-grid--2" style="gap:var(--bp-3);margin-top:var(--bp-3)">
          <label class="bp-field" style="margin:0"><span class="bp-label">Days to pull</span>
            <select class="bp-select" data-pc-field="days">
              <option value="7">Last 7 days</option><option value="30" selected>Last 30 days</option><option value="90">Last 90 days</option>
            </select>
            <span class="bp-tiny bp-subtle">${copy.windowNote}</span></label>
          ${raw(copy.noBook ? "" : html`<label class="bp-field" style="margin:0"><span class="bp-label">Book for new campaigns</span>
            <select class="bp-select" data-pc-field="book">${raw(books.map((b) => html`<option value="${b.id}">${b.title}</option>`).join(""))}</select>
            <span class="bp-tiny bp-subtle">Only used for ${copy.name} campaigns BookPilot hasn't seen before.</span></label>`)}
        </div>` : "")}
      <div class="bp-row bp-row--wrap" style="margin-top:var(--bp-3)">
        ${raw(integration.account_id ? '<button type="button" class="bp-btn bp-btn--primary bp-btn--sm" data-pc-action="sync">Sync now</button>' : "")}
        <button type="button" class="bp-btn bp-btn--secondary bp-btn--sm" data-pc-action="accounts">${integration.account_id ? "Change ad account" : "Choose ad account"}</button>
        <button type="button" class="bp-btn bp-btn--danger bp-btn--sm" data-pc-action="disconnect">Disconnect</button>
      </div>
      <div data-pc-accounts class="bp-stack-sm" style="margin-top:var(--bp-3)"></div>
      <div data-pc-result role="status" aria-live="polite" style="margin-top:var(--bp-3)"></div>
      <p class="bp-tiny bp-subtle" style="margin:var(--bp-3) 0 0">${raw(copy.footnote)}</p>
    </div>`;
}

export function wirePlatformConnect(root, platform, { done }) {
  const block = root.querySelector(`[data-platform-card][data-platform="${platform}"] [data-pc]`);
  if (!block) return;
  const copy = COPY[platform];
  const field = (name) => block.querySelector(`[data-pc-field="${name}"]`);

  block.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-pc-action]");
    if (!button) return;
    const action = button.dataset.pcAction;

    if (action === "connect") {
      button.disabled = true;
      try {
        const { url } = await API.connectAuthorizeUrl(platform, copy.regions ? { region: field("region")?.value } : undefined);
        location.href = url;
      } catch (err) { notify.error(err.message); button.disabled = false; }
    } else if (action === "accounts") {
      button.disabled = true;
      try {
        const { accounts, selected } = await API.connectAccounts(platform);
        const list = block.querySelector("[data-pc-accounts]");
        list.innerHTML = accounts.length
          ? accounts.map((a) => html`
              <label class="bp-radio ${a.id === selected ? "bp-radio--selected" : ""}">
                <input type="radio" name="pc-account" value="${a.id}" ${a.id === selected ? "checked" : ""}>
                <span><strong>${a.name}</strong>
                  <span class="bp-small bp-subtle"> · ${a.currency || "currency not stated"}${a.country ? ` · ${a.country}` : a.timezone ? ` · ${a.timezone}` : ""}</span></span>
              </label>`).join("") +
            '<button type="button" class="bp-btn bp-btn--primary bp-btn--sm" data-pc-action="use-account" style="margin-top:var(--bp-2)">Use this account</button>'
          : `<p class="bp-small bp-muted">No ad accounts found on that ${copy.name} login.</p>`;
      } catch (err) { notify.error(err.message); }
      button.disabled = false;
    } else if (action === "use-account") {
      const chosen = block.querySelector('input[name="pc-account"]:checked');
      if (!chosen) return;
      try {
        await API.connectSelectAccount(platform, { account_id: chosen.value });
        notify.success("Ad account saved.");
        done?.();
      } catch (err) { notify.error(err.message); }
    } else if (action === "sync") {
      button.disabled = true;
      const result = block.querySelector("[data-pc-result]");
      result.innerHTML = `<span class="bp-small bp-muted">Syncing from ${copy.name}…</span>`;
      try {
        const r = await API.connectSync(platform, { days: Number(field("days")?.value) || 30, book_id: field("book")?.value || undefined });
        if (!r.days) notify.info(`${copy.name} returned no figures for those days.`);
        else notify.success(`Synced ${fmt.number(r.days)} campaign-days from ${fmt.number(r.campaigns)} campaign${r.campaigns === 1 ? "" : "s"}.`);
        for (const note of r.notes || []) notify.info(note);
        if (r.skipped?.length) {
          notify.info(`${r.skipped.length} campaign${r.skipped.length === 1 ? " was" : "s were"} skipped: ${r.skipped.slice(0, 2).map((s) => `${s.name} (${s.reason})`).join(" ")}`);
        }
        done?.();
      } catch (err) {
        result.innerHTML = "";
        notify.error(err.message);
        button.disabled = false;
      }
    } else if (action === "disconnect") {
      const ok = await confirmDialog({
        title: `Disconnect ${copy.name}?`,
        message: copy.disconnect,
        confirmLabel: "Disconnect", tone: "danger",
      });
      if (!ok) return;
      try { await API.connectDisconnect(platform); notify.success(`${copy.name} disconnected.`); done?.(); }
      catch (err) { notify.error(err.message); }
    }
  });
}
