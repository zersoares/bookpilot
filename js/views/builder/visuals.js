// Figures and research.
//
// The Visual Director sorts every figure into one of two kinds, and this
// screen is where that distinction becomes visible rather than being
// quietly papered over:
//
//   Drawn    — diagrams, processes, timelines, comparisons, tables,
//              checklists, quote cards. The layout engine draws these
//              from structured data, so they are rendered here, exactly
//              as they will print, and they always work.
//
//   Imaged   — illustrations, infographics, conceptual art. These need
//              an image renderer. Where none is configured, the card
//              carries the art direction and the prompt and says plainly
//              that no image exists. It never shows a grey box as though
//              it were artwork.

import { html, raw, $, delegate, setBusy } from "../../core/dom.js";
import { BB } from "../../core/builder-api.js";
import * as store from "../../core/store.js";
import { notify, confirmDialog } from "../../core/toast.js";
import { projectHeader, agentPanel, costBadge, fmt } from "./shared.js";
import { demoBadge } from "../shared.js";
import { figureSvg } from "../../doc/svg.js";
import { resolveTheme } from "../../doc/themes.js";

const DRAWN = new Set([
  "diagram", "process", "timeline", "comparison", "table",
  "checklist", "quote_card", "chapter_opener",
]);

const KIND_LABEL = {
  illustration: "Illustration", diagram: "Diagram", infographic: "Infographic",
  timeline: "Timeline", process: "Process", comparison: "Comparison",
  table: "Table", checklist: "Checklist", quote_card: "Quote card",
  chapter_opener: "Chapter opener", concept: "Concept image", case_study: "Case-study image",
};

export async function render(container, params, query) {
  const [data, { sources = [] }] = await Promise.all([
    BB.project(params.id),
    BB.sources(params.id).catch(() => ({ sources: [] })),
  ]);
  const { project, chapters = [], visuals = [] } = data;
  const focus = query?.get("chapter") || "";

  const written = chapters.filter((c) => (c.word_count || 0) > 0 && c.kind !== "front");
  const theme = resolveTheme(project.theme_id, project.design || {});
  const imageProvider = Boolean(store.get("config")?.capabilities?.imageGeneration);

  container.innerHTML = html`
    ${raw(projectHeader(project, { active: "visuals", actions: demoBadge() }))}

    <div class="bb-stage">
      ${!written.length ? raw(html`
        <div class="bp-empty">
          <div class="bp-empty__icon">◐</div>
          <div class="bp-empty__title">Write a chapter first</div>
          <p class="bp-empty__text">
            The Visual Director reads the chapter and says which figures would make it better.
            It cannot do that from an outline.
          </p>
          <a class="bp-btn bp-btn--primary" href="#/studio/${project.id}/write">Open the editor</a>
        </div>`) : ""}

      ${written.length ? raw(html`
        <section class="bp-card" style="margin-bottom:var(--bp-8)">
          <div class="bp-row bp-row--between bp-row--wrap">
            <div>
              <h2 class="bb-section-title" style="margin:0">Choose figures for a chapter</h2>
              <p class="bp-small bp-muted" style="margin:4px 0 0">
                A figure earns its page when it does something the prose cannot.
              </p>
            </div>
            <div class="bp-row" style="gap:8px">
              <label class="bp-sr-only" for="chapter-select">Chapter</label>
              <select class="bp-select" id="chapter-select" style="min-width:220px">
                ${raw(written.map((chapter) => html`<option value="${chapter.id}"
                  ${chapter.id === focus ? "selected" : ""}>
                  ${chapter.number ? `${chapter.number}. ` : ""}${chapter.title}</option>`).join(""))}
              </select>
              <button type="button" class="bp-btn bp-btn--primary" data-action="direct" data-busy="Reading…">
                Suggest figures ${raw(costBadge("visual_direction"))}
              </button>
            </div>
          </div>
        </section>`) : ""}

      ${!imageProvider && visuals.some((visual) => !DRAWN.has(visual.kind)) ? raw(html`
        <div class="bp-alert bp-alert--info" style="margin-bottom:var(--bp-6)">
          <span class="bp-alert__icon">i</span>
          <div>
            <div class="bp-alert__title">No image renderer is connected</div>
            <div>
              Drawn figures below are finished and will appear in the book. The illustrated ones
              carry their art direction and prompt so you can render them elsewhere; until an image
              exists they are left out of the exported book rather than shown as an empty frame.
            </div>
          </div>
        </div>`) : ""}

      ${visuals.length
        ? raw(html`<div class="bb-figures">
            ${raw(visuals.map((visual) => figureCard(visual, chapters, theme)).join(""))}
          </div>`)
        : raw(written.length ? '<p class="bp-muted">No figures yet.</p>' : "")}

      <section style="margin-top:var(--bp-12)">
        <div class="bp-row bp-row--between bp-row--wrap" style="margin-bottom:var(--bp-4)">
          <div>
            <h2 class="bb-section-title" style="margin:0">Research</h2>
            <p class="bp-small bp-muted" style="margin:4px 0 0">
              Where a claim could be checked, and what would check it. The Research Agent has no
              internet access and never invents a citation — it tells you where to look.
            </p>
          </div>
          <button type="button" class="bp-btn bp-btn--secondary bp-btn--sm" data-action="open-research">
            Ask for a research brief ${raw(costBadge("research_brief"))}
          </button>
        </div>

        <div id="research-form" hidden>
          <section class="bp-card" style="margin-bottom:var(--bp-5)">
            <div class="bp-field">
              <label class="bp-label" for="research-topic">What needs checking?</label>
              <textarea class="bp-textarea" id="research-topic" rows="3"
                placeholder="The chapter claims remote work reduces attrition. What would support or contradict that?"></textarea>
            </div>
            <div class="bp-row">
              <button type="button" class="bp-btn bp-btn--primary bp-btn--sm"
                      data-action="research" data-busy="Working…">Prepare the brief</button>
              <button type="button" class="bp-btn bp-btn--ghost bp-btn--sm" data-action="close-research">Cancel</button>
            </div>
          </section>
        </div>

        <div id="research-results"></div>

        ${sources.length
          ? raw(html`<div class="bb-sources">
              ${raw(sources.map(sourceRow).join(""))}
            </div>`)
          : raw('<p class="bp-muted bp-small">No sources recorded yet.</p>')}
      </section>
    </div>
  `;

  delegate(container, "click", {
    async direct(trigger) {
      const chapterId = $("#chapter-select", container)?.value;
      if (!chapterId) return;
      setBusy(trigger, true, trigger.dataset.busy || "Reading…");
      try {
        const result = await BB.directVisuals(chapterId);
        notify.success(`${result.visuals.length} figures suggested.`);
        render(container, params, new URLSearchParams(`chapter=${chapterId}`));
      } catch (err) {
        notify.error(err.message);
        setBusy(trigger, false);
      }
    },

    async approve(trigger) {
      const { id } = trigger.dataset;
      await BB.updateVisual(project.id, id, { status: "approved" });
      notify.success("In the book.");
      render(container, params, query);
    },

    async skip(trigger) {
      await BB.updateVisual(project.id, trigger.dataset.id, { status: "skipped" });
      notify.info("Left out.");
      render(container, params, query);
    },

    async remove(trigger) {
      const ok = await confirmDialog({
        title: "Delete this figure?",
        message: "Its brief and prompt go with it.",
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
      await BB.deleteVisual(project.id, trigger.dataset.id);
      render(container, params, query);
    },

    async prompt(trigger) {
      setBusy(trigger, true, "Directing…");
      try {
        const result = await BB.imagePrompt({ visual_id: trigger.dataset.id });
        notify.success(
          result.imageProviderConfigured
            ? "Prompt written and queued for rendering."
            : "Prompt written. No renderer is connected, so no image was made."
        );
        render(container, params, query);
      } catch (err) {
        notify.error(err.message);
        setBusy(trigger, false);
      }
    },

    "open-research"() {
      $("#research-form", container).hidden = false;
      $("#research-topic", container).focus();
    },
    "close-research"() {
      $("#research-form", container).hidden = true;
    },

    async research(trigger) {
      const topic = $("#research-topic", container).value.trim();
      if (!topic) {
        notify.error("Say what needs checking.");
        return;
      }
      setBusy(trigger, true, trigger.dataset.busy || "Working…");
      try {
        const result = await BB.research({
          project_id: project.id,
          chapter_id: $("#chapter-select", container)?.value || null,
          topic,
        });
        $("#research-results", container).innerHTML = researchResults(result);
        notify.success("Brief ready.");
      } catch (err) {
        notify.error(err.message);
      } finally {
        setBusy(trigger, false);
      }
    },

    async verify(trigger) {
      const { id, state: next } = trigger.dataset;
      await BB.updateSource(project.id, id, { verification: next });
      notify.success(next === "verified" ? "Marked as checked." : "Marked as disputed.");
      render(container, params, query);
    },
  });
}

function figureCard(visual, chapters, theme) {
  const chapter = chapters.find((c) => c.id === visual.chapter_id);
  const drawn = DRAWN.has(visual.kind);
  const rendered = drawn ? figureSvg(visual, { width: 420, theme }) : null;

  return html`
    <article class="bb-figure bb-figure--${visual.status}">
      <div class="bb-figure__preview">
        ${rendered
          ? raw(rendered.svg)
          : raw(html`<div class="bb-figure__unrendered">
              <div class="bb-figure__unrendered-mark" aria-hidden="true">◐</div>
              <p><strong>${KIND_LABEL[visual.kind] || visual.kind}</strong></p>
              <p class="bp-tiny bp-subtle">No image exists for this yet.</p>
            </div>`)}
      </div>

      <div class="bb-figure__body">
        <div class="bp-row bp-row--between bp-row--top">
          <div>
            <h3 class="bb-figure__title">${visual.title || KIND_LABEL[visual.kind]}</h3>
            <p class="bp-tiny bp-subtle">
              ${KIND_LABEL[visual.kind] || visual.kind} ·
              ${chapter ? `${chapter.number ? `Chapter ${chapter.number}` : chapter.title}` : "no chapter"}
              ${drawn ? " · drawn by the layout engine" : " · needs a renderer"}
            </p>
          </div>
          <span class="bp-badge ${visual.status === "approved" || visual.status === "rendered"
            ? "bp-badge--success" : visual.status === "skipped" ? "" : "bp-badge--primary"}">
            ${visual.status === "suggested" ? "Suggested"
              : visual.status === "approved" ? "In the book"
              : visual.status === "rendered" ? "Rendered" : "Left out"}
          </span>
        </div>

        ${visual.purpose ? raw(html`<p class="bp-small">${visual.purpose}</p>`) : ""}
        ${visual.placement ? raw(html`<p class="bp-tiny bp-subtle">Goes: ${visual.placement}</p>`) : ""}

        ${visual.brief ? raw(html`
          <details class="bb-figure__details">
            <summary>Art direction</summary>
            <p>${visual.brief}</p>
            ${visual.prompt ? raw(html`<p class="bb-figure__prompt">${visual.prompt}</p>`) : ""}
          </details>`) : ""}

        <div class="bp-row bp-row--wrap" style="gap:6px">
          ${visual.status !== "approved" && visual.status !== "rendered"
            ? raw(html`<button type="button" class="bp-btn bp-btn--primary bp-btn--sm"
                data-action="approve" data-id="${visual.id}">Put it in the book</button>`)
            : ""}
          ${!drawn && !visual.prompt
            ? raw(html`<button type="button" class="bp-btn bp-btn--secondary bp-btn--sm"
                data-action="prompt" data-id="${visual.id}">Write the image prompt ${raw(costBadge("book_image"))}</button>`)
            : ""}
          ${visual.status !== "skipped"
            ? raw(html`<button type="button" class="bp-btn bp-btn--ghost bp-btn--sm"
                data-action="skip" data-id="${visual.id}">Leave it out</button>`)
            : ""}
          <button type="button" class="bp-btn bp-btn--ghost bp-btn--sm"
                  data-action="remove" data-id="${visual.id}">Delete</button>
        </div>
      </div>
    </article>
  `;
}

const KIND_TONE = { fact: "primary", interpretation: "info", example: "", opinion: "warning" };

function sourceRow(source) {
  return html`
    <article class="bb-source bb-source--${source.verification}">
      <div class="bb-source__head">
        <div>
          <h4>${source.title}</h4>
          ${source.author_org ? raw(html`<p class="bp-tiny bp-subtle">${source.author_org}</p>`) : ""}
        </div>
        <div class="bp-row" style="gap:6px">
          <span class="bp-badge ${KIND_TONE[source.kind] ? `bp-badge--${KIND_TONE[source.kind]}` : ""}">
            ${source.kind}
          </span>
          <span class="bp-badge ${source.verification === "verified" ? "bp-badge--success"
            : source.verification === "disputed" ? "bp-badge--danger" : "bp-badge--warning"}">
            ${source.verification === "verified" ? "You checked this"
              : source.verification === "disputed" ? "Disputed" : "Unverified"}
          </span>
        </div>
      </div>
      ${source.claim ? raw(html`<p class="bb-source__claim">“${source.claim}”</p>`) : ""}
      ${source.summary ? raw(html`<p class="bp-small bp-muted">${source.summary}</p>`) : ""}
      ${source.notes ? raw(html`<p class="bp-tiny bp-subtle">${source.notes}</p>`) : ""}
      ${source.url ? raw(html`<a class="bp-small" href="${source.url}" target="_blank" rel="noopener noreferrer">Open the source ↗</a>`) : ""}
      ${source.verification === "unverified" ? raw(html`
        <div class="bp-row" style="gap:6px;margin-top:var(--bp-3)">
          <button type="button" class="bp-btn bp-btn--ghost bp-btn--sm"
                  data-action="verify" data-id="${source.id}" data-state="verified">I checked it</button>
          <button type="button" class="bp-btn bp-btn--ghost bp-btn--sm"
                  data-action="verify" data-id="${source.id}" data-state="disputed">It doesn't hold up</button>
        </div>`) : ""}
    </article>
  `;
}

function researchResults(result) {
  const claims = result.claims || [];
  if (!claims.length && !(result.open_questions || []).length) return "";
  return html`
    <section class="bp-card" style="margin-bottom:var(--bp-6)">
      <h3 class="bb-side-title">What the chapter is asserting</h3>
      <ul class="bb-claims-list">
        ${raw(claims.map((claim) => html`
          <li>
            <span class="bp-badge ${KIND_TONE[claim.kind] ? `bp-badge--${KIND_TONE[claim.kind]}` : ""}">${claim.kind}</span>
            <div>
              <p>${claim.claim}</p>
              <p class="bp-tiny bp-subtle">
                ${claim.confidence} confidence${claim.needs_source ? " · needs a source" : " · no source needed"}
                ${claim.note ? ` · ${claim.note}` : ""}
              </p>
            </div>
          </li>`).join(""))}
      </ul>
      ${(result.open_questions || []).length ? raw(html`
        <h3 class="bb-side-title" style="margin-top:var(--bp-6)">For you to decide</h3>
        <ul class="bp-small bp-muted" style="padding-left:1.05rem">
          ${raw(result.open_questions.map((question) => html`<li>${question}</li>`).join(""))}
        </ul>`) : ""}
      <p class="bp-tiny bp-subtle" style="margin-top:var(--bp-4)">
        ${(result.sources || []).length} place${(result.sources || []).length === 1 ? "" : "s"} to look
        added below, all unverified until you say otherwise.
      </p>
    </section>
  `;
}

export { fmt };
