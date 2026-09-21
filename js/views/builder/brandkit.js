// Brand Kit (spec 27).
//
// What an author or an agency reuses across books: the colours, the
// fonts, the logo, the author photo, the bio, the company details that
// belong on a copyright page. Applying a kit to a book carries those
// into its design and its back matter instead of asking for them again.

import { html, raw, $, delegate, formData, setBusy } from "../../core/dom.js";
import { BB } from "../../core/builder-api.js";
import { notify, confirmDialog } from "../../core/toast.js";
import { pageHead, emptyState, demoBadge } from "../shared.js";
import { imageField, bindImageFields } from "../image-field.js";
import { normaliseUrl } from "../../core/image-plan.js";

export async function render(container) {
  const [{ kits }, { projects }] = await Promise.all([
    BB.brandKits(),
    BB.projects().catch(() => ({ projects: [] })),
  ]);

  container.innerHTML = html`
    ${raw(pageHead({
      title: "Brand Kit",
      description: "Set your colours, type and author details once. Every book can use them.",
      actions: `${demoBadge()}<button type="button" class="bp-btn bp-btn--primary" data-action="new">New brand kit</button>`,
    }))}

    <div id="editor"></div>

    ${kits.length
      ? raw(html`<div class="bp-grid bp-grid--2">${raw(kits.map((kit) => kitCard(kit, projects)).join(""))}</div>`)
      : raw(emptyState({
          icon: "◈",
          title: "No brand kit yet",
          text: "If your books share a look — a colour, a typeface, the same bio at the back — put it here once.",
          action: '<button type="button" class="bp-btn bp-btn--primary" data-action="new">Create a brand kit</button>',
        }))}
  `;

  delegate(container, "click", {
    new() { openEditor(container, null); },
    edit(trigger) {
      const kit = kits.find((k) => k.id === trigger.dataset.id);
      openEditor(container, kit);
    },
    async default(trigger) {
      await BB.updateBrandKit(trigger.dataset.id, { is_default: true });
      notify.success("That's your default now.");
      render(container);
    },
    async remove(trigger) {
      const ok = await confirmDialog({
        title: "Delete this brand kit?",
        message: "Books already using it keep the colours they were given.",
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
      await BB.deleteBrandKit(trigger.dataset.id);
      notify.info("Deleted.");
      render(container);
    },
  });
}

function kitCard(kit, projects) {
  const using = projects.filter((project) => project.brand_kit_id === kit.id);
  const colors = Array.isArray(kit.colors) ? kit.colors : [];
  return html`
    <article class="bp-card bb-kit">
      <div class="bp-row bp-row--between bp-row--top">
        <div>
          <h3 class="bb-kit__name">${kit.name}</h3>
          ${kit.company_name ? raw(html`<p class="bp-small bp-muted">${kit.company_name}</p>`) : ""}
        </div>
        ${kit.is_default ? raw('<span class="bp-badge bp-badge--primary">Default</span>') : ""}
      </div>

      ${colors.length ? raw(html`
        <div class="bb-kit__swatches">
          ${raw(colors.map((color) => html`<span class="bb-kit__swatch" style="background:${color}"
            title="${color}"></span>`).join(""))}
        </div>`) : ""}

      <dl class="bp-kv bp-small">
        ${kit.fonts?.heading ? raw(html`<dt>Headings</dt><dd>${kit.fonts.heading}</dd>`) : ""}
        ${kit.fonts?.body ? raw(html`<dt>Text</dt><dd>${kit.fonts.body}</dd>`) : ""}
        <dt>Used by</dt><dd>${using.length} book${using.length === 1 ? "" : "s"}</dd>
      </dl>

      ${kit.author_bio ? raw(html`<p class="bp-small bp-muted bp-clamp-3">${kit.author_bio}</p>`) : ""}

      <div class="bp-row bp-row--wrap" style="gap:6px">
        <button type="button" class="bp-btn bp-btn--secondary bp-btn--sm" data-action="edit" data-id="${kit.id}">Edit</button>
        ${!kit.is_default ? raw(html`<button type="button" class="bp-btn bp-btn--ghost bp-btn--sm"
          data-action="default" data-id="${kit.id}">Make default</button>`) : ""}
        <button type="button" class="bp-btn bp-btn--ghost bp-btn--sm" data-action="remove" data-id="${kit.id}">Delete</button>
      </div>
    </article>
  `;
}

function openEditor(container, kit) {
  const mount = $("#editor", container);
  const colors = Array.isArray(kit?.colors) ? kit.colors : [];

  mount.innerHTML = html`
    <section class="bp-card" style="margin-bottom:var(--bp-8)">
      <h2 class="bb-section-title">${kit ? "Edit brand kit" : "New brand kit"}</h2>
      <form id="kit-form">
        <div class="bp-field-row">
          <div class="bp-field">
            <label class="bp-label" for="name">Name</label>
            <input class="bp-input" id="name" name="name" required maxlength="120"
                   value="${kit?.name || ""}" placeholder="My imprint">
          </div>
          <div class="bp-field">
            <label class="bp-label" for="company_name">Company or imprint</label>
            <input class="bp-input" id="company_name" name="company_name" maxlength="200"
                   value="${kit?.company_name || ""}">
          </div>
        </div>

        <div class="bp-field">
          <label class="bp-label" for="colors">Colours</label>
          <input class="bp-input" id="colors" name="colors" value="${colors.join(", ")}"
                 placeholder="#1f2a44, #a9631a, #f5f4f1">
          <p class="bp-hint">Comma separated hex values. The first becomes the accent in your book designs.</p>
        </div>

        <div class="bp-field-row">
          <div class="bp-field">
            <label class="bp-label" for="font_heading">Heading font</label>
            <input class="bp-input" id="font_heading" name="font_heading"
                   value="${kit?.fonts?.heading || ""}" placeholder="e.g. Söhne, or Sans">
          </div>
          <div class="bp-field">
            <label class="bp-label" for="font_body">Text font</label>
            <input class="bp-input" id="font_body" name="font_body"
                   value="${kit?.fonts?.body || ""}" placeholder="e.g. Lyon, or Serif">
          </div>
        </div>
        <p class="bp-hint" style="margin-top:-8px">
          Recorded for your own reference and for a designer. Exported books are set in the
          document engine's own faces — see the interior design themes.
        </p>

        <div class="bp-field">
          <label class="bp-label" for="author_bio">Author bio</label>
          <textarea class="bp-textarea" id="author_bio" name="author_bio" rows="4"
            placeholder="The paragraph that goes on the about-the-author page.">${kit?.author_bio || ""}</textarea>
        </div>

        <div class="bp-field-row">
          ${raw(imageField({ id: "logo_url", label: "Logo URL", kind: "logo", value: kit?.logo_url || "" }))}
          ${raw(imageField({ id: "author_photo_url", label: "Author photo URL", kind: "photo",
            value: kit?.author_photo_url || "" }))}
        </div>

        <div class="bp-field">
          <label class="bp-label" for="company_details">Copyright-page details</label>
          <textarea class="bp-textarea" id="company_details" name="company_details" rows="3"
            placeholder="Registered address, imprint line, anything the copyright page should carry.">${kit?.company_details || ""}</textarea>
        </div>

        <label class="bp-checkbox">
          <input type="checkbox" name="is_default" ${kit?.is_default ? "checked" : ""}>
          <span>Use this by default for new books</span>
        </label>

        <div class="bp-row" style="margin-top:var(--bp-5)">
          <button type="submit" class="bp-btn bp-btn--primary">${kit ? "Save changes" : "Create brand kit"}</button>
          <button type="button" class="bp-btn bp-btn--ghost" data-action="cancel">Cancel</button>
        </div>
      </form>
    </section>
  `;

  bindImageFields(mount);

  mount.querySelector('[data-action="cancel"]').addEventListener("click", () => {
    mount.innerHTML = "";
  });

  mount.querySelector("#kit-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('button[type="submit"]');
    const values = formData(event.target);
    const payload = {
      name: values.name,
      company_name: values.company_name || null,
      author_bio: values.author_bio || null,
      company_details: values.company_details || null,
      logo_url: normaliseUrl(values.logo_url),
      author_photo_url: normaliseUrl(values.author_photo_url),
      is_default: Boolean(event.target.querySelector('[name="is_default"]').checked),
      colors: String(values.colors || "")
        .split(",")
        .map((color) => color.trim())
        .filter((color) => /^#?[0-9a-f]{6}$/i.test(color))
        .map((color) => (color.startsWith("#") ? color : `#${color}`)),
      fonts: { heading: values.font_heading || "", body: values.font_body || "" },
    };

    setBusy(button, true, "Saving…");
    try {
      if (kit) await BB.updateBrandKit(kit.id, payload);
      else await BB.createBrandKit(payload);
      notify.success("Saved.");
      render(container);
    } catch (err) {
      notify.error(err.message);
      setBusy(button, false);
    }
  });
}
