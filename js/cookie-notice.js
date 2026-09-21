// Cookie and storage notice.
//
// BookPilot sets no cookies at all. What it keeps in the browser is a handful
// of localStorage entries, all of them either needed to run the app or written
// because the person used a control. This notice says so, lists every one, and
// remembers that it has been read.
//
// It is built to tell the truth about the site as it is, and to change with it:
//
//   * CATEGORIES is the whole inventory. Today it holds one category, the
//     necessary one, so the notice is a single "Got it".
//   * Add an optional category (analytics, marketing...) and the notice turns
//     itself into a real choice: Reject optional / Accept all / per-category
//     switches, equal weight on refusing. Nothing optional may load before
//     `bookpilotCookies.has("<id>")` says yes.
//
// tests/cookie-notice.test.mjs fails if the app starts using a storage key that
// is not listed here, or on the cookie policy page. Every function above
// `init()` is pure so it can be tested without a browser.

export const CONSENT_KEY = "bookpilot.consent";
export const CONSENT_VERSION = 1;
export const MAX_AGE_DAYS = 365;

export const CATEGORIES = [
  {
    id: "necessary",
    name: "Necessary",
    required: true,
    desc:
      "Needed to run the app, or written only when you use a control (sign in, the theme toggle, a " +
      "mockup backdrop). None of it tracks you, and none of it is sent to us for analysis.",
    items: [
      {
        name: "bookpilot.session",
        type: "localStorage",
        purpose: "Keeps you signed in. Only written when you sign in.",
        duration: "Until you sign out",
      },
      {
        name: "bookpilot.theme",
        type: "localStorage",
        purpose: "Remembers light or dark. Only written if you use the toggle.",
        duration: "Until you clear site data",
      },
      {
        name: "bookpilot.mockup.palette",
        type: "localStorage",
        purpose: "Remembers the backdrop you chose in the Book Builder's mockups. Only written when you choose one.",
        duration: "Until you clear site data",
      },
      {
        name: "bookpilot.consent",
        type: "localStorage",
        purpose: "Remembers this choice so you are not asked on every page.",
        duration: "12 months",
      },
    ],
  },
  // Optional categories go here. None is needed today.
];

// ---------------------------------------------------------------------
// Pure logic
// ---------------------------------------------------------------------

export const optionalOf = (categories = CATEGORIES) => categories.filter((c) => !c.required);

/** "notice" when there is nothing to choose, "choice" when there is. */
export const modeOf = (categories = CATEGORIES) => (optionalOf(categories).length ? "choice" : "notice");

/**
 * A stored record, or null when it should be asked again: unreadable, from an
 * older version, older than a year, or written before an optional category
 * that now exists (a choice made about a different list is not a choice about
 * this one).
 */
export function parseConsent(raw, now = Date.now(), categories = CATEGORIES) {
  let record;
  try {
    record = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (!record || typeof record !== "object" || record.v !== CONSENT_VERSION) return null;
  const when = Date.parse(record.date);
  if (!Number.isFinite(when) || when > now + 60_000) return null;
  if (now - when > MAX_AGE_DAYS * 86_400_000) return null;
  if (!record.choices || typeof record.choices !== "object") return null;
  for (const c of optionalOf(categories)) {
    if (typeof record.choices[c.id] !== "boolean") return null;
  }
  return record;
}

/** choices: { [optionalId]: boolean }. Anything not named is refused. */
export function buildRecord(choices = {}, now = Date.now(), categories = CATEGORIES) {
  const out = {};
  for (const c of optionalOf(categories)) out[c.id] = choices[c.id] === true;
  return { v: CONSENT_VERSION, date: new Date(now).toISOString(), choices: out };
}

export const acceptAll = (now, categories = CATEGORIES) =>
  buildRecord(Object.fromEntries(optionalOf(categories).map((c) => [c.id, true])), now, categories);

export const rejectOptional = (now, categories = CATEGORIES) => buildRecord({}, now, categories);

/** May code in this category run? Necessary always; optional only after a yes. */
export function allows(id, record, categories = CATEGORIES) {
  const category = categories.find((c) => c.id === id);
  if (!category) return false;
  if (category.required) return true;
  return record?.choices?.[id] === true;
}

// ---------------------------------------------------------------------
// The interface
// ---------------------------------------------------------------------

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const CSS = `
.bpcn,.bpcn-dialog{--bg:#fff;--fg:#16161a;--muted:#5c5c66;--line:#e4e2dc;--soft:#f5f4f1;--primary:#3f3aa8;--on-primary:#fff;--ring:#3f3aa8}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .bpcn,:root:not([data-theme="light"]) .bpcn-dialog{--bg:#1b1b1f;--fg:#f2f1ee;--muted:#a9a8b3;--line:#34343c;--soft:#25252b;--primary:#9b96f0;--on-primary:#15132f;--ring:#9b96f0}}
:root[data-theme="dark"] .bpcn,:root[data-theme="dark"] .bpcn-dialog{--bg:#1b1b1f;--fg:#f2f1ee;--muted:#a9a8b3;--line:#34343c;--soft:#25252b;--primary:#9b96f0;--on-primary:#15132f;--ring:#9b96f0}
.bpcn{position:fixed;z-index:2147483000;left:16px;right:16px;bottom:16px;max-width:760px;margin:0 auto;padding:18px 20px;
 background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.18);
 font:400 .92rem/1.5 'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
 padding-bottom:calc(18px + env(safe-area-inset-bottom,0px))}
.bpcn[hidden],.bpcn-dialog:not([open]){display:none}
.bpcn__title{margin:0 0 4px;font-weight:600;font-size:.98rem}
.bpcn__text{margin:0;color:var(--muted)}
.bpcn__text a,.bpcn-dialog a{color:var(--primary);text-decoration:underline;text-underline-offset:2px}
.bpcn__actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px;justify-content:flex-end}
.bpcn button,.bpcn-dialog button{font:inherit;font-weight:500;font-size:.9rem;min-height:40px;padding:8px 16px;border-radius:10px;cursor:pointer;
 border:1px solid var(--line);background:var(--bg);color:var(--fg)}
.bpcn button:hover,.bpcn-dialog button:hover{background:var(--soft)}
.bpcn button.bpcn__primary,.bpcn-dialog button.bpcn__primary{background:var(--primary);border-color:var(--primary);color:var(--on-primary)}
.bpcn button.bpcn__primary:hover,.bpcn-dialog button.bpcn__primary:hover{filter:brightness(1.08);background:var(--primary)}
.bpcn button:focus-visible,.bpcn-dialog button:focus-visible,.bpcn a:focus-visible,.bpcn-dialog a:focus-visible,.bpcn-dialog input:focus-visible{outline:2px solid var(--ring);outline-offset:2px}
.bpcn-dialog{width:min(640px,calc(100vw - 24px));max-height:min(86vh,720px);padding:0;border:1px solid var(--line);border-radius:16px;
 background:var(--bg);color:var(--fg);font:400 .92rem/1.55 'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif}
.bpcn-dialog::backdrop{background:rgba(10,10,20,.5)}
.bpcn-dialog__in{display:flex;flex-direction:column;max-height:min(86vh,720px)}
.bpcn-dialog__head{padding:20px 22px 8px}
.bpcn-dialog__head h2{margin:0 0 6px;font-size:1.15rem;font-weight:600}
.bpcn-dialog__head h2:focus{outline:none}
.bpcn-dialog__head p{margin:0;color:var(--muted)}
.bpcn-dialog__body{padding:8px 22px;overflow:auto}
.bpcn-cat{border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:12px 0}
.bpcn-cat__head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.bpcn-cat__name{font-weight:600}
.bpcn-cat__state{font-size:.78rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.bpcn-cat p{margin:6px 0 0;color:var(--muted)}
.bpcn-cat label{display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-size:.86rem}
.bpcn-cat input[type=checkbox]{width:18px;height:18px;accent-color:var(--primary)}
.bpcn-items{margin:12px 0 0;padding:0;list-style:none;border-top:1px solid var(--line)}
.bpcn-items li{padding:10px 0;border-bottom:1px solid var(--line)}
.bpcn-items li:last-child{border-bottom:0;padding-bottom:0}
.bpcn-items code{font:500 .82rem ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--soft);padding:2px 6px;border-radius:6px}
.bpcn-items .meta{display:block;margin-top:2px;font-size:.8rem;color:var(--muted)}
.bpcn-dialog__foot{display:flex;flex-wrap:wrap;gap:10px;justify-content:flex-end;padding:14px 22px 20px;border-top:1px solid var(--line)}
.bpcn-dialog__links{margin:8px 0 0;font-size:.85rem;color:var(--muted)}
@media (max-width:520px){.bpcn{left:10px;right:10px;bottom:10px;padding:16px}.bpcn__actions button{flex:1 1 auto}.bpcn-dialog__foot button{flex:1 1 auto}}
@media (prefers-reduced-motion:no-preference){.bpcn{animation:bpcn-in .25s ease-out}@keyframes bpcn-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}}
`;

function readStored() {
  try {
    return parseConsent(localStorage.getItem(CONSENT_KEY));
  } catch {
    return null; // storage blocked: ask each visit, and say nothing optional is on
  }
}

function writeStored(record) {
  try {
    localStorage.setItem(CONSENT_KEY, JSON.stringify(record));
  } catch {
    /* blocked or full: the choice simply won't persist */
  }
}

function categoryHtml(category, record) {
  const on = category.required || record?.choices?.[category.id] === true;
  const state = category.required
    ? '<span class="bpcn-cat__state">Always on</span>'
    : `<label><input type="checkbox" data-bpcn-cat="${esc(category.id)}" ${on ? "checked" : ""}> Allow</label>`;
  const items = category.items
    .map(
      (i) =>
        `<li><code>${esc(i.name)}</code><span class="meta">${esc(i.type)} · ${esc(i.duration)}. ${esc(i.purpose)}</span></li>`,
    )
    .join("");
  return `<section class="bpcn-cat"><div class="bpcn-cat__head"><span class="bpcn-cat__name">${esc(category.name)}</span>${state}</div>
    <p>${esc(category.desc)}</p><ul class="bpcn-items">${items}</ul></section>`;
}

export function init() {
  if (typeof document === "undefined" || document.getElementById("bpcn-root")) return;

  const mode = modeOf();
  const optional = optionalOf();
  let record = readStored();
  const listeners = new Set();

  const style = document.createElement("style");
  style.id = "bpcn-style";
  style.textContent = CSS;
  document.head.appendChild(style);

  // On <html>, not <body>: the app replaces the body's contents when it starts
  // and again for the sign-in screens, which would take the notice with it.
  const root = document.createElement("div");
  root.id = "bpcn-root";
  root.innerHTML = `
    <section class="bpcn" role="region" aria-labelledby="bpcn-title" hidden>
      <p class="bpcn__title" id="bpcn-title">Cookies and storage</p>
      <p class="bpcn__text">${
        mode === "notice"
          ? "BookPilot uses no advertising or tracking cookies. It stores only what it needs to work: your sign-in and your display choices."
          : `BookPilot needs a few things to work. Optional: ${esc(optional.map((c) => c.name.toLowerCase()).join(", "))}. None of it runs unless you say yes.`
      } <a href="/cookies.html">Cookie policy</a></p>
      <div class="bpcn__actions">
        <button type="button" data-bpcn="details">Details</button>
        ${
          mode === "notice"
            ? '<button type="button" class="bpcn__primary" data-bpcn="ok">Got it</button>'
            : '<button type="button" data-bpcn="reject">Reject optional</button><button type="button" class="bpcn__primary" data-bpcn="accept">Accept all</button>'
        }
      </div>
    </section>
    <dialog class="bpcn-dialog" aria-labelledby="bpcn-dtitle"><div class="bpcn-dialog__in">
      <div class="bpcn-dialog__head"><h2 id="bpcn-dtitle" tabindex="-1" autofocus>Cookies and storage</h2>
        <p>BookPilot sets no cookies. This is everything it keeps in your browser, and why.</p>
        <p class="bpcn-dialog__links"><a href="/cookies.html">Cookie policy</a> · <a href="/privacy.html">Privacy policy</a></p></div>
      <div class="bpcn-dialog__body" data-bpcn-cats></div>
      <div class="bpcn-dialog__foot" data-bpcn-foot></div>
    </div></dialog>`;
  document.documentElement.appendChild(root);

  const banner = root.querySelector(".bpcn");
  const dialog = root.querySelector("dialog");
  const cats = root.querySelector("[data-bpcn-cats]");
  const foot = root.querySelector("[data-bpcn-foot]");

  const commit = (next) => {
    record = next;
    writeStored(next);
    banner.hidden = true;
    if (dialog.open) dialog.close();
    listeners.forEach((fn) => fn(record));
    document.dispatchEvent(new CustomEvent("bookpilot:consent", { detail: record }));
  };

  const renderDialog = () => {
    cats.innerHTML = CATEGORIES.map((c) => categoryHtml(c, record)).join("");
    foot.innerHTML =
      mode === "notice"
        ? `<button type="button" data-bpcn="close">Close</button>${record ? "" : '<button type="button" class="bpcn__primary" data-bpcn="ok">Got it</button>'}`
        : '<button type="button" data-bpcn="reject">Reject optional</button><button type="button" data-bpcn="save">Save choices</button><button type="button" class="bpcn__primary" data-bpcn="accept">Accept all</button>';
  };

  const open = () => {
    renderDialog();
    if (!dialog.open) dialog.showModal();
  };

  root.addEventListener("click", (event) => {
    const action = event.target.closest("[data-bpcn]")?.dataset.bpcn;
    if (!action) return;
    const now = Date.now();
    if (action === "details") open();
    else if (action === "close") dialog.close();
    else if (action === "ok" || action === "reject") commit(rejectOptional(now));
    else if (action === "accept") commit(acceptAll(now));
    else if (action === "save") {
      const picked = {};
      cats.querySelectorAll("[data-bpcn-cat]").forEach((box) => { picked[box.dataset.bpcnCat] = box.checked; });
      commit(buildRecord(picked, now));
    }
  });

  // Anything with data-cookie-settings reopens the notice: footer links, the
  // Settings page. It is a plain link to the policy when scripts are off.
  document.addEventListener("click", (event) => {
    const trigger = event.target.closest?.("[data-cookie-settings]");
    if (!trigger) return;
    event.preventDefault();
    open();
  });

  window.bookpilotCookies = {
    /** May code in this category run? Check this before loading anything optional. */
    has: (id) => allows(id, record),
    /** The stored choice, or null while nothing has been chosen. */
    record: () => record,
    open,
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };

  if (!record) banner.hidden = false;
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
}
