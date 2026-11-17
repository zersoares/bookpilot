// Every book has a real, indexable page.
//
// books/<slug>/index.html used to be a stub that redirected to the catalogue
// (/books/#b-<slug>), so no single book could rank for its own title. The pages
// are now generated from the catalogue by tools/build_book_pages.py. The tool
// that builds the catalogue (sales-page/build.mjs, outside this repo) can write
// the old stubs back, so this test fails loudly if that happens.
//
// If it fails: run  python3 tools/build_book_pages.py  (and, for
// books/mastering-claude-code/,  python3 tools/patch_mastering_claude_code.py).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const slugs = readdirSync(join(ROOT, "books"), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(ROOT, "books", d.name, "index.html")))
  .map((d) => d.name);

test("there are book pages to check", () => {
  assert.ok(slugs.length > 100, `only ${slugs.length} book folders found`);
});

test("no book page is a redirect stub", () => {
  const stubs = slugs.filter((s) => {
    const html = read(`books/${s}/index.html`);
    return /location\.replace\(|http-equiv="refresh"/i.test(html);
  });
  assert.deepEqual(stubs, [], `redirect stubs (rerun tools/build_book_pages.py): ${stubs.join(", ")}`);
});

test("every book page has a heading and a canonical URL of its own", () => {
  const bad = slugs.filter((s) => {
    const html = read(`books/${s}/index.html`);
    return !/<h1[\s>]/i.test(html) || !html.includes(`rel="canonical" href="https://bookpilot.org/books/${s}/"`);
  });
  assert.deepEqual(bad, [], `missing <h1> or canonical: ${bad.join(", ")}`);
});

test("every book page is in the sitemap", () => {
  const sitemap = read("sitemap-pages.xml");
  const missing = slugs.filter((s) => !sitemap.includes(`https://bookpilot.org/books/${s}/`));
  assert.deepEqual(missing, [], `not in sitemap-pages.xml: ${missing.join(", ")}`);
});

test("the catalogue has a canonical URL", () => {
  assert.match(read("books/index.html"), /<link rel="canonical" href="https:\/\/bookpilot\.org\/books\/">/);
});
