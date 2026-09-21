// The cover template gallery on the Create a book page.
//
// A scrollable column of cover designs to start from. Each is drawn by the same
// renderer the Cover step uses (coverPreview), so what is picked here is what
// appears there. The choice travels with the form as a radio group, so the
// arrow keys, screen readers and "no choice yet" all work without special code.

import { html, raw } from "../../core/dom.js";
import { COVER_TEMPLATES, templateGenreCounts, sampleCover, coverTemplateById } from "../../core/cover-templates.js";
import { coverPreview } from "./cover-render.js";

const FORM = "new-book"; // the wizard's form; the radios live beside it, not inside it

function tile(template, { author, selected }) {
  return html`
    <label class="bb-tpl ${selected ? "bb-tpl--selected" : ""}" data-template="${template.id}" data-genres="${template.genres.join("|")}">
      <input class="bb-tpl__input" type="radio" name="cover_template" value="${template.id}" form="${FORM}"
             ${selected ? "checked" : ""} aria-label="${template.name}">
      <span class="bb-tpl__cover">${raw(coverPreview(sampleCover(template, { author }), { width: 132 }))}</span>
      <span class="bb-tpl__name">${template.name}</span>
      <span class="bb-tpl__mood">${template.genres.slice(0, 2).join(" · ")}</span>
    </label>`;
}

export function coverGallery({ selected = "", author = "" } = {}) {
  const genres = templateGenreCounts();
  return html`
    <aside class="bb-tpl-panel" aria-labelledby="bb-tpl-title">
      <div class="bb-tpl-panel__head">
        <h2 class="bb-tpl-panel__title" id="bb-tpl-title">Cover templates</h2>
        <p class="bb-tpl-panel__lead">
          ${COVER_TEMPLATES.length} designs to start from. Scroll to browse and pick the one that
          fits your book. You can change it later, or use AI concepts instead.
        </p>
        <div class="bb-tpl-filters" role="group" aria-label="Filter by kind of book">
          <button type="button" class="bb-tpl-chip bb-tpl-chip--active" data-genre="" aria-pressed="true">All</button>
          ${raw(genres.map(([g, n]) => html`<button type="button" class="bb-tpl-chip" data-genre="${g}" aria-pressed="false">${g} <span class="bb-tpl-chip__n">${n}</span></button>`).join(""))}
        </div>
      </div>

      <div class="bb-tpl-list" tabindex="0" role="region" aria-label="Cover templates. Scroll to see more.">
        <label class="bb-tpl bb-tpl--none ${selected ? "" : "bb-tpl--selected"}" data-template="" data-genres="*">
          <input class="bb-tpl__input" type="radio" name="cover_template" value="" form="${FORM}"
                 ${selected ? "" : "checked"} aria-label="No template, decide later">
          <span class="bb-tpl__blank"><strong>No template</strong><span>Decide on the cover later</span></span>
        </label>
        ${raw(COVER_TEMPLATES.map((t) => tile(t, { author, selected: t.id === selected })).join(""))}
      </div>

      <p class="bb-tpl-panel__status" role="status" aria-live="polite" data-tpl-status></p>
    </aside>`;
}

export function bindCoverGallery(root) {
  const panel = root.querySelector(".bb-tpl-panel");
  if (!panel) return;
  const status = panel.querySelector("[data-tpl-status]");
  const tiles = [...panel.querySelectorAll(".bb-tpl")];
  const chips = [...panel.querySelectorAll(".bb-tpl-chip")];
  const list = panel.querySelector(".bb-tpl-list");

  const announce = () => {
    const checked = panel.querySelector(".bb-tpl__input:checked");
    const template = coverTemplateById(checked?.value);
    status.textContent = template ? `Selected: ${template.name}.` : "No template selected.";
  };

  // Selection: mark the chosen tile (the radios already hold the value).
  panel.addEventListener("change", (event) => {
    if (!event.target.classList.contains("bb-tpl__input")) return;
    tiles.forEach((t) => t.classList.toggle("bb-tpl--selected", t.contains(event.target) && event.target.checked));
    announce();
  });

  // Filtering by kind of book. The "no template" tile is always kept.
  chips.forEach((chip) => chip.addEventListener("click", () => {
    const genre = chip.dataset.genre;
    chips.forEach((c) => {
      const on = c === chip;
      c.classList.toggle("bb-tpl-chip--active", on);
      c.setAttribute("aria-pressed", String(on));
    });
    let shown = 0;
    tiles.forEach((t) => {
      const match = !genre || t.dataset.genres === "*" || t.dataset.genres.split("|").includes(genre);
      t.hidden = !match;
      if (match && t.dataset.template) shown += 1;
    });
    list.scrollTo?.({ top: 0 });
    status.textContent = genre ? `Showing ${shown} ${shown === 1 ? "template" : "templates"} for ${genre}.` : `Showing all ${COVER_TEMPLATES.length} templates.`;
  }));

  // The author's name goes on the thumbnails as they type it: the quickest way
  // to see whether a design suits it. Only the text changes, so nothing reloads.
  const authorInput = root.querySelector("#author_name");
  authorInput?.addEventListener("input", () => {
    const name = authorInput.value.trim() || "Author Name";
    panel.querySelectorAll(".bb-cover__author").forEach((el) => { el.textContent = name; });
  });

}
