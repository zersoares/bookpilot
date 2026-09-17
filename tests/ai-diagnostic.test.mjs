// When an AI call fails in production, Netlify's function log is the only
// place the reason appears — and that log is readable only in Netlify's own
// UI. So the reason is condensed into a short code that rides back with the
// error and lands in ai_usage.operation via the refund path, where a query
// can find it.
//
// The constraint that shapes the design: on a validation error Anthropic
// quotes the offending request back, and the request here is the author's
// book text. A length cap is not a safeguard, because the *first* characters
// of that quote are already the book. So recognised operational messages are
// allowlisted and everything else is dropped. These tests keep that true.

import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnose } from "../netlify/functions/bookpilot-lib/ai.js";

const BOOK_TEXT = "A field guide for women rebuilding after a divorce";

test("the status alone is enough when the body is not JSON", () => {
  assert.equal(diagnose("<html>Bad Gateway</html>", 502), "http_502");
});

test("an Anthropic error contributes its type and message", () => {
  const body = JSON.stringify({
    type: "error",
    error: { type: "invalid_request_error", message: "Your credit balance is too low to access the API" },
  });
  const out = diagnose(body, 400);
  assert.match(out, /^http_400:invalid_request_error:/);
  assert.match(out, /credit balance is too low/);
});

test("an authentication failure is identifiable at a glance", () => {
  const body = JSON.stringify({
    type: "error",
    error: { type: "authentication_error", message: "invalid x-api-key" },
  });
  assert.equal(diagnose(body, 401), "http_401:authentication_error:invalid x-api-key");
});

test("the request echo never reaches the diagnostic", () => {
  const body = JSON.stringify({
    type: "error",
    error: { type: "invalid_request_error", message: "messages.0.content: " + BOOK_TEXT.repeat(40) },
    request: { messages: [{ role: "user", content: BOOK_TEXT.repeat(40) }] },
  });
  const out = diagnose(body, 400);
  assert.ok(!out.includes(BOOK_TEXT), "the book text must not appear in the diagnostic");
  assert.ok(out.length < 200, `diagnostic should stay short, got ${out.length}`);
});

test("an unrecognised message is dropped rather than truncated", () => {
  // This is the safeguard. Truncating would still emit the first 120
  // characters, which on a validation error is the request echo.
  const body = JSON.stringify({ error: { type: "api_error", message: "something we have never seen" } });
  assert.equal(diagnose(body, 500), "http_500:api_error");
});

test("a recognised message is still capped in length", () => {
  const body = JSON.stringify({
    error: { type: "invalid_request_error", message: "Your credit balance is too low. " + "x".repeat(5000) },
  });
  const out = diagnose(body, 400);
  assert.match(out, /^http_400:invalid_request_error:Your credit balance is too low\./);
  assert.ok(out.length <= "http_400:invalid_request_error:".length + 120);
});

test("newlines are flattened so the code stays a single field", () => {
  const body = JSON.stringify({
    error: { type: "rate_limit_error", message: "rate limit reached\n\nfor requests\tper minute" },
  });
  const out = diagnose(body, 429);
  assert.ok(!/[\n\r\t]/.test(out), "a stored diagnostic must not contain control whitespace");
  assert.match(out, /rate limit reached for requests per minute/);
});

test("the causes we actually expect are all recognised", () => {
  const cases = [
    [400, "invalid_request_error", "Your credit balance is too low to access the API"],
    [401, "authentication_error", "invalid x-api-key"],
    [429, "rate_limit_error", "rate limit reached"],
    [529, "overloaded_error", "Overloaded"],
    [404, "not_found_error", "model: claude-nope-5 does not exist"],
  ];
  for (const [status, type, message] of cases) {
    const out = diagnose(JSON.stringify({ error: { type, message } }), status);
    assert.ok(out.split(":").length >= 3, `${type} lost its message: ${out}`);
  }
});

test("a missing error object degrades to the status", () => {
  assert.equal(diagnose(JSON.stringify({ something: "else" }), 418), "http_418");
  assert.equal(diagnose("", 500), "http_500");
});
