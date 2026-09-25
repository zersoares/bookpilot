// Shared machinery for "a book's picture on a plain background, with
// optional text, that can be downloaded" — used by both the Social Posts
// composer and the Creative Library template composer, so the two stay
// visually consistent and the canvas-export logic exists exactly once.

import { html, raw, safeImageUrl, setBusy } from "../core/dom.js";
import { notify } from "../core/toast.js";
import { getMockup3D, renderMockup3D, getBookAsset, paintMockupAtYaw } from "./book-mockup-3d.js";

// A rendered 3D hardcover mockup (real angled photo of the actual cover,
// transparent background, shadow already lit into the render) for every
// book that has one on disk — this is real product photography, not a
// stock photo with a book pasted on. Keyed by the book's title because
// that is the one stable thing every caller already has in hand.
export const MOCKUP_3D = {
  "Mastering GDPR": "mastering-gdpr",
  "Mastering Claude": "mastering-claude-code",
  "Mastering ChatGPT": "mastering-chatgpt",
  "The Modern Woman's Guide to Starting Over": "modern-womans-guide",
  "AI Cybercrime: The New Digital Threat": "ai-cybercrime",
  "Master Gemini": "mastering-gemini",
  "The Abundance Operating System": "abundance-os",
  "Master Your Mind Before the World Masters Your Attention": "master-your-mind",
  "YOU & AI MASTERMIND": "you-ai-mastermind",
  "YOU + AI": "you-and-ai",
  "YOU Beyond AI": "you-beyond-ai",
  "Unleash Your Inner Girlboss": "unleash-your-inner-girlboss",
  "Money Hack": "money-hacks",
};

/**
 * The best real picture of this book: a curated 3D mockup, a live-rendered
 * one built from its flat cover (see `ensureBookMockup3D` — this is what
 * makes that one available, since the render itself is async and this
 * function isn't), or, failing both, the flat cover itself.
 */
export function bookImage(book) {
  const slug = MOCKUP_3D[book?.title];
  if (slug) return { url: `/assets/covers/3d/${slug}.webp`, isMockup: true };
  const cover = safeImageUrl(book?.cover_url);
  if (cover) {
    const live = getMockup3D(cover);
    if (live) return { url: live, isMockup: true };
  }
  return cover ? { url: cover, isMockup: false } : { url: "", isMockup: false };
}

/**
 * Renders (and caches) a live 3D mockup for this book's flat cover, unless
 * it already has a curated one or a full-art background override — call
 * this and await it before the first `bookImage`/`imageBoxMarkup` for a
 * book, so that call sees the 3D render instead of the flat cover. A
 * render that fails (e.g. the cover URL doesn't allow cross-origin reads)
 * is swallowed here; `bookImage` then falls back to the flat cover exactly
 * as it always has, rather than the caller having to handle the error.
 */
export async function ensureBookMockup3D(book) {
  if (MOCKUP_3D[book?.title] || BOOK_BG_OVERRIDE[book?.title]) return;
  const cover = safeImageUrl(book?.cover_url);
  if (!cover) return;
  try {
    await renderMockup3D(cover);
  } catch {
    // Falls back to the flat cover in bookImage().
  }
}

/**
 * Can this book's picture be spun around? Only true for the live-rendered
 * path (see `ensureBookMockup3D`) — a curated MOCKUP_3D asset and a
 * BOOK_BG_OVERRIDE full-art picture are both a single flat file on disk,
 * photographed/rendered once at a fixed angle, with no textures left to
 * repaint from another side.
 */
export function canRotateBook(book) {
  if (MOCKUP_3D[book?.title] || BOOK_BG_OVERRIDE[book?.title]) return false;
  const cover = safeImageUrl(book?.cover_url);
  return Boolean(cover && getBookAsset(cover));
}

/** Repaint this book's live 3D mockup at `yaw` degrees, or `null` if it can't be rotated. */
export function rotateBookMockup(book, yaw) {
  const cover = safeImageUrl(book?.cover_url);
  const asset = cover && getBookAsset(cover);
  return asset ? paintMockupAtYaw(asset, yaw) : null;
}

// A small studio-colour palette to pick from, in the style of real
// book-mockup backdrops — plain, single colours, nothing busier than that.
export const BG_SWATCHES = ["#e7eef0", "#2f6f6b", "#e8734a", "#1f2937", "#f5efe3", "#5b6b8c", "#7a8c6f", "#c9a267"];

// Photographed studio backdrops — the same idea as the plain colour
// swatches, one step further: a soft gradient, a lit corner, a textured
// surface. Generated once (ComfyUI, ai-disclosure-free — no book, no
// text, no logo in any of them) rather than a stock photo, so nothing
// here was ever "someone else's photoshoot". A path (starts with "/")
// is how `isImageBg` tells one of these from a plain hex colour.
export const BG_IMAGES = [
  "/assets/social/bg/bg-01-cream-studio.webp",
  "/assets/social/bg/bg-02-teal-studio.webp",
  "/assets/social/bg/bg-03-terracotta-glow.webp",
  "/assets/social/bg/bg-04-blush-pastel.webp",
  "/assets/social/bg/bg-05-concrete-corner.webp",
  "/assets/social/bg/bg-06-sage-fabric.webp",
  "/assets/social/bg/bg-07-window-light.webp",
  "/assets/social/bg/bg-08-marble-flatlay.webp",
  "/assets/social/bg/bg-09-linen-tray.webp",
  "/assets/social/bg/bg-10-purple-blocks.webp",
  "/assets/social/bg/bg-11-navy-spotlight.webp",
  "/assets/social/bg/bg-12-sunlit-curtain.webp",
  "/assets/social/bg/bg-13-grey-pedestal.webp",
  "/assets/social/bg/bg-14-paper-texture.webp",
  "/assets/social/bg/bg-15-cool-blue.webp",
  "/assets/social/bg/bg-16-rust-cream-split.webp",
  "/assets/social/bg/bg-17-pastel-ledge.webp",
  "/assets/social/bg/bg-18-green-bokeh.webp",
  "/assets/social/bg/bg-19-sand-glow.webp",
  "/assets/social/bg/bg-20-lavender-band.webp",
];

/** Is this a photographed backdrop (a path, or an uploaded photo) rather than a plain colour? */
export const isImageBg = (bg) =>
  typeof bg === "string" && (bg.startsWith("/") || bg.startsWith("data:image/") || bg.startsWith("blob:"));

// A handful of books ship with one finished hero shot — the cover and its
// backdrop already composed together as a single image (a dramatic angled
// render against a themed backdrop, supplied whole) — rather than the
// cutout-on-a-swappable-background system every other book uses. Keyed by
// title, same as MOCKUP_3D. `defaultBgFor` is what a caller asks instead of
// reading PLATFORM_BG/BG_SWATCHES directly, so this book opens on its own
// picture; `imageBoxMarkup` checks the same map to skip drawing a second,
// separate cutout on top of a picture that already has one baked in.
export const BOOK_BG_OVERRIDE = {
  "Mastering the GDPR — Volume 1: The Regulation": "/assets/covers/3d/mastering-the-gdpr-vol1.webp",
};

/** The background a book should open on: its own finished shot, or `fallback`. */
export function defaultBgFor(book, fallback) {
  return BOOK_BG_OVERRIDE[book?.title] || fallback;
}

// A saved composer session — background, book position/size/angle, headline,
// subtext and any extra text lines — kept in localStorage rather than sent
// anywhere: this is a convenience for coming back to the same post later,
// not a draft on a server. Keyed by book + template, so each network's
// template on each book remembers its own edit.
const SAVE_PREFIX = "bp.postComposer.";

function composerStateKey(book, templateId) {
  return `${SAVE_PREFIX}${book?.id || "book"}:${templateId || "default"}`;
}

/** Save the composer's current state for this book+template. Returns false if storage failed (quota, private mode). */
export function saveComposerState(book, templateId, state) {
  try {
    localStorage.setItem(composerStateKey(book, templateId), JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/** The last-saved state for this book+template, or `null` if there isn't one. */
export function loadComposerState(book, templateId) {
  try {
    const raw = localStorage.getItem(composerStateKey(book, templateId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** The bottom text overlay: a bold headline and a smaller subtext line, either optional. */
function textOverlayMarkup(initialHeadline, initialSubtext) {
  if (!initialHeadline && !initialSubtext) return "";
  return html`
    <div class="bp-social-box__headline" data-headline-overlay>
      ${initialHeadline ? raw(html`<div data-headline-text>${initialHeadline}</div>`) : ""}
      ${initialSubtext ? raw(html`<div class="bp-social-box__subtext" data-subtext-text>${initialSubtext}</div>`) : ""}
    </div>
  `;
}

/**
 * The box markup: background colour, the book's picture centred on it, a
 * label badge, and an optional headline/subtext overlay along the bottom.
 * Callers embed this inside their own modal/card and call `wireImageBox`
 * once it is in the DOM to get the background-swatch and text-input behaviour.
 */
export function imageBoxMarkup({ label, book, initialBg, initialHeadline = "", initialSubtext = "", height = 320 }) {
  // The chosen backdrop IS this book's whole picture already (see
  // BOOK_BG_OVERRIDE) — drawing the normal cutout or "add a cover" link on
  // top of it would just be a second, redundant book.
  const isFullArt = BOOK_BG_OVERRIDE[book?.title] === initialBg;
  const { url, isMockup } = isFullArt ? { url: "", isMockup: false } : bookImage(book);
  const bgStyle = isImageBg(initialBg)
    ? `background-image:url('${initialBg}');background-size:cover;background-position:center`
    : `background:${initialBg}`;
  return html`
    <div class="bp-social-box" data-bg-box style="${bgStyle};height:${height}px">
      ${url
        ? raw(html`<img class="bp-social-box__book${isMockup ? "" : " bp-social-box__book--flat"}" src="${url}" alt="Cover of ${book?.title || "the book"}" loading="lazy" decoding="async">`)
        : (isFullArt ? "" : raw(html`<span class="bp-social-box__nocover">${book?.id ? `<a href="#/books/${book.id}/edit">Add your book cover</a>` : "No cover yet"}</span>`))}
      <span class="bp-badge bp-badge--accent bp-social-box__label">${label}</span>
      ${raw(textOverlayMarkup(initialHeadline, initialSubtext))}
    </div>
  `;
}

/** The swatch row + custom colour wheel, meant to sit under `imageBoxMarkup`. */
export function bgSwatchesMarkup(initialBg) {
  const colorActive = !isImageBg(initialBg);
  return html`
    <div class="bp-field">
      <label class="bp-label">Background</label>
      <div class="bp-row bp-row--wrap" style="gap:8px;align-items:center">
        ${raw(BG_SWATCHES.map((color) => html`
          <button type="button" class="bp-swatch${colorActive && color === initialBg ? " bp-swatch--active" : ""}" data-bg-swatch
            style="background:${color}" data-color="${color}" aria-label="Use this background colour" title="${color}"></button>
        `).join(""))}
        <label class="bp-swatch bp-swatch--custom" title="Pick a custom colour">
          <input type="color" data-bg-custom value="${colorActive ? initialBg : "#e7eef0"}" style="opacity:0;width:100%;height:100%;cursor:pointer">
        </label>
      </div>
      <div class="bp-row bp-row--wrap" style="gap:8px;align-items:center;margin-top:8px">
        ${raw(BG_IMAGES.map((src) => html`
          <button type="button" class="bp-swatch bp-swatch--photo${!colorActive && src === initialBg ? " bp-swatch--active" : ""}" data-bg-swatch
            style="background-image:url('${src}')" data-color="${src}" aria-label="Use this backdrop photo" title="Backdrop photo"></button>
        `).join(""))}
        <label class="bp-swatch bp-swatch--photo bp-swatch--upload" title="Upload your own photo">
          <span aria-hidden="true">+</span>
          <input type="file" accept="image/*" data-bg-upload style="position:absolute;inset:0;opacity:0;cursor:pointer">
        </label>
      </div>
      <p class="bp-tiny bp-subtle" style="margin:6px 0 0" data-upload-hint hidden>Uploaded photos aren't saved anywhere — pick it again next time you open this.</p>
    </div>
  `;
}

/**
 * The book-position controls: a size slider and a reset link, meant to sit
 * under `imageBoxMarkup`. Position itself has no widget — the book is
 * dragged directly in the box above — this is only for what dragging alone
 * can't do (the book too big or small for a given backdrop's "floor").
 */
export function positionControlsMarkup() {
  return html`
    <div class="bp-field">
      <div class="bp-row bp-row--between" style="align-items:center">
        <label class="bp-label" for="post-book-scale" style="margin:0">Book size</label>
        <button type="button" class="bp-small bp-link" data-reset-position>Reset position</button>
      </div>
      <input class="bp-range" id="post-book-scale" type="range" min="0.5" max="1.6" step="0.02" value="1">
      <p class="bp-tiny bp-subtle" style="margin:4px 0 0">Drag the book in the picture above to place it — useful when a backdrop's "floor" doesn't line up with the middle of the box.</p>
    </div>
    <div class="bp-field" data-rotate-row hidden>
      <label class="bp-label" for="post-book-rotate" style="margin:0">Turn the book</label>
      <input class="bp-range" id="post-book-rotate" type="range" min="-180" max="180" step="1" value="30">
      <p class="bp-tiny bp-subtle" style="margin:4px 0 0">Spin it to whichever side shows what you want — the spine, or straight-on.</p>
    </div>
  `;
}

/** The headline + subtext text fields, meant to sit under `bgSwatchesMarkup`. */
export function textFieldsMarkup(initialHeadline, initialSubtext = "") {
  return html`
    <div class="bp-field">
      <label class="bp-label" for="post-headline">Headline on the image <span class="bp-subtle">(optional)</span></label>
      <input class="bp-input" id="post-headline" type="text" maxlength="80" value="${initialHeadline}" placeholder="e.g. Out now">
    </div>
    <div class="bp-field">
      <label class="bp-label" for="post-subtext">Subtext <span class="bp-subtle">(optional)</span></label>
      <input class="bp-input" id="post-subtext" type="text" maxlength="100" value="${initialSubtext}" placeholder="e.g. A practical guide for solo founders">
    </div>
    <div class="bp-field">
      <div class="bp-row bp-row--between" style="align-items:center">
        <label class="bp-label" style="margin:0">Extra text <span class="bp-subtle">(optional)</span></label>
        <button type="button" class="bp-small bp-link" data-add-text>+ Add a line</button>
      </div>
      <div data-extra-lines></div>
    </div>
  `;
}

/**
 * Lets the book in `bookEl` be dragged around inside `box` (its own
 * on-screen picture, not just a description of one). The book starts out
 * centred by ordinary flow layout; the first drag switches it to absolute
 * positioning anchored at wherever it already was, so a book nobody has
 * touched yet still sits exactly where `imageBoxMarkup` put it. The offset
 * this returns is a fraction of the box's own size (how far the book's
 * centre has moved, left/right and up/down, as a share of box width/height)
 * so the same number means the same thing whether it's applied to this
 * small on-screen box or the much larger canvas `downloadPostImage` draws.
 */
function makeBookDraggable(box, bookEl) {
  let dragging = false;
  let start = null;
  let offset = { x: 0, y: 0 };

  const ensureAbsolute = () => {
    if (bookEl.style.position === "absolute") return;
    const boxRect = box.getBoundingClientRect();
    const bookRect = bookEl.getBoundingClientRect();
    bookEl.style.position = "absolute";
    bookEl.style.left = `${bookRect.left - boxRect.left}px`;
    bookEl.style.top = `${bookRect.top - boxRect.top}px`;
    bookEl.style.margin = "0";
  };

  const recomputeOffset = () => {
    const boxRect = box.getBoundingClientRect();
    const bookRect = bookEl.getBoundingClientRect();
    const bookCx = bookRect.left - boxRect.left + bookRect.width / 2;
    const bookCy = bookRect.top - boxRect.top + bookRect.height / 2;
    offset = {
      x: (bookCx - boxRect.width / 2) / boxRect.width,
      y: (bookCy - boxRect.height / 2) / boxRect.height,
    };
  };

  bookEl.addEventListener("pointerdown", (event) => {
    ensureAbsolute();
    dragging = true;
    bookEl.setPointerCapture(event.pointerId);
    start = { x: event.clientX, y: event.clientY, left: parseFloat(bookEl.style.left), top: parseFloat(bookEl.style.top) };
  });
  bookEl.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    bookEl.style.left = `${start.left + (event.clientX - start.x)}px`;
    bookEl.style.top = `${start.top + (event.clientY - start.y)}px`;
    recomputeOffset();
  });
  const stopDragging = () => { dragging = false; };
  bookEl.addEventListener("pointerup", stopDragging);
  bookEl.addEventListener("pointercancel", stopDragging);

  return {
    getOffset: () => offset,
    reset: () => {
      bookEl.style.position = "";
      bookEl.style.left = "";
      bookEl.style.top = "";
      bookEl.style.margin = "";
      offset = { x: 0, y: 0 };
    },
    /** Move the book to a saved offset (fractions of box size) — restoring a save, not a drag. */
    setOffset: (x, y) => {
      ensureAbsolute();
      const boxRect = box.getBoundingClientRect();
      const bookRect = bookEl.getBoundingClientRect();
      const targetCx = boxRect.width / 2 + x * boxRect.width;
      const targetCy = boxRect.height / 2 + y * boxRect.height;
      bookEl.style.left = `${targetCx - bookRect.width / 2}px`;
      bookEl.style.top = `${targetCy - bookRect.height / 2}px`;
      offset = { x, y };
    },
  };
}

/**
 * Wires the swatches, the custom-colour input, the headline/subtext fields
 * and the book's drag-to-reposition + size slider (all already in `root`)
 * to update the box live. Returns `{ getBg, getHeadline, getSubtext,
 * getOffset, getScale }` for the caller's own download handler to read from.
 */
export function wireImageBox(root, { initialBg, book = null }) {
  let currentBg = initialBg;

  const setBg = (color) => {
    currentBg = color;
    const box = root.querySelector("[data-bg-box]");
    if (box) {
      if (isImageBg(color)) {
        box.style.background = "";
        box.style.backgroundImage = `url('${color}')`;
        box.style.backgroundSize = "cover";
        box.style.backgroundPosition = "center";
      } else {
        box.style.backgroundImage = "";
        box.style.background = color;
      }
    }
    root.querySelectorAll("[data-bg-swatch]").forEach((btn) => btn.classList.toggle("bp-swatch--active", btn.dataset.color === color));
  };
  root.querySelectorAll("[data-bg-swatch]").forEach((btn) => btn.addEventListener("click", () => setBg(btn.dataset.color)));
  root.querySelector("[data-bg-custom]")?.addEventListener("input", (event) => setBg(event.target.value));
  root.querySelector("[data-bg-upload]")?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setBg(reader.result);
      const upload = root.querySelector(".bp-swatch--upload");
      if (upload) { upload.style.backgroundImage = `url('${reader.result}')`; upload.style.backgroundSize = "cover"; }
      const hint = root.querySelector("[data-upload-hint]");
      if (hint) hint.hidden = false;
    };
    reader.readAsDataURL(file);
  });

  const headlineInput = root.querySelector("#post-headline");
  const subtextInput = root.querySelector("#post-subtext");
  const extraLinesContainer = root.querySelector("[data-extra-lines]");
  let extraLineInputs = [];

  // Rebuilt from the three text sources every time, rather than diffed —
  // simpler than tracking which of an arbitrary number of extra lines
  // changed, and cheap enough for something a person edits by hand.
  const syncOverlay = () => {
    const headline = headlineInput?.value.trim() || "";
    const subtext = subtextInput?.value.trim() || "";
    const extras = extraLineInputs.map((input) => input.value.trim()).filter(Boolean);
    const box = root.querySelector("[data-bg-box]");
    let overlay = box.querySelector("[data-headline-overlay]");

    if (!headline && !subtext && !extras.length) {
      overlay?.remove();
      return;
    }
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "bp-social-box__headline";
      overlay.dataset.headlineOverlay = "";
      box.appendChild(overlay);
    }
    overlay.innerHTML = "";
    if (headline) {
      const el = document.createElement("div");
      el.textContent = headline;
      overlay.appendChild(el);
    }
    for (const line of [subtext, ...extras].filter(Boolean)) {
      const el = document.createElement("div");
      el.className = "bp-social-box__subtext";
      el.textContent = line;
      overlay.appendChild(el);
    }
  };

  /** Add one editable "extra text" row, wired to re-sync the overlay as it's typed or removed. */
  function addExtraLine(value = "") {
    const row = document.createElement("div");
    row.className = "bp-row";
    row.style.cssText = "gap:6px;margin-top:6px;align-items:center";
    const input = document.createElement("input");
    input.className = "bp-input";
    input.type = "text";
    input.maxLength = 80;
    input.value = value;
    input.placeholder = "Another line on the image";
    input.style.flex = "1";
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "bp-btn bp-btn--ghost bp-btn--sm";
    removeBtn.textContent = "Remove";
    input.addEventListener("input", syncOverlay);
    removeBtn.addEventListener("click", () => {
      row.remove();
      extraLineInputs = extraLineInputs.filter((i) => i !== input);
      syncOverlay();
    });
    row.append(input, removeBtn);
    extraLinesContainer?.appendChild(row);
    extraLineInputs.push(input);
  }

  root.querySelector("[data-add-text]")?.addEventListener("click", () => {
    addExtraLine();
    syncOverlay();
  });

  headlineInput?.addEventListener("input", syncOverlay);
  subtextInput?.addEventListener("input", syncOverlay);

  const box = root.querySelector("[data-bg-box]");
  const bookEl = box?.querySelector(".bp-social-box__book");
  const scaleInput = root.querySelector("#post-book-scale");
  const drag = bookEl ? makeBookDraggable(box, bookEl) : null;

  scaleInput?.addEventListener("input", (event) => {
    box.style.setProperty("--book-scale", event.target.value);
  });
  const rotateRow = root.querySelector("[data-rotate-row]");
  const rotateInput = root.querySelector("#post-book-rotate");
  const canRotate = canRotateBook(book);
  if (rotateRow) rotateRow.hidden = !canRotate;
  if (canRotate && bookEl) {
    rotateInput.addEventListener("input", (event) => {
      const url = rotateBookMockup(book, Number(event.target.value));
      if (url) bookEl.src = url;
    });
  }

  root.querySelector("[data-reset-position]")?.addEventListener("click", () => {
    drag?.reset();
    if (scaleInput) {
      scaleInput.value = "1";
      box.style.setProperty("--book-scale", "1");
    }
    if (canRotate && rotateInput) {
      rotateInput.value = "30";
      const url = rotateBookMockup(book, 30);
      if (url) bookEl.src = url;
    }
  });

  /**
   * Reproduce a previously-saved state: background, book offset/scale/angle,
   * headline, subtext and extra lines. Called once, right after wiring —
   * order matters, since the offset restore reads the book's current
   * (already-scaled) size to place it correctly.
   */
  function applyState(state) {
    if (!state) return;
    if (state.bg) setBg(state.bg);
    if (headlineInput && typeof state.headline === "string") headlineInput.value = state.headline;
    if (subtextInput && typeof state.subtext === "string") subtextInput.value = state.subtext;
    for (const line of state.extraLines || []) addExtraLine(line);
    if (scaleInput && state.scale) {
      scaleInput.value = String(state.scale);
      box.style.setProperty("--book-scale", String(state.scale));
    }
    if (canRotate && rotateInput && Number.isFinite(state.rotate)) {
      rotateInput.value = String(state.rotate);
      const url = rotateBookMockup(book, state.rotate);
      if (url) bookEl.src = url;
    }
    if (drag && state.offset) drag.setOffset(state.offset.x || 0, state.offset.y || 0);
    syncOverlay();
  }

  return {
    getBg: () => currentBg,
    getHeadline: () => headlineInput?.value.trim() || "",
    getSubtext: () => subtextInput?.value.trim() || "",
    getExtraLines: () => extraLineInputs.map((input) => input.value.trim()).filter(Boolean),
    getOffset: () => drag?.getOffset() || { x: 0, y: 0 },
    getScale: () => Number(scaleInput?.value) || 1,
    getRotate: () => (canRotate ? Number(rotateInput?.value) : null),
    getImageUrl: () => bookEl?.src || "",
    applyState,
  };
}

function loadImage(src, { crossOrigin } = {}) {
  return new Promise((resolve, reject) => {
    const el = new Image();
    if (crossOrigin) el.crossOrigin = crossOrigin;
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("The image didn't load."));
    el.src = src;
  });
}

async function exportCanvas(canvas, filename) {
  const blob = await new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), "image/png");
    } catch {
      resolve(null);
    }
  });
  if (!blob) throw new Error("Could not render the image.");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Wraps `text` to fit `maxWidth`, returning one line per array entry. */
function wrapText(ctx, text, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * The plain studio-colour background, filled directly (no photo to load),
 * with the book's own 3D mockup or flat cover centred on top — the same
 * picture the box on screen shows. The mockup already has its own lighting
 * and shadow baked into the render; a flat cover gets a drop shadow here
 * so it doesn't look like a sticker glued onto the background. The optional
 * headline and subtext are drawn along the bottom, on a scrim, matching the
 * on-screen overlay — headline bold and larger, subtext lighter and smaller.
 *
 * A cover hosted somewhere that doesn't grant CORS read access can display
 * on screen but still taint the canvas, so it loads with
 * `crossOrigin: "anonymous"` here and, if that fails, the export falls
 * back to the plain background — with a clear notice, never a silently
 * wrong file.
 */
export async function downloadPostImage(bg, imageUrl, isMockup, headline, subtext, size, filename, button, { offset = { x: 0, y: 0 }, scale = 1, extraLines = [] } = {}) {
  setBusy(button, true, "Preparing…");
  try {
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (isImageBg(bg)) {
      try {
        const backdrop = await loadImage(bg);
        const bgFit = Math.max(size.width / backdrop.naturalWidth, size.height / backdrop.naturalHeight);
        const bw = backdrop.naturalWidth * bgFit, bh = backdrop.naturalHeight * bgFit;
        ctx.drawImage(backdrop, (size.width - bw) / 2, (size.height - bh) / 2, bw, bh);
      } catch {
        ctx.fillStyle = "#e7eef0";
        ctx.fillRect(0, 0, size.width, size.height);
      }
    } else {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, size.width, size.height);
    }

    // Measure the text first (if any) so the book can be sized and centred
    // to clear that strip, the same way the on-screen box reserves room for
    // it with padding-bottom, rather than the book sitting behind the scrim.
    const headlineSize = Math.round(size.width * 0.032);
    const subtextSize = Math.round(size.width * 0.021);
    const headlineLineHeight = headlineSize * 1.3;
    const subtextLineHeight = subtextSize * 1.35;
    const maxTextWidth = size.width * 0.86;
    const padding = headlineSize * 0.6;

    ctx.font = `700 ${headlineSize}px system-ui, sans-serif`;
    const headlineLines = headline ? wrapText(ctx, headline, maxTextWidth).slice(0, 3) : [];
    ctx.font = `400 ${subtextSize}px system-ui, sans-serif`;
    // Subtext plus any extra lines share the same smaller style, one below
    // the other — capped so a handful of added lines can't push the book
    // off the top of the frame.
    const subLines = [subtext, ...extraLines].filter(Boolean).flatMap((line) => wrapText(ctx, line, maxTextWidth)).slice(0, 6);

    const gap = headlineLines.length && subLines.length ? subtextSize * 0.5 : 0;
    const blockHeight = headlineLines.length * headlineLineHeight + gap + subLines.length * subtextLineHeight;
    const scrimHeight = (headlineLines.length || subLines.length) ? blockHeight + padding * 2 : 0;
    const bookAreaHeight = size.height - scrimHeight;

    let bookDrawn = false;
    if (imageUrl) {
      try {
        const book = await loadImage(imageUrl, { crossOrigin: "anonymous" });
        const maxW = size.width * (scrimHeight ? 0.76 : 0.7);
        const maxH = bookAreaHeight * (scrimHeight ? 0.93 : 0.82);
        const fit = Math.min(maxW / book.naturalWidth, maxH / book.naturalHeight) * scale;
        const w = book.naturalWidth * fit;
        const h = book.naturalHeight * fit;
        const x = (size.width - w) / 2 + offset.x * size.width;
        const y = (bookAreaHeight - h) / 2 + offset.y * size.height;
        ctx.save();
        if (!isMockup) {
          ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
          ctx.shadowBlur = 26;
          ctx.shadowOffsetY = 14;
        }
        ctx.drawImage(book, x, y, w, h);
        ctx.restore();
        bookDrawn = true;
      } catch {
        // Falls through to exporting the plain background; reported below.
      }
    }

    if (headline || subLines.length) {
      const scrim = ctx.createLinearGradient(0, size.height - scrimHeight, 0, size.height);
      scrim.addColorStop(0, "rgba(0, 0, 0, 0)");
      scrim.addColorStop(1, "rgba(0, 0, 0, 0.55)");
      ctx.fillStyle = scrim;
      ctx.fillRect(0, size.height - scrimHeight, size.width, scrimHeight);

      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";

      let y = size.height - padding - blockHeight;
      ctx.font = `700 ${headlineSize}px system-ui, sans-serif`;
      for (const line of headlineLines) {
        ctx.fillText(line, size.width / 2, y);
        y += headlineLineHeight;
      }
      if (headlineLines.length && subLines.length) y += gap;
      ctx.font = `400 ${subtextSize}px system-ui, sans-serif`;
      ctx.globalAlpha = 0.85;
      for (const line of subLines) {
        ctx.fillText(line, size.width / 2, y);
        y += subtextLineHeight;
      }
      ctx.globalAlpha = 1;
    }

    await exportCanvas(canvas, filename);
    if (imageUrl && !bookDrawn) {
      notify.error("Downloaded the plain background only — the book image couldn't be read into the file. Add it yourself before posting.");
    }
  } catch (err) {
    notify.error(err.message || "Couldn't download the image.");
  }
  setBusy(button, false);
}
