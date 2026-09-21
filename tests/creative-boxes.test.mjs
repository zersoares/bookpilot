// The picture box on a creative card, and the template samples that feed it.
//
// The rule being protected: a box shows a real picture of something real (the
// creative's own image, or the book's cover) or it plainly shows nothing. It
// must never be blank without saying why, and never dress up a stand-in.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { creativePreview } from "../js/views/shared.js";
import {
  CREATIVE_TEMPLATES, SAMPLE_TEMPLATE_IDS, creativeFromTemplate,
  sampleImagePath, isSampleImage, sampleAltFor,
} from "../js/views/creative-templates.js";
import { url as validateUrl } from "../netlify/functions/bookpilot-lib/validate.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const BOOK = { id: "b1", title: "The Modern Woman's Guide", cover_url: "https://cdn.example/cover.jpg" };
const NO_COVER = { id: "b2", title: "No Cover Yet", cover_url: null };
const box = (creative, opts) => creativePreview({ headline: "Headline", format: "static", ...creative }, { label: "Static image", ...opts });

test("a creative with no picture shows the book's cover, large, over a blur of itself", () => {
  const out = box({}, { book: BOOK });
  assert.match(out, /bp-creative__preview--image/);
  assert.match(out, /bp-creative__img--blur"[^>]*src="https:\/\/cdn\.example\/cover\.jpg"/, "blurred backdrop");
  assert.match(out, /bp-creative__cover--hero"[^>]*src="https:\/\/cdn\.example\/cover\.jpg"/, "the cover itself");
  assert.match(out, /alt="Cover of The Modern Woman&#39;s Guide"/, "described for screen readers, and escaped");
  assert.doesNotMatch(out, /bp-creative__concept/, "it is the real cover: no AI or sample tag");
});

test("with no picture and no cover, it says so and links to where to add one", () => {
  const out = box({}, { book: NO_COVER });
  assert.doesNotMatch(out, /<img/);
  assert.match(out, /href="#\/books\/b2\/edit"[^>]*>Add your book cover</);
  // no book known at all: the plain box, nothing invented
  const bare = box({}, {});
  assert.doesNotMatch(bare, /<img|nocover/);
  assert.match(bare, /Headline/);
});

test("a creative's own picture keeps the book's cover on top of it", () => {
  const out = box({ media_url: "https://cdn.example/scene.webp", body: { image_alt: "A kitchen table." } }, { book: BOOK });
  assert.match(out, /bp-creative__img"[^>]*src="https:\/\/cdn\.example\/scene\.webp"[^>]*alt="A kitchen table\."/);
  assert.match(out, /bp-creative__cover--thumb/, "a small cover in the corner");
  assert.match(out, />AI concept image</);
  // when the book IS the subject of the ad, the cover is large and central
  assert.match(box({ format: "mockup", media_url: "https://cdn.example/s.webp" }, { book: BOOK }), /bp-creative__cover--hero/);
  assert.match(box({ format: "promo", media_url: "https://cdn.example/s.webp" }, { book: BOOK }), /bp-creative__cover--hero/);
  // and no cover means no cover element, just the picture
  assert.doesNotMatch(box({ media_url: "https://cdn.example/s.webp" }, { book: NO_COVER }), /bp-creative__cover/);
});

test("a template sample is labelled as a sample, with its own description", () => {
  const out = box({ media_url: sampleImagePath("cover-reveal"), format: "mockup" }, { book: BOOK });
  assert.match(out, />Sample image</);
  assert.doesNotMatch(out, />AI concept image</);
  assert.ok(sampleAltFor(sampleImagePath("cover-reveal")).length > 10, "and it has alt text");
  assert.ok(isSampleImage("https://bookpilot.org/assets/creatives/sample-quote-card.webp"), "recognised at any origin");
  assert.ok(!isSampleImage("/assets/creatives/demo-1.webp"), "a demo concept image is not a sample");
  assert.ok(!isSampleImage(null));
});

test("nothing unsafe reaches an <img> or an attribute", () => {
  // a cover URL that is not a picture address is ignored, not rendered
  for (const bad of ["javascript:alert(1)", "data:image/svg+xml;base64,PHN2Zz4=", "data:text/html;base64,PGI+", "vbscript:x"]) {
    assert.doesNotMatch(box({}, { book: { ...NO_COVER, cover_url: bad } }), /<img|javascript:|vbscript:|svg\+xml/, `ignores ${bad}`);
  }
  // an inline PNG (what the demo's uploads are) is fine
  assert.match(box({}, { book: { ...BOOK, cover_url: "data:image/png;base64,iVBORw0KGgo=" } }), /data:image\/png;base64,iVBORw0KGgo=/);
  // titles and headlines are escaped wherever they appear
  const evil = { ...BOOK, title: '"><script>alert(1)</script>' };
  const out = box({ headline: "<img src=x onerror=alert(1)>" }, { book: evil });
  assert.doesNotMatch(out, /<script|<img src=x/);
  // a video is not shown as a picture
  assert.doesNotMatch(box({ media_url: "https://cdn.example/clip.mp4" }, { book: NO_COVER }), /clip\.mp4/);
});

// ---- templates ----------------------------------------------------------

test("every template has a sample image on disk, and an alt text for it", () => {
  assert.deepEqual([...SAMPLE_TEMPLATE_IDS].sort(), CREATIVE_TEMPLATES.map((t) => t.id).sort(),
    "the samples cover exactly the templates that exist");
  for (const t of CREATIVE_TEMPLATES) {
    assert.ok(existsSync(join(ROOT, sampleImagePath(t.id))), `missing ${sampleImagePath(t.id)}`);
    assert.ok(sampleAltFor(sampleImagePath(t.id)), `${t.id} has no alt text`);
  }
});

test("a draft made from a template starts with its sample image, as an address the server accepts", () => {
  const book = { id: "11111111-1111-4111-8111-111111111111", title: "T", genre: "Self-Help" };
  for (const t of CREATIVE_TEMPLATES) {
    const body = creativeFromTemplate(t, book, { origin: "https://bookpilot.org" });
    assert.equal(body.media_url, `https://bookpilot.org/assets/creatives/sample-${t.id}.webp`);
    assert.equal(validateUrl(body.media_url, "Media URL"), body.media_url, "passes the server's URL check");
    assert.equal(body.status, "draft");
  }
  // no browser, no origin: the field is simply absent rather than a broken relative path
  assert.ok(!("media_url" in creativeFromTemplate(CREATIVE_TEMPLATES[0], book, { origin: undefined })));
});
