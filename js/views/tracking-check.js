// "Is my tracking working?" — the installation check for a website
// tracking key.
//
// An author who pastes a script into their site and then sees nothing has
// no way to tell "not working" from "no visitors yet". This screen ends
// that: it says what has arrived, lets them prove the script works on
// their real site with one test visit, and — for the commonest failure,
// a key used from a domain other than the one registered — says so.
//
// Nothing is simulated in a live workspace. The demo workspace, which has
// no website to visit, gets a clearly labelled button to show what a
// received test visit looks like.

import { html, raw } from "../core/dom.js";
import { API, isDemo } from "../core/api.js";
import { notify } from "../core/toast.js";
import { fmt } from "./shared.js";

const EVENT_LABEL = {
  page_view: "Page view",
  click: "Click",
  add_to_cart: "Add to cart",
  checkout: "Checkout",
  purchase: "Purchase",
};

const STATE = {
  receiving: { label: "Receiving events", tone: "success" },
  quiet: { label: "Quiet", tone: "warning" },
  tested: { label: "Test received", tone: "info" },
  mismatch: { label: "Wrong domain", tone: "danger" },
  waiting: { label: "Waiting for first event", tone: "" },
};

const POLL_MS = 3000;
const POLL_LIMIT_MS = 3 * 60_000;

export function healthBadge(status) {
  const state = STATE[status?.health?.state] || STATE.waiting;
  return html`<span class="bp-badge ${state.tone ? `bp-badge--${state.tone}` : ""}">${state.label}</span>`;
}

function headline(status) {
  const h = status.health || {};
  const s = status.summary || {};
  switch (h.state) {
    case "receiving":
      return `Events are arriving. The last one was ${fmt.relativeTime(s.last_real_event_at)}, and there ${s.last_24h === 1 ? "has been 1" : `have been ${fmt.number(s.last_24h)}`} in the last 24 hours.`;
    case "quiet":
      return `Events arrived before, but none in the last 7 days. The last one was ${fmt.relativeTime(s.last_real_event_at)}.`;
    case "tested":
      return `Your test visit arrived ${fmt.relativeTime(s.last_event_at)}, so the script works. Real visits appear once an ad link brings someone to your site.`;
    case "mismatch":
      return h.rejected_host
        ? `Your key was used from ${h.rejected_host}, which isn't the domain you registered (${status.site.domain}). Those visits were ignored.`
        : `Your key was used from a domain that isn't the one you registered (${status.site.domain}). Those visits were ignored.`;
    default:
      return "Nothing has arrived yet. That's normal before the script is on your site and someone clicks an ad. The test below proves it works without waiting for a real visitor.";
  }
}

function countsBlock(status) {
  const c = status.summary?.counts || {};
  const cell = (label, value) => html`
    <div class="bp-panel" style="padding:var(--bp-3)">
      <div class="bp-tiny bp-subtle">${label}</div>
      <div style="font-size:1.25rem;font-variant-numeric:tabular-nums">${value}</div>
    </div>`;
  return html`
    <div class="bp-grid bp-grid--3" style="margin-top:var(--bp-3)">
      ${raw(cell("Page views", fmt.number(c.page_view || 0)))}
      ${raw(cell("Checkouts", fmt.number(c.checkout || 0)))}
      ${raw(cell("Purchases", fmt.number(c.purchase || 0)))}
    </div>
    <p class="bp-tiny bp-subtle" style="margin:var(--bp-2) 0 0">
      Last 7 days${status.summary?.capped ? " (the most recent 500 events)" : ""}.
      ${status.summary?.revenue_cents ? `Purchases total ${fmt.money(status.summary.revenue_cents)}.` : ""}
      Test visits are not counted.
    </p>`;
}

function recentTable(status) {
  const rows = status.recent || [];
  if (!rows.length) return "";
  return html`
    <div class="bp-table-wrap" style="margin-top:var(--bp-4)">
      <table class="bp-table">
        <thead><tr><th>When</th><th>Event</th><th>Source</th><th class="bp-num">Value</th></tr></thead>
        <tbody>
          ${raw(rows.map((e) => html`
            <tr>
              <td class="bp-small">${fmt.relativeTime(e.occurred_at)}</td>
              <td class="bp-small">${EVENT_LABEL[e.event_type] || e.event_type}</td>
              <td class="bp-small">
                ${raw(e.is_test
                  ? '<span class="bp-badge bp-badge--info">Test visit</span>'
                  : e.attributed
                    ? '<span class="bp-badge bp-badge--success">Attributed to a campaign</span>'
                    : html`<span class="bp-badge">Not attributed</span>`)}
                ${e.label && !e.is_test && !e.attributed ? raw(html` <span class="bp-tiny bp-subtle">${e.label}</span>`) : ""}
              </td>
              <td class="bp-small bp-num">${e.value_cents ? fmt.money(e.value_cents, e.currency) : "—"}</td>
            </tr>`).join(""))}
        </tbody>
      </table>
    </div>`;
}

function testBlock(status, { waiting, received }) {
  const demo = isDemo();
  return html`
    <div class="bp-panel" style="margin-top:var(--bp-4)">
      <strong class="bp-small">Prove it works on your site</strong>
      <ol class="bp-small bp-muted" style="margin:var(--bp-2) 0 var(--bp-3);padding-left:1.2em">
        <li>Put the snippet on your site, on every page.</li>
        <li>Open your site using the test link below (a normal visitor is never tracked, so the link carries a marker).</li>
        <li>This page shows the visit as soon as it lands.</li>
      </ol>
      ${raw(demo ? html`
        <p class="bp-tiny bp-subtle" style="margin:0 0 var(--bp-3)">
          The demo workspace has no website to visit, so the button below shows what a received test visit looks like.
        </p>` : html`
        <code class="bp-code" style="word-break:break-all">${status.test_url}</code>`)}
      <div class="bp-row bp-row--wrap" style="margin-top:var(--bp-3)">
        ${raw(demo ? "" : html`
          <a class="bp-btn bp-btn--secondary bp-btn--sm" href="${status.test_url}" target="_blank" rel="noopener noreferrer">Open my site with the test link</a>
          <button type="button" class="bp-btn bp-btn--ghost bp-btn--sm" data-copy-test="${status.test_url}">Copy link</button>`)}
        <button type="button" class="bp-btn bp-btn--primary bp-btn--sm" data-track-action="${demo ? "simulate" : "wait"}"
                ${waiting ? "disabled" : ""}>
          ${demo ? "Simulate a test visit (demo)" : waiting ? "Waiting…" : "Wait for a test visit"}
        </button>
      </div>
      <div class="bp-small" style="margin-top:var(--bp-3)" role="status" aria-live="polite">
        ${raw(received
          ? '<span class="bp-badge bp-badge--success">✓ Test visit received. Your tracking works.</span>'
          : waiting
            ? '<span class="bp-muted">Listening for a test visit… open the test link in another tab.</span>'
            : "")}
      </div>
    </div>`;
}

function troubleshooting(status) {
  return html`
    <details style="margin-top:var(--bp-4)">
      <summary class="bp-small" style="cursor:pointer">Nothing showing up? Check these</summary>
      <ul class="bp-small bp-muted" style="margin:var(--bp-3) 0 0;padding-left:1.2em;display:grid;gap:6px">
        <li>The snippet contains <em>your</em> key exactly as shown above, and is on the page you are testing — in <code>&lt;head&gt;</code> or just before <code>&lt;/body&gt;</code>.</li>
        <li>The site is on <strong>${status.site.domain}</strong> (or a subdomain of it). A different domain is ignored — register the domain the site really runs on.</li>
        <li>The test link arrives with its <code>?utm_…</code> parameters intact. Redirects, link shorteners and some shop platforms strip them, and a visit with no attribution is deliberately not recorded.</li>
        <li>Your consent banner isn't holding the script back: if <code>window.bookpilotConsent</code> is <code>false</code>, nothing is sent until you set it to <code>true</code>.</li>
        <li>An ad blocker or a strict Content Security Policy can block the script or its request. Try a private window with extensions off.</li>
        <li>Purchases only count toward a campaign when <code>utm_campaign</code> holds that campaign's BookPilot id — links built by the campaign wizard do this for you.</li>
      </ul>
    </details>`;
}

/** The body of the check panel for one site's status. */
export function checkBody(status, options = {}) {
  return html`
    <p class="bp-small" style="margin:0">${headline(status)}</p>
    ${raw(countsBlock(status))}
    ${raw(testBlock(status, options))}
    ${raw(recentTable(status))}
    ${raw(troubleshooting(status))}
  `;
}

/**
 * Make the check panels live: open/closed state, the test-visit poll,
 * copy-link and the demo's simulate button. `statuses` maps site id to
 * the status already fetched for the page.
 */
export function wireTrackingChecks(container, statuses) {
  container.querySelectorAll("[data-check-site]").forEach((panel) => {
    const siteId = panel.dataset.checkSite;
    const body = panel.querySelector("[data-check-body]");
    const badge = panel.closest("[data-site-card]")?.querySelector("[data-site-health]");
    let status = statuses[siteId];
    let waiting = false;
    let received = false;
    let timer = null;
    let startedAt = 0;

    const paint = () => {
      if (!status) {
        body.innerHTML = '<p class="bp-small bp-muted">Status isn\'t available right now. Try again in a moment.</p>';
        return;
      }
      body.innerHTML = checkBody(status, { waiting, received });
      if (badge) badge.innerHTML = healthBadge(status);
    };

    const stop = () => {
      waiting = false;
      if (timer) clearInterval(timer);
      timer = null;
    };

    const refresh = async () => {
      try {
        status = await API.trackingStatus(siteId);
      } catch (err) {
        notify.error(err.message);
      }
    };

    const tick = async () => {
      // The page replaces this DOM on navigation; stop polling then.
      if (!document.body.contains(panel)) return stop();
      await refresh();
      const arrived = (status?.recent || []).some(
        (e) => e.is_test && Date.parse(e.occurred_at) >= startedAt - 2000
      );
      if (arrived) {
        received = true;
        stop();
      } else if (Date.now() - startedAt > POLL_LIMIT_MS) {
        stop();
        notify.info("No test visit arrived. The checklist below lists the usual causes.");
        panel.querySelector("details details")?.setAttribute("open", "");
      }
      paint();
    };

    panel.addEventListener("click", async (event) => {
      const copy = event.target.closest("[data-copy-test]");
      if (copy) {
        try {
          await navigator.clipboard.writeText(copy.dataset.copyTest);
          notify.success("Copied to your clipboard.");
        } catch {
          notify.info("Select the link and copy it manually.");
        }
        return;
      }
      const action = event.target.closest("[data-track-action]")?.dataset.trackAction;
      if (action === "wait") {
        received = false;
        waiting = true;
        startedAt = Date.now();
        paint();
        timer = setInterval(tick, POLL_MS);
      } else if (action === "simulate") {
        await API.simulateTestVisit(siteId);
        startedAt = Date.now() - 1000;
        await refresh();
        received = true;
        paint();
      }
    });

    panel.addEventListener("toggle", () => {
      if (!panel.open) stop();
    });

    paint();
  });
}
