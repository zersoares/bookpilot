// Buying and receiving a seller's book: signed download links, the checks made
// on every download, the thank-you lookup, the receipt email, and the pages.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  signDownloadToken, verifyDownloadToken, downloadBlock, resolveDownload, orderFor,
  sendReceipt, receiptEmail, MAX_DOWNLOADS, downloadUrl,
} from "../netlify/functions/bookpilot-lib/seller-delivery.js";

const SECRET = "test-secret";
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

function memoryDb(t) {
  const match = (r, eq = {}) => Object.entries(eq).every(([k, v]) => r[k] === v);
  return {
    t,
    async selectOne(table, o = {}) { return t[table].find((r) => match(r, o.eq)) || null; },
    async update(table, patch, o = {}) { const r = t[table].find((x) => match(x, o.eq)); if (r) Object.assign(r, patch); return r || null; },
  };
}
const world = (sale = {}) => memoryDb({
  seller_sales: [{ id: "sale1", stripe_session_id: "cs_test_1", book_id: "book1", status: "pending", price_cents: 1200, refunded_cents: 0, download_count: 0, currency: "EUR", reader_email: "r@example.com", receipt_sent_at: null, ...sale }],
  seller_books: [{ book_id: "book1", file_path: "u/book1/book.pdf", file_name: "book.pdf" }],
  books: [{ id: "book1", title: "My Book", author_name: "A. Author" }],
});
const storage = { async signDownload(path, name) { return `https://storage.example/signed/${path}?n=${name}`; } };

// --- tokens ---------------------------------------------------------------
test("a download token verifies for its own sale and nothing else", async () => {
  const token = await signDownloadToken("sale1", SECRET);
  assert.equal(await verifyDownloadToken(token, SECRET), "sale1");
});

test("a forged, edited or wrong-secret token is refused", async () => {
  const token = await signDownloadToken("sale1", SECRET);
  assert.equal(await verifyDownloadToken(token.replace("sale1", "sale2"), SECRET), null);
  assert.equal(await verifyDownloadToken(`${token.slice(0, -1)}0`, SECRET) === "sale1" && token.endsWith("0") === false, false);
  assert.equal(await verifyDownloadToken(token, "other-secret"), null);
  assert.equal(await verifyDownloadToken("sale1.", SECRET), null);
  assert.equal(await verifyDownloadToken("nodot", SECRET), null);
  assert.equal(await verifyDownloadToken(undefined, SECRET), null);
});

test("signing without a secret throws instead of producing a guessable token", async () => {
  await assert.rejects(() => signDownloadToken("sale1", ""));
  assert.equal(await verifyDownloadToken("sale1.abc", ""), null);
});

// --- who may download -----------------------------------------------------
test("a normal sale may be downloaded", () => assert.equal(downloadBlock({ status: "pending", price_cents: 1200, refunded_cents: 0, download_count: 0 }), null));
test("a refunded sale may not", () => {
  assert.equal(downloadBlock({ status: "refunded", price_cents: 1200, refunded_cents: 1200 }), "refunded");
  assert.equal(downloadBlock({ status: "pending", price_cents: 1200, refunded_cents: 1200 }), "refunded");
});
test("a partly refunded sale still may (the reader keeps the book)", () => assert.equal(downloadBlock({ status: "pending", price_cents: 1200, refunded_cents: 300, download_count: 0 }), null));
test("a disputed sale is paused", () => assert.equal(downloadBlock({ status: "review", review_reason: "payment disputed", price_cents: 1200, refunded_cents: 0 }), "disputed"));
test("a sale held for another review reason (fee currency) may still be downloaded", () => assert.equal(downloadBlock({ status: "review", review_reason: "fee in usd, sale in EUR", price_cents: 1200, refunded_cents: 0, download_count: 0 }), null));
test("the download limit is enforced", () => assert.equal(downloadBlock({ status: "pending", price_cents: 1200, refunded_cents: 0, download_count: MAX_DOWNLOADS }), "limit"));
test("an unknown sale is not found", () => assert.equal(downloadBlock(null), "not_found"));

test("a valid link returns a signed storage URL and counts the download", async () => {
  const db = world();
  const token = await signDownloadToken("sale1", SECRET);
  const r = await resolveDownload({ db, storage, token, secret: SECRET });
  assert.equal(r.ok, true);
  assert.match(r.url, /signed\/u\/book1\/book\.pdf/);
  assert.equal(db.t.seller_sales[0].download_count, 1);
});

test("a refunded sale's link stops working", async () => {
  const db = world({ status: "refunded", refunded_cents: 1200 });
  const r = await resolveDownload({ db, storage, token: await signDownloadToken("sale1", SECRET), secret: SECRET });
  assert.deepEqual(r, { ok: false, reason: "refunded" });
  assert.equal(db.t.seller_sales[0].download_count, 0);
});

test("the link stops after the download limit", async () => {
  const db = world({ download_count: MAX_DOWNLOADS - 1 });
  const token = await signDownloadToken("sale1", SECRET);
  assert.equal((await resolveDownload({ db, storage, token, secret: SECRET })).ok, true);
  assert.deepEqual(await resolveDownload({ db, storage, token, secret: SECRET }), { ok: false, reason: "limit" });
});

test("a book whose file was removed is reported, not served", async () => {
  const db = world(); db.t.seller_books[0].file_path = null;
  const r = await resolveDownload({ db, storage, token: await signDownloadToken("sale1", SECRET), secret: SECRET });
  assert.equal(r.reason, "no_file");
});

test("a bad token never reaches the database or storage", async () => {
  const db = world();
  const spy = { async signDownload() { throw new Error("must not be called"); } };
  assert.deepEqual(await resolveDownload({ db, storage: spy, token: "sale1.deadbeef", secret: SECRET }), { ok: false, reason: "not_found" });
});

// --- the thank-you page lookup --------------------------------------------
test("before the webhook lands the order is pending", async () => {
  assert.deepEqual(await orderFor({ db: world(), sessionId: "cs_unknown", secret: SECRET, siteUrl: "https://bookpilot.org" }), { status: "pending" });
});

test("once recorded, the order returns the title and a working download link", async () => {
  const db = world();
  const o = await orderFor({ db, sessionId: "cs_test_1", secret: SECRET, siteUrl: "https://bookpilot.org/" });
  assert.equal(o.status, "ready");
  assert.equal(o.title, "My Book");
  assert.ok(o.downloadUrl.startsWith("https://bookpilot.org/api/bp-seller/download?t=sale1."));
  const t = new URL(o.downloadUrl).searchParams.get("t");
  assert.equal(await verifyDownloadToken(t, SECRET), "sale1");
});

test("a refunded order shows as unavailable and carries no link", async () => {
  const o = await orderFor({ db: world({ status: "refunded", refunded_cents: 1200 }), sessionId: "cs_test_1", secret: SECRET, siteUrl: "https://bookpilot.org" });
  assert.equal(o.status, "unavailable");
  assert.equal(o.downloadUrl, undefined);
});

// --- the receipt email ----------------------------------------------------
test("the receipt carries the title, the link, the download limit and the refund contact", () => {
  const m = receiptEmail({ title: "My <Book>", link: "https://bookpilot.org/x?t=1", price: "12.00 EUR" });
  assert.match(m.text, /My <Book>/);
  assert.match(m.text, new RegExp(`${MAX_DOWNLOADS} times`));
  assert.match(m.text, /hello@bookpilot\.org/);
  assert.ok(m.html.includes("My &lt;Book&gt;"), "html is escaped");
});

test("a receipt is sent once and recorded", async () => {
  const db = world(); const sent = [];
  const mail = { async send(m) { sent.push(m); return { sent: true }; } };
  await sendReceipt({ db, mail, sale: db.t.seller_sales[0], secret: SECRET, siteUrl: "https://bookpilot.org" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "r@example.com");
  assert.ok(db.t.seller_sales[0].receipt_sent_at);
  await sendReceipt({ db, mail, sale: db.t.seller_sales[0], secret: SECRET, siteUrl: "https://bookpilot.org" });
  assert.equal(sent.length, 1, "not sent twice");
});

test("a mail failure leaves the receipt unrecorded so a retry can send it", async () => {
  const db = world();
  const mail = { async send() { throw new Error("down"); } };
  await assert.rejects(() => sendReceipt({ db, mail, sale: db.t.seller_sales[0], secret: SECRET, siteUrl: "https://bookpilot.org" }));
  assert.equal(db.t.seller_sales[0].receipt_sent_at, null);
});

test("downloadUrl has no double slash", () => assert.equal(downloadUrl("https://bookpilot.org/", "a.b"), "https://bookpilot.org/api/bp-seller/download?t=a.b"));

// --- the source and the pages ---------------------------------------------
test("checkout refuses a book with no file and sends the buyer to the thank-you page", () => {
  const src = read("netlify/functions/bookpilot-seller.mjs");
  assert.ok(src.includes("offer.file_path"));
  assert.ok(src.includes("{CHECKOUT_SESSION_ID}"));
  assert.ok(src.includes("/purchase/?session_id="));
});

test("the webhook sends the receipt without failing the sale if mail is down", () => {
  const src = read("netlify/functions/bookpilot-stripe-webhook.mjs");
  assert.ok(src.includes("sendReceipt("));
  assert.ok(/try \{[\s\S]*sendReceipt[\s\S]*\} catch/.test(src));
});

test("the public catalogue and book endpoints expose no file path or seller id", () => {
  const src = read("netlify/functions/bookpilot-seller.mjs");
  const block = src.match(/const publicBook = [\s\S]*?\}\);/)[0];
  for (const bad of ["file_path", "user_id", "seller", "stripe"]) assert.ok(!block.includes(bad), bad);
});

test("an uploaded file goes to a path fixed by the server, limited to pdf and epub", () => {
  const src = read("netlify/functions/bookpilot-seller.mjs");
  assert.ok(src.includes("`${ctx.user.id}/${bookId}/book.${type}`"));
  const lib = read("netlify/functions/bookpilot-lib/seller-delivery.js");
  assert.ok(lib.includes('pdf: "application/pdf"') && lib.includes("epub"));
});

test("the migration makes the bucket private and adds the delivery columns", () => {
  const sql = read("sql/025_seller_delivery.sql");
  assert.ok(/'seller-files', 'seller-files', false/.test(sql));
  assert.ok(sql.includes("download_count") && sql.includes("file_path"));
  assert.ok(!/create policy/i.test(sql), "no policy: only the server can touch the bucket");
});

test("the buy page builds from text nodes (no innerHTML), only shows https covers, and keeps the referral", () => {
  const html = read("buy/index.html");
  assert.ok(!html.includes("innerHTML"));
  assert.ok(html.includes("https:\\/\\/"));
  assert.ok(html.includes("sessionStorage"));
  assert.ok(html.includes("/api/bp-seller/checkout"));
  assert.ok(html.includes('href="/sell-your-book/"'), "footer carries the Sell your book link");
});

test("the thank-you page is noindex, polls for the order, and uses no innerHTML", () => {
  const html = read("purchase/index.html");
  assert.ok(html.includes('content="noindex, nofollow"'));
  assert.ok(html.includes("/api/bp-seller/order?session_id="));
  assert.ok(!html.includes("innerHTML"));
});
