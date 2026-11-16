// The seller terms for authors.
//
// The "Sell your book" page promises 70% and 35% and says the details are in
// the seller terms. These tests keep the two in step and keep the terms
// internally honest: the same numbers everywhere, every cross-reference
// pointing at a clause that exists, the same operator and governing law as the
// Terms of service, no placeholder text, and the worked example actually adding up.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const terms = read("seller-terms.html");
const tos = read("terms.html");
const sell = read("sell-your-book/index.html");

const plain = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ")
  .replace(/<[^>]+>/g, " ").replace(/&rsquo;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const body = plain(/<main[\s\S]*?<\/main>/.exec(terms)[0]);

test("the page is a complete standalone legal page at the address the sell page links to", () => {
  assert.match(terms, /^<!DOCTYPE html>/i);
  assert.equal((terms.match(/<h1[\s>]/g) || []).length, 1);
  assert.match(terms, /<link rel="canonical" href="https:\/\/bookpilot\.org\/seller-terms\.html">/);
  assert.match(terms, /Effective 16 November 2026/);
  assert.ok(terms.includes('<script type="module" src="/js/cookie-notice.js"></script>'));
});

test("it has the eighteen numbered sections in order, plus the summary", () => {
  const headings = [...terms.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1]);
  assert.equal(headings[0], "At a glance");
  const numbered = headings.slice(1);
  assert.equal(numbered.length, 18);
  numbered.forEach((h, i) => assert.ok(h.startsWith(`${i + 1}. `), `section ${i + 1} is "${h}"`));
});

test("the headline terms match the Sell your book page and the decisions made", () => {
  // the shares and which sale each belongs to
  assert.match(body, /Own-audience sale 70%/);
  assert.match(body, /BookPilot-audience sale 35%/);
  assert.match(body, /70% of the Net Amount for sales from your own audience; 35% of the Net Amount for sales from BookPilot's audience/);
  // the same two numbers on the page that promises them
  assert.match(plain(sell), /keep 70% of every sale that comes from your own readers, and 35% of every sale BookPilot brings you/);
  // BookPilot is the seller of record
  assert.match(body, /We are the seller to the Reader/);
  // net of VAT and payment fees
  assert.match(body, /Net Amount\s*:\s*the Price, minus any VAT or similar sales tax contained in it, minus the payment-processing fee/);
  // 14-day refunds with the share deducted
  assert.match(body, /Refund Window\s*:\s*14 days/);
  assert.match(body, /your share of it is removed from your Balance/);
  // monthly payouts, 20 euro minimum, after the refund window
  assert.match(body, /once a month everything that is payable, if it comes to at least €20/);
  assert.match(body, /payable once the Refund Window has ended/);
  // rights stay with the author; the licence is non-exclusive
  assert.match(body, /You keep the copyright/);
  assert.match(body, /non-exclusive, worldwide licence/);
  // no percentage other than the two shares appears in the terms
  const percentages = (body.match(/\b\d{1,3}%/g) || []).filter((p) => p !== "70%" && p !== "35%");
  assert.deepEqual(percentages, [], "the only percentages are the two shares");
});

test("the worked example adds up", () => {
  const paid = 12.0, vat = 2.0, fee = 0.6;
  const net = Math.round((paid - vat - fee) * 100) / 100;
  assert.equal(net, 9.4);
  assert.equal((net * 0.7).toFixed(2), "6.58");
  assert.equal((net * 0.35).toFixed(2), "3.29");
  assert.match(body, /€12\.00 − €2\.00 − €0\.60 = €9\.40/);
  assert.match(body, /70% = €6\.58/);
  assert.match(body, /35% = €3\.29/);
});

test("it names the same operator, contact and law as the Terms of service", () => {
  for (const must of ["Zirlandia Milkovic", "private individual", "Croatia", "hello@bookpilot.org"]) {
    assert.ok(body.includes(must) && plain(tos).includes(must), `both documents say "${must}"`);
  }
  assert.match(body, /governed by Croatian law/);
  assert.match(plain(tos), /governed by Croatian law/);
});

test("every cross-reference points at a clause that exists", () => {
  const mine = new Set([
    ...[...terms.matchAll(/<h2>(\d+)\./g)].map((m) => m[1]),
    ...[...terms.matchAll(/<h3>(\d+\.\d+)\s/g)].map((m) => m[1]),
    ...[...terms.matchAll(/<p>(\d+\.\d+)\s/g)].map((m) => m[1]),
  ]);
  const theirs = new Set([
    ...[...tos.matchAll(/<h2>(\d+)\./g)].map((m) => m[1]),
    ...[...tos.matchAll(/<h3>(\d+\.\d+)\s/g)].map((m) => m[1]),
  ]);
  const text = body;
  // "section 3.1 of the Terms of service", "section 5.4 of the Terms of service"
  for (const m of text.matchAll(/sections? (\d+(?:\.\d+)?) of the Terms of service/g)) {
    assert.ok(theirs.has(m[1]), `the Terms of service has no clause ${m[1]}`);
  }
  // "section 5.2", "sections 9.2, 11, 16 and 17", "section 6, 7 or 13" - ours
  const ours = text.replace(/sections? \d+(?:\.\d+)? of the Terms of service/g, "");
  for (const m of ours.matchAll(/sections? ((?:\d+(?:\.\d+)?(?:,| or| and)? ?)+)/g)) {
    for (const n of m[1].match(/\d+(?:\.\d+)?/g)) assert.ok(mine.has(n), `these terms have no clause ${n}`);
  }
});

test("there is no unfinished text", () => {
  for (const bad of [/\[[^\]]*\]/, /TODO/i, /lorem ipsum/i, /placeholder/i, /\bXX+\b/, /<span class="bp-placeholder"/]) {
    assert.ok(!bad.test(terms.replace(/<script[\s\S]*?<\/script>/g, "")), `found ${bad}`);
  }
});

test("it does not claim a payout system or checkout that does not exist, and says who is paid how", () => {
  assert.match(body, /by invitation/i);
  assert.match(body, /Your Balance is an amount we owe you\. It is not a bank deposit and earns no interest/);
  assert.match(body, /a payment provider we name when we onboard you/);
  assert.ok(!/guarantee[ds]? (payment|income|sales)/i.test(body));
});

test("every internal link and asset on the page resolves", () => {
  const targets = [...terms.matchAll(/\b(?:href|src)="([^"]+)"/g)].map((m) => m[1]).filter((t) => t.startsWith("/") && !t.startsWith("//"));
  assert.ok(targets.length > 15);
  for (const target of targets) {
    const path = target.split("#")[0].split("?")[0];
    if (path === "/") continue;
    const file = path.endsWith("/") ? `${path}index.html` : path;
    assert.ok(existsSync(join(ROOT, file)) && statSync(join(ROOT, file)).isFile(), `${target} does not resolve`);
  }
});

test("the Sell your book page links to the terms from the notice, the FAQ and its footer", () => {
  const links = sell.match(/href="\/seller-terms\.html"/g) || [];
  assert.ok(links.length >= 3, `found ${links.length} links`);
  assert.match(sell, /<footer[\s\S]*href="\/seller-terms\.html">Seller terms<\/a>/);
  assert.match(plain(sell), /set out in the seller terms ?, which you agree to before you start selling/);
});

test("its footer links to the Sell your book page, like every other footer", () => {
  assert.match(/<footer[\s\S]*<\/footer>/.exec(terms)[0], /href="\/sell-your-book\/">Sell your book<\/a>/);
});
