// The chapter editor (spec 10).
//
// Three columns: the book's structure on the left, the writing canvas in
// the middle, the editorial assistant on the right. On a tablet the
// assistant folds under the canvas; on a phone the structure becomes a
// select and the canvas takes the screen.
//
// Two rules this screen keeps, because they are what an author trusts:
//
//   1. Nothing the AI produces is saved over the author's text without
//      them accepting it. A revision arrives as a proposal beside the
//      original, and "Use this" is a button they press.
//   2. Every save that changes the text keeps the previous one. The
//      version list is not a feature, it is the safety net that makes
//      the rest of the screen usable without fear.

import { html, raw, $, delegate, setBusy } from "../../core/dom.js";
import { BB } from "../../core/builder-api.js";
import { notify, confirmDialog } from "../../core/toast.js";
import { navigate } from "../../core/router.js";
import { refreshAccount } from "../../core/session.js";
import {
  projectHeader, agentPanel, manuscriptPreview, scoreBar, fmt, costBadge,
} from "./shared.js";
import { demoBadge } from "../shared.js";

// The assistant's standing commands (spec 10). Each is a plain
// instruction to the Book Writer, phrased the way an author would.
const COMMANDS = [
  ["Make this more engaging.", "More engaging"],
  ["Add a real-world example that the author could plausibly have.", "Add an example"],
  ["Explain this for a reader new to the subject.", "Explain for beginners"],
  ["Make this sound more authoritative without adding claims.", "More authoritative"],
  ["Reduce repetition.", "Reduce repetition"],
  ["Tighten this. Same substance, fewer words.", "Tighten"],
  ["Expand this where it is thin.", "Expand"],
  ["Add an exercise the reader can do.", "Add an exercise"],
  ["Add a short case study, marking what the author must supply.", "Add a case study"],
  ["Add key takeaways at the end.", "Add takeaways"],
];

let state = {
  chapterId: null,
  dirty: false,
  proposal: null,
  autosave: null,
};

export async function render(container, params) {
  const data = await BB.project(params.id);
  const { project, chapters = [] } = data;
  const body = chapters.filter((c) => c.include !== false);

  if (!body.length) {
    container.innerHTML = html`
      ${raw(projectHeader(project, { active: "write" }))}
      <div class="bp-empty">
        <div class="bp-empty__icon">✎</div>
        <div class="bp-empty__title">No chapters to write yet</div>
        <p class="bp-empty__text">Design the book first — the Writer needs to know what each chapter is for.</p>
        <a class="bp-btn bp-btn--primary" href="#/studio/${project.id}/blueprint">Build the blueprint</a>
      </div>`;
    return;
  }

  const wanted = params.chapterId
    || body.find((c) => c.kind !== "front" && !(c.word_count || 0))?.id
    || body.find((c) => c.kind !== "front")?.id
    || body[0].id;

  if (!params.chapterId) {
    navigate(`/studio/${project.id}/write/${wanted}`, { replace: true });
    return;
  }

  const { chapter, versions = [], visuals = [] } = await BB.chapter(project.id, params.chapterId);

  container.innerHTML = html`
    ${raw(projectHeader(project, {
      active: "write",
      actions: `${demoBadge()}<a class="bp-btn bp-btn--secondary bp-btn--sm"
        href="#/studio/${project.id}/preview?chapter=${chapter.id}">Preview the page</a>`,
    }))}

    <div class="bb-editor">
      <aside class="bb-editor__structure">
        <div class="bb-editor__structure-head">
          <span>Structure</span>
          <span class="bp-tiny bp-subtle">${body.length}</span>
        </div>
        <label class="bp-sr-only" for="chapter-jump">Jump to a section</label>
        <select class="bp-select bb-editor__jump" id="chapter-jump">
          ${raw(body.map((item) => html`<option value="${item.id}" ${item.id === chapter.id ? "selected" : ""}>
            ${item.number ? `${item.number}. ` : ""}${item.title}</option>`).join(""))}
        </select>
        <nav class="bb-editor__list">
          ${raw(body.map((item) => {
            const pct = item.target_words
              ? Math.min(100, Math.round(((item.word_count || 0) / item.target_words) * 100))
              : (item.word_count ? 100 : 0);
            return html`<a class="bb-editor__item ${item.id === chapter.id ? "bb-editor__item--active" : ""}"
                 href="#/studio/${project.id}/write/${item.id}">
              <span class="bb-editor__item-number">${item.number ?? (item.kind === "front" ? "◦" : "·")}</span>
              <span class="bb-editor__item-title">${item.title}</span>
              <span class="bb-editor__item-bar"><i style="width:${pct}%"></i></span>
            </a>`;
          }).join(""))}
        </nav>
      </aside>

      <main class="bb-editor__canvas">
        <div class="bb-editor__toolbar">
          <div class="bp-row" style="gap:6px">
            <button type="button" class="bp-btn bp-btn--primary bp-btn--sm" data-action="save">Save</button>
            <button type="button" class="bp-btn bp-btn--ghost bp-btn--sm" data-action="undo" title="Undo">↶</button>
            <button type="button" class="bp-btn bp-btn--ghost bp-btn--sm" data-action="redo" title="Redo">↷</button>
            <span class="bb-editor__divider" aria-hidden="true"></span>
            <button type="button" class="bp-btn bp-btn--ghost bp-btn--sm" data-action="insert" data-insert="## ">Heading</button>
            <button type="button" class="bp-btn bp-btn--ghost bp-btn--sm" data-action="insert" data-insert="> ">Quote</button>
            <button type="button" class="bp-btn bp-btn--ghost bp-btn--sm" data-action="insert" data-insert="- ">List</button>
            <details class="bb-menu">
              <summary class="bp-btn bp-btn--ghost bp-btn--sm">Insert</summary>
              <div class="bb-menu__list">
                <button type="button" class="bb-menu__item" data-action="insert"
                        data-insert=":::callout Note\n\n:::">Callout</button>
                <button type="button" class="bb-menu__item" data-action="insert"
                        data-insert=":::exercise Try this\n\n:::">Exercise</button>
                <button type="button" class="bb-menu__item" data-action="insert"
                        data-insert=":::case Case study\n\n:::">Case study</button>
                <button type="button" class="bb-menu__item" data-action="insert"
                        data-insert=":::checklist Checklist\n- \n:::">Checklist</button>
                <button type="button" class="bb-menu__item" data-action="insert"
                        data-insert=":::takeaways Key takeaways\n- \n:::">Key takeaways</button>
                <button type="button" class="bb-menu__item" data-action="insert"
                        data-insert="[[visual: what the figure shows]]">Figure anchor</button>
                <button type="button" class="bb-menu__item" data-action="insert" data-insert="\n---\n">Scene break</button>
              </div>
            </details>
          </div>
          <div class="bp-row" style="gap:10px">
            <span class="bb-editor__count" id="word-count">${fmt.number(chapter.word_count || 0)} words</span>
            <button type="button" class="bp-btn bp-btn--ghost bp-btn--sm" data-action="toggle-preview">Preview</button>
          </div>
        </div>

        <div class="bb-editor__title-row">
          <input class="bb-editor__title" id="chapter-title" value="${chapter.title}"
                 maxlength="300" aria-label="Chapter title">
          <span class="bb-editor__target">
            ${chapter.target_words ? `${fmt.number(chapter.target_words)} word budget` : "no budget set"}
          </span>
        </div>

        ${chapter.purpose ? raw(html`
          <p class="bb-editor__purpose"><strong>Purpose:</strong> ${chapter.purpose}</p>`) : ""}

        <textarea class="bb-editor__text" id="manuscript" spellcheck="true"
                  placeholder="Write here, or ask the Book Writer for a first draft.">${chapter.content || ""}</textarea>

        <div class="bb-editor__preview" id="preview" hidden>
          ${raw(manuscriptPreview(chapter.content, { visuals }))}
        </div>

        <div id="proposal"></div>

        ${!String(chapter.content || "").trim() ? raw(agentPanel({
          agent: "Book Writer",
          title: `Draft “${chapter.title}”`,
          description:
            "Written to this chapter's purpose and word budget, in the voice the Book Bible sets, " +
            "knowing what the chapters either side of it do.",
          operation: "chapter_write",
          action: "write",
          label: "Write this chapter",
          busyLabel: "Writing…",
        })) : ""}
      </main>

      <aside class="bb-editor__assistant">
        <div class="bb-assistant__head">
          <span class="bb-agent__mark" aria-hidden="true"></span>
          <div>
            <div class="bb-agent__name">Editorial assistant</div>
            <p class="bp-tiny bp-subtle">Select text to work on a passage, or leave it to work on the whole chapter.</p>
          </div>
        </div>

        <div class="bb-assistant__commands">
          ${raw(COMMANDS.map(([instruction, label]) => html`
            <button type="button" class="bb-assistant__command" data-action="revise"
                    data-instruction="${instruction}">${label}</button>`).join(""))}
        </div>

        <div class="bp-field" style="margin-top:var(--bp-4)">
          <label class="bp-label" for="custom-instruction">Ask for something else</label>
          <textarea class="bp-textarea" id="custom-instruction" rows="2"
                    placeholder="Make the opening less abstract."></textarea>
          <button type="button" class="bp-btn bp-btn--secondary bp-btn--sm bp-btn--block"
                  style="margin-top:var(--bp-2)" data-action="revise-custom">
            Revise ${raw(costBadge("chapter_revise"))}
          </button>
        </div>

        <div class="bb-assistant__section">
          <button type="button" class="bp-btn bp-btn--secondary bp-btn--sm bp-btn--block"
                  data-action="continue" data-busy="Writing…">Continue writing</button>
          <button type="button" class="bp-btn bp-btn--secondary bp-btn--sm bp-btn--block"
                  style="margin-top:var(--bp-2)" data-action="review" data-busy="Reading…">
            Editorial review ${raw(costBadge("editorial_review"))}
          </button>
          <button type="button" class="bp-btn bp-btn--secondary bp-btn--sm bp-btn--block"
                  style="margin-top:var(--bp-2)" data-action="visuals" data-busy="Looking…">
            Suggest figures ${raw(costBadge("visual_direction"))}
          </button>
        </div>

        <div id="review-panel">${raw(reviewPanel(chapter))}</div>

        ${visuals.length ? raw(html`
          <div class="bb-assistant__section">
            <h4 class="bb-side-title">Figures in this chapter</h4>
            <ul class="bb-assistant__visuals">
              ${raw(visuals.map((visual) => html`
                <li><strong>${visual.title || visual.kind}</strong>
                  <span class="bp-tiny bp-subtle">${visual.kind.replace(/_/g, " ")}</span></li>`).join(""))}
            </ul>
            <a class="bp-small" href="#/studio/${project.id}/visuals">Open the figures</a>
          </div>`) : ""}

        <div class="bb-assistant__section">
          <h4 class="bb-side-title">Versions</h4>
          ${versions.length
            ? raw(html`<ul class="bb-versions">
                ${raw(versions.slice(0, 8).map((version) => html`
                  <li class="bb-versions__item">
                    <div>
                      <strong>v${version.version}</strong>
                      <span class="bp-tiny bp-subtle">${version.label || version.action}</span>
                      <div class="bp-tiny bp-subtle">${fmt.relativeTime(version.created_at)} · ${fmt.number(version.word_count)} words</div>
                    </div>
                    <button type="button" class="bp-btn bp-btn--ghost bp-btn--sm"
                            data-action="restore" data-version="${version.id}">Restore</button>
                  </li>`).join(""))}
              </ul>`)
            : raw('<p class="bp-tiny bp-subtle">No earlier versions yet. One is kept every time the text changes.</p>')}
        </div>

        <p class="bp-tiny bp-subtle" style="margin-top:var(--bp-4)">
          This chapter is never used to train a model, ours or anyone else's — see <a href="/#faq-manuscript" target="_blank" rel="noopener noreferrer">how we handle it</a>.
        </p>
      </aside>
    </div>
  `;

  wire(container, project, chapter, visuals);
}

function reviewPanel(chapter) {
  const quality = chapter.quality;
  if (!quality) return "";
  const scores = quality.scores || {};
  return html`
    <div class="bb-assistant__section bb-review">
      <div class="bp-row bp-row--between">
        <h4 class="bb-side-title" style="margin:0">Editorial review</h4>
        <span class="bp-tiny bp-subtle">${fmt.relativeTime(quality.reviewed_at)}</span>
      </div>
      <div class="bp-stack-sm" style="margin-top:var(--bp-3)">
        ${raw(scoreBar("Clarity", scores.clarity))}
        ${raw(scoreBar("Structure", scores.structure))}
        ${raw(scoreBar("Readability", scores.readability))}
        ${raw(scoreBar("Consistency", scores.consistency))}
        ${raw(scoreBar("Practical value", scores.practical_value))}
        ${raw(scoreBar("Freshness", scores.originality_review))}
      </div>
      <p class="bp-tiny bp-subtle" style="margin-top:var(--bp-2)">
        Freshness is an editorial judgement, not a plagiarism or copyright check.
      </p>
      ${quality.verdict ? raw(html`<p class="bp-small" style="margin-top:var(--bp-3)">${quality.verdict}</p>`) : ""}

      ${(quality.recommendations || []).length ? raw(html`
        <ul class="bb-recommendations">
          ${raw(quality.recommendations.map((rec) => html`
            <li class="bb-recommendations__item bb-recommendations__item--${rec.severity}">
              <div class="bb-recommendations__where">${rec.where}</div>
              <div class="bb-recommendations__issue">${rec.issue}</div>
              <div class="bb-recommendations__action">${rec.action}</div>
              <button type="button" class="bp-btn bp-btn--ghost bp-btn--sm" data-action="revise"
                      data-instruction="${rec.action}">Apply with AI</button>
            </li>`).join(""))}
        </ul>`) : ""}

      ${(quality.claims_to_check || []).length ? raw(html`
        <div class="bb-claims">
          <h5>Claims to check</h5>
          <ul>
            ${raw(quality.claims_to_check.map((claim) => html`
              <li><strong>${claim.claim}</strong><span>${claim.why}</span></li>`).join(""))}
          </ul>
        </div>`) : ""}

      ${(quality.consistency_notes || []).length ? raw(html`
        <div class="bb-claims">
          <h5>Against the Book Bible</h5>
          <ul>${raw(quality.consistency_notes.map((note) => html`<li>${note}</li>`).join(""))}</ul>
        </div>`) : ""}
    </div>
  `;
}

function wire(container, project, chapter, visuals) {
  const textarea = $("#manuscript", container);
  const preview = $("#preview", container);
  const counter = $("#word-count", container);
  const titleInput = $("#chapter-title", container);

  state = { chapterId: chapter.id, dirty: false, proposal: null, autosave: null };

  const countWords = (text) => {
    const plain = String(text || "")
      .replace(/^:::.*$/gm, " ")
      .replace(/\[\[.*?\]\]/g, " ")
      .replace(/[#>*_-]/g, " ")
      .trim();
    return plain ? plain.split(/\s+/).length : 0;
  };

  const markDirty = () => {
    state.dirty = true;
    counter.textContent = `${fmt.number(countWords(textarea.value))} words · unsaved`;
    counter.classList.add("bb-editor__count--dirty");
  };

  const save = async ({ quiet = false } = {}) => {
    if (!state.dirty) return;
    const patch = { content: textarea.value };
    if (titleInput.value.trim() && titleInput.value !== chapter.title) {
      patch.title = titleInput.value.trim();
    }
    const updated = await BB.updateChapter(project.id, chapter.id, patch);
    state.dirty = false;
    chapter.content = textarea.value;
    chapter.title = patch.title || chapter.title;
    counter.textContent = `${fmt.number(updated.chapter?.word_count ?? countWords(textarea.value))} words`;
    counter.classList.remove("bb-editor__count--dirty");
    if (!quiet) notify.success("Saved.");
  };

  textarea.addEventListener("input", () => {
    markDirty();
    // Autosave after a pause. The previous text is versioned server-side
    // on every content change, so an autosave can never lose a draft.
    clearTimeout(state.autosave);
    state.autosave = setTimeout(() => save({ quiet: true }).catch(() => {}), 4000);
  });
  titleInput.addEventListener("input", markDirty);

  $("#chapter-jump", container)?.addEventListener("change", async (event) => {
    if (state.dirty) await save({ quiet: true }).catch(() => {});
    navigate(`/studio/${project.id}/write/${event.target.value}`);
  });

  // Leaving with unsaved text is the one thing this screen must not do
  // quietly.
  window.addEventListener("beforeunload", (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });

  const selection = () => {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    if (end - start < 20) return null;
    return { text: textarea.value.slice(start, end), start, end };
  };

  const showProposal = (result, selected) => {
    state.proposal = { ...result, selected };
    $("#proposal", container).innerHTML = html`
      <section class="bb-proposal">
        <div class="bb-proposal__head">
          <div>
            <div class="bb-agent__name">Book Writer</div>
            <h3 class="bb-proposal__title">${selected ? "Revised passage" : "Revised chapter"}</h3>
          </div>
          <span class="bp-badge bp-badge--primary">Not applied yet</span>
        </div>
        ${result.what_changed ? raw(html`<p class="bb-proposal__note">${result.what_changed}</p>`) : ""}
        <div class="bb-proposal__body">${raw(manuscriptPreview(result.content, { visuals }))}</div>
        ${result.notes_for_author ? raw(html`
          <p class="bb-proposal__author-note"><strong>For you:</strong> ${result.notes_for_author}</p>`) : ""}
        <div class="bp-row">
          <button type="button" class="bp-btn bp-btn--primary bp-btn--sm" data-action="accept">Use this</button>
          <button type="button" class="bp-btn bp-btn--ghost bp-btn--sm" data-action="discard">Keep mine</button>
        </div>
      </section>`;
    $("#proposal", container).scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const revise = async (trigger, instruction) => {
    if (!textarea.value.trim()) {
      notify.error("There is nothing to revise yet.");
      return;
    }
    if (state.dirty) await save({ quiet: true }).catch(() => {});
    const selected = selection();
    setBusy(trigger, true, "Revising…");
    try {
      const result = await BB.revise({
        chapter_id: chapter.id,
        instruction,
        passage: selected?.text,
      });
      await refreshAccount().catch(() => {});
      showProposal(result, selected);
    } catch (err) {
      notify.error(err.message);
    } finally {
      setBusy(trigger, false);
    }
  };

  delegate(container, "click", {
    async save(trigger) {
      setBusy(trigger, true, "Saving…");
      try {
        state.dirty = true;
        await save();
      } catch (err) {
        notify.error(err.message);
      } finally {
        setBusy(trigger, false);
      }
    },

    undo() { document.execCommand("undo"); textarea.focus(); },
    redo() { document.execCommand("redo"); textarea.focus(); },

    insert(trigger) {
      const snippet = trigger.dataset.insert.replace(/\\n/g, "\n");
      const start = textarea.selectionStart;
      const before = textarea.value.slice(0, start);
      const after = textarea.value.slice(textarea.selectionEnd);
      const padded = before && !before.endsWith("\n\n") ? `${before.replace(/\n*$/, "")}\n\n` : before;
      textarea.value = `${padded}${snippet}${after}`;
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = padded.length + snippet.indexOf("\n\n") + 2 || padded.length + snippet.length;
      markDirty();
    },

    "toggle-preview"(trigger) {
      const showing = !preview.hidden;
      if (showing) {
        preview.hidden = true;
        textarea.hidden = false;
        trigger.textContent = "Preview";
      } else {
        preview.innerHTML = manuscriptPreview(textarea.value, { visuals });
        preview.hidden = false;
        textarea.hidden = true;
        trigger.textContent = "Edit";
      }
    },

    async write(trigger) {
      setBusy(trigger, true, "Writing…");
      try {
        const result = await BB.writeChapter(chapter.id);
        await refreshAccount().catch(() => {});
        textarea.value = result.chapter.content;
        state.dirty = false;
        counter.textContent = `${fmt.number(result.chapter.word_count)} words`;
        counter.classList.remove("bb-editor__count--dirty");
        if (result.placeholders?.length) {
          notify.info(`${result.placeholders.length} place${result.placeholders.length === 1 ? "" : "s"} marked for your own material.`);
        }
        notify.success("First draft written. It's yours to change.");
        trigger.closest(".bb-agent")?.remove();
      } catch (err) {
        notify.error(err.message);
        setBusy(trigger, false);
      }
    },

    revise(trigger) { revise(trigger, trigger.dataset.instruction); },

    "revise-custom"(trigger) {
      const instruction = $("#custom-instruction", container).value.trim();
      if (!instruction) {
        notify.error("Say what you'd like changed.");
        return;
      }
      revise(trigger, instruction);
    },

    async continue(trigger) {
      if (state.dirty) await save({ quiet: true }).catch(() => {});
      setBusy(trigger, true, trigger.dataset.busy || "Writing…");
      try {
        const result = await BB.continueChapter(chapter.id);
        await refreshAccount().catch(() => {});
        textarea.value = `${textarea.value.replace(/\s*$/, "")}\n\n${result.content}`;
        markDirty();
        await save({ quiet: true });
        notify.success("Continued. Read it before you keep going.");
      } catch (err) {
        notify.error(err.message);
      } finally {
        setBusy(trigger, false);
      }
    },

    accept() {
      const proposal = state.proposal;
      if (!proposal) return;
      if (proposal.selected) {
        textarea.value =
          textarea.value.slice(0, proposal.selected.start) +
          proposal.content +
          textarea.value.slice(proposal.selected.end);
      } else {
        textarea.value = proposal.content;
      }
      markDirty();
      $("#proposal", container).innerHTML = "";
      state.proposal = null;
      save().catch((err) => notify.error(err.message));
    },

    discard() {
      $("#proposal", container).innerHTML = "";
      state.proposal = null;
    },

    async review(trigger) {
      if (state.dirty) await save({ quiet: true }).catch(() => {});
      setBusy(trigger, true, trigger.dataset.busy || "Reading…");
      try {
        const result = await BB.review(chapter.id);
        await refreshAccount().catch(() => {});
        chapter.quality = result.quality;
        $("#review-panel", container).innerHTML = reviewPanel(chapter);
        notify.success("Reviewed.");
      } catch (err) {
        notify.error(err.message);
      } finally {
        setBusy(trigger, false);
      }
    },

    async visuals(trigger) {
      if (state.dirty) await save({ quiet: true }).catch(() => {});
      setBusy(trigger, true, trigger.dataset.busy || "Looking…");
      try {
        const result = await BB.directVisuals(chapter.id);
        await refreshAccount().catch(() => {});
        notify.success(`${result.visuals.length} figures suggested.`);
        navigate(`/studio/${project.id}/visuals?chapter=${chapter.id}`);
      } catch (err) {
        notify.error(err.message);
        setBusy(trigger, false);
      }
    },

    async restore(trigger) {
      const ok = await confirmDialog({
        title: "Restore this version?",
        message: "The text on screen is kept as a new version first, so nothing is lost either way.",
        confirmLabel: "Restore",
      });
      if (!ok) return;
      try {
        const result = await BB.restoreChapterVersion(chapter.id, trigger.dataset.version);
        textarea.value = result.chapter.content || "";
        state.dirty = false;
        counter.textContent = `${fmt.number(result.chapter.word_count)} words`;
        notify.success(`Restored version ${result.restored}.`);
      } catch (err) {
        notify.error(err.message);
      }
    },
  });

  // Ctrl/Cmd+S saves, because everyone tries it.
  textarea.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      state.dirty = true;
      save().catch((err) => notify.error(err.message));
    }
  });
}
