// Social Posts gallery — organic, one-per-network templates (spec: the
// "post/share to Instagram, Facebook, LinkedIn, TikTok, X, Bluesky" ask).
//
// This is a standalone feature, deliberately separate from the Creative
// library: picking a template opens a self-contained composer right here
// (caption + correctly-sized image + share/copy/download actions). Nothing
// is written to the creatives table, nothing opens the creative editor, and
// there is no cross-link between the two — they are two different options,
// not one funnelling into the other.
//
// None of the six networks has a publish API BookPilot is connected to, so
// "share" means one of two honest things: a network's own web share-intent
// (a popup window pre-filled with the text/link, which the person still
// has to post from) where the network offers one, or the device's native
// share sheet (Web Share API) where the browser supports it. The rest get
// "copy the caption and download the image, then post from the app"
// instead of a fake share button.

import { html, raw, $ } from "../core/dom.js";
import { API } from "../core/api.js";
import * as store from "../core/store.js";
import { notify, openModal } from "../core/toast.js";
import { SOCIAL_TEMPLATES, PLATFORM_SIZES, sizeLabel } from "./social-templates.js";
import { pageHead, emptyState, demoBadge } from "./shared.js";
import {
  bookImage, imageBoxMarkup, bgSwatchesMarkup, positionControlsMarkup, textFieldsMarkup, wireImageBox,
  downloadPostImage, defaultBgFor, ensureBookMockup3D, saveComposerState, loadComposerState,
} from "./post-image.js";

// Networks with a real web share-intent URL: a popup pre-filled with text
// (and a link, where the network accepts one) that the person still sends
// themselves. Facebook and LinkedIn's intents only accept a URL, not text,
// so those two need the book's sales link to be worth showing at all.
const SHARE_INTENTS = {
  x: ({ text, url }) => `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}${url ? `&url=${encodeURIComponent(url)}` : ""}`,
  bluesky: ({ text, url }) => `https://bsky.app/intent/compose?text=${encodeURIComponent(url ? `${text}\n\n${url}` : text)}`,
  facebook: ({ url }) => (url ? `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}` : ""),
  linkedin: ({ url }) => (url ? `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}` : ""),
};

function openShareWindow(url) {
  window.open(url, "_blank", "noopener,width=600,height=640");
}

// A photographed studio backdrop per network by default — the mood each
// one's brand and post style suggests — with every other backdrop and the
// plain colours still one click away in the composer (bgSwatchesMarkup).
const PLATFORM_BG = {
  instagram: "/assets/social/bg/bg-04-blush-pastel.webp",
  facebook: "/assets/social/bg/bg-15-cool-blue.webp",
  linkedin: "/assets/social/bg/bg-13-grey-pedestal.webp",
  tiktok: "/assets/social/bg/bg-11-navy-spotlight.webp",
  x: "/assets/social/bg/bg-05-concrete-corner.webp",
  bluesky: "/assets/social/bg/bg-12-sunlit-curtain.webp",
};

function socialPreview(template, book) {
  const bg = defaultBgFor(book, PLATFORM_BG[template.platform]);
  return imageBoxMarkup({ label: PLATFORM_SIZES[template.platform].label, book, initialBg: bg, height: 300 });
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
  await ensureBookMockup3D(books.find((b) => b.id === preselected));

  container.innerHTML = html`
    ${raw(pageHead({
      title: "Social posts",
      description: "A caption and a correctly-sized image for each network, pre-filled from your book. "
        + "Nothing publishes on its own: copy the caption, download the image, and post it yourself — or use "
        + "a share button where the network supports one.",
      actions: demoBadge(),
    }))}

    <div class="bp-row bp-row--wrap" style="margin-bottom:var(--bp-5);gap:var(--bp-2);align-items:center">
      <label class="bp-label" for="social-book" style="margin:0">Book</label>
      <select class="bp-select" id="social-book" style="width:auto">
        ${raw(books.map((b) => html`<option value="${b.id}" ${b.id === preselected ? "selected" : ""}>${b.title}</option>`).join(""))}
      </select>
    </div>

    <div class="bp-grid bp-grid--cards">
      ${raw(SOCIAL_TEMPLATES.map((t) => html`
        <article class="bp-card bp-card--flush bp-creative bp-creative--tone-${t.platform}">
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
                Create this post
              </button>
            </div>
          </div>
        </article>`).join(""))}
    </div>
  `;

  // The backdrop is generic per network; the selected book's own picture
  // goes on top, so switching books here shows what that book's post looks like.
  $("#social-book").addEventListener("change", async () => {
    const book = books.find((b) => b.id === $("#social-book").value);
    await ensureBookMockup3D(book);
    container.querySelectorAll("[data-preview]").forEach((slot) => {
      const t = SOCIAL_TEMPLATES.find((x) => x.id === slot.dataset.preview);
      if (t) slot.innerHTML = socialPreview(t, book);
    });
  });

  container.querySelectorAll("[data-template]").forEach((button) => {
    button.addEventListener("click", async () => {
      const template = SOCIAL_TEMPLATES.find((t) => t.id === button.dataset.template);
      const book = books.find((b) => b.id === $("#social-book").value);
      if (!template || !book) return;
      await ensureBookMockup3D(book);
      openComposer(template, book);
    });
  });
}

function openComposer(template, book) {
  const built = template.build(book || {});
  const caption = [built.primary_text, built.hashtags?.length ? built.hashtags.join(" ") : ""]
    .filter(Boolean)
    .join("\n\n");
  const size = PLATFORM_SIZES[template.platform];
  const { url: bookImageUrl, isMockup } = bookImage(book);
  const shareUrl = book?.sales_url || "";
  const hasIntent = template.platform in SHARE_INTENTS;
  const intentUrl = hasIntent ? SHARE_INTENTS[template.platform]({ text: caption, url: shareUrl }) : "";
  const intentNeedsLink = hasIntent && !intentUrl;
  const canDeviceShare = typeof navigator.share === "function";

  // A saved session (background, book position/size/angle, text) beats the
  // template's own defaults — the author already decided how they want this
  // one to look.
  const saved = loadComposerState(book, template.id);
  const initialBg = saved?.bg || defaultBgFor(book, PLATFORM_BG[template.platform]);
  const initialHeadline = saved?.headline ?? (built.headline?.startsWith("[") ? "" : (built.headline || ""));
  const initialSubtext = saved?.subtext ?? (book?.subtitle || "");

  const { root, close } = openModal(
    html`
      <div class="bp-modal__header"><h3>${template.name}</h3></div>
      <div class="bp-stack">
        <div class="bp-card bp-card--flush bp-creative" style="border-radius:var(--bp-radius, 8px);overflow:hidden">
          ${raw(imageBoxMarkup({ label: PLATFORM_SIZES[template.platform].label, book, initialBg, initialHeadline, initialSubtext }))}
        </div>

        ${raw(bgSwatchesMarkup(initialBg))}
        ${raw(positionControlsMarkup())}
        ${raw(textFieldsMarkup(initialHeadline, initialSubtext))}

        <div class="bp-field">
          <label class="bp-label" for="post-caption">Caption</label>
          <textarea class="bp-textarea" id="post-caption" rows="7">${caption}</textarea>
        </div>
        <p class="bp-tiny bp-subtle">${sizeLabel(template.platform)}</p>

        <div class="bp-row bp-row--wrap" style="gap:var(--bp-2)">
          <button type="button" class="bp-btn bp-btn--secondary bp-btn--sm" data-copy>Copy caption</button>
          <button type="button" class="bp-btn bp-btn--secondary bp-btn--sm" data-download>
            Download image (${size.width}×${size.height})
          </button>
          ${canDeviceShare ? raw(html`<button type="button" class="bp-btn bp-btn--secondary bp-btn--sm" data-device-share>Share…</button>`) : ""}
          <button type="button" class="bp-btn bp-btn--primary bp-btn--sm" data-save-composer>Save changes</button>
        </div>
        ${saved ? raw(html`<p class="bp-tiny bp-subtle">Restored from your last save.</p>`) : ""}

        ${hasIntent ? raw(html`
          <div class="bp-row bp-row--wrap" style="gap:var(--bp-2)">
            <button type="button" class="bp-btn bp-btn--primary bp-btn--sm" data-intent-share ${intentNeedsLink ? "disabled" : ""}
              title="${intentNeedsLink ? "Add your book's sales link on the book's edit page to enable this." : ""}">
              Share to ${PLATFORM_SIZES[template.platform].label}
            </button>
          </div>
          ${intentNeedsLink ? raw(html`<p class="bp-tiny bp-subtle">Add your book's sales link to enable one-click sharing here.</p>`) : ""}
        `) : raw(html`
          <p class="bp-tiny bp-subtle">
            ${PLATFORM_SIZES[template.platform].label} doesn't offer a direct web-share link — copy the caption
            and download the image above, then post them from the app.
          </p>
        `)}

        <div class="bp-modal__footer">
          <button type="button" class="bp-btn bp-btn--ghost" data-close>Close</button>
        </div>
      </div>
    `,
    { wide: false }
  );

  root.querySelector("[data-copy]").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(root.querySelector("#post-caption").value);
      notify.success("Caption copied.");
    } catch {
      notify.error("Couldn't reach the clipboard — select and copy the text by hand.");
    }
  });

  const { getBg, getHeadline, getSubtext, getExtraLines, getOffset, getScale, getRotate, getImageUrl, applyState } =
    wireImageBox(root, { initialBg, book });
  applyState(saved);

  root.querySelector("[data-download]").addEventListener("click", (event) =>
    downloadPostImage(getBg(), getImageUrl() || bookImageUrl, isMockup, getHeadline(), getSubtext(), size, `bookpilot-${template.platform}-${template.id}.png`, event.currentTarget,
      { offset: getOffset(), scale: getScale(), extraLines: getExtraLines() })
  );

  root.querySelector("[data-save-composer]").addEventListener("click", () => {
    saveComposerState(book, template.id, {
      bg: getBg(), headline: getHeadline(), subtext: getSubtext(), extraLines: getExtraLines(),
      offset: getOffset(), scale: getScale(), rotate: getRotate(),
    });
    notify.success("Saved — this will be here next time you open this post.");
  });

  root.querySelector("[data-intent-share]")?.addEventListener("click", () => {
    if (!intentUrl) return;
    openShareWindow(SHARE_INTENTS[template.platform]({ text: root.querySelector("#post-caption").value, url: shareUrl }));
  });

  root.querySelector("[data-device-share]")?.addEventListener("click", async () => {
    try {
      await navigator.share({
        title: template.name,
        text: root.querySelector("#post-caption").value,
        ...(shareUrl ? { url: shareUrl } : {}),
      });
    } catch (err) {
      if (err?.name !== "AbortError") notify.error("Couldn't open the share sheet.");
    }
  });
}
