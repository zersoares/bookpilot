// BookPilot AI — application bootstrap.
//
// Decides three things at start-up, in this order:
//
//   1. What this deployment can do (GET /api/bp/config).
//   2. Whether we're in the demo workspace — asked for with ?demo=1, or
//      forced when the deployment has no database configured. In that
//      case the app runs entirely in the browser against the sample
//      dataset and says so on every screen, rather than showing an
//      error page or, worse, pretending.
//   3. Whether there's a session, and therefore whether to show the app
//      or the sign-in screen.

import { html, raw, $, mount } from "./core/dom.js";
import * as router from "./core/router.js";
import * as auth from "./core/auth.js";
import * as store from "./core/store.js";
import { API, useDemoAdapter, isDemo, ApiError } from "./core/api.js";
import { demoAdapter, resetDemo } from "./data/demo-adapter.js";
import { applyStoredTheme, toggleTheme, currentTheme } from "./core/theme.js";
import { notify } from "./core/toast.js";
import * as fmt from "./core/format.js";
import { refreshAccount } from "./core/session.js";
import { loading, errorBox } from "./views/shared.js";

import * as authView from "./views/auth.js";
import * as onboardingView from "./views/onboarding.js";
import * as overviewView from "./views/overview.js";
import * as booksView from "./views/books.js";
import * as strategyView from "./views/strategy.js";
import * as creativesView from "./views/creatives.js";
import * as campaignsView from "./views/campaigns.js";
import * as analyticsView from "./views/analytics.js";
import * as advisorView from "./views/advisor.js";
import * as attributionView from "./views/attribution.js";
import * as billingView from "./views/billing.js";
import * as settingsView from "./views/settings.js";
import * as adminView from "./views/admin.js";

const NAV = [
  { path: "/overview", label: "Overview", icon: "◈", mobile: "Home" },
  { path: "/books", label: "My Books", icon: "▤", mobile: "Books" },
  { path: "/strategy", label: "AI Strategy", icon: "✦" },
  { path: "/creatives", label: "Creatives", icon: "◐", mobile: "Creatives" },
  { path: "/campaigns", label: "Campaigns", icon: "▶", mobile: "Campaigns" },
  { path: "/analytics", label: "Analytics", icon: "▦", mobile: "Analytics" },
  { path: "/advisor", label: "AI Advisor", icon: "✧" },
  { path: "/attribution", label: "Attribution", icon: "⇱" },
  { path: "/billing", label: "Billing", icon: "◇" },
  { path: "/settings", label: "Settings", icon: "⚙" },
];

const PUBLIC_ROUTES = ["/signin", "/signup", "/reset"];

// Inline rather than a glyph: the bell characters in the Unicode
// geometric blocks aren't in DM Sans, so they render as nothing.
const BELL_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
  <path d="M8 2a3.6 3.6 0 0 0-3.6 3.6v2.2L3.3 10a.5.5 0 0 0 .43.76h8.54A.5.5 0 0 0 12.7 10l-1.1-2.2V5.6A3.6 3.6 0 0 0 8 2Z"
        stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
  <path d="M6.6 12.4a1.5 1.5 0 0 0 2.8 0" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
</svg>`;

// ---------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------

function navItems(activePath) {
  const showAdmin = store.get("profile")?.role === "admin";
  const items = showAdmin ? [...NAV, { path: "/admin", label: "Admin", icon: "⛭" }] : NAV;
  return items
    .map((item) => {
      const active = activePath === item.path || activePath.startsWith(`${item.path}/`);
      return html`<a class="bp-nav-item ${active ? "bp-nav-item--active" : ""}" href="#${item.path}">
        <span class="bp-nav-item__icon" aria-hidden="true">${item.icon}</span>${item.label}
      </a>`;
    })
    .join("");
}

function bottomNav(activePath) {
  return NAV.filter((item) => item.mobile)
    .map((item) => {
      const active = activePath === item.path || activePath.startsWith(`${item.path}/`);
      return html`<a class="bp-bottom-nav__item ${active ? "bp-bottom-nav__item--active" : ""}" href="#${item.path}">
        <span class="bp-bottom-nav__icon" aria-hidden="true">${item.icon}</span>${item.mobile}
      </a>`;
    })
    .join("");
}

function creditsPanel() {
  const profile = store.get("profile");
  const plan = store.get("plan");
  if (!profile) return "";
  const allowance = plan?.monthly_credits || 0;
  const pct = allowance ? Math.min(100, Math.round((profile.ai_credits / allowance) * 100)) : 0;
  return html`
    <div class="bp-credits">
      <div class="bp-credits__row">
        <span class="bp-muted">AI credits</span>
        <strong>${fmt.number(profile.ai_credits)}</strong>
      </div>
      <div class="bp-progress"><div class="bp-progress__bar" style="width:${pct}%"></div></div>
      <div class="bp-tiny bp-subtle" style="margin-top:6px">
        ${plan ? `${plan.name} plan` : ""}${allowance ? ` · ${allowance}/month` : ""}
      </div>
      <a class="bp-btn bp-btn--secondary bp-btn--sm bp-btn--block" style="margin-top:var(--bp-3)" href="#/billing">
        Manage plan
      </a>
    </div>
  `;
}

function renderShell(activePath) {
  const profile = store.get("profile");
  const unread = store.get("counts")?.unreadNotifications || 0;

  document.body.innerHTML = html`
    <a class="bp-skip-link" href="#view">Skip to content</a>
    <div class="bp-app">
      <aside class="bp-sidebar">
        <a class="bp-sidebar__brand" href="#/overview">
          <span class="bp-sidebar__mark" aria-hidden="true"></span> BookPilot
        </a>
        <nav class="bp-nav-group" aria-label="Main">${raw(navItems(activePath))}</nav>
        <div class="bp-sidebar__foot">${raw(creditsPanel())}</div>
      </aside>

      <div class="bp-main">
        <header class="bp-topbar">
          <div class="bp-topbar__title" id="topbar-title"></div>
          <div class="bp-topbar__actions">
            <a class="bp-btn bp-btn--primary bp-btn--sm" href="#/campaigns/new">New campaign</a>
            <button type="button" class="bp-icon-btn" id="notif-btn" aria-label="Notifications">
              ${raw(BELL_ICON)}${unread ? raw('<span class="bp-icon-btn__dot"></span>') : ""}
            </button>
            <button type="button" class="bp-icon-btn" id="theme-btn" aria-label="Switch theme">
              ${currentTheme() === "dark" ? "☀" : "☾"}
            </button>
            <button type="button" class="bp-avatar" id="avatar-btn" aria-label="Account menu">
              ${fmt.initials(profile?.full_name || profile?.email || "?")}
            </button>
          </div>
        </header>

        ${isDemo() ? raw(demoBar()) : ""}

        <main class="bp-view" id="view" tabindex="-1">${raw(loading())}</main>
      </div>
    </div>
    <nav class="bp-bottom-nav" aria-label="Main">${raw(bottomNav(activePath))}</nav>
  `;

  $("#theme-btn").addEventListener("click", (event) => {
    toggleTheme();
    event.currentTarget.textContent = currentTheme() === "dark" ? "☀" : "☾";
  });
  $("#avatar-btn").addEventListener("click", toggleAccountMenu);
  $("#notif-btn").addEventListener("click", toggleNotifications);
  $("#demo-reset")?.addEventListener("click", () => {
    resetDemo();
    notify.info("Demo workspace reset.");
    refresh()
      .catch(() => {})
      .finally(() => router.resolve());
  });
}

function demoBar() {
  return html`
    <div class="bp-demo-bar">
      <span class="bp-demo-badge">Demo data</span>
      <span class="bp-flex-1">
        You're exploring a sample book and a simulated campaign. None of these figures are real sales,
        and nothing here is connected to an ad account.
      </span>
      <a class="bp-btn bp-btn--primary bp-btn--sm" href="#/signup">Create a free account</a>
      <button type="button" class="bp-btn bp-btn--ghost bp-btn--sm" id="demo-reset">Reset demo</button>
    </div>
  `;
}

function setTitle(title) {
  const node = $("#topbar-title");
  if (node) node.textContent = title;
  document.title = `${title} · BookPilot AI`;
}

// ---------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------

function closeMenus() {
  document.querySelectorAll(".bp-menu, .bp-notifications").forEach((node) => node.remove());
}

function toggleAccountMenu() {
  if (document.querySelector(".bp-menu")) return closeMenus();
  closeMenus();
  const profile = store.get("profile");
  const menu = document.createElement("div");
  menu.className = "bp-menu";
  menu.innerHTML = html`
    <div class="bp-menu__head">
      <div><strong>${profile?.full_name || "Your account"}</strong></div>
      <div class="bp-tiny bp-subtle">${profile?.email || ""}</div>
    </div>
    <a class="bp-menu__item" href="#/settings">Settings</a>
    <a class="bp-menu__item" href="#/billing">Plan &amp; credits</a>
    <a class="bp-menu__item" href="/privacy.html">Privacy policy</a>
    ${isDemo()
      ? raw('<a class="bp-menu__item" href="#/signup">Create an account</a>')
      : raw('<button type="button" class="bp-menu__item" id="signout-btn">Sign out</button>')}
  `;
  document.querySelector(".bp-main").appendChild(menu);
  menu.querySelector("#signout-btn")?.addEventListener("click", async () => {
    await auth.signOut();
    location.hash = "#/signin";
    location.reload();
  });
  setTimeout(() => document.addEventListener("click", onOutsideClick, { once: true }), 0);
}

async function toggleNotifications() {
  if (document.querySelector(".bp-notifications")) return closeMenus();
  closeMenus();
  const panel = document.createElement("div");
  panel.className = "bp-notifications";
  panel.innerHTML = loading(2);
  document.querySelector(".bp-main").appendChild(panel);

  try {
    const { notifications } = await API.notifications();
    store.set({ notifications });
    panel.innerHTML = notifications.length
      ? `<div class="bp-row bp-row--between" style="padding:var(--bp-3) var(--bp-4);border-bottom:1px solid var(--bp-border)">
           <strong>Notifications</strong>
           <button type="button" class="bp-btn bp-btn--ghost bp-btn--sm" id="read-all">Mark all read</button>
         </div>` +
        notifications
          .map(
            (n) => html`<a class="bp-notification ${n.read ? "" : "bp-notification--unread"}" href="${n.link || "#/overview"}">
              <div><strong>${n.title}</strong></div>
              <div class="bp-small bp-muted">${n.message || ""}</div>
              <div class="bp-tiny bp-subtle" style="margin-top:4px">${fmt.relativeTime(n.created_at)}</div>
            </a>`
          )
          .join("")
      : `<div style="padding:var(--bp-6)" class="bp-center bp-muted bp-small">Nothing yet. We'll tell you when a campaign has news.</div>`;

    panel.querySelector("#read-all")?.addEventListener("click", async () => {
      await API.markAllRead();
      store.set({ counts: { ...store.get("counts"), unreadNotifications: 0 } });
      closeMenus();
      $("#notif-btn").querySelector(".bp-icon-btn__dot")?.remove();
    });
  } catch (err) {
    panel.innerHTML = `<div style="padding:var(--bp-4)">${errorBox(err.message)}</div>`;
  }
  setTimeout(() => document.addEventListener("click", onOutsideClick, { once: true }), 0);
}

function onOutsideClick(event) {
  if (event.target.closest(".bp-menu, .bp-notifications, #avatar-btn, #notif-btn")) {
    document.addEventListener("click", onOutsideClick, { once: true });
    return;
  }
  closeMenus();
}

// ---------------------------------------------------------------------
// View plumbing
// ---------------------------------------------------------------------

let shellPath = null;

/**
 * Renders a view into the shell, creating the shell first if needed and
 * turning any thrown error into a readable panel rather than a blank
 * screen (spec §37).
 */
function view(title, renderFn) {
  return async (params, query) => {
    const path = router.currentPath().split("?")[0];
    if (shellPath === null || document.querySelector(".bp-app") === null) renderShell(path);
    else refreshNav(path);
    shellPath = path;
    closeMenus();
    setTitle(title);

    const container = $("#view");
    container.innerHTML = loading();
    try {
      await renderFn(container, params, query);
    } catch (err) {
      console.error(err);
      container.innerHTML = errorBox(
        err instanceof ApiError ? err.message : "Something went wrong loading this page.",
        '<a class="bp-btn bp-btn--secondary bp-btn--sm" href="#/overview">Back to overview</a>'
      );
    }
  };
}

function refreshNav(activePath) {
  const sidebar = document.querySelector(".bp-sidebar .bp-nav-group");
  if (sidebar) sidebar.innerHTML = navItems(activePath);
  const bottom = document.querySelector(".bp-bottom-nav");
  if (bottom) bottom.innerHTML = bottomNav(activePath);
  const credits = document.querySelector(".bp-sidebar__foot");
  if (credits) credits.innerHTML = creditsPanel();
}

// The sidebar shows the credit balance and the admin link, so it has to
// follow the store rather than only the route.
store.subscribe(() => {
  if (document.querySelector(".bp-app")) refreshNav(router.currentPath().split("?")[0]);
});

async function refresh() {
  return refreshAccount();
}

// ---------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------

function registerRoutes() {
  // Public
  router.register("/signin", (p, q) => authView.render($("#app-root") || document.body, "signin", q));
  router.register("/signup", (p, q) => authView.render($("#app-root") || document.body, "signup", q));
  router.register("/reset", (p, q) => authView.render($("#app-root") || document.body, "reset", q));

  router.register("/onboarding", view("Welcome", onboardingView.render));
  router.register("/overview", view("Overview", overviewView.render));

  router.register("/books", view("My Books", booksView.renderList));
  router.register("/books/new", view("Add a book", booksView.renderForm));
  router.register("/books/:id", view("Book", booksView.renderDetail));
  router.register("/books/:id/edit", view("Edit book", booksView.renderForm));

  router.register("/strategy", view("AI Strategy", strategyView.render));
  router.register("/strategy/:bookId", view("AI Strategy", strategyView.render));

  router.register("/creatives", view("Creative library", creativesView.renderLibrary));
  router.register("/creatives/new", view("Create ads", creativesView.renderFactory));
  router.register("/creatives/templates", view("Templates", creativesView.renderTemplates));
  router.register("/creatives/:id", view("Creative", creativesView.renderDetail));

  router.register("/campaigns", view("Campaigns", campaignsView.renderList));
  router.register("/campaigns/new", view("New campaign", campaignsView.renderWizard));
  router.register("/campaigns/:id", view("Campaign", campaignsView.renderDetail));

  router.register("/analytics", view("Analytics", analyticsView.render));
  router.register("/advisor", view("AI Advisor", advisorView.render));
  router.register("/attribution", view("Attribution", attributionView.render));
  router.register("/billing", view("Billing", billingView.render));
  router.register("/settings", view("Settings", settingsView.render));
  router.register("/admin", view("Admin", adminView.render));

  router.setNotFound(
    view("Not found", (container) => {
      container.innerHTML = `
        <div class="bp-empty">
          <div class="bp-empty__icon">◇</div>
          <div class="bp-empty__title">That page doesn't exist</div>
          <p class="bp-empty__text">The link may be out of date.</p>
          <a class="bp-btn bp-btn--primary" href="#/overview">Back to overview</a>
        </div>`;
    })
  );
}

// ---------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------

function isPublicRoute() {
  const path = router.currentPath().split("?")[0];
  return PUBLIC_ROUTES.includes(path);
}

async function boot() {
  applyStoredTheme();
  registerRoutes();

  const wantsDemo = new URLSearchParams(location.search).get("demo") === "1";

  // A session can arrive in the URL fragment after OAuth or a magic link.
  auth.consumeUrlSession();

  let config = null;
  try {
    config = await API.config();
  } catch {
    config = null;
  }

  const hasBackend = Boolean(config?.capabilities?.database && config?.auth?.url);
  if (wantsDemo || !hasBackend) {
    useDemoAdapter(demoAdapter);
    store.set({ demo: true, config: await API.config() });
    if (!wantsDemo && !hasBackend) {
      // Honest about why. The flag covers both cases — never configured,
      // and configured but not answering — so the wording has to as well.
      console.info("[bookpilot] The database isn't available — running the demo workspace.");
    }
  } else {
    store.set({ demo: false, config });
    auth.configure(config.auth);
  }

  if (!isDemo() && !auth.currentUser() && !isPublicRoute()) {
    const token = await auth.accessToken();
    if (!token) {
      router.navigate("/signin", { replace: true });
    }
  }

  if (!isDemo() && (await auth.accessToken())) {
    try {
      const me = await refresh();
      // A brand-new account goes through onboarding before anything else.
      if (me.profile.onboarding_step < 6 && !isPublicRoute()) {
        router.navigate("/onboarding", { replace: true });
      }
    } catch (err) {
      console.error("[bookpilot] could not load account:", err);
    }
  } else if (isDemo()) {
    try {
      await refresh();
    } catch {
      /* the demo adapter always answers, but never block boot on it */
    }
  }

  router.setNavigateHook(() => closeMenus());
  router.start();
}

// Sign-in screens replace the whole body, so give them a root to own.
document.body.innerHTML = '<div id="app-root"></div>';
boot().catch((err) => {
  console.error(err);
  mount(
    document.body,
    `<div class="bp-auth"><div class="bp-auth__card">${errorBox(
      "BookPilot couldn't start. Please reload the page.",
      '<button type="button" class="bp-btn bp-btn--primary bp-btn--sm" onclick="location.reload()">Reload</button>'
    )}</div></div>`
  );
});

export { store, API, router, notify };

