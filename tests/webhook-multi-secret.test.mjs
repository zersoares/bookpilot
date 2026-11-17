// The webhook accepts several signing secrets (one per Stripe endpoint: your
// account and connected accounts) in STRIPE_WEBHOOK_SECRET, comma-separated.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://db.test";
process.env.SUPABASE_ANON_KEY = "anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
process.env.STRIPE_SECRET_KEY = "sk_test_x";
process.env.BOOKPILOT_SITE_URL = "https://example.test";

const { env } = await import("../netlify/functions/bookpilot-lib/env.js");
const { verifyWebhook } = await import("../netlify/functions/bookpilot-lib/stripe.js");

async function header(raw, secret, at = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${at}.${raw}`));
  return `t=${at},v1=${[...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

test("a single secret still works", async () => {
  env.stripeWebhookSecret = "whsec_one";
  assert.equal(await verifyWebhook("{}", await header("{}", "whsec_one")), true);
});

test("either of two comma-separated secrets verifies, with stray spaces ignored", async () => {
  env.stripeWebhookSecret = "whsec_account , whsec_connect";
  assert.equal(await verifyWebhook("{}", await header("{}", "whsec_account")), true);
  assert.equal(await verifyWebhook("{}", await header("{}", "whsec_connect")), true);
});

test("a signature from a secret that is not listed is refused", async () => {
  env.stripeWebhookSecret = "whsec_account,whsec_connect";
  assert.equal(await verifyWebhook("{}", await header("{}", "whsec_other")), false);
});

test("an old timestamp is refused even with a right secret", async () => {
  env.stripeWebhookSecret = "whsec_account,whsec_connect";
  assert.equal(await verifyWebhook("{}", await header("{}", "whsec_connect", 1000)), false);
});

test("an empty or missing secret list throws instead of accepting anything", async () => {
  env.stripeWebhookSecret = " , ";
  const h = await header("{}", "x");
  await assert.rejects(() => verifyWebhook("{}", h));
});

test("seller checkout opts out of Managed Payments only when STRIPE_DISABLE_MANAGED_PAYMENTS is set", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../netlify/functions/bookpilot-seller.mjs", import.meta.url), "utf8");
  assert.ok(src.includes("env.stripeDisableManagedPayments ? { managed_payments: { enabled: false } } : {}"));
  const envSrc = readFileSync(new URL("../netlify/functions/bookpilot-lib/env.js", import.meta.url), "utf8");
  assert.ok(envSrc.includes('read("STRIPE_DISABLE_MANAGED_PAYMENTS")'));
});
