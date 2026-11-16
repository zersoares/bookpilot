// The seller pages are hidden until their details have been checked.
//
// /sell-your-book/ (the 70% / 35% offer) and /seller-terms (the seller terms)
// were published and then taken down with a forced 404 while the commercial and
// legal details are reviewed. What must stay true meanwhile: the redirect rules
// are forced (otherwise Netlify serves the file on disk and the rule never
// fires), nothing on the site links to either page, the sitemap does not list
// them, and the 404 page they land on exists. The pages' files stay in the repo
// so they can be published again by deleting the rules and restoring the links.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const toml = read("netlify.toml");

// The redirect block whose `from` is exactly `from`.
function rule(from) {
  const lines = toml.split(String.fromCharCode(13)).join("");
  const blocks = lines.split("[[redirects]]").slice(1).map((b) => b.split(/\n\s*\n/)[0]);
  return blocks.find((b) => (/from\s*=\s*"([^"]*)"/.exec(b) || [])[1] === from);
}

test("each hidden address has a forced 404 redirect", () => {
  for (const from of ["/sell-your-book", "/sell-your-book/*", "/seller-terms", "/seller-terms.html"]) {
    const block = rule(from);
    assert.ok(block, `no redirect rule for ${from}`);
    assert.match(block, /to\s*=\s*"\/404\.html"/, `${from} must land on the 404 page`);
    assert.match(block, /status\s*=\s*404/, `${from} must answer 404, not a redirect`);
    assert.match(block, /force\s*=\s*true/, `${from} must be forced, or the file on disk is served`);
  }
  assert.ok(existsSync(join(ROOT, "404.html")));
});

test("the pages themselves are still in the repo, ready to be published again", () => {
  assert.ok(existsSync(join(ROOT, "sell-your-book/index.html")));
  assert.ok(existsSync(join(ROOT, "seller-terms.html")));
});

function htmlFiles(dir = "", found = []) {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (["node_modules", ".git", ".claude", "_wt", "netlify", "tests", "sql", "assets", "fonts", "js"].includes(entry.name)) continue;
    const path = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) htmlFiles(path, found);
    else if (entry.name.endsWith(".html")) found.push(path);
  }
  return found;
}

test("no page on the site links to a hidden page, apart from the hidden pages themselves", () => {
  const linking = htmlFiles()
    .filter((f) => f !== "sell-your-book/index.html" && f !== "seller-terms.html")
    .filter((f) => /sell-your-book|seller-terms/.test(read(f)));
  assert.deepEqual(linking, [], "a page still points at a hidden page");
});

test("the sitemaps do not list them", () => {
  for (const sitemap of ["sitemap.xml", "sitemap-pages.xml", "sitemap-blog.xml"]) {
    if (!existsSync(join(ROOT, sitemap))) continue;
    assert.ok(!/sell-your-book|seller-terms/.test(read(sitemap)), `${sitemap} lists a hidden page`);
  }
});

test("the app and its scripts do not point at them either", () => {
  for (const f of ["js/app.js", "app.html"]) {
    if (existsSync(join(ROOT, f))) assert.ok(!/sell-your-book|seller-terms/.test(read(f)), `${f} links to a hidden page`);
  }
});
