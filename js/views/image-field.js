// A URL field with an "Upload image" button beside it.
//
// The field is still a plain text input named like any other, so forms read
// it the way they always did. Uploading fills it in with the link of the
// stored file; pasting a link of your own still works. A thumbnail shows
// what the link points at, so a wrong or broken link is obvious.
//
//   imageField({ id: "cover_url", label: "Cover image URL", kind: "cover" })
//   bindImageFields(container)          // once, after the markup is in the page

import { html, raw, safeImageUrl } from "../core/dom.js";
import { uploadImage } from "../core/upload.js";
import { ACCEPTED_TYPES, looksLikeImageUrl } from "../core/image-plan.js";
import { notify } from "../core/toast.js";

const DEFAULT_HINT =
  "Upload a PNG, JPG or WebP image and the link is filled in for you, or paste a link of your own.";

export function imageField({ id, label, kind, value = "", hint = DEFAULT_HINT, optional = false }) {
  return html`
    <div class="bp-field bp-imgfield" data-image-field data-kind="${kind}">
      <label class="bp-label" for="${id}">${label}${optional ? raw(' <span class="bp-subtle">(optional)</span>') : ""}</label>
      <div class="bp-imgfield__row">
        <input class="bp-input" id="${id}" name="${id}" type="text" inputmode="url" autocomplete="off"
               spellcheck="false" value="${value}" placeholder="https://">
        <button type="button" class="bp-btn bp-btn--secondary" data-image-pick>Upload image</button>
        <input type="file" accept="${ACCEPTED_TYPES.join(",")}" hidden tabindex="-1" data-image-file>
      </div>
      <div class="bp-imgfield__preview" data-image-preview hidden>
        <img alt="" data-image-thumb>
        <button type="button" class="bp-btn bp-btn--ghost bp-btn--sm" data-image-clear>Remove</button>
      </div>
      <div class="bp-hint">${hint}</div>
      <div class="bp-hint bp-imgfield__status" role="status" aria-live="polite" data-image-status></div>
    </div>`;
}

export function bindImageFields(root) {
  root.querySelectorAll("[data-image-field]").forEach(wire);
}

function wire(field) {
  const kind = field.dataset.kind;
  const input = field.querySelector("input[type=text]");
  const pick = field.querySelector("[data-image-pick]");
  const file = field.querySelector("[data-image-file]");
  const preview = field.querySelector("[data-image-preview]");
  const thumb = field.querySelector("[data-image-thumb]");
  const status = field.querySelector("[data-image-status]");

  const say = (text, tone = "") => {
    status.textContent = text;
    status.dataset.tone = tone;
  };

  const sync = () => {
    const value = input.value.trim();
    const src = looksLikeImageUrl(value) ? safeImageUrl(value) : "";
    preview.hidden = !src;
    if (src) thumb.src = src;
    else thumb.removeAttribute("src");
  };

  // A link that will not load is worth saying so about, not silently a blank box.
  thumb.addEventListener("error", () => {
    preview.hidden = true;
    if (input.value.trim()) say("That link didn't load as an image. Check it, or upload the file instead.", "error");
  });
  thumb.addEventListener("load", () => {
    if (status.dataset.tone === "error") say("");
  });

  input.addEventListener("input", () => {
    say("");
    sync();
  });

  field.querySelector("[data-image-clear]").addEventListener("click", () => {
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  });

  pick.addEventListener("click", () => file.click());

  file.addEventListener("change", async () => {
    const chosen = file.files?.[0];
    file.value = ""; // so picking the same file again still fires
    if (!chosen) return;

    const label = pick.textContent;
    pick.disabled = true;
    pick.textContent = "Uploading…";
    say("");
    try {
      const result = await uploadImage(chosen, kind);
      input.value = result.url;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      const kb = Math.max(1, Math.round(result.bytes / 1024));
      say(
        result.demo
          ? `Added (${result.width}×${result.height}, ${kb} KB). In the demo the image stays in this tab only.`
          : `Uploaded (${result.width}×${result.height}, ${kb} KB). The link is filled in above.`,
        "ok",
      );
    } catch (err) {
      say(err.message, "error");
      notify.error(err.message);
    } finally {
      pick.disabled = false;
      pick.textContent = label;
    }
  });

  sync();
}
