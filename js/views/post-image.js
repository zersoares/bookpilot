// Shared machinery for "a book's picture on a plain background, with
// optional text, that can be downloaded" — used by both the Social Posts
// composer and the Creative Library template composer, so the two stay
// visually consistent and the canvas-export logic exists exactly once.

import { html, raw, safeImageUrl, setBusy } from "../core/dom.js";
import { notify } from "../core/toast.js";

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

/** The best real picture of this book: its own 3D mockup, or its flat cover. */
export function bookImage(book) {
  const slug = MOCKUP_3D[book?.title];
  if (slug) return { url: `/assets/covers/3d/${slug}.webp`, isMockup: true };
  const cover = safeImageUrl(book?.cover_url);
  return cover ? { url: cover, isMockup: false } : { url: "", isMockup: false };
}

// A small studio-colour palette to pick from, in the style of real
// book-mockup backdrops — plain, single colours, nothing busier than that.
export const BG_SWATCHES = ["#e7eef0", "#2f6f6b", "#e8734a", "#1f2937", "#f5efe3", "#5b6b8c", "#7a8c6f", "#c9a267"];

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
  const { url, isMockup } = bookImage(book);
  return html`
    <div class="bp-social-box" data-bg-box style="background:${initialBg};height:${height}px">
      ${url
        ? raw(html`<img class="bp-social-box__book${isMockup ? "" : " bp-social-box__book--flat"}" src="${url}" alt="Cover of ${book?.title || "the book"}" loading="lazy" decoding="async">`)
        : raw(html`<span class="bp-social-box__nocover">${book?.id ? `<a href="#/books/${book.id}/edit">Add your book cover</a>` : "No cover yet"}</span>`)}
      <span class="bp-badge bp-badge--accent bp-social-box__label">${label}</span>
      ${raw(textOverlayMarkup(initialHeadline, initialSubtext))}
    </div>
  `;
}

/** The swatch row + custom colour wheel, meant to sit under `imageBoxMarkup`. */
export function bgSwatchesMarkup(initialBg) {
  return html`
    <div class="bp-field">
      <label class="bp-label">Background</label>
      <div class="bp-row bp-row--wrap" style="gap:8px;align-items:center">
        ${raw([initialBg, ...BG_SWATCHES.filter((c) => c !== initialBg)].map((color, index) => html`
          <button type="button" class="bp-swatch${index === 0 ? " bp-swatch--active" : ""}" data-bg-swatch
            style="background:${color}" data-color="${color}" aria-label="Use this background colour" title="${color}"></button>
        `).join(""))}
        <label class="bp-swatch bp-swatch--custom" title="Pick a custom colour">
          <input type="color" data-bg-custom value="${initialBg}" style="opacity:0;width:100%;height:100%;cursor:pointer">
        </label>
      </div>
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
  `;
}

/**
 * Wires the swatches, the custom-colour input and the headline/subtext
 * fields (all already in `root`) to update the box live. Returns
 * `{ getBg, getHeadline, getSubtext }` for the caller's own download
 * handler to read from.
 */
export function wireImageBox(root, { initialBg }) {
  let currentBg = initialBg;

  const setBg = (color) => {
    currentBg = color;
    const box = root.querySelector("[data-bg-box]");
    if (box) box.style.background = color;
    root.querySelectorAll("[data-bg-swatch]").forEach((btn) => btn.classList.toggle("bp-swatch--active", btn.dataset.color === color));
  };
  root.querySelectorAll("[data-bg-swatch]").forEach((btn) => btn.addEventListener("click", () => setBg(btn.dataset.color)));
  root.querySelector("[data-bg-custom]")?.addEventListener("input", (event) => setBg(event.target.value));

  const headlineInput = root.querySelector("#post-headline");
  const subtextInput = root.querySelector("#post-subtext");

  const syncOverlay = () => {
    const headline = headlineInput?.value.trim() || "";
    const subtext = subtextInput?.value.trim() || "";
    const box = root.querySelector("[data-bg-box]");
    let overlay = box.querySelector("[data-headline-overlay]");

    if (!headline && !subtext) {
      overlay?.remove();
      return;
    }
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "bp-social-box__headline";
      overlay.dataset.headlineOverlay = "";
      box.appendChild(overlay);
    }

    let headlineEl = overlay.querySelector("[data-headline-text]");
    if (headline) {
      if (!headlineEl) {
        headlineEl = document.createElement("div");
        headlineEl.dataset.headlineText = "";
        overlay.prepend(headlineEl);
      }
      headlineEl.textContent = headline;
    } else {
      headlineEl?.remove();
    }

    let subtextEl = overlay.querySelector("[data-subtext-text]");
    if (subtext) {
      if (!subtextEl) {
        subtextEl = document.createElement("div");
        subtextEl.className = "bp-social-box__subtext";
        subtextEl.dataset.subtextText = "";
        overlay.appendChild(subtextEl);
      }
      subtextEl.textContent = subtext;
    } else {
      subtextEl?.remove();
    }
  };

  headlineInput?.addEventListener("input", syncOverlay);
  subtextInput?.addEventListener("input", syncOverlay);

  return {
    getBg: () => currentBg,
    getHeadline: () => headlineInput?.value.trim() || "",
    getSubtext: () => subtextInput?.value.trim() || "",
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
export async function downloadPostImage(bg, imageUrl, isMockup, headline, subtext, size, filename, button) {
  setBusy(button, true, "Preparing…");
  try {
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size.width, size.height);

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
    const subtextLines = subtext ? wrapText(ctx, subtext, maxTextWidth).slice(0, 2) : [];

    const gap = headlineLines.length && subtextLines.length ? subtextSize * 0.5 : 0;
    const blockHeight = headlineLines.length * headlineLineHeight + gap + subtextLines.length * subtextLineHeight;
    const scrimHeight = (headlineLines.length || subtextLines.length) ? blockHeight + padding * 2 : 0;
    const bookAreaHeight = size.height - scrimHeight;

    let bookDrawn = false;
    if (imageUrl) {
      try {
        const book = await loadImage(imageUrl, { crossOrigin: "anonymous" });
        const maxW = size.width * (scrimHeight ? 0.76 : 0.7);
        const maxH = bookAreaHeight * (scrimHeight ? 0.93 : 0.82);
        const scale = Math.min(maxW / book.naturalWidth, maxH / book.naturalHeight);
        const w = book.naturalWidth * scale;
        const h = book.naturalHeight * scale;
        const x = (size.width - w) / 2;
        const y = (bookAreaHeight - h) / 2;
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

    if (headline || subtext) {
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
      if (headlineLines.length && subtextLines.length) y += gap;
      ctx.font = `400 ${subtextSize}px system-ui, sans-serif`;
      ctx.globalAlpha = 0.85;
      for (const line of subtextLines) {
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
