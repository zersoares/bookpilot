// Partials shared by the Book Builder screens.
//
// The two that carry the most weight:
//
//   agentPanel()  — every AI action in the product is presented the same
//                   way: who is doing it, what it costs, what it will
//                   produce, and a single Create button. An author
//                   should never be surprised by a charge or by a
//                   generation replacing their work.
//
//   stageRail()   — the book's journey from idea to file, with what is
//                   done, what is next and what is not available yet.
//                   This is the progressive disclosure the spec asks for:
//                   a first-time author sees one next step, not eleven
//                   tabs of controls.

import { html, raw } from "../../core/dom.js";
import * as store from "../../core/store.js";
import * as fmt from "../../core/format.js";

export const STAGES = [
  { key: "overview", path: "", label: "Overview", icon: "◈" },
  { key: "positioning", path: "/positioning", label: "Positioning", icon: "✦", agent: "Book Architect" },
  { key: "blueprint", path: "/blueprint", label: "Blueprint", icon: "⌘", agent: "Book Architect" },
  { key: "bible", path: "/bible", label: "Book Bible", icon: "◉", agent: "Book Architect" },
  { key: "write", path: "/write", label: "Manuscript", icon: "✎", agent: "Book Writer" },
  { key: "visuals", path: "/visuals", label: "Visuals", icon: "◐", agent: "Visual Director" },
  { key: "design", path: "/design", label: "Design", icon: "▤", agent: "Book Designer" },
  { key: "cover", path: "/cover", label: "Cover", icon: "▣", agent: "Cover Designer" },
  { key: "mockups", path: "/mockups", label: "Mockups", icon: "◫" },
  { key: "preview", path: "/preview", label: "Preview", icon: "⊞" },
  { key: "publish", path: "/publish", label: "Publish", icon: "⇪", agent: "Quality Controller" },
  { key: "marketing", path: "/marketing", label: "Marketing", icon: "◇", agent: "Marketing Director" },
];

/** The cost of an operation, from the deployment's own price list. */
export function creditCost(operation) {
  const costs = store.get("config")?.creditCosts || {};
  return costs[operation] ?? null;
}

export function costBadge(operation) {
  const cost = creditCost(operation);
  if (cost === null) return "";
  return html`<span class="bb-cost" title="AI credits this uses">${cost} credits</span>`;
}

/** Can this account afford it? Used to disable rather than to fail. */
export function canAfford(operation) {
  const cost = creditCost(operation);
  const credits = store.get("profile")?.ai_credits ?? 0;
  return cost === null || credits >= cost;
}

/**
 * The standard block around every AI action.
 *
 * @param {object} options
 *   agent       who is running — the specialist's name, not "AI"
 *   title       what will be produced
 *   description one or two sentences in plain language
 *   operation   credit-cost key
 *   action      data-action for the button
 *   label       button text ("Create", never "Generate Stuff")
 *   secondary   extra markup beside the button
 *   note        a caution shown under the button (e.g. "this replaces…")
 */
export function agentPanel({
  agent, title, description, operation, action, label = "Create",
  secondary = "", note = "", disabled = false, busyLabel = "Working…",
}) {
  const affordable = !operation || canAfford(operation);
  const blocked = disabled || !affordable;
  return html`
    <section class="bb-agent">
      <div class="bb-agent__head">
        <span class="bb-agent__mark" aria-hidden="true"></span>
        <div>
          <div class="bb-agent__name">${agent}</div>
          <h3 class="bb-agent__title">${title}</h3>
        </div>
        ${raw(operation ? costBadge(operation) : "")}
      </div>
      <p class="bb-agent__text">${description}</p>
      ${note ? raw(html`<p class="bb-agent__note">${note}</p>`) : ""}
      <div class="bb-row bb-agent__actions">
        <button type="button" class="bp-btn bp-btn--primary" data-action="${action}"
                data-busy="${busyLabel}" ${blocked ? "disabled" : ""}>${label}</button>
        ${raw(secondary)}
      </div>
      ${!affordable
        ? raw(`<p class="bp-small bp-muted" style="margin:var(--bp-3) 0 0">
             You don't have enough AI credits for this.
             <a href="#/billing">Top up or change plan</a>.
           </p>`)
        : ""}
    </section>
  `;
}

/** The stage rail down the side of a project. */
export function stageRail(project, active) {
  const stages = project.stages || {};
  const done = {
    positioning: stages.positioning === "approved",
    blueprint: stages.blueprint === "approved" || stages.blueprint === "generated",
    bible: Boolean(stages.bible),
    write: (project.progress?.chaptersWritten || 0) > 0,
    visuals: stages.visuals === "approved" || stages.visuals === "generated",
    design: stages.design === "approved",
    cover: stages.cover === "approved" || stages.cover === "generated",
    publish: stages.publish === "checked",
    marketing: stages.marketing === "generated",
  };

  return html`
    <nav class="bb-rail" aria-label="Book stages">
      ${raw(STAGES.map((stage) => {
        const isActive = stage.key === active;
        const isDone = done[stage.key];
        return html`<a class="bb-rail__item ${isActive ? "bb-rail__item--active" : ""} ${isDone ? "bb-rail__item--done" : ""}"
             href="#/studio/${project.id}${stage.path}">
          <span class="bb-rail__icon" aria-hidden="true">${isDone && !isActive ? "✓" : stage.icon}</span>
          <span class="bb-rail__label">${stage.label}</span>
        </a>`;
      }).join(""))}
    </nav>
  `;
}

/** The header every project screen carries. */
export function projectHeader(project, { active = "overview", actions = "" } = {}) {
  const progress = project.progress || {};
  return html`
    <header class="bb-project-head">
      <div class="bb-project-head__main">
        <a class="bp-small bp-muted" href="#/studio">← All books</a>
        <h1 class="bb-project-head__title">${project.title || "Untitled book"}</h1>
        ${project.subtitle ? raw(html`<p class="bb-project-head__sub">${project.subtitle}</p>`) : ""}
        <div class="bp-row bp-row--wrap" style="gap:6px;margin-top:var(--bp-3)">
          ${raw(statusBadge(project.status))}
          ${project.genre ? raw(html`<span class="bp-badge">${project.genre}</span>`) : ""}
          ${raw(html`<span class="bp-badge">${progress.chapters || 0} chapters</span>`)}
          ${raw(html`<span class="bp-badge">${fmt.number(progress.words || 0)} words</span>`)}
          ${raw(html`<span class="bp-badge">≈ ${progress.estimatedPages || 0} pages</span>`)}
        </div>
      </div>
      <div class="bb-project-head__side">
        <div class="bb-progress">
          <div class="bb-progress__figure">${progress.percent || 0}<span>%</span></div>
          <div class="bp-progress"><div class="bp-progress__bar" style="width:${progress.percent || 0}%"></div></div>
          <div class="bp-tiny bp-subtle">${progress.chaptersWritten || 0} of ${progress.chapters || 0} chapters drafted</div>
        </div>
        <div class="bp-row bp-row--wrap">${raw(actions)}</div>
      </div>
    </header>
    ${raw(stageRail(project, active))}
  `;
}

const STATUS_TONE = {
  draft: "",
  positioning: "info",
  architecture: "info",
  writing: "primary",
  editing: "primary",
  designing: "warning",
  ready: "success",
  published: "success",
  archived: "",
};

const STATUS_LABEL = {
  draft: "Draft",
  positioning: "Positioning",
  architecture: "Architecture",
  writing: "Writing",
  editing: "Editing",
  designing: "Designing",
  ready: "Ready",
  published: "Published",
  archived: "Archived",
};

export function statusBadge(status) {
  const tone = STATUS_TONE[status] ?? "";
  return html`<span class="bp-badge ${tone ? `bp-badge--${tone}` : ""}">${STATUS_LABEL[status] || status}</span>`;
}

/** A score out of 100, as a labelled bar rather than a bare number. */
export function scoreBar(label, value, { max = 100 } = {}) {
  const pct = Math.max(0, Math.min(100, Math.round(((value || 0) / max) * 100)));
  const tone = pct >= 90 ? "success" : pct >= 75 ? "primary" : pct >= 60 ? "warning" : "danger";
  return html`
    <div class="bb-score">
      <div class="bb-score__row">
        <span>${label}</span>
        <strong>${value ?? "—"}</strong>
      </div>
      <div class="bp-progress bb-score__track">
        <div class="bp-progress__bar bb-score__bar--${tone}" style="width:${pct}%"></div>
      </div>
    </div>
  `;
}

const RATING_TONE = { strong: "success", good: "primary", fair: "warning", weak: "danger" };

export function ratingBadge(rating) {
  const tone = RATING_TONE[rating] || "";
  const label = rating ? rating.charAt(0).toUpperCase() + rating.slice(1) : "Not checked";
  return html`<span class="bp-badge ${tone ? `bp-badge--${tone}` : ""}">${label}</span>`;
}

/**
 * Manuscript preview.
 *
 * Renders the restricted Markdown the way the printed page will read it
 * — headings, panels, quotes, figure anchors — without pretending to be
 * the typeset page. The Preview screen is where the real pages live.
 */
export function manuscriptPreview(text, { visuals = [] } = {}) {
  const source = String(text || "").trim();
  if (!source) {
    return '<p class="bp-muted bp-small">Nothing written yet.</p>';
  }

  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let paragraph = [];
  let list = null;
  let container = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push(`<p>${inline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`);
    list = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) { flushParagraph(); flushList(); continue; }

    const open = /^:::\s*([a-z]+)\s*(.*)$/i.exec(line);
    if (open) {
      flushParagraph(); flushList();
      container = open[1].toLowerCase();
      out.push(`<aside class="bb-panel bb-panel--${escapeAttr(container)}">` +
        (open[2] ? `<h4>${escapeText(open[2])}</h4>` : ""));
      continue;
    }
    if (line === ":::") {
      flushParagraph(); flushList();
      if (container) { out.push("</aside>"); container = null; }
      continue;
    }

    const visual = /^\[\[\s*visual\s*:?\s*(.*?)\s*\]\]$/i.exec(line);
    if (visual) {
      flushParagraph(); flushList();
      const match = visuals.find((v) =>
        v.title && visual[1] && v.title.toLowerCase().includes(visual[1].toLowerCase().slice(0, 16)));
      out.push(
        `<div class="bb-figure-anchor">` +
        `<span class="bb-figure-anchor__label">Figure</span>` +
        `<span>${escapeText(match?.title || visual[1] || "a figure belongs here")}</span>` +
        `${match ? "" : '<span class="bb-figure-anchor__pending">not created yet</span>'}` +
        `</div>`
      );
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph(); flushList();
      const level = Math.min(4, Math.max(3, heading[1].length + 1));
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^>\s?/.test(line)) {
      flushParagraph(); flushList();
      out.push(`<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`);
      continue;
    }

    if (/^(---|\*\*\*)$/.test(line)) {
      flushParagraph(); flushList();
      out.push('<p class="bb-scene-break">• • •</p>');
      continue;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    const ordered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || ordered) {
      flushParagraph();
      const tag = ordered ? "ol" : "ul";
      if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
      list.items.push((bullet || ordered)[1]);
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  if (container) out.push("</aside>");
  return out.join("\n");
}

function escapeText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(value) {
  return String(value ?? "").replace(/[^a-z0-9_-]/gi, "");
}

/**
 * Inline emphasis, and the author placeholders.
 *
 * Escaping first and only then adding markup is what keeps a manuscript
 * that contains a literal `<script>` from becoming one.
 */
function inline(text) {
  return escapeText(text)
    .replace(/\[author:([^\]]*)\]/gi, (_, note) =>
      `<mark class="bb-placeholder" title="The author has to supply this">${note.trim() || "your material"}</mark>`)
    .replace(/(\*\*|__)(.+?)\1/g, "<strong>$2</strong>")
    .replace(/(^|[\s(])[*_](?!\s)([^*_]+?)[*_](?=[\s.,;:!?)]|$)/g, "$1<em>$2</em>");
}

/** Words → a reading time an author recognises. */
export function readingTime(words) {
  const minutes = Math.round((words || 0) / 230);
  if (!minutes) return "under a minute";
  if (minutes < 60) return `${minutes} min read`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m read`;
}

export { fmt };
