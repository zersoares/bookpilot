// Creative Factory, library and detail (spec §13, §14, §27).

import { html, raw, $, setBusy } from "../core/dom.js";
import { API, isDemo } from "../core/api.js";
import * as store from "../core/store.js";
import { notify, confirmDialog, openModal } from "../core/toast.js";
import { navigate } from "../core/router.js";
import { refreshAccount } from "../core/session.js";
import { FORMATS, PLATFORMS } from "./options.js";
import { CREATIVE_TEMPLATES, creativeFromTemplate, sampleImagePath } from "./creative-templates.js";
import { pageHead, emptyState, scoreBadge, fmt, demoBadge, loading, bullets, creativePreview } from "./shared.js";

const FORMAT_LABEL = Object.fromEntries(FORMATS.map((f) => [f.value, f.label]));

// ---------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------

export async function renderLibrary(container, params, query) {
  const [{ creatives }, { books }] = await Promise.all([API.creatives(), API.books()]);
  store.set({ creatives, books });
  const bookById = new Map(books.map((b) => [b.id, b]));

  if (!creatives.length) {
    container.innerHTML =
      pageHead({
        title: "Creative library",
        description: "Every creative stays linked to the book, reader and angle it was written for.",
      }) +
      emptyState({
        icon: "◐",
        title: "No creatives yet",
        text: "Pick an angle and BookPilot will write the copy and art-direct the visual.",
        action: books.length
          ? '<a class="bp-btn bp-btn--primary" href="#/creatives/new">Create ads</a>'
            + '<a class="bp-btn bp-btn--secondary" href="#/creatives/templates" '
            + 'style="margin-left:var(--bp-2)">Start from a template</a>'
          : '<a class="bp-btn bp-btn--primary" href="#/books/new">Add a book first</a>',
      });
    return;
  }

  const bookFilter = query?.get("book") || "";
  container.innerHTML = html`
    ${raw(pageHead({
      title: "Creative library",
      description: "Filter, preview, score, duplicate — then put the good ones in a campaign.",
      actions: `${demoBadge()}<a class="bp-btn bp-btn--secondary" href="#/creatives/templates">Templates</a>`
        + `<a class="bp-btn bp-btn--primary" href="#/creatives/new" style="margin-left:var(--bp-2)">Create ads</a>`,
    }))}

    <div class="bp-row bp-row--wrap" style="margin-bottom:var(--bp-5);gap:var(--bp-2)">
      <select class="bp-select" id="filter-book" style="width:auto">
        <option value="">All books</option>
        ${raw(books.map((b) => html`<option value="${b.id}" ${b.id === bookFilter ? "selected" : ""}>${b.title}</option>`).join(""))}
      </select>
      <select class="bp-select" id="filter-format" style="width:auto">
        <option value="">All formats</option>
        ${raw(FORMATS.map((f) => html`<option value="${f.value}">${f.label}</option>`).join(""))}
      </select>
      <select class="bp-select" id="filter-platform" style="width:auto">
        <option value="">All platforms</option>
        ${raw(PLATFORMS.map((p) => html`<option value="${p.value}">${p.label}</option>`).join(""))}
      </select>
      <select class="bp-select" id="filter-sort" style="width:auto">
        <option value="recent">Newest first</option>
        <option value="score">Highest score first</option>
      </select>
    </div>

    <div class="bp-grid bp-grid--cards" id="creative-grid"></div>
  `;

  const paint = () => {
    const book = $("#filter-book").value;
    const format = $("#filter-format").value;
    const platform = $("#filter-platform").value;
    const sort = $("#filter-sort").value;

    let list = creatives.filter(
      (c) =>
        (!book || c.book_id === book) &&
        (!format || c.format === format) &&
        (!platform || c.platform === platform)
    );
    list = sort === "score"
      ? [...list].sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
      : [...list].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

    $("#creative-grid").innerHTML = list.length
      ? list.map((c) => creativeCard(c, bookById.get(c.book_id))).join("")
      : `<div style="grid-column:1/-1">${emptyState({
          icon: "◇",
          title: "Nothing matches those filters",
          text: "Try widening them, or create a new set of ads.",
          action: '<a class="bp-btn bp-btn--secondary" href="#/creatives/new">Create ads</a>',
        })}</div>`;
  };

  ["#filter-book", "#filter-format", "#filter-platform", "#filter-sort"].forEach((selector) =>
    $(selector).addEventListener("change", paint)
  );
  paint();
}

function creativeCard(creative, book) {
  return html`
    <article class="bp-card bp-card--flush bp-card--interactive bp-creative">
      ${raw(creativePreview(creative, { label: FORMAT_LABEL[creative.format] || creative.format, book }))}
      <div class="bp-creative__body">
        <p class="bp-small bp-muted bp-clamp-3" style="margin:0">${creative.primary_text || ""}</p>
        <div class="bp-row bp-row--between">
          ${raw(scoreBadge(creative.score))}
          <span class="bp-tiny bp-subtle">${fmt.platformName(creative.platform)}</span>
        </div>
        <div class="bp-creative__footer">
          <a class="bp-btn bp-btn--secondary bp-btn--sm" href="#/creatives/${creative.id}">Open</a>
        </div>
      </div>
    </article>
  `;
}

// ---------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------

export async function renderFactory(container, params, query) {
  const { books } = await API.books();
  if (!books.length) {
    container.innerHTML =
      pageHead({ title: "Create ads" }) +
      emptyState({
        icon: "▤",
        title: "Add a book first",
        text: "Creatives are written from a book's angles, so there has to be a book.",
        action: '<a class="bp-btn bp-btn--primary" href="#/books/new">Add a book</a>',
      });
    return;
  }

  const bookId = query?.get("book") || books[0].id;
  const preselectedAngle = query?.get("angle") || "";
  const strategy = await API.strategy(bookId);

  container.innerHTML = html`
    ${raw(pageHead({
      title: "Create ads",
      description: "Pick the angle, the platform and the format. BookPilot writes the copy and art-directs the visual.",
      actions: demoBadge(),
    }))}

    ${raw(!strategy.angles.length
      ? emptyState({
          icon: "◑",
          title: "This book has no angles yet",
          text: "Creatives are built from a marketing angle so you always know what each one was testing.",
          action: `<a class="bp-btn bp-btn--primary" href="#/strategy/${bookId}">Generate angles</a>`,
        })
      : html`
      <form class="bp-card" id="factory-form" style="max-width:720px">
        <div class="bp-field">
          <label class="bp-label" for="book">Book</label>
          <select class="bp-select" id="book" name="book">
            ${raw(books.map((b) => html`<option value="${b.id}" ${b.id === bookId ? "selected" : ""}>${b.title}</option>`).join(""))}
          </select>
        </div>

        <div class="bp-field">
          <label class="bp-label" for="angle">Marketing angle</label>
          <select class="bp-select" id="angle" name="angle">
            ${raw(strategy.angles.map((a) => html`<option value="${a.id}" ${a.id === preselectedAngle ? "selected" : ""}>${a.name}</option>`).join(""))}
          </select>
          <div class="bp-hint" id="angle-hook"></div>
        </div>

        <div class="bp-field">
          <label class="bp-label" for="platform">Platform</label>
          <select class="bp-select" id="platform" name="platform">
            ${raw(PLATFORMS.map((p) => html`<option value="${p.value}">${p.label}</option>`).join(""))}
          </select>
        </div>

        <div class="bp-field">
          <label class="bp-label">Format</label>
          <div class="bp-grid bp-grid--3">
            ${raw(FORMATS.map((f, index) => html`
              <label class="bp-radio">
                <input type="radio" name="format" value="${f.value}" ${index === 0 ? "checked" : ""}>
                <span><strong class="bp-small">${f.label}</strong><br><span class="bp-tiny bp-subtle">${f.hint}</span></span>
              </label>`).join(""))}
          </div>
        </div>

        <div class="bp-field">
          <label class="bp-label" for="count">How many variations?</label>
          <select class="bp-select" id="count" name="count" style="width:auto">
            <option value="1">1</option>
            <option value="2" selected>2</option>
            <option value="3">3</option>
          </select>
          <div class="bp-hint">Different approaches, not reworded versions of the same one.</div>
        </div>

        <div class="bp-alert bp-alert--info">
          <span class="bp-alert__icon">◆</span>
          <div class="bp-small">
            BookPilot writes the copy and the art direction for each creative. Rendering the image or
            video is not available on this deployment yet, so you'll get a brief you can hand to a
            designer or an image tool — clearly marked, rather than a placeholder pretending to be
            finished artwork.
          </div>
        </div>

        <div class="bp-wizard__footer">
          <a class="bp-btn bp-btn--ghost" href="#/creatives">Cancel</a>
          <button type="submit" class="bp-btn bp-btn--primary">Generate creatives</button>
        </div>
      </form>
      <div id="factory-results" style="margin-top:var(--bp-8)"></div>`)}
  `;

  if (!strategy.angles.length) return;

  const showHook = () => {
    const angle = strategy.angles.find((a) => a.id === $("#angle").value);
    $("#angle-hook").textContent = angle?.hook ? `“${angle.hook}”` : "";
  };
  $("#angle").addEventListener("change", showHook);
  showHook();

  $("#book").addEventListener("change", (event) => {
    navigate(`/creatives/new?book=${event.target.value}`);
  });

  $("#factory-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('button[type="submit"]');
    const format = event.target.querySelector('input[name="format"]:checked').value;
    const payload = {
      book_id: $("#book").value,
      angle_id: $("#angle").value,
      platform: $("#platform").value,
      format,
      count: Number($("#count").value),
    };
    setBusy(button, true, "Writing…");
    $("#factory-results").innerHTML = loading(2);
    try {
      const result = format === "video_script"
        ? await API.generateVideoScript({ ...payload, duration: 30 })
        : await API.generateCreatives(payload);
      const created = result.creatives || [result.creative];
      await refreshAccount();
      $("#factory-results").innerHTML = html`
        <div class="bp-row bp-row--between" style="margin-bottom:var(--bp-4)">
          <h2 style="font-size:1.05rem">${created.length} new ${created.length === 1 ? "creative" : "creatives"}</h2>
          <a class="bp-small" href="#/creatives">Creative library →</a>
        </div>
        <div class="bp-grid bp-grid--cards">${raw(created.map((c) => creativeCard(c, books.find((b) => b.id === c.book_id))).join(""))}</div>
      `;
      notify.success("Creatives ready.");
    } catch (err) {
      $("#factory-results").innerHTML = "";
      notify.error(err.message);
    }
    setBusy(button, false);
  });
}

// ---------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------

export async function renderDetail(container, params) {
  const { creative } = await API.creative(params.id);
  const [{ book }, strategy] = await Promise.all([
    API.book(creative.book_id),
    API.strategy(creative.book_id).catch(() => ({ angles: [], personas: [] })),
  ]);
  const angle = strategy.angles.find((a) => a.id === creative.angle_id);
  const persona = strategy.personas.find((p) => p.id === creative.persona_id);
  const slides = creative.body?.slides || [];
  const beats = creative.body?.beats || [];

  container.innerHTML = html`
    <div class="bp-row bp-row--between" style="margin-bottom:var(--bp-5)">
      <a class="bp-small bp-muted" href="#/creatives">← Creative library</a>
      ${raw(demoBadge())}
    </div>

    <div class="bp-grid" style="grid-template-columns:minmax(0,320px) minmax(0,1fr);align-items:start;gap:var(--bp-8)">
      <div class="bp-stack">
        <div class="bp-card bp-card--flush bp-creative">
          ${raw(creativePreview(creative, {
            label: FORMAT_LABEL[creative.format] || creative.format,
            tall: creative.format === "reel" || creative.format === "story",
            book,
          }))}
        </div>
        <div class="bp-card">
          <div class="bp-card__header">
            <div class="bp-card__title">Predicted quality</div>
            ${raw(scoreBadge(creative.score))}
          </div>
          ${raw(creative.score === null || creative.score === undefined
            ? `<p class="bp-small bp-muted">Not scored yet.</p>
               <button type="button" class="bp-btn bp-btn--primary bp-btn--sm bp-btn--block" id="score-btn">Score this creative · 1 credit</button>`
            : scorePanel(creative))}
          <p class="bp-tiny bp-subtle" style="margin-top:var(--bp-3)">
            A judgement about the creative before it runs — hook, clarity, audience fit. It is not a
            prediction of sales. Only campaign data can tell you that.
          </p>
        </div>
      </div>

      <div class="bp-stack-lg">
        <section class="bp-card">
          <div class="bp-card__header">
            <div class="bp-card__title">Copy</div>
            <span class="bp-badge">${fmt.platformName(creative.platform)}</span>
          </div>
          <dl class="bp-kv">
            <dt>Headline</dt><dd>${creative.headline || "—"}</dd>
            <dt>Primary text</dt><dd class="bp-pre-wrap">${creative.primary_text || "—"}</dd>
            <dt>Description</dt><dd>${creative.description || "—"}</dd>
            <dt>Call to action</dt><dd>${creative.cta || "—"}</dd>
          </dl>
        </section>

        ${creative.visual_prompt ? raw(html`
          <section class="bp-card">
            <div class="bp-card__title" style="margin-bottom:var(--bp-3)">Art direction</div>
            <p class="bp-small bp-muted bp-pre-wrap">${creative.visual_prompt}</p>
          </section>`) : ""}

        ${slides.length ? raw(html`
          <section class="bp-card">
            <div class="bp-card__title" style="margin-bottom:var(--bp-3)">Slides</div>
            <div class="bp-stack-sm">
              ${raw(slides.map((slide) => html`
                <div class="bp-panel">
                  <div class="bp-eyebrow">${slide.label || ""}</div>
                  <div class="bp-small" style="margin-top:4px"><strong>${slide.text || ""}</strong></div>
                  <div class="bp-tiny bp-subtle" style="margin-top:4px">${slide.visual || ""}</div>
                </div>`).join(""))}
            </div>
          </section>`) : ""}

        ${beats.length ? raw(html`
          <section class="bp-card">
            <div class="bp-card__title" style="margin-bottom:var(--bp-3)">Script</div>
            <div class="bp-table-wrap">
              <table class="bp-table">
                <thead><tr><th>Timing</th><th>Voiceover</th><th>On screen</th><th>Visual</th></tr></thead>
                <tbody>${raw(beats.map((beat) => html`<tr>
                  <td class="bp-nowrap">${beat.timing || ""}</td>
                  <td>${beat.voiceover || ""}</td>
                  <td>${beat.on_screen || ""}</td>
                  <td class="bp-small bp-muted">${beat.visual || ""}</td>
                </tr>`).join(""))}</tbody>
              </table>
            </div>
          </section>`) : ""}

        <section class="bp-card">
          <div class="bp-card__title" style="margin-bottom:var(--bp-3)">Context</div>
          <dl class="bp-kv">
            <dt>Book</dt><dd><a href="#/books/${book.id}">${book.title}</a></dd>
            <dt>Angle</dt><dd>${angle?.name || "—"}</dd>
            <dt>Reader</dt><dd>${persona?.name || "—"}</dd>
            <dt>Status</dt><dd>${fmt.titleCase(creative.status)}</dd>
            <dt>Created</dt><dd>${fmt.date(creative.created_at, { withTime: true })}</dd>
          </dl>
        </section>

        <div class="bp-row bp-row--wrap">
          <button type="button" class="bp-btn bp-btn--secondary bp-btn--sm" id="edit-btn">Edit copy</button>
          <button type="button" class="bp-btn bp-btn--secondary bp-btn--sm" id="duplicate-btn">Duplicate</button>
          ${creative.body?.social_post ? "" : raw(html`
            <button type="button" class="bp-btn bp-btn--secondary bp-btn--sm" id="variation-btn">Create variation</button>`)}
          ${creative.body?.social_post ? raw(html`
            <button type="button" class="bp-btn bp-btn--ghost bp-btn--sm" id="copy-caption-btn">Copy caption</button>
            <button type="button" class="bp-btn bp-btn--ghost bp-btn--sm" id="download-image-btn">
              Download image (${creative.body.size?.width}×${creative.body.size?.height})
            </button>`) : ""}
          <button type="button" class="bp-btn bp-btn--ghost bp-btn--sm" id="download-btn">Download brief</button>
          ${creative.body?.social_post ? "" : raw(html`
            <a class="bp-btn bp-btn--ghost bp-btn--sm" href="#/campaigns/new?book=${book.id}&creative=${creative.id}">Add to campaign</a>`)}
          <button type="button" class="bp-btn bp-btn--danger bp-btn--sm" id="delete-btn">Delete</button>
        </div>
        ${creative.body?.social_post ? raw(html`
          <p class="bp-tiny bp-subtle">
            No platform here connects to BookPilot for publishing — copy the caption and download the
            image, then post it yourself from your ${fmt.platformName(creative.platform)} account.
          </p>`) : ""}
      </div>
    </div>
  `;

  $("#score-btn")?.addEventListener("click", async (event) => {
    setBusy(event.currentTarget, true, "Reviewing…");
    try {
      await API.scoreCreative(creative.id);
      await refreshAccount();
      renderDetail(container, params);
    } catch (err) {
      notify.error(err.message);
      setBusy(event.currentTarget, false);
    }
  });

  $("#edit-btn").addEventListener("click", () => openEditor(creative, () => renderDetail(container, params)));

  $("#duplicate-btn").addEventListener("click", async () => {
    const { creative: copy } = await API.createCreative({
      book_id: creative.book_id,
      angle_id: creative.angle_id,
      persona_id: creative.persona_id,
      platform: creative.platform,
      format: creative.format,
      headline: creative.headline,
      primary_text: creative.primary_text,
      description: creative.description,
      cta: creative.cta,
      visual_prompt: creative.visual_prompt,
      body: creative.body,
    });
    notify.success("Duplicated.");
    navigate(`/creatives/${copy.id}`);
  });

  $("#copy-caption-btn")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(creative.primary_text || "");
      notify.success("Caption copied.");
    } catch {
      notify.error("Couldn't reach the clipboard — select and copy the text by hand.");
    }
  });

  $("#download-image-btn")?.addEventListener("click", (event) => downloadSocialImage(creative, event.currentTarget));

  $("#variation-btn")?.addEventListener("click", async (event) => {
    setBusy(event.currentTarget, true, "Writing…");
    try {
      const { creatives } = await API.generateCreatives({
        book_id: creative.book_id,
        angle_id: creative.angle_id,
        platform: creative.platform,
        format: creative.format,
        count: 1,
      });
      await refreshAccount();
      notify.success("Variation created.");
      if (creatives?.[0]) navigate(`/creatives/${creatives[0].id}`);
    } catch (err) {
      notify.error(err.message);
      setBusy(event.currentTarget, false);
    }
  });

  $("#download-btn").addEventListener("click", () => downloadCreative(creative, book));

  $("#delete-btn").addEventListener("click", async () => {
    const confirmed = await confirmDialog({
      title: "Delete this creative?",
      message: "It will be removed from the library. Campaigns already using it keep their results.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) return;
    await API.deleteCreative(creative.id);
    notify.success("Creative deleted.");
    navigate("/creatives");
  });
}

function scorePanel(creative) {
  const detail = creative.score_detail || {};
  const dimensions = detail.dimensions || {};
  const labels = {
    hook_strength: "Hook strength", clarity: "Clarity", emotional_impact: "Emotional impact",
    relevance: "Relevance", cta_strength: "CTA strength", audience_fit: "Audience fit",
    visual_concept: "Visual concept", differentiation: "Differentiation",
  };
  return html`
    <div class="bp-score-bars" style="margin-top:var(--bp-3)">
      ${raw(Object.entries(labels).map(([key, label]) => {
        const value = dimensions[key];
        if (value === undefined) return "";
        return html`<div class="bp-score-bar">
          <span class="bp-subtle">${label}</span>
          <span class="bp-progress"><span class="bp-progress__bar" style="width:${value}%"></span></span>
          <span class="bp-right">${value}</span>
        </div>`;
      }).join(""))}
    </div>
    ${detail.strengths?.length ? raw(html`
      <div style="margin-top:var(--bp-4)">
        <div class="bp-eyebrow">Working</div>
        ${raw(bullets(detail.strengths))}
      </div>`) : ""}
    ${detail.improvements?.length ? raw(html`
      <div style="margin-top:var(--bp-3)">
        <div class="bp-eyebrow">Could be stronger</div>
        ${raw(bullets(detail.improvements))}
      </div>`) : ""}
  `;
}

function openEditor(creative, onSaved) {
  const { root, close } = openModal(
    html`
      <div class="bp-modal__header"><h3>Edit copy</h3></div>
      <form id="edit-form">
        <div class="bp-field">
          <label class="bp-label" for="e-headline">Headline</label>
          <input class="bp-input" id="e-headline" name="headline" maxlength="300" value="${creative.headline || ""}">
        </div>
        <div class="bp-field">
          <label class="bp-label" for="e-primary">Primary text</label>
          <textarea class="bp-textarea" id="e-primary" name="primary_text" rows="5" maxlength="4000">${creative.primary_text || ""}</textarea>
        </div>
        <div class="bp-field">
          <label class="bp-label" for="e-description">Description</label>
          <input class="bp-input" id="e-description" name="description" maxlength="1000" value="${creative.description || ""}">
        </div>
        <div class="bp-field">
          <label class="bp-label" for="e-cta">Call to action</label>
          <input class="bp-input" id="e-cta" name="cta" maxlength="120" value="${creative.cta || ""}">
        </div>
        <div class="bp-modal__footer">
          <button type="button" class="bp-btn bp-btn--ghost" data-close>Cancel</button>
          <button type="submit" class="bp-btn bp-btn--primary">Save</button>
        </div>
      </form>`,
    { wide: false }
  );

  root.querySelector("#edit-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('button[type="submit"]');
    setBusy(button, true, "Saving…");
    try {
      await API.updateCreative(creative.id, {
        headline: root.querySelector("#e-headline").value,
        primary_text: root.querySelector("#e-primary").value,
        description: root.querySelector("#e-description").value,
        cta: root.querySelector("#e-cta").value,
      });
      notify.success("Saved.");
      close();
      onSaved();
    } catch (err) {
      notify.error(err.message);
      setBusy(button, false);
    }
  });
}

/**
 * Download the creative as a plain text brief. Exporting what BookPilot
 * actually produced — copy plus art direction — is honest; offering a
 * "download image" button for artwork that was never rendered would not
 * be.
 */
function downloadCreative(creative, book) {
  const lines = [
    `BOOKPILOT AI — CREATIVE BRIEF${isDemo() ? " (DEMO DATA)" : ""}`,
    "",
    `Book:      ${book.title}`,
    `Platform:  ${creative.platform}`,
    `Format:    ${FORMAT_LABEL[creative.format] || creative.format}`,
    creative.score !== null && creative.score !== undefined
      ? `Score:     ${creative.score}/100 (predicted quality, not a sales forecast)`
      : "",
    "",
    "HEADLINE",
    creative.headline || "—",
    "",
    "PRIMARY TEXT",
    creative.primary_text || "—",
    "",
    "DESCRIPTION",
    creative.description || "—",
    "",
    "CALL TO ACTION",
    creative.cta || "—",
    "",
    "ART DIRECTION",
    creative.visual_prompt || "—",
  ];

  for (const slide of creative.body?.slides || []) {
    lines.push("", `${slide.label || "Slide"}: ${slide.text || ""}`, `  Visual: ${slide.visual || ""}`);
  }
  for (const beat of creative.body?.beats || []) {
    lines.push("", `${beat.timing || ""}`, `  VO: ${beat.voiceover || ""}`,
      `  On screen: ${beat.on_screen || ""}`, `  Visual: ${beat.visual || ""}`);
  }

  const blob = new Blob([lines.filter((l) => l !== "").join("\n")], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `bookpilot-creative-${creative.id.slice(0, 8)}.txt`;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Export a social post's background art at the exact pixel size its
 * network crops to (spec: creative.body.size, set by socialPostFromTemplate).
 * Same-origin sample art only — no book cover baked in, so there is
 * nothing here to taint the canvas with a cross-origin image.
 */
async function downloadSocialImage(creative, button) {
  const size = creative.body?.size;
  const mediaUrl = creative.media_url;
  if (!size?.width || !size?.height || !mediaUrl) return;
  setBusy(button, true, "Preparing…");
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("The image didn't load."));
      el.src = mediaUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    const scale = Math.max(size.width / img.naturalWidth, size.height / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    ctx.drawImage(img, (size.width - w) / 2, (size.height - h) / 2, w, h);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Could not render the image.");
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `bookpilot-${creative.platform}-${creative.id.slice(0, 8)}.png`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    notify.error(err.message || "Couldn't download the image.");
  }
  setBusy(button, false);
}

// ---------------------------------------------------------------------
// Starter templates (spec §13 — the empty-library path)
// ---------------------------------------------------------------------

/**
 * A gallery of ad structures that write a draft creative directly. No
 * generation, no credits: the draft opens in the editor pre-filled from
 * the book, with bracketed gaps where only the author can decide.
 */
/** A template's sample image, with this book's cover and headline on it. */
function templatePreview(template, book) {
  const headline = template.build(book || {}).headline || "";
  return creativePreview(
    {
      format: template.format,
      media_url: sampleImagePath(template.id),
      // Some templates open with a bracketed gap for the author to fill; show the name instead.
      headline: headline.startsWith("[") ? template.name : headline,
    },
    { label: FORMAT_LABEL[template.format] || template.format, book },
  );
}

export async function renderTemplates(container, params, query) {
  const { books } = await API.books();
  store.set({ books });

  if (!books.length) {
    container.innerHTML =
      pageHead({ title: "Templates", description: "Ready-made ad structures, filled in from your book." }) +
      emptyState({
        icon: "◇",
        title: "Add a book first",
        text: "Templates pull the title, subtitle, price and description straight from the book they are for.",
        action: '<a class="bp-btn bp-btn--primary" href="#/books/new">Add a book</a>',
      });
    return;
  }

  const preselected = query?.get("book") || books[0].id;

  container.innerHTML = html`
    ${raw(pageHead({
      title: "Templates",
      description: "Proven ad structures, pre-filled from your book. No AI credits are spent — pick one and edit it.",
      actions: `${demoBadge()}<a class="bp-btn bp-btn--secondary" href="#/creatives">Back to library</a>`,
    }))}

    <div class="bp-row bp-row--wrap" style="margin-bottom:var(--bp-5);gap:var(--bp-2);align-items:center">
      <label class="bp-label" for="template-book" style="margin:0">Book</label>
      <select class="bp-select" id="template-book" style="width:auto">
        ${raw(books.map((b) => html`<option value="${b.id}" ${b.id === preselected ? "selected" : ""}>${b.title}</option>`).join(""))}
      </select>
    </div>

    <div class="bp-grid bp-grid--cards">
      ${raw(CREATIVE_TEMPLATES.map((t) => html`
        <article class="bp-card bp-card--flush bp-creative">
          <div data-preview="${t.id}">${raw(templatePreview(t, books.find((b) => b.id === preselected)))}</div>
          <div class="bp-creative__body">
            <div class="bp-row" style="justify-content:space-between;align-items:flex-start;gap:var(--bp-2)">
              <h3 style="margin:0;font-size:1.02rem">${t.name}</h3>
              <span class="bp-badge">${FORMAT_LABEL[t.format] || t.format}</span>
            </div>
            <p class="bp-small bp-subtle" style="margin:0">${t.blurb}</p>
            <div class="bp-creative__footer">
              <button type="button" class="bp-btn bp-btn--secondary bp-btn--sm" data-template="${t.id}">
                Use this template
              </button>
            </div>
          </div>
        </article>`).join(""))}
    </div>
  `;

  // The sample images are generic; the book's own cover and headline go on top,
  // so picking a different book shows what that book's ad would look like.
  $("#template-book").addEventListener("change", () => {
    const book = books.find((b) => b.id === $("#template-book").value);
    container.querySelectorAll("[data-preview]").forEach((slot) => {
      const t = CREATIVE_TEMPLATES.find((x) => x.id === slot.dataset.preview);
      if (t) slot.innerHTML = templatePreview(t, book);
    });
  });

  container.querySelectorAll("[data-template]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      const template = CREATIVE_TEMPLATES.find((t) => t.id === button.dataset.template);
      const book = books.find((b) => b.id === $("#template-book").value);
      if (!template || !book) return;

      const btn = event.currentTarget;
      setBusy(btn, true, "Creating…");
      try {
        const { creative } = await API.createCreative(creativeFromTemplate(template, book));
        notify.success("Draft created from template.");
        navigate(`/creatives/${creative.id}`);
      } catch (error) {
        notify.error(error.message || "Could not create the draft.");
      } finally {
        setBusy(btn, false);
      }
    });
  });
}
