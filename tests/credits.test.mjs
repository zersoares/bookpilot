// AI credits: the admin bypass.
//
// role: "admin" on a profile is the deployment owner's own testing
// account, not a plan tier. It must never be metered by the credit
// system that exists to charge customers — an admin who can't afford
// to click "Generate personas" on their own product can't verify a fix
// actually works, which is exactly the situation that led to this.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isAdmin, charge } from "../netlify/functions/bookpilot-lib/credits.js";

test("isAdmin: only role \"admin\" counts, and a missing profile never throws", () => {
  assert.equal(isAdmin({ role: "admin" }), true);
  assert.equal(isAdmin({ role: "author" }), false);
  assert.equal(isAdmin({ role: "user" }), false);
  assert.equal(isAdmin({}), false);
  assert.equal(isAdmin(null), false);
  assert.equal(isAdmin(undefined), false);
});

test("charge: an admin profile is never billed, whatever the balance says", async () => {
  const out = await charge("user-1", "book_analysis", { available: 0, profile: { role: "admin" } });
  assert.deepEqual(out, { credits: 0, remaining: 0 });
});

test("charge: the reported balance is passed through as-is, never invented", async () => {
  const out = await charge("user-1", "reader_personas", { available: 42, profile: { role: "admin" } });
  assert.equal(out.credits, 0, "nothing was spent");
  assert.equal(out.remaining, 42, "the screen shows the real balance, not a fabricated one");
});
