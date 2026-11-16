// Meta webhook: the subscription handshake and signed event delivery, through
// the real handler. The endpoint is public, so what matters is what it refuses.

import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

process.env.META_APP_SECRET = "app-secret-for-tests";
process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-token-for-tests";
process.env.URL = "http://localhost:8888";

const handler = (await import("../netlify/functions/bookpilot-meta.mjs")).default;
const BASE = "http://localhost:8888/api/bp-meta/webhook";

const sign = (body) => "sha256=" + createHmac("sha256", process.env.META_APP_SECRET).update(body).digest("hex");
const post = (body, signature) =>
  handler(new Request(BASE, { method: "POST", body, headers: signature ? { "x-hub-signature-256": signature } : {} }));

test("handshake echoes the challenge when the verify token matches", async () => {
  const res = await handler(new Request(`${BASE}?hub.mode=subscribe&hub.verify_token=verify-token-for-tests&hub.challenge=12345`));
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "12345");
});

test("handshake refuses a wrong token, a wrong mode, and a missing token", async () => {
  for (const qs of [
    "hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1",
    "hub.mode=unsubscribe&hub.verify_token=verify-token-for-tests&hub.challenge=1",
    "hub.mode=subscribe&hub.challenge=1",
  ]) {
    const res = await handler(new Request(`${BASE}?${qs}`));
    assert.equal(res.status, 403, qs);
    assert.notEqual(await res.text(), "1");
  }
});

test("a correctly signed event is acknowledged", async () => {
  const body = JSON.stringify({ object: "page", entry: [{ id: "1", changes: [{ field: "feed" }] }] });
  const res = await post(body, sign(body));
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "EVENT_RECEIVED");
});

test("events with a missing, wrong or body-mismatched signature are rejected", async () => {
  const body = JSON.stringify({ object: "page", entry: [] });
  assert.equal((await post(body)).status, 401);
  assert.equal((await post(body, "sha256=" + "0".repeat(64))).status, 401);
  assert.equal((await post(body, sign(body + " "))).status, 401);
  assert.equal((await post(body, "not-a-signature")).status, 401);
});

test("a signed but malformed body is a 400, not a crash", async () => {
  const body = "{not json";
  assert.equal((await post(body, sign(body))).status, 400);
});
