// Book Builder — the library and the new-book wizard.

import { html, raw, $, $$, delegate, formData, setBusy } from "../../core/dom.js";
import { BB, downloadExport, saveFile } from "../../core/builder-api.js";
import { isDemo } from "../../core/api.js";
import { notify, confirmDialog } from "../../core/toast.js";
import { navigate } from "../../core/router.js";
import { refreshAccount } from "../../core/session.js";
import { pageHead, emptyState, demoBadge } from "../shared.js";
import { statusBadge, fmt, readingTime } from "./shared.js";
import { coverPreview } from "./cover-render.js";
import { coverGallery, bindCoverGallery } from "./cover-gallery.js";
import { coverTemplateById } from "../../core/cover-templates.js";
import { GENRE_OPTIONS } from "../options.js";  // a prebuilt <option> list, not an array

const FILTERS = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "writing", label: "Writing" },
  { key: "editing", label: "Editing" },
  { key: "designing", label: "Designing" },
  { key: "ready", label: "Ready" },
  { key: "published", label: "Published" },
];

// ---------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------

export async function renderList(container, params, query) {
  const { projects } = await BB.projects();
  const filter = query?.get("filter") || "all";

  if (!projects.length) {
    container.innerHTML = html`
      ${raw(pageHead({
        title: "Book Builder",
        description: "Turn an idea into a finished, designed, publication-ready book.",
      }))}
      ${raw(emptyState({
        icon: "✎",
        title: "No books yet",
        text: "Describe what you want to write in a sentence. The Book Architect takes it from there.",
        action: '<a class="bp-btn bp-btn--primary bp-btn--lg" href="#/studio/new">Create your first book</a>',
      }))}
      ${raw(howItWorks())}
    `;
    return;
  }

  const visible = filter === "all"
    ? projects
    : projects.filter((project) => project.status === filter);

  container.innerHTML = html`
    ${raw(pageHead({
      title: "Book Builder",
      description: "Every book keeps its own plan, voice, design and campaign in one place.",
      actions: `${demoBadge()}<a class="bp-btn bp-btn--primary" href="#/studio/new">Create a book</a>`,
    }))}

    <div class="bp-chips" style="margin-bottom:var(--bp-6)">
      ${raw(FILTERS.map((item) => {
        const count = item.key === "all"
          ? projects.length
          : projects.filter((p) => p.status === item.key).length;
        if (!count && item.key !== "all" && filter !== item.key) return "";
        return html`<a class="bp-chip ${filter === item.key ? "bp-chip--active" : ""}"
             href="#/studio?filter=${item.key}">${item.label} <span class="bp-subtle">${count}</span></a>`;
      }).join(""))}
    </div>

    ${visible.length
      ? raw(`<div class="bb-grid">${visible.map(projectCard).join("")}</div>`)
      : raw(emptyState({
          icon: "◇",
          title: `Nothing at the ${filter} stage`,
          text: "Try another filter, or start something new.",
          action: '<a class="bp-btn bp-btn--secondary" href="#/studio">Show all books</a>',
        }))}
  `;

  delegate(container, "click", {
    async export(trigger) {
      const { id, format } = trigger.dataset;
      setBusy(trigger, true, "Building…");
      try {
        const file = await downloadExport(format, id);
        saveFile(file.blob, file.fileName);
        notify.success(`${file.fileName} is ready${file.pages ? ` — ${file.pages} pages` : ""}.`);
      } catch (err) {
        notify.error(err.message);
      } finally {
        setBusy(trigger, false);
      }
    },
    async duplicate(trigger) {
      setBusy(trigger, true, "Copying…");
      try {
        const { project } = await BB.duplicateProject(trigger.dataset.id);
        notify.success("Copied. The duplicate is yours to take in a different direction.");
        navigate(`/studio/${project.id}`);
      } catch (err) {
        notify.error(err.message);
        setBusy(trigger, false);
      }
    },
    async archive(trigger) {
      const { id, status } = trigger.dataset;
      const next = status === "archived" ? "draft" : "archived";
      await BB.updateProject(id, { status: next });
      notify.info(next === "archived" ? "Archived." : "Restored.");
      renderList(container, params, query);
    },
    async delete(trigger) {
      const ok = await confirmDialog({
        title: "Delete this book?",
        message: "The manuscript, its versions, its figures and its covers all go with it. This cannot be undone.",
        confirmLabel: "Delete permanently",
        danger: true,
      });
      if (!ok) return;
      await BB.deleteProject(trigger.dataset.id);
      await refreshAccount().catch(() => {});
      notify.info("Deleted.");
      renderList(container, params, query);
    },
  });
}

function projectCard(project) {
  const progress = project.progress || {};
  const cover = project.cover;
  return html`
    <article class="bb-card">
      <a class="bb-card__cover" href="#/studio/${project.id}" aria-hidden="true">
        ${raw(cover
          ? coverPreview(cover, { width: 132 })
          : coverPreview({
              title_text: project.title,
              author_text: project.author_name,
              subtitle_text: project.subtitle,
              layout: { title_case: "title", title_align: "center", title_position: "middle", type_style: "serif" },
              palette: [],
            }, { width: 132, className: "bb-cover--unset" }))}
      </a>
      <div class="bb-card__body">
        <div>
          <a href="#/studio/${project.id}"><strong class="bp-clamp-2">${project.title}</strong></a>
          <div class="bp-small bp-muted">${project.author_name || "Author not set"}</div>
        </div>

        <div class="bp-row bp-row--wrap" style="gap:6px">
          ${raw(statusBadge(project.status))}
          ${project.genre ? raw(html`<span class="bp-badge">${project.genre}</span>`) : ""}
        </div>

        <div>
          <div class="bp-row bp-row--between bp-tiny bp-subtle" style="margin-bottom:5px">
            <span>Progress</span><span>${progress.percent || 0}%</span>
          </div>
          <div class="bp-progress"><div class="bp-progress__bar" style="width:${progress.percent || 0}%"></div></div>
        </div>

        <dl class="bp-kv bp-tiny" style="margin:0">
          <dt>Written</dt><dd>${fmt.number(progress.words || 0)} words</dd>
          <dt>Length</dt><dd>≈ ${progress.estimatedPages || 0} pages</dd>
          <dt>Edited</dt><dd>${fmt.relativeTime(project.updated_at)}</dd>
        </dl>

        <div class="bp-row bp-row--wrap" style="gap:6px">
          <a class="bp-btn bp-btn--primary bp-btn--sm" href="#/studio/${project.id}">Continue</a>
          <details class="bb-menu">
            <summary class="bp-btn bp-btn--ghost bp-btn--sm">More</summary>
            <div class="bb-menu__list">
              <a class="bb-menu__item" href="#/studio/${project.id}/preview">Preview</a>
              <button type="button" class="bb-menu__item" data-action="export"
                      data-id="${project.id}" data-format="pdf_digital">Export PDF</button>
              <button type="button" class="bb-menu__item" data-action="export"
                      data-id="${project.id}" data-format="epub">Export EPUB</button>
              <button type="button" class="bb-menu__item" data-action="duplicate" data-id="${project.id}">Duplicate</button>
              <button type="button" class="bb-menu__item" data-action="archive"
                      data-id="${project.id}" data-status="${project.status}">
                ${project.status === "archived" ? "Restore" : "Archive"}
              </button>
              <button type="button" class="bb-menu__item bb-menu__item--danger"
                      data-action="delete" data-id="${project.id}">Delete</button>
            </div>
          </details>
        </div>
      </div>
    </article>
  `;
}

function howItWorks() {
  const steps = [
    ["Idea", "One or two sentences about the book you want."],
    ["Positioning", "Titles, the promise, the reader, the angle — you choose."],
    ["Blueprint", "Parts, chapters, word budgets, where the figures go."],
    ["Manuscript", "Written chapter by chapter, in one consistent voice."],
    ["Design", "A real interior: margins, running heads, chapter openers."],
    ["Publish", "PDF, EPUB, Word — and a campaign built from the book."],
  ];
  return html`
    <section class="bb-how">
      <h2 class="bb-how__title">From an idea to a finished book</h2>
      <ol class="bb-how__list">
        ${raw(steps.map(([title, text], index) => html`
          <li class="bb-how__step">
            <span class="bb-how__number">${index + 1}</span>
            <div>
              <strong>${title}</strong>
              <p>${text}</p>
            </div>
          </li>`).join(""))}
      </ol>
    </section>
  `;
}

// ---------------------------------------------------------------------
// The wizard
// ---------------------------------------------------------------------

const LENGTHS = [
  { value: 60, label: "Short — about 60 pages", hint: "A lead magnet or a focused guide" },
  { value: 100, label: "Compact — about 100 pages", hint: "One idea, told properly" },
  { value: 160, label: "Standard — about 160 pages", hint: "The usual trade non-fiction length" },
  { value: 220, label: "Full — about 220 pages", hint: "A comprehensive treatment" },
  { value: 320, label: "Substantial — about 320 pages", hint: "A reference or a memoir" },
];

const PURPOSES = [
  ["sell", "Sell it", "A book that earns on its own"],
  ["authority", "Build authority", "The book that makes the introduction"],
  ["educate", "Teach", "A course companion or a practical guide"],
  ["lead_generation", "Generate leads", "A lead magnet with a clear next step"],
  ["personal", "A personal project", "The one you have wanted to write"],
  ["business", "For the business", "A white paper or a client book"],
];

const STYLES = [
  ["professional", "Professional"],
  ["conversational", "Conversational"],
  ["mentor", "Mentor"],
  ["practical", "Practical"],
  ["inspirational", "Inspirational"],
  ["storytelling", "Storytelling"],
  ["business", "Business"],
  ["academic", "Academic"],
  ["luxury_editorial", "Luxury editorial"],
];

const LANGUAGES = [
  ["en", "English"], ["de", "German"], ["fr", "French"], ["es", "Spanish"],
  ["it", "Italian"], ["pt", "Portuguese"], ["nl", "Dutch"], ["hr", "Croatian"],
];

export async function renderWizard(container, params, query) {
  const [{ templates }, { themes, trimSizes }] = await Promise.all([
    BB.templates().catch(() => ({ templates: [] })),
    BB.themes().catch(() => ({ themes: [], trimSizes: [] })),
  ]);

  const preselected = query?.get("template") || "";

  // A cover template can be preselected from a link (?cover=sunrise-doorway).
  const preselectedCover = coverTemplateById(query?.get("cover"))?.id || "";

  container.innerHTML = html`
    <div class="bb-wizard bb-wizard--wide">
      <div class="bb-wizard__head">
        <a class="bp-small bp-muted" href="#/studio">← All books</a>
        <h1 class="bb-wizard__title">Create a book</h1>
        <p class="bb-wizard__lead">
          Start with the idea in your head. Everything after this — the title, the structure,
          the chapters, the design — is something you approve rather than something you invent.
        </p>
      </div>

      <div class="bb-wizard__layout">
      ${raw(coverGallery({ selected: preselectedCover }))}

      <form id="new-book" class="bb-wizard__form" novalidate>
        <section class="bp-card bb-wizard__card">
          <div class="bb-step">
            <span class="bb-step__number">1</span>
            <div>
              <h2 class="bb-step__title">The idea</h2>
              <p class="bb-step__text">One or two sentences. Plain language beats a pitch.</p>
            </div>
          </div>

          <div class="bp-field">
            <label class="bp-label" for="idea">What is the book?</label>
            <textarea class="bp-textarea" id="idea" name="idea" rows="4" required
              placeholder="I want to write a 100-page book helping women rebuild their lives after a major life change."></textarea>
            <p class="bp-hint">Say who it is for and what it does for them, if you know. If you don't, say what it is about.</p>
          </div>

          <div class="bp-field-row">
            <div class="bp-field">
              <label class="bp-label" for="genre">Genre</label>
              <select class="bp-select" id="genre" name="genre">
                ${raw(GENRE_OPTIONS)}
              </select>
            </div>
            <div class="bp-field">
              <label class="bp-label" for="language">Language</label>
              <select class="bp-select" id="language" name="language">
                ${raw(LANGUAGES.map(([value, label]) =>
                  html`<option value="${value}">${label}</option>`).join(""))}
              </select>
            </div>
          </div>

          <div class="bp-field">
            <label class="bp-label" for="audience">Who is it for?</label>
            <input class="bp-input" id="audience" name="audience" maxlength="400"
                   placeholder="Women in their forties and fifties going through divorce, redundancy or bereavement">
          </div>

          <div class="bp-field">
            <label class="bp-label" for="author_name">Author name</label>
            <input class="bp-input" id="author_name" name="author_name" maxlength="200"
                   placeholder="The name that goes on the cover">
          </div>
        </section>

        <section class="bp-card bb-wizard__card">
          <div class="bb-step">
            <span class="bb-step__number">2</span>
            <div>
              <h2 class="bb-step__title">Shape and voice</h2>
              <p class="bb-step__text">These set the word budget and the register. Both are changeable later.</p>
            </div>
          </div>

          <fieldset class="bp-field">
            <legend class="bp-label">How long?</legend>
            <div class="bb-options">
              ${raw(LENGTHS.map((length, index) => html`
                <label class="bp-radio ${index === 2 ? "bp-radio--selected" : ""}">
                  <input type="radio" name="target_pages" value="${length.value}" ${index === 2 ? "checked" : ""}>
                  <span><strong>${length.label}</strong><br><span class="bp-tiny bp-subtle">${length.hint}</span></span>
                </label>`).join(""))}
            </div>
          </fieldset>

          <fieldset class="bp-field">
            <legend class="bp-label">What is it for?</legend>
            <div class="bb-options">
              ${raw(PURPOSES.map(([value, label, hint]) => html`
                <label class="bp-radio">
                  <input type="radio" name="purpose" value="${value}">
                  <span><strong>${label}</strong><br><span class="bp-tiny bp-subtle">${hint}</span></span>
                </label>`).join(""))}
            </div>
          </fieldset>

          <div class="bp-field">
            <label class="bp-label" for="writing_style">Writing style</label>
            <select class="bp-select" id="writing_style" name="writing_style">
              ${raw(STYLES.map(([value, label]) =>
                html`<option value="${value}">${label}</option>`).join(""))}
            </select>
          </div>
        </section>

        <section class="bp-card bb-wizard__card">
          <div class="bb-step">
            <span class="bb-step__number">3</span>
            <div>
              <h2 class="bb-step__title">Starting point and look</h2>
              <p class="bb-step__text">Optional. A template gives the Architect a shape to work from.</p>
            </div>
          </div>

          <div class="bp-field">
            <label class="bp-label" for="template_id">Template</label>
            <select class="bp-select" id="template_id" name="template_id">
              <option value="">Start from nothing</option>
              ${raw(templates.map((template) => html`<option value="${template.id}"
                ${template.id === preselected ? "selected" : ""}>${template.category} — ${template.name}</option>`).join(""))}
            </select>
            <p class="bp-hint">
              <a href="#/studio/templates">Look through the templates first</a> if you're not sure.
            </p>
          </div>

          <div class="bp-field-row">
            <div class="bp-field">
              <label class="bp-label" for="theme_id">Interior design</label>
              <select class="bp-select" id="theme_id" name="theme_id">
                ${raw(themes.map((theme) => html`<option value="${theme.id}"
                  ${theme.id === "editorial" ? "selected" : ""}>${theme.name}${theme.tagline ? ` — ${theme.tagline}` : ""}</option>`).join(""))}
              </select>
            </div>
            <div class="bp-field">
              <label class="bp-label" for="trim_size">Page size</label>
              <select class="bp-select" id="trim_size" name="trim_size">
                ${raw(trimSizes.map((trim) => html`<option value="${trim.id}"
                  ${trim.id === "6x9" ? "selected" : ""}>${trim.label}</option>`).join(""))}
              </select>
            </div>
          </div>
        </section>

        <div class="bb-wizard__actions">
          <a class="bp-btn bp-btn--ghost" href="#/studio">Cancel</a>
          <button type="submit" class="bp-btn bp-btn--primary bp-btn--lg">Create the book</button>
        </div>
        <p class="bp-tiny bp-subtle bb-wizard__foot">
          Creating the book costs nothing. The first AI step — positioning — comes next, and
          tells you what it costs before it runs.
        </p>
      </form>
      </div>
    </div>
  `;

  bindCoverGallery(container);

  // Radio cards highlight their selection.
  $$('input[type="radio"]', container).forEach((input) => {
    input.addEventListener("change", () => {
      $$(`input[name="${input.name}"]`, container).forEach((sibling) => {
        sibling.closest(".bp-radio")?.classList.toggle("bp-radio--selected", sibling.checked);
      });
    });
  });

  $("#new-book").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('button[type="submit"]');
    const data = formData(event.target);

    if (!data.idea || data.idea.length < 10) {
      notify.error("Tell us what the book is, in a sentence or two.");
      $("#idea").focus();
      return;
    }

    setBusy(button, true, "Creating…");
    try {
      const { cover_template: coverTemplate, ...fields } = data;
      const { project } = await BB.createProject({
        ...fields,
        target_pages: Number(fields.target_pages) || 160,
        // Only sent when one was picked; the server checks it is a real template.
        ...(coverTemplate ? { cover_template: coverTemplate } : {}),
      });
      await refreshAccount().catch(() => {});
      notify.success("Your book exists. Now let's work out what it is.");
      navigate(`/studio/${project.id}/positioning`);
    } catch (err) {
      notify.error(err.message);
      setBusy(button, false);
    }
  });
}

// ---------------------------------------------------------------------
// Templates (spec 28)
// ---------------------------------------------------------------------

export async function renderTemplates(container) {
  const { templates } = await BB.templates();
  const categories = [...new Set(templates.map((t) => t.category))];

  container.innerHTML = html`
    ${raw(pageHead({
      title: "Templates",
      description: "A starting architecture for a kind of book. The Architect adapts it to your idea rather than following it to the letter.",
      actions: demoBadge(),
    }))}

    ${templates.length
      ? raw(categories.map((category) => html`
          <section style="margin-bottom:var(--bp-10)">
            <h2 class="bb-section-title">${category}</h2>
            <div class="bp-grid bp-grid--2">
              ${raw(templates.filter((t) => t.category === category).map(templateCard).join(""))}
            </div>
          </section>`).join(""))
      : raw(emptyState({
          icon: "▤",
          title: "No templates on this deployment",
          text: "Templates are reference data. Run sql/008_book_builder_seed.sql to load the starting set.",
          action: '<a class="bp-btn bp-btn--primary" href="#/studio/new">Start from nothing instead</a>',
        }))}
  `;
}

function templateCard(template) {
  const parts = template.structure?.parts || [];
  return html`
    <article class="bp-card bb-template">
      <div class="bp-row bp-row--between bp-row--top">
        <div>
          <h3 class="bb-template__name">${template.name}</h3>
          <p class="bp-small bp-muted">${template.description || ""}</p>
        </div>
        ${template.is_premium ? raw('<span class="bp-badge bp-badge--accent">Premium</span>') : ""}
      </div>

      ${parts.length ? raw(html`
        <ol class="bb-template__structure">
          ${raw(parts.map((part) => html`
            <li>
              <strong>${part.title}</strong>
              <span class="bp-tiny bp-subtle">${(part.chapters || []).length} chapters</span>
            </li>`).join(""))}
        </ol>`) : ""}

      <dl class="bp-kv bp-tiny">
        ${template.target_pages ? raw(html`<dt>Length</dt><dd>≈ ${template.target_pages} pages</dd>`) : ""}
        ${template.audience_hint ? raw(html`<dt>For</dt><dd>${template.audience_hint}</dd>`) : ""}
      </dl>

      <a class="bp-btn bp-btn--secondary bp-btn--sm" href="#/studio/new?template=${template.id}">
        Start from this
      </a>
    </article>
  `;
}

export { isDemo, readingTime };
