// The "Sell your book" page for independent authors and creators.
//
// A public page that states a revenue share is a promise, so what is pinned
// here is the part that must not drift quietly: the two shares and which sale
// type each belongs to, the honest limits (selling is by invitation, the exact
// terms are in the seller terms, no promise of sales), that every link on the
// page goes somewhere real, and that the landing page's hero and footer link
// to it.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const page = read("sell-your-book/index.html");
const landing = read("index.html");

const text = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ")
  .replace(/<[^>]+>/g, " ").replace(/&rsquo;|&#39;/g, "'").replace(/&mdash;/g, "-").replace(/&nbsp;/g, " ")
  .replace(/\s+/g, " ");

test("the page is a complete standalone document with one heading and the right address", () => {
  assert.match(page, /^<!DOCTYPE html>/i);
  assert.equal((page.match(/<h1[\s>]/g) || []).length, 1, "exactly one h1");
  assert.match(page, /<link rel="canonical" href="https:\/\/bookpilot\.org\/sell-your-book\/">/);
  assert.match(page, /<meta property="og:url" content="https:\/\/bookpilot\.org\/sell-your-book\/">/);
  const title = /<title>([^<]+)<\/title>/.exec(page)[1];
  assert.ok(title.length <= 75, `title is ${title.length} characters`);
  const description = /<meta name="description" content="([^"]+)"/.exec(page)[1];
  assert.ok(description.length >= 100 && description.length <= 170, `description is ${description.length} characters`);
  assert.ok(!/noindex/i.test(page), "it is meant to be found");
});

test("the two shares belong to the right sale types", () => {
  const body = text(page);
  // 70% is the author's own audience; 35% is readers BookPilot brings. Never the other way round.
  assert.match(body, /70%\s+Your own audience\s+When the reader arrives through you[^.]*you keep 70% of the sale/i);
  assert.match(body, /35%\s+Readers BookPilot brings\s+When a reader finds your book through BookPilot[^.]*you keep 35% of the sale/i);
  assert.match(body, /keep 70% of every sale that comes from your own readers, and 35% of every sale BookPilot brings you/i);
  assert.equal((body.match(/\b\d{2}%/g) || []).filter((p) => p !== "70%" && p !== "35%").length, 0, "no other percentage appears");
});

test("it never promises more than exists: selling is by invitation, terms are written, and no sales are promised", () => {
  const body = text(page);
  assert.match(body, /by invitation/i);
  assert.match(body, /seller terms/i);
  assert.match(body, /Nothing on this page promises that any book will sell/i);
  assert.match(body, /payment fees, VAT and refunds/i);
  for (const claim of [/guarantee/i, /instant payout/i, /passive income/i, /get rich/i, /earn \$|earn €/i, /unlimited/i]) {
    assert.ok(!claim.test(body), `the page must not say ${claim}`);
  }
});

test("it tells KDP Select authors about exclusivity rather than hiding it", () => {
  const body = text(page);
  assert.match(body, /KDP Select/);
  assert.match(body, /exclusive to Amazon/i);
  assert.match(body, /link to Amazon/i);
});

test("every internal link and asset on the page resolves to a real file", () => {
  const targets = [...page.matchAll(/\b(?:href|src)="([^"]+)"/g)].map((m) => m[1])
    .filter((t) => t.startsWith("/") && !t.startsWith("//"));
  assert.ok(targets.length > 15, "found the page's links");
  for (const target of targets) {
    const path = target.split("#")[0].split("?")[0];
    if (path === "/") continue;
    const file = path.endsWith("/") ? `${path}index.html` : path;
    const full = join(ROOT, file);
    assert.ok(existsSync(full) && statSync(full).isFile(), `${target} does not resolve to a file`);
  }
});

test("the call to action goes to the existing sign-up and sign-in, and to the contact page", () => {
  assert.ok((page.match(/href="\/app\.html#\/signup"/g) || []).length >= 3, "nav, hero and closing band");
  assert.ok(page.includes('href="/app.html#/signin"'));
  assert.ok(page.includes('href="/contact/"'));
});

test("the cookie notice is on it, like every product page", () => {
  assert.ok(page.includes('<script type="module" src="/js/cookie-notice.js"></script>'));
});

test("the landing page links to it from the hero and from the footer", () => {
  const hero = /<div class="bp-hero__ctas">([\s\S]*?)<\/div>/.exec(landing)[1];
  assert.ok(hero.includes('href="/sell-your-book/"'), "hero button");
  assert.match(hero, />Sell your book</);
  const footer = /<footer class="bp-footer">([\s\S]*?)<\/footer>/.exec(landing)[1];
  assert.ok(footer.includes('href="/sell-your-book/">Sell your book</a>'), "footer link");
});

test("the new page's own nav and footer link back to itself, and only the nav marks it current", () => {
  assert.equal((page.match(/aria-current="page"/g) || []).length, 1);
  assert.ok(/<footer[\s\S]*href="\/sell-your-book\/">Sell your book<\/a>/.test(page));
});

test("it is in the sitemap", () => {
  assert.match(read("sitemap-pages.xml"), /<loc>https:\/\/bookpilot\.org\/sell-your-book\/<\/loc>/);
});

// ---- every footer ---------------------------------------------------------

function htmlFiles(dir = "", found = []) {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (["node_modules", ".git", ".claude", "_wt", "netlify", "tests", "sql", "assets", "fonts", "js"].includes(entry.name)) continue;
    const path = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) htmlFiles(path, found);
    else if (entry.name.endsWith(".html")) found.push(path);
  }
  return found;
}

// The Gumroad store profile is copy for another site, not BookPilot's own footer.
const NOT_A_SITE_FOOTER = new Set(["gumroad/profile.html"]);

test("every page of the site that has a footer links to the Sell your book page from it", () => {
  const withFooter = htmlFiles().filter((f) => !NOT_A_SITE_FOOTER.has(f)).filter((f) => read(f).includes("<footer"));
  assert.ok(withFooter.length >= 30, `found the site's footers (${withFooter.length})`);
  const missing = withFooter.filter((f) => {
    const footers = read(f).match(/<footer\b[\s\S]*?<\/footer>/g) || [];
    return !footers.some((footer) => /href="(https:\/\/bookpilot\.org)?\/sell-your-book\/"/.test(footer));
  });
  assert.deepEqual(missing, [], "a new page or post has a footer without the link");
});

test("no footer carries the link twice", () => {
  for (const f of htmlFiles().filter((f) => !NOT_A_SITE_FOOTER.has(f))) {
    for (const footer of read(f).match(/<footer\b[\s\S]*?<\/footer>/g) || []) {
      assert.ok((footer.match(/\/sell-your-book\//g) || []).length <= 1, `${f} has the link twice in one footer`);
    }
  }
});
