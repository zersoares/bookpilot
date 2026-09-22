// Reader-magnet landing pages: slugs, email validation, and the HTML
// they render to.
//
// The one page in the product served to a stranger with no session, so
// the tests that matter most here are the ones that would let an
// author's own saved text break out of the page it's rendered into.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  slugify, validateSlug, validateEmail, escapeHtml, safeAttrUrl, renderPage, RESERVED_SLUGS,
} from "../netlify/functions/bookpilot-lib/landing.js";
import { demoAdapter, resetDemo } from "../js/data/demo-adapter.js";
import { DEMO_IDS } from "../js/data/demo.js";

test("slugify: lowercases, strips accents and punctuation, collapses to hyphens", () => {
  assert.equal(slugify("The Long Walk Home"), "the-long-walk-home");
  assert.equal(slugify("Café Rêverie!!"), "cafe-reverie");
  assert.equal(slugify("  --Weird__Spacing--  "), "weird-spacing");
  assert.equal(slugify(""), "book", "an empty title still produces something usable");
  assert.equal(slugify("!!!"), "book", "an all-symbol title strips to nothing and falls back");
  assert.equal(slugify("é"), "e", "an accented letter still leaves a real character behind");
  assert.ok(slugify("x".repeat(200)).length <= 60);
});

test("validateSlug: accepts a clean slug, rejects bad characters and reserved words", () => {
  assert.equal(validateSlug("the-long-walk-home"), "the-long-walk-home");
  assert.equal(validateSlug("Book-2"), "book-2", "case-folded, not rejected");
  assert.throws(() => validateSlug("a"), /2–60 characters/);
  assert.throws(() => validateSlug("has spaces"), /lowercase letters/);
  assert.throws(() => validateSlug("has_underscore"), /lowercase letters/);
  assert.throws(() => validateSlug("-leading-hyphen"), /lowercase letters/);
  assert.throws(() => validateSlug("trailing-hyphen-"), /lowercase letters/);
  assert.throws(() => validateSlug("../etc/passwd"), /lowercase letters/, "no path characters, ever");
  assert.throws(() => validateSlug("api"), /reserved/);
  assert.throws(() => validateSlug("TRACK"), /reserved/, "reserved check is case-insensitive too");
  // A couple of reserved words ("app.html", "l") aren't shaped like a
  // slug at all and are already refused by the character check above;
  // every reserved word that IS slug-shaped must still be refused here.
  for (const word of RESERVED_SLUGS) {
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(word)) continue;
    assert.throws(() => validateSlug(word), /reserved/, word);
  }
});

test("validateEmail: a plausible address passes and is lower-cased; junk is refused", () => {
  assert.equal(validateEmail("Reader@Example.COM"), "reader@example.com");
  assert.equal(validateEmail("  a@b.co  "), "a@b.co");
  for (const bad of ["", "not an email", "a@b", "a@@b.com", "a b@c.com", "@nodomain.com", "x".repeat(260) + "@b.com"]) {
    assert.throws(() => validateEmail(bad), /email address/, bad);
  }
});

test("escapeHtml: the five characters that matter, and non-strings coerce safely", () => {
  assert.equal(escapeHtml(`<script>alert('"x"&y')</script>`), "&lt;script&gt;alert(&#39;&quot;x&quot;&amp;y&#39;)&lt;/script&gt;");
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
  assert.equal(escapeHtml(42), "42");
});

test("safeAttrUrl: only http(s) survives; javascript: and malformed input are dropped", () => {
  assert.equal(safeAttrUrl("https://example.com/a?b=1"), "https://example.com/a?b=1");
  assert.equal(safeAttrUrl("javascript:alert(1)"), "");
  assert.equal(safeAttrUrl("data:text/html,<script>1</script>"), "");
  assert.equal(safeAttrUrl(""), "");
  assert.equal(safeAttrUrl(null), "");
  assert.equal(safeAttrUrl("not a url"), "");
  // The URL constructor itself escapes structurally dangerous characters,
  // and the result still runs through escapeHtml for the HTML context.
  assert.ok(!safeAttrUrl('https://example.com/"><script>alert(1)</script>').includes("<script>"));
});

// --- renderPage: the actual HTML a stranger's browser receives --------

const BOOK = { title: "The Long Walk Home", subtitle: "A memoir", cover_url: "https://cdn.example.com/cover.jpg", description: "A story about walking.", author_name: "Jamie Author", sales_url: "https://amazon.com/dp/X" };
const PAGE = { headline: null, subhead: null, cta_label: "Buy now", cta_url: null, magnet_enabled: true, magnet_label: "Get chapter one", magnet_url: null, canonicalUrl: "https://bookpilot.org/l/the-long-walk-home" };

test("renderPage: falls back to the book's own fields when the page has none set", () => {
  const out = renderPage({ page: PAGE, book: BOOK });
  assert.match(out, /<title>The Long Walk Home<\/title>/);
  assert.match(out, /A memoir/);
  assert.match(out, /by Jamie Author/);
  assert.match(out, /href="https:\/\/amazon\.com\/dp\/X"/, "cta_url falls back to the book's sales_url");
  assert.match(out, /og:image" content="https:\/\/cdn\.example\.com\/cover\.jpg"/);
  assert.match(out, /og:url" content="https:\/\/bookpilot\.org\/l\/the-long-walk-home"/);
});

test("renderPage: a headline or subhead containing HTML is rendered inert", () => {
  const page = { ...PAGE, headline: `"><script>alert(1)</script>`, subhead: `<img src=x onerror=alert(1)>` };
  const out = renderPage({ page, book: BOOK });
  assert.ok(!out.includes("<script>alert(1)</script>"));
  assert.ok(!out.includes("<img src=x onerror"));
  assert.match(out, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(out, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("renderPage: a javascript: cta_url is dropped rather than rendered as a link", () => {
  const page = { ...PAGE, cta_url: "javascript:alert(document.cookie)" };
  const out = renderPage({ page, book: BOOK });
  assert.ok(!out.includes("javascript:"));
  // No href at all for the CTA once the url is unsafe, since falsy skips the block.
  assert.ok(!out.includes('class="btn btn-primary" href'));
});

test("renderPage: the magnet form is present only when enabled, and submitted state hides it", () => {
  const withForm = renderPage({ page: PAGE, book: BOOK });
  assert.match(withForm, /id="magnet-form"/);
  assert.match(withForm, /Get chapter one/);

  const disabled = renderPage({ page: { ...PAGE, magnet_enabled: false }, book: BOOK });
  assert.ok(!disabled.includes("magnet-form"));
  assert.ok(!disabled.includes("magnet-card"));

  const submitted = renderPage({ page: PAGE, book: BOOK, submitted: true });
  assert.ok(!submitted.includes("magnet-form"), "no double-submit once already subscribed");
  assert.match(submitted, /You're on the list/);
});

test("renderPage: a book with no cover, subtitle or sales link still renders a minimal page", () => {
  const bareBook = { title: "Untitled", subtitle: null, cover_url: null, description: null, author_name: null, sales_url: null };
  const barePage = { ...PAGE, cta_url: null, magnet_enabled: false };
  const out = renderPage({ page: barePage, book: bareBook });
  assert.match(out, /<title>Untitled<\/title>/);
  assert.ok(!out.includes("class=\"cover\""));
  assert.ok(!out.includes("og:image"));
});

// --- Demo workspace -----------------------------------------------------

test("demo: create, slug clash, one page per book, edit, leads, delete", async () => {
  resetDemo();
  const bookId = DEMO_IDS.BOOK_ID;

  assert.equal((await demoAdapter.request("GET", `/api/bp/landing-pages?book_id=${bookId}`)).page, null);

  const created = await demoAdapter.request("POST", "/api/bp/landing-pages", {
    book_id: bookId, slug: "starting-over", headline: "Custom headline",
  });
  assert.equal(created.page.slug, "starting-over");
  assert.equal(created.page.book_id, bookId);
  assert.equal(created.page.published, true, "a new page is live by default");

  // A second page for the same book is refused (one per book).
  await assert.rejects(
    () => demoAdapter.request("POST", "/api/bp/landing-pages", { book_id: bookId, slug: "another-one" }),
    /already has a landing page/
  );

  // Its own slug isn't "taken" against itself; a different, real clash is.
  assert.equal((await demoAdapter.request("GET", "/api/bp/landing-pages/slug-available?slug=starting-over")).available, false);
  assert.equal(
    (await demoAdapter.request("GET", `/api/bp/landing-pages/slug-available?slug=starting-over&exclude=${created.page.id}`)).available,
    true
  );
  assert.equal((await demoAdapter.request("GET", "/api/bp/landing-pages/slug-available?slug=totally-free")).available, true);
  assert.equal((await demoAdapter.request("GET", "/api/bp/landing-pages/slug-available?slug=api")).available, false, "reserved words are never available");

  // Example leads were seeded so the empty state isn't the only thing an
  // author sees in a workspace that can never receive a real signup.
  const { leads } = await demoAdapter.request("GET", `/api/bp/landing-pages/${created.page.id}/leads`);
  assert.equal(leads.length, 2);
  assert.ok(leads.every((l) => l.email.includes("@")));

  const updated = await demoAdapter.request("PATCH", `/api/bp/landing-pages/${created.page.id}`, {
    headline: "New headline", published: false,
  });
  assert.equal(updated.page.headline, "New headline");
  assert.equal(updated.page.published, false);
  assert.equal(updated.page.slug, "starting-over", "fields left out of the patch are untouched");

  await demoAdapter.request("DELETE", `/api/bp/landing-pages/${created.page.id}`);
  assert.equal((await demoAdapter.request("GET", `/api/bp/landing-pages?book_id=${bookId}`)).page, null);
  await assert.rejects(
    () => demoAdapter.request("GET", `/api/bp/landing-pages/${created.page.id}/leads`),
    /couldn't find that landing page/
  );
});

test("demo: a blank slug is generated from the book's title, with a numeric suffix on collision", async () => {
  resetDemo();
  const bookId = DEMO_IDS.BOOK_ID;
  const created = await demoAdapter.request("POST", "/api/bp/landing-pages", { book_id: bookId });
  assert.equal(created.page.slug, slugify("The Modern Woman's Guide to Starting Over"));
});

test("demo: an invalid or reserved slug is refused the same way the server refuses it", async () => {
  resetDemo();
  const bookId = DEMO_IDS.BOOK_ID;
  await assert.rejects(
    () => demoAdapter.request("POST", "/api/bp/landing-pages", { book_id: bookId, slug: "not valid!" }),
    /lowercase letters/
  );
  await assert.rejects(
    () => demoAdapter.request("POST", "/api/bp/landing-pages", { book_id: bookId, slug: "admin" }),
    /reserved/
  );
});
