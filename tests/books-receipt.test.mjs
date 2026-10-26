// Book receipts: signed Stripe events in, one email to Resend out.
// Nothing reaches Stripe or Resend; global fetch is replaced by a recorder.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import handler, { BOOKS, buildEmail, verifySignature } from "../netlify/functions/bookpilot-books-receipt.mjs";

const SECRET = "whsec_test";
let sent;

beforeEach(() => {
  process.env.BOOKS_WEBHOOK_SECRET = SECRET;
  process.env.RESEND_API_KEY = "re_test";
  sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body), headers: init.headers });
    return new Response("{}", { status: 200 });
  };
});

function signed(event, { secret = SECRET, t = Math.floor(Date.now() / 1000) } = {}) {
  const raw = JSON.stringify(event);
  const sig = crypto.createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
  return new Request("https://x/api/books-receipt", { method: "POST", headers: { "stripe-signature": `t=${t},v1=${sig}` }, body: raw });
}

const paid = (link, extra = {}) => ({
  id: "evt_1",
  type: "checkout.session.completed",
  data: { object: { id: "cs_1", payment_link: link, payment_status: "paid", customer_details: { email: "buyer@example.com" }, ...extra } },
});

test("a paid Master Your Mind session emails the PDF and EPUB links", async () => {
  const res = await handler(signed(paid("plink_1UUnBiLfqCbvloYwaTZwuSc1")));
  assert.equal(res.status, 200);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].body.to, ["buyer@example.com"]);
  assert.match(sent[0].body.html, /thanks-master-your-mind-bk-97cd6c87bc\.html/);
  assert.match(sent[0].body.html, /Master-Your-Mind-bk-97cd6c87bc\.epub/);
  assert.equal(sent[0].headers.authorization, "Bearer re_test");
});

test("the Portuguese book gets a Portuguese email", async () => {
  await handler(signed(paid("plink_1UUnHJLfqCbvloYw3jBJxLcg")));
  assert.match(sent[0].body.subject, /^O seu livro/);
});

test("any other payment link is acknowledged and ignored", async () => {
  const res = await handler(signed(paid("plink_somethingelse")));
  assert.equal(res.status, 200);
  assert.equal(sent.length, 0);
});

test("an unpaid session sends nothing", async () => {
  await handler(signed(paid("plink_1UUnDhLfqCbvloYwZK7RQHnz", { payment_status: "unpaid" })));
  assert.equal(sent.length, 0);
});

test("a wrong signature, a stale timestamp and a missing header are rejected", async () => {
  assert.equal((await handler(signed(paid("plink_1UUnDhLfqCbvloYwZK7RQHnz"), { secret: "whsec_other" }))).status, 400);
  assert.equal((await handler(signed(paid("plink_1UUnDhLfqCbvloYwZK7RQHnz"), { t: 1000 }))).status, 400);
  const bare = new Request("https://x/api/books-receipt", { method: "POST", body: "{}" });
  assert.equal((await handler(bare)).status, 400);
  assert.equal(sent.length, 0);
});

test("without its secrets the endpoint says it is not configured", async () => {
  delete process.env.RESEND_API_KEY;
  assert.equal((await handler(signed(paid("plink_1UUnDhLfqCbvloYwZK7RQHnz")))).status, 501);
});

test("a failed send returns 500 so Stripe retries", async () => {
  globalThis.fetch = async () => new Response("nope", { status: 422 });
  assert.equal((await handler(signed(paid("plink_1UUnDhLfqCbvloYwZK7RQHnz")))).status, 500);
});

test("every mapped file is a real file in books/", async () => {
  const { existsSync } = await import("node:fs");
  for (const book of Object.values(BOOKS)) {
    assert.ok(existsSync(new URL(`../books/${book.page}`, import.meta.url)), book.page);
    for (const [, f] of book.files) assert.ok(existsSync(new URL(`../books/${f}`, import.meta.url)), f);
    assert.ok(buildEmail(book).text.includes(book.page));
  }
  assert.equal(verifySignature("{}", "t=1,v1=00", SECRET), false);
});
