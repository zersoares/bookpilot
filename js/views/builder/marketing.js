// The Marketing Studio and repurposing (spec 25, 26).
//
// The differentiator, and the reason the two halves of BookPilot belong
// in one product: the campaign is written by an agent that has read the
// finished book, so a post quotes the actual argument and names the
// actual chapter instead of describing a book in general.

import { html, raw, $, delegate, setBusy } from "../../core/dom.js";
import { BB } from "../../core/builder-api.js";
import { notify, confirmDialog } from "../../core/toast.js";
import { navigate } from "../../core/router.js";
import { refreshAccount } from "../../core/session.js";
import { projectHeader, costBadge, fmt } from "./shared.js";
import { demoBadge } from "../shared.js";

const SCOPES = [
  {
    id: "social",
    name: "Social",
    text: "Instagram, Facebook, LinkedIn and Pinterest, each written from a different chapter.",
  },
  {
    id: "video",
    name: "Video",
    text: "Short-form scripts, YouTube scripts and a book trailer.",
  },
  {
    id: "email",
    name: "Email",
    text: "The launch announcement, a five-email sequence and the follow-ups.",
  },
  {
    id: "sales",
    name: "Sales",
    text: "The book description, a landing page, a sales page, your bio and an FAQ.",
  },
  {
    id: "advertising",
    name: "Advertising",
    text: "Headline variations, ad copy and image concepts for paid campaigns.",
  },
];

const REPURPOSE = [
  ["lead_magnet", "Lead magnet", "One problem, solved completely, in exchange for an email address."],
  ["mini_ebook", "Mini ebook", "A short book that stands on its own."],
  ["workbook", "Workbook", "Prompts and space to write."],
  ["checklist", "Checklist", "One sitting, one outcome."],
  ["course_outline", "Course outline", "Sequenced by what a learner can do."],
  ["presentation", "Presentation", "One idea per slide."],
  ["newsletter_series", "Newsletter series", "The book, delivered weekly."],
  ["blog_series", "Blog series", "Search-visible versions of the argument."],
  ["social_series", "Social series", "Posts that build on each other."],
];

const CHANNEL_LABEL = {
  instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn",
  pinterest: "Pinterest", tiktok: "TikTok", youtube: "YouTube",
  email: "Email", sales: "Sales", advertising: "Advertising",
  podcast: "Podcast", repurpose: "Repurposed",
};

export async function render(container, params, query) {
  const [data, { assets = [] }] = await Promise.all([
    BB.project(params.id),
    BB.marketing(params.id).catch(() => ({ assets: [] })),
  ]);
  const { project, chapters = [] } = data;
  const written = chapters.filter((c) => (c.word_count || 0) > 0);
  const channel = query?.get("channel") || "all";

  const channels = [...new Set(assets.map((asset) => asset.channel))];
  const visible = channel === "all" ? assets : assets.filter((asset) => asset.channel === channel);

  container.innerHTML = html`
    ${raw(projectHeader(project, {
      active: "marketing",
      actions: `${demoBadge()}${project.book_id
        ? `<a class="bp-btn bp-btn--secondary bp-btn--sm" href="#/books/${project.book_id}">Open in Campaigns</a>`
        : `<button type="button" class="bp-btn bp-btn--secondary bp-btn--sm" data-action="promote">Advertise this book</button>`}`,
    }))}

    <div class="bb-stage">
      ${!written.length ? raw(html`
        <div class="bp-empty">
          <div class="bp-empty__icon">◇</div>
          <div class="bp-empty__title">Write some of the book first</div>
          <p class="bp-empty__text">
            The campaign is written from the book itself. Without chapters there is nothing to quote,
            and a post that could be about any book is a wasted post.
          </p>
          <a class="bp-btn bp-btn--primary" href="#/studio/${project.id}/write">Open the editor</a>
        </div>`) : ""}

      ${written.length ? raw(html`
        <section style="margin-bottom:var(--bp-10)">
          <h2 class="bb-section-title">Build the campaign</h2>
          <p class="bp-small bp-muted" style="margin:4px 0 var(--bp-5)">
            The Marketing Director reads the book and writes from it. No invented reviews, no
            bestseller claims, no guaranteed outcomes.
          </p>
          <div class="bb-scopes">
            ${raw(SCOPES.map((scope) => html`
              <article class="bb-scope">
                <div>
                  <h3 class="bb-scope__name">${scope.name}</h3>
                  <p class="bp-small bp-muted">${scope.text}</p>
                </div>
                <button type="button" class="bp-btn bp-btn--secondary bp-btn--sm"
                        data-action="build" data-scope="${scope.id}" data-busy="Writing…">
                  Create ${raw(costBadge("marketing_campaign"))}
                </button>
              </article>`).join(""))}
          </div>
        </section>

        <section style="margin-bottom:var(--bp-10)">
          <h2 class="bb-section-title">Turn the book into something else</h2>
          <p class="bp-small bp-muted" style="margin:4px 0 var(--bp-5)">
            Not an excerpt with a new cover: each one has its own shape and its own job.
          </p>
          <div class="bp-chips">
            ${raw(REPURPOSE.map(([id, name, text]) => html`
              <button type="button" class="bp-chip" data-action="repurpose" data-format="${id}"
                      title="${text}" data-busy="Working…">${name}</button>`).join(""))}
          </div>
        </section>` ) : ""}

      ${assets.length ? raw(html`
        <section>
          <div class="bp-row bp-row--between bp-row--wrap" style="margin-bottom:var(--bp-4)">
            <h2 class="bb-section-title" style="margin:0">${assets.length} pieces</h2>
            <div class="bp-chips">
              <a class="bp-chip ${channel === "all" ? "bp-chip--active" : ""}"
                 href="#/studio/${project.id}/marketing">All</a>
              ${raw(channels.map((key) => html`<a class="bp-chip ${channel === key ? "bp-chip--active" : ""}"
                 href="#/studio/${project.id}/marketing?channel=${key}">${CHANNEL_LABEL[key] || key}</a>`).join(""))}
            </div>
          </div>

          <div class="bb-assets">
            ${raw(visible.map(assetCard).join(""))}
          </div>
        </section>`) : ""}
    </div>
  `;

  delegate(container, "click", {
    async build(trigger) {
      setBusy(trigger, true, trigger.dataset.busy || "Writing…");
      try {
        const result = await BB.buildCampaign(project.id, trigger.dataset.scope);
        await refreshAccount().catch(() => {});
        notify.success(`${result.assets.length} pieces written.`);
        render(container, params, query);
      } catch (err) {
        notify.error(err.message);
        setBusy(trigger, false);
      }
    },

    async repurpose(trigger) {
      setBusy(trigger, true, trigger.dataset.busy || "Working…");
      try {
        const result = await BB.repurpose(project.id, trigger.dataset.format);
        await refreshAccount().catch(() => {});
        notify.success(`“${result.asset.title}” is ready.`);
        render(container, params, query);
      } catch (err) {
        notify.error(err.message);
        setBusy(trigger, false);
      }
    },

    async copy(trigger) {
      const card = trigger.closest(".bb-asset");
      const text = card?.querySelector(".bb-asset__content")?.textContent || "";
      try {
        await navigator.clipboard.writeText(text.trim());
        notify.success("Copied.");
      } catch {
        notify.error("Your browser wouldn't let us copy. Select the text instead.");
      }
    },

    async approve(trigger) {
      await BB.updateAsset(project.id, trigger.dataset.id, { status: "approved" });
      notify.success("Approved.");
      render(container, params, query);
    },

    async remove(trigger) {
      const ok = await confirmDialog({
        title: "Delete this piece?",
        message: "The rest of the campaign is unaffected.",
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
      await BB.deleteAsset(project.id, trigger.dataset.id);
      render(container, params, query);
    },

    async promote(trigger) {
      setBusy(trigger, true, "Handing over…");
      try {
        const { book } = await BB.promote(project.id);
        notify.success("It's in your marketing library now.");
        navigate(`/books/${book.id}`);
      } catch (err) {
        notify.error(err.message);
        setBusy(trigger, false);
      }
    },
  });
}

function assetCard(asset) {
  const body = asset.body || {};
  return html`
    <article class="bb-asset">
      <div class="bb-asset__head">
        <div>
          <span class="bp-badge">${CHANNEL_LABEL[asset.channel] || asset.channel}</span>
          <span class="bp-badge">${String(asset.kind).replace(/_/g, " ")}</span>
          ${asset.status === "approved" ? raw('<span class="bp-badge bp-badge--success">Approved</span>') : ""}
        </div>
        ${body.from_chapter ? raw(html`<span class="bp-tiny bp-subtle">from ${body.from_chapter}</span>`) : ""}
      </div>

      <h3 class="bb-asset__title">${asset.title || ""}</h3>
      ${body.hook ? raw(html`<p class="bb-asset__hook">${body.hook}</p>`) : ""}
      <div class="bb-asset__content">${asset.content || ""}</div>

      ${body.visual_idea ? raw(html`
        <p class="bp-tiny bp-subtle"><strong>Visual:</strong> ${body.visual_idea}</p>`) : ""}
      ${(body.hashtags || []).length ? raw(html`
        <div class="bp-chips">
          ${raw(body.hashtags.map((tag) => html`<span class="bp-chip">${tag}</span>`).join(""))}
        </div>`) : ""}

      <div class="bp-row bp-row--wrap" style="gap:6px">
        <button type="button" class="bp-btn bp-btn--ghost bp-btn--sm" data-action="copy">Copy</button>
        ${asset.status !== "approved" ? raw(html`<button type="button" class="bp-btn bp-btn--ghost bp-btn--sm"
          data-action="approve" data-id="${asset.id}">Approve</button>`) : ""}
        <button type="button" class="bp-btn bp-btn--ghost bp-btn--sm"
                data-action="remove" data-id="${asset.id}">Delete</button>
      </div>
    </article>
  `;
}

export { fmt };
