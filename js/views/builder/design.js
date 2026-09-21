// Design and the Cover Studio.
//
// The design screen is a live one: choosing a theme re-typesets a real
// page from the author's own manuscript in front of them, using the same
// engine that writes the PDF. No mock-ups, no sample text — the page in
// the picker is a page from their book.

import { html, raw, $, $$, delegate, setBusy } from "../../core/dom.js";
import { BB } from "../../core/builder-api.js";
import { notify, confirmDialog } from "../../core/toast.js";
import { refreshAccount } from "../../core/session.js";
import { projectHeader, agentPanel, ratingBadge, costBadge } from "./shared.js";
import { coverPreview, coverWrap } from "./cover-render.js";
import { demoBadge } from "../shared.js";
import { layoutBook } from "../../doc/layout.js";
import { renderPage } from "../../doc/render-html.js";
import { assembleBook } from "../../doc/assemble.js";
import { trimSize } from "../../doc/themes.js";

// =====================================================================
// Design (spec 16, 17)
// =====================================================================

export async function renderDesign(container, params) {
  const [data, { themes, trimSizes }] = await Promise.all([
    BB.manuscript(params.id),
    BB.themes(),
  ]);
  const project = data.project;

  container.innerHTML = html`
    ${raw(projectHeader(project, {
      active: "design",
      actions: `${demoBadge()}<a class="bp-btn bp-btn--secondary bp-btn--sm"
        href="#/studio/${project.id}/preview">See the whole book</a>`,
    }))}

    <div class="bb-stage">
      <section style="margin-bottom:var(--bp-8)">
        <h2 class="bb-section-title">Interior design</h2>
        <p class="bp-small bp-muted" style="margin:4px 0 var(--bp-5)">
          Each one is a complete design — page geometry, type scale, chapter openers, running heads.
          The page beside each theme is set from your manuscript, by the engine that writes the PDF.
        </p>
        <div class="bb-themes" id="themes">
          ${raw(themes.map((theme) => themeCard(theme, project)).join(""))}
        </div>
      </section>

      <section class="bp-card">
        <h2 class="bb-section-title">Fine tuning</h2>
        <p class="bp-small bp-muted" style="margin:4px 0 var(--bp-5)">
          Changes here apply on top of the theme. Leave them alone and the theme's own proportions hold.
        </p>

        <form id="design-form">
          <div class="bp-field-row">
            <div class="bp-field">
              <label class="bp-label" for="trim_size">Page size</label>
              <select class="bp-select" id="trim_size" name="trim_size">
                ${raw(trimSizes.map((trim) => html`<option value="${trim.id}"
                  ${trim.id === project.trim_size ? "selected" : ""}>${trim.label}</option>`).join(""))}
              </select>
            </div>
            <div class="bp-field">
              <label class="bp-label" for="size">Text size</label>
              <input class="bp-input" id="size" name="size" type="number" step="0.5" min="8" max="16"
                     value="${project.design?.size || ""}" placeholder="theme default">
              <p class="bp-hint">Points. Most trade books sit between 10.5 and 11.5.</p>
            </div>
          </div>

          <div class="bp-field-row">
            <div class="bp-field">
              <label class="bp-label" for="leading">Line spacing</label>
              <input class="bp-input" id="leading" name="leading" type="number" step="0.02" min="1.1" max="2.2"
                     value="${project.design?.leading || ""}" placeholder="theme default">
              <p class="bp-hint">A multiple of the text size. 1.5 is comfortable for a 6×9 page.</p>
            </div>
            <div class="bp-field">
              <label class="bp-label" for="accent">Accent colour</label>
              <input class="bp-input" id="accent" name="accent" maxlength="7"
                     value="${project.design?.accent || ""}" placeholder="theme default, e.g. #1f2a44">
            </div>
          </div>

          <div class="bp-field-row">
            <div class="bp-field">
              <label class="bp-label" for="firstLineIndent">First-line indent</label>
              <input class="bp-input" id="firstLineIndent" name="firstLineIndent" type="number"
                     min="0" max="36" value="${project.design?.firstLineIndent ?? ""}" placeholder="theme default">
              <p class="bp-hint">Points. Zero means paragraphs are separated by space instead.</p>
            </div>
            <div class="bp-field">
              <label class="bp-label" for="runningHead">Running heads</label>
              <select class="bp-select" id="runningHead" name="runningHead">
                <option value="">Theme default</option>
                <option value="plain" ${project.design?.runningHead === "plain" ? "selected" : ""}>Plain</option>
                <option value="smallcaps" ${project.design?.runningHead === "smallcaps" ? "selected" : ""}>Small caps</option>
                <option value="italic" ${project.design?.runningHead === "italic" ? "selected" : ""}>Italic</option>
                <option value="none" ${project.design?.runningHead === "none" ? "selected" : ""}>None</option>
              </select>
            </div>
          </div>

          <div class="bp-row">
            <button type="submit" class="bp-btn bp-btn--primary">Apply</button>
            <button type="button" class="bp-btn bp-btn--ghost" data-action="reset">Back to the theme's defaults</button>
          </div>
        </form>
      </section>
    </div>
  `;

  // Each theme card shows a real page. Rendering them after the markup
  // lands keeps the first paint fast on a long book.
  paintThemeSamples(container, data);

  delegate(container, "click", {
    async theme(trigger) {
      const themeId = trigger.dataset.theme;
      if (themeId === project.theme_id) return;
      await BB.updateProject(project.id, {
        theme_id: themeId,
        stages: { ...(project.stages || {}), design: "approved" },
      });
      notify.success("Design applied.");
      renderDesign(container, params);
    },
    async reset() {
      await BB.updateProject(project.id, { design: {} });
      notify.info("Back to the theme's own proportions.");
      renderDesign(container, params);
    },
  });

  $("#design-form", container).addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('button[type="submit"]');
    const design = {};
    for (const key of ["size", "leading", "accent", "firstLineIndent", "runningHead"]) {
      const value = $(`#${key}`, container).value.trim();
      if (!value) continue;
      design[key] = ["size", "leading", "firstLineIndent"].includes(key) ? Number(value) : value;
    }
    setBusy(button, true, "Applying…");
    try {
      await BB.updateProject(project.id, {
        design,
        trim_size: $("#trim_size", container).value,
        stages: { ...(project.stages || {}), design: "approved" },
      });
      notify.success("Applied.");
      renderDesign(container, params);
    } catch (err) {
      notify.error(err.message);
      setBusy(button, false);
    }
  });
}

function themeCard(theme, project) {
  const active = theme.id === project.theme_id;
  return html`
    <button type="button" class="bb-theme ${active ? "bb-theme--active" : ""}"
            data-action="theme" data-theme="${theme.id}" aria-pressed="${active}">
      <span class="bb-theme__page" data-theme-sample="${theme.id}"></span>
      <span class="bb-theme__meta">
        <span class="bb-theme__name">${theme.name}</span>
        <span class="bb-theme__tagline">${theme.tagline || ""}</span>
        <span class="bb-theme__spec">
          ${theme.body === "sans" ? "Sans" : "Serif"} text · ${theme.size}pt · ${theme.leading} leading
        </span>
      </span>
      ${active ? raw('<span class="bb-theme__check" aria-hidden="true">✓</span>') : ""}
    </button>
  `;
}

/**
 * Typeset one page per theme, from the author's own book.
 *
 * The engine is the same module the exporter runs, so a theme that looks
 * right here is a theme that prints right — which is the only reason to
 * show a preview at all.
 */
function paintThemeSamples(container, data) {
  const samples = $$("[data-theme-sample]", container);
  for (const node of samples) {
    const themeId = node.dataset.themeSample;
    try {
      const book = assembleBook({ ...data, project: { ...data.project, theme_id: themeId } });
      if (!book.sections.length) {
        node.innerHTML = '<span class="bb-theme__empty">Write a chapter to see it set</span>';
        continue;
      }
      const laid = layoutBook(book, { print: false });
      // The first page with a decent amount of text on it reads better
      // as a sample than a half-title or a chapter opener.
      const page = laid.pages.find((p) => p.items.filter((op) => op.op === "text").length > 18)
        || laid.pages[laid.pages.length - 1];
      const scale = 168 / laid.trim.width;
      node.innerHTML =
        `<span class="bb-theme__page-inner" style="width:${laid.trim.width * scale}px;height:${laid.trim.height * scale}px">` +
        renderPage(page, laid.trim, { scale }) +
        `</span>`;
    } catch (err) {
      console.error("[bookpilot] theme sample failed:", err);
      node.innerHTML = '<span class="bb-theme__empty">Preview unavailable</span>';
    }
  }
}

// =====================================================================
// The Cover Studio (spec 18, 19)
// =====================================================================

export async function renderCover(container, params) {
  let data = await BB.project(params.id);

  // The author picked a cover template on the Create page. Their title and name
  // exist now, so this is the moment to turn it into a real cover. It is made
  // once (the pointer on the project is cleared after) and never selected for
  // them: choosing the cover is theirs to do.
  const picked = data.project.design?.cover_template;
  if (picked) {
    try {
      await BB.createCoverFromTemplate(data.project.id, picked);
      const { cover_template: _done, ...rest } = data.project.design;
      await BB.updateProject(data.project.id, { design: rest });
      data = await BB.project(params.id);
    } catch (err) {
      // Not fatal: the pointer stays, and the next visit tries again.
      console.error("[bookpilot] could not create the template cover:", err);
    }
  }

  // A template cover made before the title was chosen has no title on it yet.
  // Fill it in from the project, so the cover shows the book it belongs to.
  const realTitle = data.project.title && data.project.title !== "Untitled book";
  const unlettered = (data.covers || []).filter((c) => c.title_text == null && realTitle);
  if (unlettered.length) {
    await Promise.all(unlettered.map((c) => BB.updateCover(data.project.id, c.id, {
      title_text: data.project.title,
      ...(data.project.subtitle ? { subtitle_text: data.project.subtitle } : {}),
      ...(data.project.author_name ? { author_text: data.project.author_name } : {}),
    }).catch(() => null)));
    data = await BB.project(params.id);
  }

  const { project, covers = [] } = data;
  const trim = trimSize(project.trim_size);
  const pageCount = Math.max(24, project.progress?.estimatedPages || 120);

  container.innerHTML = html`
    ${raw(projectHeader(project, { active: "cover", actions: demoBadge() }))}

    <div class="bb-stage">
      ${!covers.length ? raw(agentPanel({
        agent: "Cover Designer",
        title: "Six complete cover concepts",
        description:
          "Each one is a full specification — palette, type treatment, composition, back-cover copy — " +
          "not six versions of the same idea. Typographic concepts render completely here.",
        operation: "cover_concepts",
        action: "generate",
        label: "Create cover concepts",
        busyLabel: "Designing…",
        note: "A cover is judged on whether the right reader stops at thumbnail size. Nothing here predicts sales.",
      })) : ""}

      ${covers.length ? raw(html`
        <div class="bp-row bp-row--between bp-row--wrap" style="margin-bottom:var(--bp-6)">
          <div>
            <h2 class="bb-section-title" style="margin:0">Cover concepts</h2>
            <p class="bp-small bp-muted" style="margin:4px 0 0">
              Choose one to make it the book's cover. Everything is editable afterwards.
            </p>
          </div>
          <button type="button" class="bp-btn bp-btn--secondary bp-btn--sm"
                  data-action="generate" data-busy="Designing…">
            More concepts ${raw(costBadge("cover_concepts"))}
          </button>
        </div>

        <div class="bb-covers">
          ${raw(covers.map((cover) => coverCard(cover)).join(""))}
        </div>

        ${raw(selectedPanel(covers.find((c) => c.is_selected), trim, pageCount))}
      `) : ""}
    </div>
  `;

  delegate(container, "click", {
    async generate(trigger) {
      setBusy(trigger, true, trigger.dataset.busy || "Designing…");
      try {
        await BB.generateCovers(project.id, 6);
        await refreshAccount().catch(() => {});
        notify.success("Six concepts. Pick the one that stops you at thumbnail size.");
        renderCover(container, params);
      } catch (err) {
        notify.error(err.message);
        setBusy(trigger, false);
      }
    },

    async select(trigger) {
      await BB.updateCover(project.id, trigger.dataset.id, { is_selected: true });
      notify.success("That's the cover.");
      renderCover(container, params);
    },

    async check(trigger) {
      setBusy(trigger, true, "Reviewing…");
      try {
        await BB.checkCover(trigger.dataset.id);
        await refreshAccount().catch(() => {});
        notify.success("Reviewed.");
        renderCover(container, params);
      } catch (err) {
        notify.error(err.message);
        setBusy(trigger, false);
      }
    },

    async remove(trigger) {
      const ok = await confirmDialog({
        title: "Delete this concept?",
        message: "The others are unaffected.",
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
      await BB.deleteCover(project.id, trigger.dataset.id);
      renderCover(container, params);
    },
  });
}

function coverCard(cover) {
  const report = cover.check_report;
  return html`
    <article class="bb-cover-concept ${cover.is_selected ? "bb-cover-concept--selected" : ""}">
      <div class="bb-cover-concept__art">
        ${raw(coverPreview(cover, { width: 200 }))}
      </div>
      <div class="bb-cover-concept__body">
        <div class="bp-row bp-row--between bp-row--top">
          <h3 class="bb-cover-concept__name">${cover.concept_name}</h3>
          ${cover.is_selected ? raw('<span class="bp-badge bp-badge--success">Chosen</span>') : ""}
        </div>
        ${cover.rationale ? raw(html`<p class="bp-small bp-muted">${cover.rationale}</p>`) : ""}

        ${cover.genre_signals?.length ? raw(html`
          <div class="bp-chips">
            ${raw(cover.genre_signals.map((signal) => html`<span class="bp-chip">${signal}</span>`).join(""))}
          </div>`) : ""}

        ${report ? raw(html`
          <div class="bb-cover-check">
            <h4>Cover review</h4>
            <dl>
              <dt>Thumbnail readability</dt><dd>${raw(ratingBadge(report.scores?.thumbnail_readability))}</dd>
              <dt>Title hierarchy</dt><dd>${raw(ratingBadge(report.scores?.title_hierarchy))}</dd>
              <dt>Typography</dt><dd>${raw(ratingBadge(report.scores?.typography))}</dd>
              <dt>Contrast</dt><dd>${raw(ratingBadge(report.scores?.contrast))}</dd>
              <dt>Genre signalling</dt><dd>${raw(ratingBadge(report.scores?.genre_signalling))}</dd>
              <dt>Visual balance</dt><dd>${raw(ratingBadge(report.scores?.visual_balance))}</dd>
            </dl>
            ${report.summary ? raw(html`<p class="bp-small">${report.summary}</p>`) : ""}
            ${(report.improvements || []).length ? raw(html`
              <ul class="bp-small bp-muted" style="padding-left:1.05rem;margin:var(--bp-2) 0 0">
                ${raw(report.improvements.map((item) =>
                  html`<li><strong>${item.issue}</strong> — ${item.change}</li>`).join(""))}
              </ul>`) : ""}
            <p class="bp-tiny bp-subtle" style="margin-top:var(--bp-2)">
              A judgement about craft. It is not a prediction of sales.
            </p>
          </div>`) : ""}

        <div class="bp-row bp-row--wrap" style="gap:6px">
          ${!cover.is_selected ? raw(html`<button type="button" class="bp-btn bp-btn--primary bp-btn--sm"
            data-action="select" data-id="${cover.id}">Use this cover</button>`) : ""}
          ${!report ? raw(html`<button type="button" class="bp-btn bp-btn--secondary bp-btn--sm"
            data-action="check" data-id="${cover.id}">Review it ${raw(costBadge("cover_check"))}</button>`) : ""}
          <button type="button" class="bp-btn bp-btn--ghost bp-btn--sm"
                  data-action="remove" data-id="${cover.id}">Delete</button>
        </div>
      </div>
    </article>
  `;
}

function selectedPanel(cover, trim, pageCount) {
  if (!cover) return "";
  return html`
    <section class="bp-card" style="margin-top:var(--bp-10)">
      <h2 class="bb-section-title">The full wrap</h2>
      <p class="bp-small bp-muted" style="margin:4px 0 var(--bp-5)">
        Back cover, spine and front, at the proportions your page count gives them.
      </p>
      <div class="bb-wrap-frame">
        ${raw(coverWrap(cover, { trim, pageCount, width: 640 }))}
      </div>
      ${cover.back_blurb ? raw(html`
        <div style="margin-top:var(--bp-6)">
          <h3 class="bb-side-title">Back cover copy</h3>
          <p class="bb-blurb">${cover.back_blurb}</p>
        </div>`) : ""}
    </section>
  `;
}
