// Social Posts gallery — organic, one-per-network templates (spec: the
// "post/share to Instagram, Facebook, LinkedIn, TikTok, X, Bluesky" ask).
// Picking one writes a draft creative into the same library the paid-ad
// templates use, tagged `body.social_post: true`, so it gets the same
// editor, the same "Copy caption" / "Download image" pair (see
// downloadSocialImage in creatives.js) and the same detail page — just
// without a campaign attached, since none of these six platforms has a
// publish connection.

import { html, raw, $ } from "../core/dom.js";
import { API } from "../core/api.js";
import * as store from "../core/store.js";
import { notify } from "../core/toast.js";
import { navigate } from "../core/router.js";
import { SOCIAL_TEMPLATES, PLATFORM_SIZES, sizeLabel, sampleImagePath, socialPostFromTemplate } from "./social-templates.js";
import { pageHead, emptyState, demoBadge, creativePreview } from "./shared.js";

function socialPreview(template, book) {
  const built = template.build(book || {});
  const headline = built.headline || "";
  const size = PLATFORM_SIZES[template.platform];
  return creativePreview(
    {
      format: "static",
      media_url: sampleImagePath(template.id),
      headline: headline.startsWith("[") ? template.name : headline,
    },
    // Every card the same box (`aspect: "gallery"`, a fixed height rather
    // than each network's own aspect ratio) so six very different post
    // shapes — square-ish feed post next to 9:16 video cover — still read
    // as one gallery instead of a ragged row of mismatched heights. The
    // real size is in the ×px label under the card, not the box shape.
    // `coverPosition: "hero"` centres the book large, the way an actual
    // book-launch post shows it, rather than the small ad-template corner
    // thumbnail, which reads as a watermark at this box height.
    { label: size.label, aspect: "gallery", coverPosition: "hero", book },
  );
}

export async function renderGallery(container, params, query) {
  const { books } = await API.books();
  store.set({ books });

  if (!books.length) {
    container.innerHTML =
      pageHead({ title: "Social posts", description: "One template per network, each sized to what that network actually shows." }) +
      emptyState({
        icon: "◒",
        title: "Add a book first",
        text: "A post pulls the title, subtitle, price and description straight from the book it's for.",
        action: '<a class="bp-btn bp-btn--primary" href="#/books/new">Add a book</a>',
      });
    return;
  }

  const preselected = query?.get("book") || books[0].id;

  container.innerHTML = html`
    ${raw(pageHead({
      title: "Social posts",
      description: "A caption and a correctly-sized image for each network, pre-filled from your book. "
        + "No AI credits spent, and nothing publishes on its own — copy the caption, download the image, post it yourself.",
      actions: `${demoBadge()}<a class="bp-btn bp-btn--secondary" href="#/creatives">Creative library</a>`,
    }))}

    <div class="bp-row bp-row--wrap" style="margin-bottom:var(--bp-5);gap:var(--bp-2);align-items:center">
      <label class="bp-label" for="social-book" style="margin:0">Book</label>
      <select class="bp-select" id="social-book" style="width:auto">
        ${raw(books.map((b) => html`<option value="${b.id}" ${b.id === preselected ? "selected" : ""}>${b.title}</option>`).join(""))}
      </select>
    </div>

    <div class="bp-grid bp-grid--cards">
      ${raw(SOCIAL_TEMPLATES.map((t) => html`
        <article class="bp-card bp-card--flush bp-creative">
          <div data-preview="${t.id}">${raw(socialPreview(t, books.find((b) => b.id === preselected)))}</div>
          <div class="bp-creative__body">
            <div class="bp-row" style="justify-content:space-between;align-items:flex-start;gap:var(--bp-2)">
              <h3 style="margin:0;font-size:1.02rem">${t.name}</h3>
              <span class="bp-badge">${PLATFORM_SIZES[t.platform].label}</span>
            </div>
            <p class="bp-small bp-subtle" style="margin:0">${t.blurb}</p>
            <p class="bp-tiny bp-subtle" style="margin:0">${sizeLabel(t.platform)}</p>
            <div class="bp-creative__footer">
              <button type="button" class="bp-btn bp-btn--secondary bp-btn--sm" data-template="${t.id}">
                Use this template
              </button>
            </div>
          </div>
        </article>`).join(""))}
    </div>
  `;

  // Sample art is generic per network; swapping the book updates the headline
  // shown in the preview so it's clear which book the draft will be written for.
  $("#social-book").addEventListener("change", () => {
    const book = books.find((b) => b.id === $("#social-book").value);
    container.querySelectorAll("[data-preview]").forEach((slot) => {
      const t = SOCIAL_TEMPLATES.find((x) => x.id === slot.dataset.preview);
      if (t) slot.innerHTML = socialPreview(t, book);
    });
  });

  container.querySelectorAll("[data-template]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      const template = SOCIAL_TEMPLATES.find((t) => t.id === button.dataset.template);
      const book = books.find((b) => b.id === $("#social-book").value);
      if (!template || !book) return;

      const btn = event.currentTarget;
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Creating…";
      try {
        const { creative } = await API.createCreative(socialPostFromTemplate(template, book));
        notify.success("Draft post created.");
        navigate(`/creatives/${creative.id}`);
      } catch (error) {
        notify.error(error.message || "Could not create the draft.");
        btn.disabled = false;
        btn.textContent = original;
      }
    });
  });
}
