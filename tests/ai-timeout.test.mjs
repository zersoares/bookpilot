// The AI request timeout has to sit under the platform's own limit.
//
// Netlify kills a synchronous function at 30 seconds — measured against
// this site, not assumed: a handler sleeping 28s returns 200, one sleeping
// 31s gets a 502. The request timeout was 55s, so the abort could never
// fire. The platform killed the function first, the catch block never ran,
// and the catch block is what refunds the credits: every generation that
// ran long charged the user and returned nothing.
//
// Measured latencies for book_analysis through the live gateway:
//
//   opus-5   effort high     29.4s and 34.1s on identical input
//   opus-5   effort low      23.3s
//   sonnet-5 effort medium   15.7s
//   haiku-4-5 (no effort)    13.7s
//
// The default straddles the cliff, which is why the margin below matters.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const source = readFileSync(join(ROOT, "netlify/functions/bookpilot-lib/ai.js"), "utf8");

const constant = (name) => {
  const match = source.match(new RegExp(`const ${name} = ([0-9_]+)`));
  assert.ok(match, `${name} is not declared`);
  return Number(match[1].replace(/_/g, ""));
};

test("the request timeout leaves the platform room to return the error", () => {
  const request = constant("REQUEST_TIMEOUT_MS");
  const platform = constant("PLATFORM_LIMIT_MS");

  assert.ok(
    request < platform,
    `the abort must fire before the platform kills the function (${request}ms vs ${platform}ms)`
  );
  // Aborting at the very last moment is no better: the catch block still
  // has to refund the credits and write the diagnostic row.
  assert.ok(
    platform - request >= 3000,
    `leave at least 3s to refund and report, got ${platform - request}ms`
  );
});

test("the platform limit reflects what was measured, not a guess", () => {
  assert.equal(constant("PLATFORM_LIMIT_MS"), 30_000);
});
