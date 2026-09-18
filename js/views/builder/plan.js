// The Book Architect's three stages: positioning, the blueprint and the
// Book Bible.
//
// Grouped in one module because they are one conversation — what the
// book is, how it is shaped, and how it is written — and because each
// one reads the output of the one before it.

import { html, raw, $, $$, delegate, formData, setBusy } from "../../core/dom.js";
import { BB } from "../../core/builder-api.js";
import { notify, confirmDialog } from "../../core/toast.js";
import { navigate } from "../../core/router.js";
import { refreshAccount } from "../../core/session.js";
import { projectHeader, agentPanel, fmt } from "./shared.js";
import { demoBadge } from "../shared.js";

// =====================================================================
// Positioning (spec 5, step 2)
// =====================================================================

export async function renderPositioning(container, params) {
  const data = await BB.project(params.id);
  const { project, positioning } = data;

  container.innerHTML = html`
    ${raw(projectHeader(project, { active: "positioning", actions: demoBadge() }))}
    <div class="bb-stage" id="stage"></div>
  `;

  paintPositioning($("#stage"), project, positioning);
}

function paintPositioning(mount, project, positioning) {
  const approved = Boolean(positioning?.approved_at);

  // Only a title the author actually settled on belongs in the free-text
  // box. Pre-filling it with the placeholder a new project starts with
  // meant that value silently won over whatever they picked from the
  // list, and the book kept the name "Untitled book".
  const chosenCustomTitle =
    approved && !isFromList(project.title, positioning?.title_ideas) ? project.title || "" : "";
  const chosenCustomSubtitle =
    approved && !isFromList(project.subtitle, positioning?.subtitle_ideas) ? project.subtitle || "" : "";

  mount.innerHTML = html`
    ${!positioning ? raw(agentPanel({
      agent: "Book Architect",
      title: "Work out what this book is",
      description:
        "Ten titles, ten subtitles, the promise, the reader, the problem, the transformation and the angle — " +
        "from the idea you wrote. You pick from what comes back; nothing is applied without you.",
      operation: "book_positioning",
      action: "generate",
      label: "Create positioning",
      busyLabel: "Thinking…",
    })) : ""}

    ${positioning ? raw(html`
      <form id="positioning-form" class="bp-stack-lg">
        <section class="bp-card">
          <div class="bp-row bp-row--between bp-row--top" style="margin-bottom:var(--bp-5)">
            <div>
              <h2 class="bb-section-title" style="margin:0">Choose a title</h2>
              <p class="bp-small bp-muted" style="margin:4px 0 0">
                Pick one, or write your own. A title's job is to make the right reader recognise themselves.
              </p>
            </div>
            ${approved ? raw('<span class="bp-badge bp-badge--success">Approved</span>') : ""}
          </div>

          <div class="bb-pick" role="radiogroup" aria-label="Title">
            ${raw((positioning.title_ideas || []).map((title, index) => html`
              <label class="bb-pick__option ${project.title === title ? "bb-pick__option--selected" : ""}">
                <input type="radio" name="title_pick" value="${title}"
                       ${project.title === title || (index === 0 && !chosenCustomTitle && !isFromList(project.title, positioning.title_ideas)) ? "checked" : ""}>
                <span>${title}</span>
              </label>`).join(""))}
          </div>

          <div class="bp-field" style="margin-top:var(--bp-4)">
            <label class="bp-label" for="title">Or write your own</label>
            <input class="bp-input" id="title" name="title" maxlength="300"
                   value="${chosenCustomTitle}" placeholder="Your title">
          </div>
        </section>

        <section class="bp-card">
          <h2 class="bb-section-title">Choose a subtitle</h2>
          <p class="bp-small bp-muted" style="margin:0 0 var(--bp-4)">
            The subtitle carries the specifics the title cannot.
          </p>
          <div class="bb-pick" role="radiogroup" aria-label="Subtitle">
            ${raw((positioning.subtitle_ideas || []).map((subtitle) => html`
              <label class="bb-pick__option ${project.subtitle === subtitle ? "bb-pick__option--selected" : ""}">
                <input type="radio" name="subtitle_pick" value="${subtitle}"
                       ${project.subtitle === subtitle ? "checked" : ""}>
                <span>${subtitle}</span>
              </label>`).join(""))}
          </div>
          <div class="bp-field" style="margin-top:var(--bp-4)">
            <label class="bp-label" for="subtitle">Or write your own</label>
            <input class="bp-input" id="subtitle" name="subtitle" maxlength="300"
                   value="${chosenCustomSubtitle}" placeholder="Your subtitle">
          </div>
        </section>

        <section class="bp-card">
          <h2 class="bb-section-title">The reading</h2>
          <p class="bp-small bp-muted" style="margin:0 0 var(--bp-5)">
            Edit anything here that is wrong. What you approve is what every later stage works from.
          </p>
          <div class="bp-stack">
            ${raw(field("promise", "The promise", positioning.promise, "One sentence: what the reader gets."))}
            ${raw(field("target_reader", "The reader", positioning.target_reader, "Specific enough to picture."))}
            ${raw(field("reader_problem", "The problem", positioning.reader_problem))}
            ${raw(field("transformation", "The transformation", positioning.transformation))}
            ${raw(field("unique_angle", "The angle", positioning.unique_angle, "Why this book rather than the established one."))}
            ${raw(field("category", "The category", positioning.category, "The shelf it belongs on."))}
          </div>

          ${positioning.comparable_titles?.length ? raw(html`
            <div style="margin-top:var(--bp-5)">
              <div class="bp-label">Sits beside</div>
              <div class="bp-chips">
                ${raw(positioning.comparable_titles.map((title) => html`<span class="bp-chip">${title}</span>`).join(""))}
              </div>
            </div>`) : ""}

          ${positioning.reasoning ? raw(html`
            <p class="bb-reasoning"><strong>Why:</strong> ${positioning.reasoning}</p>`) : ""}
        </section>

        <div class="bb-sticky-actions">
          <button type="button" class="bp-btn bp-btn--ghost" data-action="regenerate"
                  data-busy="Thinking…">Try again</button>
          <button type="submit" class="bp-btn bp-btn--primary bp-btn--lg">
            ${approved ? "Update positioning" : "Approve positioning"}
          </button>
        </div>
      </form>`) : ""}
  `;

  $$("#title, #subtitle", mount).forEach((field) => {
    field.addEventListener("input", () => { field.dataset.touched = "1"; });
  });

  $$(".bb-pick__option input", mount).forEach((input) => {
    input.addEventListener("change", () => {
      $$(`input[name="${input.name}"]`, mount).forEach((sibling) =>
        sibling.closest(".bb-pick__option")?.classList.toggle("bb-pick__option--selected", sibling.checked));
      // Choosing from the list clears the free-text field, so there is
      // never a quiet conflict about which one wins.
      const custom = $(`#${input.name.replace("_pick", "")}`, mount);
      if (custom) {
        custom.value = "";
        delete custom.dataset.touched;
      }
    });
  });

  const run = async (trigger) => {
    setBusy(trigger, true, trigger.dataset.busy || "Working…");
    try {
      const result = await BB.generatePositioning(project.id);
      await refreshAccount().catch(() => {});
      notify.success("Positioning ready. Nothing is applied until you approve it.");
      paintPositioning(mount, project, result.positioning);
    } catch (err) {
      notify.error(err.message);
      setBusy(trigger, false);
    }
  };

  delegate(mount, "click", {
    generate: run,
    async regenerate(trigger) {
      const ok = await confirmDialog({
        title: "Ask for new positioning?",
        message: "This costs credits again and replaces the suggestions on this page. Your approved title stays as it is until you approve something else.",
        confirmLabel: "Try again",
      });
      if (ok) run(trigger);
    },
  });

  mount.querySelector("#positioning-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('button[type="submit"]');
    const values = formData(event.target);
    // A value typed by hand wins; otherwise the choice from the list does.
    const typedTitle = $("#title", mount)?.dataset.touched ? values.title : "";
    const typedSubtitle = $("#subtitle", mount)?.dataset.touched ? values.subtitle : "";
    const title = typedTitle || values.title_pick || values.title;
    const subtitle = typedSubtitle || values.subtitle_pick || values.subtitle || "";

    if (!title) {
      notify.error("Choose a title, or write one.");
      return;
    }

    setBusy(button, true, "Approving…");
    try {
      await BB.approvePositioning({
        project_id: project.id,
        title,
        subtitle,
        target_reader: values.target_reader,
      });
      notify.success("Approved. Next: the shape of the book.");
      navigate(`/studio/${project.id}/blueprint`);
    } catch (err) {
      notify.error(err.message);
      setBusy(button, false);
    }
  });
}

function isFromList(value, list) {
  return Boolean(value && (list || []).includes(value));
}

function field(name, label, value, hint = "") {
  const long = String(value || "").length > 90;
  return html`
    <div class="bp-field">
      <label class="bp-label" for="${name}">${label}</label>
      ${long
        ? raw(html`<textarea class="bp-textarea" id="${name}" name="${name}" rows="3">${value || ""}</textarea>`)
        : raw(html`<input class="bp-input" id="${name}" name="${name}" value="${value || ""}">`)}
      ${hint ? raw(html`<p class="bp-hint">${hint}</p>`) : ""}
    </div>
  `;
}

// =====================================================================
// The blueprint (spec 6, 7)
// =====================================================================

export async function renderBlueprint(container, params) {
  const data = await BB.project(params.id);
  const { project, parts = [], chapters = [] } = data;

  container.innerHTML = html`
    ${raw(projectHeader(project, {
      active: "blueprint",
      actions: `${demoBadge()}<a class="bp-btn bp-btn--secondary bp-btn--sm" href="#/studio/${project.id}/write">Start writing</a>`,
    }))}
    <div class="bb-stage" id="stage"></div>
  `;

  paintBlueprint($("#stage"), project, parts, chapters);
}

function paintBlueprint(mount, project, parts, chapters) {
  const body = chapters.filter((c) => c.kind !== "front" && c.kind !== "back");
  const front = chapters.filter((c) => c.kind === "front");
  const back = chapters.filter((c) => c.kind === "back" || c.kind === "bonus");
  const plannedWords = body.reduce((sum, c) => sum + (c.target_words || 0), 0);

  mount.innerHTML = html`
    ${!body.length ? raw(agentPanel({
      agent: "Book Architect",
      title: "Design the book before writing it",
      description:
        "Parts, chapters, the purpose and promise of each, a word budget that adds up to the length you asked for, " +
        "and where exercises, case studies and figures belong.",
      operation: "book_architecture",
      action: "generate",
      label: "Create the blueprint",
      busyLabel: "Designing…",
      disabled: project.stages?.positioning !== "approved",
      note: project.stages?.positioning !== "approved"
        ? "Approve the positioning first — the architecture is built on it."
        : "",
    })) : ""}

    ${body.length ? raw(html`
      <div class="bp-row bp-row--between bp-row--wrap" style="margin-bottom:var(--bp-5)">
        <div>
          <h2 class="bb-section-title" style="margin:0">The blueprint</h2>
          <p class="bp-small bp-muted" style="margin:4px 0 0">
            ${body.length} chapters · ${fmt.number(plannedWords)} words planned ·
            ≈ ${Math.round(plannedWords / 260)} pages.
            Drag a chapter to move it.
          </p>
        </div>
        <div class="bp-row bp-row--wrap">
          <button type="button" class="bp-btn bp-btn--ghost bp-btn--sm" data-action="add-chapter">Add a chapter</button>
          <button type="button" class="bp-btn bp-btn--ghost bp-btn--sm" data-action="regenerate"
                  data-busy="Designing…">Redesign</button>
        </div>
      </div>

      <div class="bb-tree" id="tree">
        ${raw(front.length ? treeGroup("Front matter", front, project, { plain: true }) : "")}
        ${raw(parts.length
          ? parts.map((part) => treeGroup(
              `Part ${part.number || ""} · ${part.title}`,
              body.filter((c) => c.part_id === part.id),
              project,
              { purpose: part.purpose }
            )).join("") + treeGroup("", body.filter((c) => !c.part_id), project, { plain: true })
          : treeGroup("", body, project, { plain: true }))}
        ${raw(back.length ? treeGroup("Back matter", back, project, { plain: true }) : "")}
      </div>

      <section class="bp-card" style="margin-top:var(--bp-8)">
        <h3 class="bb-side-title">Front and back matter</h3>
        <p class="bp-small bp-muted">
          The title page, the copyright page, the about-the-author page and the rest. The copyright
          page never invents an ISBN — it leaves a marked placeholder for the one you obtain.
        </p>
        <div class="bp-row bp-row--wrap">
          <button type="button" class="bp-btn bp-btn--secondary bp-btn--sm" data-action="front-matter"
                  data-busy="Writing…">Create front matter</button>
          <button type="button" class="bp-btn bp-btn--secondary bp-btn--sm" data-action="back-matter"
                  data-busy="Writing…">Create back matter</button>
        </div>
      </section>`) : ""}
  `;

  enableDragAndDrop(mount, project);

  const runArchitecture = async (trigger) => {
    setBusy(trigger, true, trigger.dataset.busy || "Designing…");
    try {
      const result = await BB.generateArchitecture(project.id);
      await refreshAccount().catch(() => {});
      if (result.kept?.length) {
        notify.info(`${result.kept.length} written chapter${result.kept.length === 1 ? "" : "s"} kept and moved to the end.`);
      }
      notify.success("Blueprint ready.");
      const fresh = await BB.project(project.id);
      paintBlueprint(mount, fresh.project, fresh.parts, fresh.chapters);
    } catch (err) {
      notify.error(err.message);
      setBusy(trigger, false);
    }
  };

  delegate(mount, "click", {
    generate: runArchitecture,
    async regenerate(trigger) {
      const ok = await confirmDialog({
        title: "Redesign the book?",
        message: "Chapters you have already written are kept and moved to the end. Empty chapters are replaced.",
        confirmLabel: "Redesign",
      });
      if (ok) runArchitecture(trigger);
    },
    async "add-chapter"() {
      const { chapter } = await BB.createChapter(project.id, {
        title: "New chapter",
        kind: "chapter",
        target_words: 2000,
      });
      notify.success("Chapter added.");
      navigate(`/studio/${project.id}/write/${chapter.id}`);
    },
    async "front-matter"(trigger) {
      await matterAction(trigger, mount, project, "front");
    },
    async "back-matter"(trigger) {
      await matterAction(trigger, mount, project, "back");
    },
    async "delete-chapter"(trigger) {
      const ok = await confirmDialog({
        title: "Delete this section?",
        message: "Anything written in it goes too.",
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
      await BB.deleteChapter(project.id, trigger.dataset.id);
      const fresh = await BB.project(project.id);
      paintBlueprint(mount, fresh.project, fresh.parts, fresh.chapters);
    },
  });
}

async function matterAction(trigger, mount, project, which) {
  setBusy(trigger, true, trigger.dataset.busy || "Writing…");
  try {
    const call = which === "front" ? BB.frontMatter : BB.backMatter;
    const result = await call(project.id, {});
    await refreshAccount().catch(() => {});
    notify.success(
      result.created
        ? `${result.created} section${result.created === 1 ? "" : "s"} added.`
        : "Updated the sections that were already there."
    );
    if (result.replaceable?.length) {
      notify.info("The dedication and epigraph are placeholders — replace them with your own.");
    }
    const fresh = await BB.project(project.id);
    paintBlueprint(mount, fresh.project, fresh.parts, fresh.chapters);
  } catch (err) {
    notify.error(err.message);
    setBusy(trigger, false);
  }
}

function treeGroup(label, chapters, project, { purpose = "", plain = false } = {}) {
  if (!chapters.length) return "";
  return html`
    <section class="bb-tree__group ${plain ? "bb-tree__group--plain" : ""}">
      ${label ? raw(html`
        <header class="bb-tree__part">
          <h3>${label}</h3>
          ${purpose ? raw(html`<p>${purpose}</p>`) : ""}
        </header>`) : ""}
      <ul class="bb-tree__list">
        ${raw(chapters.map((chapter) => chapterRow(chapter, project)).join(""))}
      </ul>
    </section>
  `;
}

function chapterRow(chapter, project) {
  const written = chapter.word_count || 0;
  const target = chapter.target_words || 0;
  const pct = target ? Math.min(100, Math.round((written / target) * 100)) : (written ? 100 : 0);
  const extras = [
    (chapter.exercises || []).length ? `${chapter.exercises.length} exercise${chapter.exercises.length === 1 ? "" : "s"}` : "",
    (chapter.case_studies || []).length ? `${chapter.case_studies.length} case stud${chapter.case_studies.length === 1 ? "y" : "ies"}` : "",
    (chapter.visual_opportunities || []).length ? `${chapter.visual_opportunities.length} figure${chapter.visual_opportunities.length === 1 ? "" : "s"}` : "",
  ].filter(Boolean);

  return html`
    <li class="bb-tree__item" draggable="true" data-id="${chapter.id}">
      <span class="bb-tree__grip" aria-hidden="true">⠿</span>
      <span class="bb-tree__number">${chapter.number ?? (chapter.kind === "front" ? "—" : "·")}</span>
      <div class="bb-tree__body">
        <a class="bb-tree__title" href="#/studio/${project.id}/write/${chapter.id}">${chapter.title}</a>
        ${chapter.purpose ? raw(html`<p class="bb-tree__purpose">${chapter.purpose}</p>`) : ""}
        ${extras.length ? raw(html`<p class="bb-tree__extras">${extras.join(" · ")}</p>`) : ""}
      </div>
      <div class="bb-tree__meta">
        <span class="bp-tiny bp-subtle">${fmt.number(written)}${target ? ` / ${fmt.number(target)}` : ""} words</span>
        <div class="bp-progress bb-tree__bar"><div class="bp-progress__bar" style="width:${pct}%"></div></div>
      </div>
      <button type="button" class="bp-icon-btn bb-tree__delete" data-action="delete-chapter"
              data-id="${chapter.id}" aria-label="Delete ${chapter.title}">×</button>
    </li>
  `;
}

/**
 * Drag and drop reordering.
 *
 * Written against the native drag events rather than a library, and it
 * saves the whole order in one call so a half-applied move cannot leave
 * two chapters claiming the same position.
 */
function enableDragAndDrop(mount, project) {
  const tree = mount.querySelector("#tree");
  if (!tree) return;
  let dragging = null;

  tree.addEventListener("dragstart", (event) => {
    const item = event.target.closest(".bb-tree__item");
    if (!item) return;
    dragging = item;
    item.classList.add("bb-tree__item--dragging");
    event.dataTransfer.effectAllowed = "move";
    // Firefox needs data set for a drag to start at all.
    event.dataTransfer.setData("text/plain", item.dataset.id);
  });

  tree.addEventListener("dragend", async () => {
    if (!dragging) return;
    dragging.classList.remove("bb-tree__item--dragging");
    dragging = null;

    const order = [...tree.querySelectorAll(".bb-tree__item")].map((item) => ({ id: item.dataset.id }));
    try {
      await BB.reorder(project.id, order);
      // Renumber visibly so the author sees the change take, rather than
      // wondering whether it saved.
      let number = 0;
      for (const item of tree.querySelectorAll(".bb-tree__item")) {
        const cell = item.querySelector(".bb-tree__number");
        if (cell && cell.textContent.trim() !== "—") {
          number += 1;
          cell.textContent = String(number);
        }
      }
      notify.success("Order saved.");
    } catch (err) {
      notify.error(err.message);
    }
  });

  tree.addEventListener("dragover", (event) => {
    if (!dragging) return;
    event.preventDefault();
    const list = event.target.closest(".bb-tree__list");
    if (!list) return;
    const after = [...list.querySelectorAll(".bb-tree__item:not(.bb-tree__item--dragging)")]
      .find((item) => {
        const box = item.getBoundingClientRect();
        return event.clientY < box.top + box.height / 2;
      });
    if (after) list.insertBefore(dragging, after);
    else list.appendChild(dragging);
  });
}

// =====================================================================
// The Book Bible (spec 8)
// =====================================================================

export async function renderBible(container, params) {
  const data = await BB.project(params.id);
  const { project, bible } = data;

  container.innerHTML = html`
    ${raw(projectHeader(project, { active: "bible", actions: demoBadge() }))}
    <div class="bb-stage" id="stage"></div>
  `;

  paintBible($("#stage"), project, bible);
}

function paintBible(mount, project, bible) {
  const hasContent = Boolean(bible?.voice_rules?.length || bible?.terminology?.length);

  mount.innerHTML = html`
    <section class="bb-explainer">
      <h2>Why this page exists</h2>
      <p>
        A book written chapter by chapter drifts. The vocabulary shifts, the reader changes age,
        the same idea gets introduced twice and contradicted once. The Book Bible is the reference
        every generation reads first, and it is the reason the chapters agree with each other.
      </p>
    </section>

    ${!hasContent ? raw(agentPanel({
      agent: "Book Architect",
      title: "Write the Book Bible",
      description:
        "The voice in decidable rules, the terms this book uses in a particular way, the recurring examples, " +
        "and every claim that a reader could check — each marked as supplied by you or needing verification.",
      operation: "book_bible",
      action: "generate",
      label: "Write the Book Bible",
      busyLabel: "Writing…",
    })) : ""}

    <form id="bible-form" class="bp-stack-lg" style="margin-top:var(--bp-6)">
      <section class="bp-card">
        <div class="bp-row bp-row--between" style="margin-bottom:var(--bp-4)">
          <h2 class="bb-section-title" style="margin:0">Voice</h2>
          ${hasContent ? raw(html`<button type="button" class="bp-btn bp-btn--ghost bp-btn--sm"
            data-action="generate" data-busy="Rewriting…">Rewrite with AI</button>`) : ""}
        </div>
        <div class="bp-field-row">
          ${raw(bibleField("audience", "Audience", bible?.audience))}
          ${raw(bibleField("tone", "Tone", bible?.tone))}
        </div>
        ${raw(bibleArea("writing_style", "Writing style", bible?.writing_style,
          "Person, tense, formality, spelling convention, sentence rhythm."))}
        ${raw(bibleArea("promise", "The promise", bible?.promise))}
        ${raw(bibleArea("transformation", "The transformation", bible?.transformation))}
        ${raw(bibleList("voice_rules", "Voice rules", bible?.voice_rules,
          "One rule per line. Decidable ones: “second person throughout”, “British spelling”."))}
      </section>

      <section class="bp-card">
        <h2 class="bb-section-title">Vocabulary</h2>
        ${raw(bibleList("key_concepts", "Key concepts", bible?.key_concepts, "One per line."))}
        ${raw(pairList("terminology", "Terminology", bible?.terminology, "term", "definition",
          "Terms this book uses in a particular way. One per line, as “term: what it means here”."))}
      </section>

      <section class="bp-card">
        <h2 class="bb-section-title">Claims</h2>
        <p class="bp-small bp-muted" style="margin:0 0 var(--bp-4)">
          Anything a reader could check. Nothing here is verified by the software — that is your call,
          and the publication check will keep asking until it is made.
        </p>
        ${(bible?.facts || []).length ? raw(html`
          <ul class="bb-facts">
            ${raw(bible.facts.map((fact) => html`
              <li class="bb-facts__item">
                <span class="bp-badge ${fact.status === "supplied_by_author" ? "bp-badge--success" : "bp-badge--warning"}">
                  ${fact.status === "supplied_by_author" ? "You supplied this" : "Needs verification"}
                </span>
                <div>
                  <p>${fact.claim}</p>
                  ${fact.source ? raw(html`<p class="bp-tiny bp-subtle">${fact.source}</p>`) : ""}
                </div>
              </li>`).join(""))}
          </ul>`)
          : raw('<p class="bp-small bp-muted">No claims recorded yet.</p>')}
      </section>

      <section class="bp-card">
        <h2 class="bb-section-title">Look</h2>
        ${raw(bibleArea("visual_style", "Visual style", bible?.visual_style,
          "How figures should look and what they are for."))}
        ${raw(bibleArea("image_style", "Image style", bible?.image_style,
          "Art direction for illustration, if the book uses any."))}
        ${raw(bibleField("brand_colors_text", "Brand colours",
          (bible?.brand_colors || []).join(", "), "Comma separated hex values."))}
      </section>

      <section class="bp-card">
        <h2 class="bb-section-title">Your notes</h2>
        ${raw(bibleArea("notes", "", bible?.notes,
          "Anything every chapter should know: your story, your clients, a phrase you use, something to avoid.", 6))}
      </section>

      ${(bible?.chapter_summaries || []).length ? raw(html`
        <section class="bp-card">
          <h2 class="bb-section-title">What the book already established</h2>
          <p class="bp-small bp-muted" style="margin:0 0 var(--bp-4)">
            Written automatically as chapters land. The Writer reads this before every new chapter,
            which is what stops it introducing the same idea twice.
          </p>
          <ol class="bb-summaries">
            ${raw(bible.chapter_summaries.map((summary) => html`
              <li><strong>${summary.title}</strong><p>${summary.summary}</p></li>`).join(""))}
          </ol>
        </section>`) : ""}

      <div class="bb-sticky-actions">
        <button type="submit" class="bp-btn bp-btn--primary bp-btn--lg">Save the Book Bible</button>
      </div>
    </form>
  `;

  delegate(mount, "click", {
    async generate(trigger) {
      if (hasContent) {
        const ok = await confirmDialog({
          title: "Rewrite the Book Bible?",
          message: "Your notes and the chapter summaries are kept. The voice, vocabulary and claims are replaced.",
          confirmLabel: "Rewrite",
        });
        if (!ok) return;
      }
      setBusy(trigger, true, trigger.dataset.busy || "Writing…");
      try {
        const result = await BB.generateBible(project.id, bible?.notes || "");
        await refreshAccount().catch(() => {});
        notify.success("The Book Bible is written. Edit anything that isn't right.");
        paintBible(mount, project, result.bible);
      } catch (err) {
        notify.error(err.message);
        setBusy(trigger, false);
      }
    },
  });

  mount.querySelector("#bible-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('button[type="submit"]');
    const values = formData(event.target);
    setBusy(button, true, "Saving…");
    try {
      await BB.updateBible(project.id, {
        audience: values.audience,
        tone: values.tone,
        writing_style: values.writing_style,
        promise: values.promise,
        transformation: values.transformation,
        visual_style: values.visual_style,
        image_style: values.image_style,
        notes: values.notes,
        voice_rules: splitLines(values.voice_rules),
        key_concepts: splitLines(values.key_concepts),
        brand_colors: (values.brand_colors_text || "")
          .split(",").map((c) => c.trim()).filter((c) => /^#?[0-9a-f]{6}$/i.test(c))
          .map((c) => (c.startsWith("#") ? c : `#${c}`)),
        terminology: splitLines(values.terminology).map((line) => {
          const [term, ...rest] = line.split(":");
          return { term: term.trim(), definition: rest.join(":").trim() };
        }).filter((entry) => entry.term && entry.definition),
      });
      notify.success("Saved. Every generation from here reads it.");
    } catch (err) {
      notify.error(err.message);
    } finally {
      setBusy(button, false);
    }
  });
}

const splitLines = (value) =>
  String(value || "").split("\n").map((line) => line.trim()).filter(Boolean);

function bibleField(name, label, value, hint = "") {
  return html`
    <div class="bp-field">
      <label class="bp-label" for="${name}">${label}</label>
      <input class="bp-input" id="${name}" name="${name}" value="${value || ""}">
      ${hint ? raw(html`<p class="bp-hint">${hint}</p>`) : ""}
    </div>`;
}

function bibleArea(name, label, value, hint = "", rows = 3) {
  return html`
    <div class="bp-field">
      ${label ? raw(html`<label class="bp-label" for="${name}">${label}</label>`) : ""}
      <textarea class="bp-textarea" id="${name}" name="${name}" rows="${rows}">${value || ""}</textarea>
      ${hint ? raw(html`<p class="bp-hint">${hint}</p>`) : ""}
    </div>`;
}

function bibleList(name, label, values, hint = "") {
  return bibleArea(name, label, (values || []).join("\n"), hint, Math.min(10, Math.max(3, (values || []).length + 1)));
}

function pairList(name, label, entries, keyField, valueField, hint = "") {
  const text = (entries || []).map((entry) => `${entry[keyField]}: ${entry[valueField]}`).join("\n");
  return bibleArea(name, label, text, hint, Math.min(12, Math.max(3, (entries || []).length + 1)));
}
