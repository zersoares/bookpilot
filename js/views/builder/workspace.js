// The project overview.
//
// One screen that answers "where am I and what is next". Everything else
// in the Book Builder is reachable from the rail; this is the page that
// decides what to put in front of an author who just opened their book.

import { html, raw, delegate, setBusy } from "../../core/dom.js";
import { BB, downloadExport, saveFile } from "../../core/builder-api.js";
import { notify } from "../../core/toast.js";
import { navigate } from "../../core/router.js";
import { projectHeader, fmt, readingTime, scoreBar } from "./shared.js";
import { coverPreview } from "./cover-render.js";
import { demoBadge } from "../shared.js";

/**
 * What to do next.
 *
 * Ordered by the only sequence that actually works: you cannot write
 * chapters without a plan, and you cannot plan without knowing what the
 * book is. The first unmet condition wins.
 */
function nextStep(project, data) {
  const stages = project.stages || {};
  const chapters = data.chapters || [];
  const body = chapters.filter((c) => c.kind !== "front" && c.kind !== "back" && c.include !== false);
  const written = body.filter((c) => (c.word_count || 0) > 0);
  const unwritten = body.filter((c) => !(c.word_count || 0));

  if (stages.positioning !== "approved") {
    return {
      title: "Decide what this book is",
      text: "The Book Architect proposes titles, the promise, the reader and the angle. You choose; nothing is decided for you.",
      label: "Go to positioning",
      href: `#/studio/${project.id}/positioning`,
    };
  }
  if (!body.length) {
    return {
      title: "Design the book before writing it",
      text: "Parts, chapters, word budgets, and where the exercises and figures belong.",
      label: "Build the blueprint",
      href: `#/studio/${project.id}/blueprint`,
    };
  }
  if (!data.bible?.voice_rules?.length) {
    return {
      title: "Write the Book Bible",
      text: "The voice, the vocabulary and the claims. Every chapter is written against it, which is what keeps chapter nine agreeing with chapter two.",
      label: "Write the Book Bible",
      href: `#/studio/${project.id}/bible`,
    };
  }
  if (unwritten.length) {
    const next = unwritten[0];
    return {
      title: written.length ? `Write “${next.title}”` : "Write the first chapter",
      text: `${written.length} of ${body.length} chapters drafted. ${unwritten.length} to go.`,
      label: "Open the editor",
      href: `#/studio/${project.id}/write/${next.id}`,
    };
  }
  if (stages.cover !== "approved") {
    return {
      title: "Choose a cover",
      text: "Six complete concepts, each with a palette, a type treatment and back-cover copy.",
      label: "Open the Cover Studio",
      href: `#/studio/${project.id}/cover`,
    };
  }
  if (!data.quality) {
    return {
      title: "Run the publication check",
      text: "Structure, editorial, design and the technical detail, in one report.",
      label: "Run the check",
      href: `#/studio/${project.id}/publish`,
    };
  }
  return {
    title: "Export the book",
    text: "PDF for print and for screen, EPUB for e-readers, Word for your editor.",
    label: "Go to publishing",
    href: `#/studio/${project.id}/publish`,
  };
}

export async function render(container, params) {
  const data = await BB.project(params.id);
  const { project, chapters = [], visuals = [], covers = [], quality, exports = [] } = data;
  const step = nextStep(project, data);
  const selectedCover = covers.find((c) => c.is_selected) || null;
  const body = chapters.filter((c) => c.kind !== "front" && c.kind !== "back");
  const reviewed = body.filter((c) => c.quality);

  container.innerHTML = html`
    ${raw(projectHeader(project, {
      active: "overview",
      actions: `${demoBadge()}
        <a class="bp-btn bp-btn--secondary bp-btn--sm" href="#/studio/${project.id}/preview">Preview</a>
        <a class="bp-btn bp-btn--primary bp-btn--sm" href="${step.href}">${step.label}</a>`,
    }))}

    <div class="bb-layout">
      <div class="bb-layout__main bp-stack-lg">
        <section class="bb-next">
          <div class="bb-next__label">Next</div>
          <h2 class="bb-next__title">${step.title}</h2>
          <p class="bb-next__text">${step.text}</p>
          <a class="bp-btn bp-btn--primary" href="${step.href}">${step.label}</a>
        </section>

        <section>
          <div class="bp-row bp-row--between" style="margin-bottom:var(--bp-4)">
            <h2 class="bb-section-title" style="margin:0">The book so far</h2>
            <a class="bp-small" href="#/studio/${project.id}/blueprint">Edit the blueprint</a>
          </div>
          ${body.length
            ? raw(html`<div class="bb-chapter-strip">
                ${raw(body.slice(0, 24).map((chapter) => {
                  const pct = chapter.target_words
                    ? Math.min(100, Math.round(((chapter.word_count || 0) / chapter.target_words) * 100))
                    : (chapter.word_count ? 100 : 0);
                  return html`<a class="bb-chapter-chip ${chapter.word_count ? "bb-chapter-chip--written" : ""}"
                       href="#/studio/${project.id}/write/${chapter.id}"
                       title="${chapter.title} — ${fmt.number(chapter.word_count || 0)} words">
                    <span class="bb-chapter-chip__number">${chapter.number || "·"}</span>
                    <span class="bb-chapter-chip__bar"><i style="height:${pct}%"></i></span>
                  </a>`;
                }).join(""))}
              </div>`)
            : raw('<p class="bp-muted bp-small">No chapters yet.</p>')}
        </section>

        ${quality ? raw(html`
          <section class="bp-card">
            <div class="bp-row bp-row--between" style="margin-bottom:var(--bp-4)">
              <div>
                <h2 class="bb-section-title" style="margin:0">Publication readiness</h2>
                <p class="bp-tiny bp-subtle" style="margin:4px 0 0">
                  An editorial and structural judgement. Not a claim about rights, copyright or reception.
                </p>
              </div>
              <div class="bb-readiness">${quality.readiness ?? "—"}<span>%</span></div>
            </div>
            <div class="bp-grid bp-grid--2">
              ${raw(scoreBar("Content", quality.scores?.content))}
              ${raw(scoreBar("Editorial", quality.scores?.editorial))}
              ${raw(scoreBar("Design", quality.scores?.design))}
              ${raw(scoreBar("Technical", quality.scores?.technical))}
            </div>
            <p class="bp-small bp-muted" style="margin:var(--bp-4) 0 0">${quality.summary || ""}</p>
            <a class="bp-btn bp-btn--secondary bp-btn--sm" style="margin-top:var(--bp-4)"
               href="#/studio/${project.id}/publish">Review the ${(quality.issues || []).length} findings</a>
          </section>`) : ""}

        <section class="bp-card">
          <h2 class="bb-section-title">The idea you started with</h2>
          <p class="bb-idea">${project.idea}</p>
        </section>
      </div>

      <aside class="bb-layout__side bp-stack">
        <div class="bp-card bb-cover-card">
          ${raw(coverPreview(selectedCover || {
            title_text: project.title,
            subtitle_text: project.subtitle,
            author_text: project.author_name,
            layout: { title_case: "title", title_align: "center", title_position: "middle", type_style: "serif" },
            palette: [],
          }, { width: 180, className: selectedCover ? "" : "bb-cover--unset" }))}
          <div class="bp-center" style="margin-top:var(--bp-4)">
            <a class="bp-btn bp-btn--secondary bp-btn--sm" href="#/studio/${project.id}/cover">
              ${selectedCover ? "Change the cover" : "Design a cover"}
            </a>
          </div>
        </div>

        <div class="bp-card">
          <h3 class="bb-side-title">At a glance</h3>
          <dl class="bp-kv bp-small">
            <dt>Words</dt><dd>${fmt.number(project.progress?.words || 0)}</dd>
            <dt>Reading time</dt><dd>${readingTime(project.progress?.words || 0)}</dd>
            <dt>Chapters drafted</dt><dd>${project.progress?.chaptersWritten || 0} of ${project.progress?.chapters || 0}</dd>
            <dt>Chapters reviewed</dt><dd>${reviewed.length}</dd>
            <dt>Figures</dt><dd>${visuals.length}</dd>
            <dt>Design</dt><dd>${project.theme_id || "editorial"}</dd>
            <dt>Page size</dt><dd>${project.trim_size}</dd>
            <dt>Last export</dt>
            <dd>${exports.length ? fmt.relativeTime(exports[0].created_at) : "never"}</dd>
          </dl>
        </div>

        <div class="bp-card">
          <h3 class="bb-side-title">Take it further</h3>
          <div class="bp-stack-sm">
            <button type="button" class="bp-btn bp-btn--secondary bp-btn--sm bp-btn--block"
                    data-action="export" data-format="pdf_digital">Download the PDF</button>
            <a class="bp-btn bp-btn--secondary bp-btn--sm bp-btn--block"
               href="#/studio/${project.id}/marketing">Build the campaign</a>
            <button type="button" class="bp-btn bp-btn--ghost bp-btn--sm bp-btn--block"
                    data-action="promote">
              ${project.book_id ? "Open it in Campaigns" : "Advertise this book"}
            </button>
          </div>
          <p class="bp-tiny bp-subtle" style="margin:var(--bp-3) 0 0">
            Advertising it hands the finished book to the marketing side of BookPilot, with its
            positioning already filled in.
          </p>
        </div>
      </aside>
    </div>
  `;

  delegate(container, "click", {
    async export(trigger) {
      setBusy(trigger, true, "Building…");
      try {
        const file = await downloadExport(trigger.dataset.format, project.id);
        saveFile(file.blob, file.fileName);
        notify.success(`${file.fileName} is ready${file.pages ? ` — ${file.pages} pages` : ""}.`);
      } catch (err) {
        notify.error(err.message);
      } finally {
        setBusy(trigger, false);
      }
    },
    async promote(trigger) {
      if (project.book_id) {
        navigate(`/books/${project.book_id}`);
        return;
      }
      setBusy(trigger, true, "Handing over…");
      try {
        const { book } = await BB.promote(project.id);
        notify.success("It's in your marketing library, with its positioning carried across.");
        navigate(`/books/${book.id}`);
      } catch (err) {
        notify.error(err.message);
        setBusy(trigger, false);
      }
    },
  });
}
