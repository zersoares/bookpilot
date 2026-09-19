// Minimal Stripe client.
//
// Stripe's REST API is form-encoded; three calls are all this product
// needs (checkout session, billing portal session, subscription read),
// so it is written directly rather than pulling in the SDK — see
// bookpilot/README.md § "Why there is no build step".

import { env } from "./env.js";
import { Errors } from "./errors.js";

const API = "https://api.stripe.com/v1";

export function configured() {
  return Boolean(env.stripeSecret);
}

// Stripe takes nested params as bracketed form keys:
//   { line_items: [{ price: "x" }] } -> line_items[0][price]=x
function encode(params, prefix = "", out = new URLSearchParams()) {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (item !== null && typeof item === "object") encode(item, `${name}[${index}]`, out);
        else out.append(`${name}[${index}]`, String(item));
      });
    } else if (value !== null && typeof value === "object") {
      encode(value, name, out);
    } else {
      out.append(name, String(value));
    }
  }
  return out;
}

async function call(path, { method = "POST", params, query } = {}) {
  if (!configured()) throw Errors.notConfigured("Billing");
  let res;
  try {
    res = await fetch(`${API}${path}${query ? `?${encode(query)}` : ""}`, {
      method,
      headers: {
        Authorization: `Bearer ${env.stripeSecret}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params ? encode(params).toString() : undefined,
    });
  } catch (err) {
    console.error("[bookpilot] Stripe unreachable:", err);
    throw new Error("stripe_unreachable");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    console.error(`[bookpilot] Stripe ${path} -> ${res.status}:`, body?.error?.message);
    throw Errors.internal();
  }
  return body;
}

export function createCheckoutSession(params) {
  return call("/checkout/sessions", { params });
}

export function createPortalSession(params) {
  return call("/billing_portal/sessions", { params });
}

export function getSubscription(id) {
  return call(`/subscriptions/${encodeURIComponent(id)}`, { method: "GET" });
}

/**
 * Move a subscription to another price. Stripe prorates the difference onto
 * the next invoice. The plan itself is applied only by the webhook that
 * follows, like every other plan change.
 */
export function changeSubscriptionPrice(id, itemId, priceId, metadata = {}) {
  return call(`/subscriptions/${encodeURIComponent(id)}`, {
    params: { items: [{ id: itemId, price: priceId }], proration_behavior: "create_prorations", metadata },
  });
}

/**
 * A read for the admin's setup check. Unlike `call` it never throws on a
 * Stripe error and hands back what Stripe said, because the point is to tell
 * the operator exactly what is wrong. It is for the operator's own screen and
 * is never sent to an author.
 *
 * @returns {Promise<{ ok: boolean, status: number, body: any, error: string|null }>}
 */
export async function probe(path, query) {
  if (!configured()) return { ok: false, status: 0, body: null, error: "No Stripe key is set." };
  try {
    const res = await fetch(`${API}${path}${query ? `?${encode(query)}` : ""}`, {
      headers: { Authorization: `Bearer ${env.stripeSecret}` },
    });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body, error: res.ok ? null : String(body?.error?.message || `HTTP ${res.status}`).slice(0, 300) };
  } catch {
    return { ok: false, status: 0, body: null, error: "Stripe could not be reached." };
  }
}

export const getPrice = (id) => probe(`/prices/${encodeURIComponent(id)}`);
export const findPriceByLookupKey = (key) => probe("/prices", { lookup_keys: [key], limit: 1 });
export const listWebhookEndpoints = () => probe("/webhook_endpoints", { limit: 100 });
export const listPortalConfigurations = () => probe("/billing_portal/configurations", { limit: 10 });

export function createPrice(params) {
  return call("/prices", { params });
}

/**
 * Verify the Stripe-Signature header.
 *
 * Without this any request to the webhook URL could hand a user a paid
 * plan, so the endpoint refuses to act on an unverified payload — and
 * refuses to run at all if the signing secret is not configured.
 */
export async function verifyWebhook(rawBody, signatureHeader, toleranceSeconds = 300) {
  if (!env.stripeWebhookSecret) throw Errors.notConfigured("The billing webhook");
  const parts = Object.fromEntries(
    String(signatureHeader || "")
      .split(",")
      .map((p) => p.split("=", 2))
      .filter((p) => p.length === 2)
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > toleranceSeconds) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.stripeWebhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");

  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}
