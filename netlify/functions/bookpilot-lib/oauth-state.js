// Signed OAuth `state` for provider callbacks.
//
// The `state` parameter carries the user id through the redirect to a
// platform and back. It is HMAC-signed so a third party cannot craft a
// callback that attaches their ad account to someone else's BookPilot
// account, and it names the provider so a state issued for one platform
// can never be accepted by another's callback.

import { Errors } from "./errors.js";

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** provider.userId.issuedAt.signature — none of the parts contain a dot. */
export async function signState(provider, userId, secret, label = provider) {
  if (!secret) throw Errors.notConfigured(`The ${label} integration`);
  const payload = `${provider}.${userId}.${Date.now()}`;
  return `${payload}.${await hmac(secret, payload)}`;
}

/** The user id a valid, fresh state was issued to; otherwise null. */
export async function verifyState(provider, state, secret, maxAgeMs = 15 * 60_000) {
  if (!secret) return null;
  const parts = String(state || "").split(".");
  if (parts.length !== 4) return null;
  const [claimed, userId, issuedAt, signature] = parts;
  if (claimed !== provider) return null;

  const expected = await hmac(secret, `${claimed}.${userId}.${issuedAt}`);
  // Constant-time-ish comparison: both are fixed-length hex digests.
  if (signature.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < signature.length; i += 1) diff |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;

  const age = Date.now() - Number(issuedAt);
  if (!Number.isFinite(age) || age < 0 || age > maxAgeMs) return null;
  return userId;
}
