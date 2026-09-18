// The previewer and the publishing screen.
//
// The previewer is the whole point of the document engine living in the
// browser: these are not mock-ups of pages, they are the pages, laid out
// by the same code that writes the PDF. A book that reads correctly here
// prints correctly, and the author can see that before spending a credit
// or a printer's fee.

import { html, raw, $, $$, delegate, setBusy } from "../../core/dom.js";
import { BB, downloadExport, saveFile } from "../../core/builder-api.js";
import * as store from "../../core/store.js";
import { notify } from "../../core/toast.js";
import { refreshAccount } from "../../core/session.js";
import { projectHeader, agentPanel, scoreBar, costBadge, fmt, readingTime } from "./shared.js";
import { demoBadge } from "../shared.js";
import { layoutBook } from "../../doc/layout.js";
import { renderPage } from "../../doc/render-html.js";
import { assembleBook } from "../../doc/assemble.js";

// =====================================================================
// The previewer (spec 24)
// =====================================================================

const DEVICES = {
  desktop: { label: "Desktop", scale: 1, spread: true },
  tablet: { label: "Tablet", scale: 0.82, spread: false },
  mobile: { label: "Phone", scale: 0.52, spread: false },
};

export async function renderPreview(container, params, query) {
  const data = await BB.manuscript(params.id);
  const { project } = data;

  const book = assembleBook(data);
  if (!book.sections.length) {
    container.innerHTML = html`
      ${raw(projectHeader(project, { active: "preview" }))}
      <div class="bp-empty">
        <div class="bp-empty__icon">⊞</div>
        <div class="bp-empty__title">Nothing to show yet</div>
        <p class="bp-empty__text">Write a chapter and it appears here, set exactly as it will print.</p>
        <a class="bp-btn bp-btn--primary" href="#/studio/${project.id}/write">Open the editor</a>
      </div>`;
    return;
  }

  let laid;
  try {
    laid = layoutBook(book, { print: false });
  } catch (err) {
    console.error("[bookpilot] preview layout failed:", err);
    container.innerHTML = html`
      ${raw(projectHeader(project, { active: "preview" }))}
      <div class="bp-alert bp-alert--danger">
        <span class="bp-alert__icon">!</span>
        <div>
          <div class="bp-alert__title">The preview couldn't be built</div>
          <div>Something in the manuscript stopped the layout engine. The text is safe — try the editor.</div>
        </div>
      </div>`;
    return;
  }

  const focusChapter = query?.get("chapter");
  const focusEntry = focusChapter && laid.outline.find((entry) => entry.id === focusChapter);
  const startPage = focusEntry ? laid.frontCount + focusEntry.page - 1 : 0;

  container.innerHTML = html`
    ${raw(projectHeader(project, {
      active: "preview",
      actions: `${demoBadge()}
        <a class="bp-btn bp-btn--secondary bp-btn--sm" href="#/studio/${project.id}/design">Change the design</a>
        <a class="bp-btn bp-btn--primary bp-btn--sm" href="#/studio/${project.id}/publish">Export</a>`,
    }))}

    <div class="bb-preview">
      <aside class="bb-preview__contents">
        <h3 class="bb-side-title">Contents</h3>
        <p class="bp-tiny bp-subtle">${laid.pages.length} pages · ${readingTime(project.progress?.words || 0)}</p>
        <nav class="bb-preview__toc">
          ${raw(laid.outline.map((entry) => html`
            <button type="button" class="bb-preview__toc-item" data-action="jump"
                    data-page="${laid.frontCount + entry.page - 1}">
              <span>${entry.number ? `${entry.number}. ` : ""}${entry.title}</span>
              <span class="bp-tiny bp-subtle">${entry.page}</span>
            </button>`).join(""))}
        </nav>
      </aside>

      <div class="bb-preview__stage">
        <div class="bb-preview__bar">
          <div class="bp-row" style="gap:6px">
            ${raw(Object.entries(DEVICES).map(([key, device]) => html`
              <button type="button" class="bp-chip" data-action="device" data-device="${key}"
                      aria-pressed="${key === "desktop"}">${device.label}</button>`).join(""))}
          </div>
          <div class="bp-row" style="gap:8px">
            <button type="button" class="bp-btn bp-btn--ghost bp-btn--sm" data-action="prev">‹ Back</button>
            <span class="bb-preview__folio" id="folio"></span>
            <button type="button" class="bp-btn bp-btn--ghost bp-btn--sm" data-action="next">Next ›</button>
            <button type="button" class="bp-btn bp-btn--ghost bp-btn--sm" data-action="spread"
                    aria-pressed="true">Two pages</button>
          </div>
        </div>

        <div class="bb-preview__viewport" id="viewport"></div>
      </div>
    </div>
  `;

  const view = {
    index: Math.max(0, Math.min(laid.pages.length - 1, startPage)),
    device: "desktop",
    spread: true,
  };

  const viewport = $("#viewport", container);
  const folio = $("#folio", container);

  const paint = () => {
    const device = DEVICES[view.device];
    const spread = view.spread && device.spread;
    // A spread always shows a verso on the left, so the pairing matches
    // what a reader would hold open.
    const first = spread ? Math.max(0, view.index - (view.index % 2 === 0 && view.index > 0 ? 1 : 0)) : view.index;
    const pages = spread
      ? [laid.pages[first], laid.pages[first + 1]].filter(Boolean)
      : [laid.pages[view.index]];

    // Fit the pages to the space there actually is, rather than to a
    // guessed fraction: a fixed scale clips the spread on a narrow pane
    // and wastes half the screen on a wide one.
    const available = Math.max(240, viewport.clientWidth - 48);
    const needed = laid.trim.width * pages.length + (pages.length - 1) * 4;
    const scale = Math.min(device.scale, available / needed, spread ? 0.72 : 0.92);
    viewport.innerHTML = pages
      .map((page) => `<div class="bb-preview__page" style="width:${laid.trim.width * scale}px;height:${laid.trim.height * scale}px">${
        renderPage(page, laid.trim, { scale })
      }</div>`)
      .join("");

    const current = laid.pages[view.index];
    folio.textContent = `Page ${current?.folio || view.index + 1} of ${laid.pages.length}`;
  };

  paint();

  delegate(container, "click", {
    prev() { view.index = Math.max(0, view.index - (view.spread ? 2 : 1)); paint(); },
    next() { view.index = Math.min(laid.pages.length - 1, view.index + (view.spread ? 2 : 1)); paint(); },
    jump(trigger) { view.index = Number(trigger.dataset.page) || 0; paint(); },
    device(trigger) {
      view.device = trigger.dataset.device;
      $$('[data-action="device"]', container).forEach((button) =>
        button.setAttribute("aria-pressed", String(button.dataset.device === view.device)));
      paint();
    },
    spread(trigger) {
      view.spread = !view.spread;
      trigger.setAttribute("aria-pressed", String(view.spread));
      trigger.textContent = view.spread ? "Two pages" : "One page";
      paint();
    },
  });

  // Arrow keys, because a page turner should feel like one.
  const onKey = (event) => {
    if (event.target.matches("input, textarea, select")) return;
    if (event.key === "ArrowRight") { view.index = Math.min(laid.pages.length - 1, view.index + (view.spread ? 2 : 1)); paint(); }
    if (event.key === "ArrowLeft") { view.index = Math.max(0, view.index - (view.spread ? 2 : 1)); paint(); }
  };
  document.addEventListener("keydown", onKey);
  // The view is replaced on every route change, so the listener has to go
  // with it or they stack up.
  const observer = new MutationObserver(() => {
    if (!document.contains(viewport)) {
      document.removeEventListener("keydown", onKey);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// =====================================================================
// Publishing: the check and the export (spec 22, 23)
// =====================================================================

const FORMATS = [
  {
    id: "pdf_digital",
    name: "Digital PDF",
    text: "For reading on screen and for sending. Symmetric margins, no gutter.",
  },
  {
    id: "pdf_print",
    name: "Print-ready PDF",
    text: "Mirrored margins with a gutter sized to the page count, chapters opening on the right.",
  },
  {
    id: "epub",
    name: "EPUB",
    text: "Reflowable, for e-readers and Kindle. Figures travel as SVG with their descriptions.",
  },
  {
    id: "docx",
    name: "Word",
    text: "The editable manuscript, with real Word styles an editor can restyle in one click.",
  },
  {
    id: "html",
    name: "HTML",
    text: "The set pages as a web page, ready to print from a browser.",
  },
];

export async function renderPublish(container, params) {
  const data = await BB.project(params.id);
  const { project, quality, exports = [], chapters = [] } = data;
  const plan = store.get("plan");
  const watermarked = plan?.id === "free";

  container.innerHTML = html`
    ${raw(projectHeader(project, {
      active: "publish",
      actions: `${demoBadge()}<a class="bp-btn bp-btn--secondary bp-btn--sm"
        href="#/studio/${project.id}/preview">Preview</a>`,
    }))}

    <div class="bb-stage">
      <section style="margin-bottom:var(--bp-10)" id="check">
        ${raw(quality ? qualityReport(quality, project) : agentPanel({
          agent: "Quality Controller",
          title: "The publication check",
          description:
            "Content, editorial, design and technical, in one report. The layout engine's own findings " +
            "— page count, empty sections, unresolved placeholders, missing front matter — are measured, not guessed.",
          operation: "quality_report",
          action: "check",
          label: "Run the check",
          busyLabel: "Checking…",
          disabled: !chapters.some((c) => (c.word_count || 0) > 0),
          note: chapters.some((c) => (c.word_count || 0) > 0)
            ? ""
            : "Write at least one chapter first.",
        }))}
      </section>

      <section>
        <h2 class="bb-section-title">Export</h2>
        <p class="bp-small bp-muted" style="margin:4px 0 var(--bp-5)">
          Every format is built from the current manuscript when you ask for it, so nothing you
          download is ever a stale draft.
        </p>

        ${watermarked ? raw(html`
          <div class="bp-alert bp-alert--warning" style="margin-bottom:var(--bp-5)">
            <span class="bp-alert__icon">!</span>
            <div>
              <div class="bp-alert__title">Exports on the Free plan carry a footer line</div>
              <div>One line at the foot of each page. <a href="#/billing">Change plan</a> to remove it.</div>
            </div>
          </div>`) : ""}

        <div class="bb-formats">
          ${raw(FORMATS.map((format) => html`
            <article class="bb-format">
              <div>
                <h3 class="bb-format__name">${format.name}</h3>
                <p class="bp-small bp-muted">${format.text}</p>
              </div>
              <button type="button" class="bp-btn bp-btn--secondary bp-btn--sm"
                      data-action="export" data-format="${format.id}">Download</button>
            </article>`).join(""))}
        </div>

        <section class="bp-card" style="margin-top:var(--bp-8)">
          <h3 class="bb-side-title">Metadata</h3>
          <p class="bp-small bp-muted" style="margin:0 0 var(--bp-4)">
            Carried into every file. An ISBN is yours to obtain — the copyright page and the EPUB
            leave a marked placeholder rather than inventing one.
          </p>
          <form id="metadata-form">
            <div class="bp-field-row">
              <div class="bp-field">
                <label class="bp-label" for="publisher">Publisher</label>
                <input class="bp-input" id="publisher" name="publisher"
                       value="${project.metadata?.publisher || ""}" placeholder="Independently published">
              </div>
              <div class="bp-field">
                <label class="bp-label" for="isbn">ISBN</label>
                <input class="bp-input" id="isbn" name="isbn"
                       value="${project.metadata?.isbn || ""}" placeholder="leave empty if you don't have one">
              </div>
            </div>
            <div class="bp-field">
              <label class="bp-label" for="keywords">Keywords</label>
              <input class="bp-input" id="keywords" name="keywords"
                     value="${(project.metadata?.keywords || []).join(", ")}"
                     placeholder="Comma separated, for the retailer's search">
            </div>
            <button type="submit" class="bp-btn bp-btn--primary bp-btn--sm">Save metadata</button>
          </form>
        </section>

        ${exports.length ? raw(html`
          <section style="margin-top:var(--bp-8)">
            <h3 class="bb-side-title">Previously built</h3>
            <div class="bp-table-wrap">
              <table class="bp-table">
                <thead><tr><th>Format</th><th>When</th><th class="bp-num">Pages</th><th class="bp-num">Size</th></tr></thead>
                <tbody>
                  ${raw(exports.map((record) => html`
                    <tr>
                      <td>${(FORMATS.find((f) => f.id === record.format) || {}).name || record.format}</td>
                      <td>${fmt.relativeTime(record.created_at)}</td>
                      <td class="bp-num">${record.page_count || "—"}</td>
                      <td class="bp-num">${formatBytes(record.byte_size)}</td>
                    </tr>`).join(""))}
                </tbody>
              </table>
            </div>
          </section>`) : ""}
      </section>
    </div>
  `;

  delegate(container, "click", {
    async check(trigger) {
      setBusy(trigger, true, trigger.dataset.busy || "Checking…");
      try {
        const result = await BB.publicationCheck(project.id);
        await refreshAccount().catch(() => {});
        notify.success(`Checked. ${(result.report.issues || []).length} findings.`);
        renderPublish(container, params);
      } catch (err) {
        notify.error(err.message);
        setBusy(trigger, false);
      }
    },
    async recheck(trigger) {
      trigger.dataset.busy = "Checking…";
      setBusy(trigger, true, "Checking…");
      try {
        await BB.publicationCheck(project.id);
        await refreshAccount().catch(() => {});
        renderPublish(container, params);
      } catch (err) {
        notify.error(err.message);
        setBusy(trigger, false);
      }
    },
    async export(trigger) {
      setBusy(trigger, true, "Building…");
      try {
        const file = await downloadExport(trigger.dataset.format, project.id);
        saveFile(file.blob, file.fileName);
        notify.success(
          `${file.fileName}${file.pages ? ` — ${file.pages} pages` : ""}${file.watermark ? " (with the free-plan footer)" : ""}`
        );
        renderPublish(container, params);
      } catch (err) {
        notify.error(err.message);
      } finally {
        setBusy(trigger, false);
      }
    },
  });

  $("#metadata-form", container).addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('button[type="submit"]');
    setBusy(button, true, "Saving…");
    try {
      await BB.updateProject(project.id, {
        metadata: {
          ...(project.metadata || {}),
          publisher: $("#publisher", container).value.trim(),
          isbn: $("#isbn", container).value.trim(),
          keywords: $("#keywords", container).value.split(",").map((k) => k.trim()).filter(Boolean),
        },
      });
      notify.success("Saved.");
    } catch (err) {
      notify.error(err.message);
    } finally {
      setBusy(button, false);
    }
  });
}

function qualityReport(quality, project) {
  const issues = quality.issues || [];
  const blocking = issues.filter((i) => i.severity === "blocking");
  const important = issues.filter((i) => i.severity === "important");
  const polish = issues.filter((i) => i.severity === "polish");

  return html`
    <div class="bb-check">
      <div class="bb-check__head">
        <div>
          <h2 class="bb-section-title" style="margin:0">Publication readiness</h2>
          <p class="bp-small bp-muted" style="margin:6px 0 0;max-width:56ch">
            An editorial and structural judgement about the manuscript. It is not a claim about
            copyright, rights clearance, legal compliance or how the book will be received.
          </p>
        </div>
        <div class="bb-check__figure">
          <div class="bb-readiness bb-readiness--lg">${quality.readiness ?? "—"}<span>%</span></div>
          <div class="bp-tiny bp-subtle">${issues.length} findings</div>
        </div>
      </div>

      <div class="bp-grid bp-grid--2" style="margin:var(--bp-6) 0">
        ${raw(scoreBar("Content", quality.scores?.content))}
        ${raw(scoreBar("Editorial", quality.scores?.editorial))}
        ${raw(scoreBar("Design", quality.scores?.design))}
        ${raw(scoreBar("Technical", quality.scores?.technical))}
      </div>

      ${quality.summary ? raw(html`<p class="bb-check__summary">${quality.summary}</p>`) : ""}

      ${raw(issueGroup("Fix before publishing", blocking, "danger", project))}
      ${raw(issueGroup("Worth fixing", important, "warning", project))}
      ${raw(issueGroup("Polish", polish, "", project))}

      <div class="bp-row" style="margin-top:var(--bp-6)">
        <button type="button" class="bp-btn bp-btn--secondary bp-btn--sm" data-action="recheck">
          Run it again ${raw(costBadge("quality_report"))}
        </button>
        <span class="bp-tiny bp-subtle">Checked ${fmt.relativeTime(quality.created_at)}</span>
      </div>
    </div>
  `;
}

function issueGroup(title, issues, tone, project) {
  if (!issues.length) return "";
  return html`
    <section class="bb-issues">
      <h3 class="bb-issues__title">
        ${title}
        <span class="bp-badge ${tone ? `bp-badge--${tone}` : ""}">${issues.length}</span>
      </h3>
      <ul class="bb-issues__list">
        ${raw(issues.map((issue) => html`
          <li class="bb-issues__item">
            <span class="bb-issues__area">${issue.area}</span>
            <div>
              <div class="bb-issues__where">${issue.where}</div>
              <p class="bb-issues__issue">${issue.issue}</p>
              <p class="bb-issues__fix">${issue.fix}</p>
            </div>
            ${issue.area === "content" || issue.area === "editorial"
              ? raw(html`<a class="bp-btn bp-btn--ghost bp-btn--sm" href="#/studio/${project.id}/write">Open the editor</a>`)
              : issue.area === "design"
                ? raw(html`<a class="bp-btn bp-btn--ghost bp-btn--sm" href="#/studio/${project.id}/design">Open design</a>`)
                : ""}
          </li>`).join(""))}
      </ul>
    </section>
  `;
}

function formatBytes(bytes) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
