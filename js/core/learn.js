// The Learning drawer — a right-hand panel of short lessons on how to
// use BookPilot, opened from the dashboard. Modelled on the "what can
// I do here" panels found in design tools: one lesson per card, a
// preview you can play in place, a title and a plain-language
// explanation underneath.
//
// A lesson's `video` is optional. Most ship without one until we've
// recorded the real walkthrough — the card still shows its title and
// description, just without a play control, rather than a broken or
// stubbed-out clip.

import { html, raw, $ } from "./dom.js";

const LESSONS = [
  {
    icon: "▤",
    title: "Bring in your book",
    text: "Import your listing straight from Amazon — title, cover, categories and blurb — or add it by hand. This is the one thing every other page in BookPilot builds on.",
    video: null,
  },
  {
    icon: "✦",
    title: "Build your marketing strategy",
    text: "BookPilot reads your book and its category to propose personas, angles and positioning before you write a single ad.",
    video: null,
  },
  {
    icon: "◐",
    title: "Generate ad creatives",
    text: "Turn an angle into on-brand creative — headline, copy and imagery — ready to review before anything goes near an ad account.",
    video: null,
  },
  {
    icon: "▶",
    title: "Launch a campaign",
    text: "Push a creative live on Meta with a budget and audience you set, or let BookPilot suggest a starting point.",
    video: null,
  },
  {
    icon: "◒",
    title: "Track what's working",
    text: "Analytics and attribution follow a click from the ad through to the sale, so 'what's working' has an actual answer.",
    video: null,
  },
  {
    icon: "✧",
    title: "Ask your AI advisor",
    text: "When the data's ambiguous, ask — the advisor reads your account's own numbers before it answers.",
    video: null,
  },
];

function lessonCard(lesson, index) {
  const hasVideo = Boolean(lesson.video);
  return html`
    <div class="bp-lesson" data-has-video="${hasVideo ? "true" : "false"}" data-index="${index}">
      <button type="button" class="bp-lesson__preview" ${raw(hasVideo ? "" : "tabindex=\"-1\" aria-hidden=\"true\"")}>
        <span aria-hidden="true">${lesson.icon}</span>
        <span class="bp-lesson__play" aria-hidden="true">▶</span>
      </button>
      <div class="bp-lesson__body">
        <p class="bp-lesson__title">${lesson.title}</p>
        <p class="bp-lesson__text">${lesson.text}</p>
      </div>
    </div>
  `;
}

function playLesson(card, lesson) {
  const preview = $(".bp-lesson__preview", card);
  preview.innerHTML = `<video src="${lesson.video}" controls autoplay playsinline></video>`;
  card.classList.add("bp-lesson--playing");
  const video = $("video", preview);
  video.addEventListener("ended", () => card.classList.remove("bp-lesson--playing"));
}

/** Opens the learning drawer. Returns a close() function. */
export function openLearnPanel() {
  const backdrop = document.createElement("div");
  backdrop.className = "bp-learn-backdrop";
  backdrop.innerHTML = html`
    <aside class="bp-learn-drawer" role="dialog" aria-modal="true" aria-label="How BookPilot works">
      <div class="bp-learn-drawer__header">
        <h2>How BookPilot works</h2>
        <button type="button" class="bp-btn bp-btn--ghost bp-btn--sm" data-close aria-label="Close">✕</button>
      </div>
      <div class="bp-learn-drawer__list">
        ${raw(LESSONS.map(lessonCard).join(""))}
      </div>
    </aside>
  `;

  const close = () => {
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (event) => {
    if (event.key === "Escape") close();
  };

  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop || event.target.closest("[data-close]")) {
      close();
      return;
    }
    const trigger = event.target.closest(".bp-lesson__preview");
    if (!trigger) return;
    const card = trigger.closest(".bp-lesson");
    const lesson = LESSONS[Number(card.dataset.index)];
    if (lesson?.video) playLesson(card, lesson);
  });

  document.addEventListener("keydown", onKey);
  document.body.appendChild(backdrop);
  return close;
}
