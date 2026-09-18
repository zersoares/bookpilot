// Website tracking: the rules behind "is my tracking working?".
//
// The collector answers 202 to everything so a key can't be probed, which
// means these rules are the only thing standing between an author and a
// silent failure. Worth pinning down.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hostMatches, hostOf, testUrl, isTestEvent, shapeEvent, summarise, health,
} from "../netlify/functions/bookpilot-lib/tracking.js";
import { demoAdapter, resetDemo } from "../js/data/demo-adapter.js";

const NOW = Date.parse("2026-09-18T12:00:00Z");
const ago = (ms) => new Date(NOW - ms).toISOString();
const HOUR = 3_600_000;
const ev = (offset, event_type, extra = {}) => ({
  id: `e${offset}${event_type}`, event_type, value_cents: 0, currency: "EUR",
  utm: { source: "meta", medium: "paid", campaign: "spring" }, occurred_at: ago(offset), ...extra,
});
const testEv = (offset) => ev(offset, "page_view", { utm: { source: "bookpilot", medium: "test", campaign: "installation-check" } });

test("an origin must be the registered domain or a subdomain of it", () => {
  assert.equal(hostMatches("https://example.com", "example.com"), true);
  assert.equal(hostMatches("https://www.example.com", "example.com"), true);
  assert.equal(hostMatches("https://shop.example.com", "example.com"), true);
  assert.equal(hostMatches("https://EXAMPLE.com", "example.com"), true);
  // The classic bug: a suffix match without the dot.
  assert.equal(hostMatches("https://notexample.com", "example.com"), false);
  assert.equal(hostMatches("https://example.com.evil.io", "example.com"), false);
  assert.equal(hostMatches("https://other.org", "example.com"), false);
});

test("a missing origin is allowed, a malformed one is not", () => {
  assert.equal(hostMatches(null, "example.com"), true);
  assert.equal(hostMatches("", "example.com"), true);
  assert.equal(hostMatches("not a url", "example.com"), false);
  assert.equal(hostMatches("https://example.com", ""), false);
});

test("hostOf returns a bare hostname or nothing", () => {
  assert.equal(hostOf("https://Shop.Example.com:8443/path"), "shop.example.com");
  assert.equal(hostOf("garbage"), null);
  assert.equal(hostOf(null), null);
});

test("the test link is https, marked, and safe for messy domain input", () => {
  const url = new URL(testUrl("https://Example.com/some/path"));
  assert.equal(url.protocol, "https:");
  assert.equal(url.hostname, "example.com");
  assert.equal(url.searchParams.get("utm_source"), "bookpilot");
  assert.equal(url.searchParams.get("utm_medium"), "test");
  assert.equal(isTestEvent({ utm: { source: "bookpilot", medium: "test" } }), true);
  assert.equal(isTestEvent({ utm: { source: "meta", medium: "paid" } }), false);
});

test("test visits are shown but never counted as results", () => {
  const s = summarise([ev(1 * HOUR, "purchase", { value_cents: 899 }), testEv(0.1 * HOUR), ev(2 * HOUR, "page_view")], { now: NOW });
  assert.equal(s.counts.page_view, 1);
  assert.equal(s.counts.purchase, 1);
  assert.equal(s.revenue_cents, 899);
  assert.equal(s.last_24h, 2);
  // The test is the newest event, the purchase the newest real one.
  assert.equal(s.last_event_at, ago(0.1 * HOUR));
  assert.equal(s.last_real_event_at, ago(1 * HOUR));
});

test("health: waiting, tested, receiving and quiet", () => {
  const site = {};
  assert.equal(health({ summary: summarise([], { now: NOW }), site, now: NOW }).state, "waiting");
  assert.equal(health({ summary: summarise([testEv(HOUR)], { now: NOW }), site, now: NOW }).state, "tested");
  assert.equal(health({ summary: summarise([ev(HOUR, "page_view")], { now: NOW }), site, now: NOW }).state, "receiving");
  assert.equal(health({ summary: summarise([ev(10 * 24 * HOUR, "page_view")], { now: NOW }), site, now: NOW }).state, "quiet");
});

test("health: a wrong-domain rejection wins only while it is the latest thing", () => {
  const rejected = { last_rejected_host: "shop.example.org", last_rejected_at: ago(HOUR) };
  const none = summarise([], { now: NOW });
  const a = health({ summary: none, site: rejected, now: NOW });
  assert.deepEqual(a, { state: "mismatch", rejected_host: "shop.example.org" });

  // Events that arrived after the rejection mean it has been fixed.
  const later = summarise([ev(0.5 * HOUR, "page_view")], { now: NOW });
  assert.equal(health({ summary: later, site: rejected, now: NOW }).state, "receiving");

  // Events that arrived before it do not hide it.
  const earlier = summarise([ev(5 * HOUR, "page_view")], { now: NOW });
  assert.equal(health({ summary: earlier, site: rejected, now: NOW }).state, "mismatch");
});

test("a shaped event carries no more than the screen shows", () => {
  const shaped = shapeEvent({
    id: "x", event_type: "purchase", value_cents: 899, currency: "EUR", campaign_id: "c1",
    utm: { source: "meta", campaign: "c1", term: "secret-ish" }, occurred_at: ago(HOUR),
    session_hash: "abc", user_id: "u1", site_id: "s1",
  });
  assert.deepEqual(Object.keys(shaped).sort(),
    ["attributed", "currency", "event_type", "id", "is_test", "label", "occurred_at", "value_cents"]);
  assert.equal(shaped.attributed, true);
});

test("the demo workspace serves the same status shape and reacts to a test visit", async () => {
  resetDemo();
  const { sites } = await demoAdapter.request("GET", "/api/bp/tracking-sites");
  const id = sites[0].id;

  const before = await demoAdapter.request("GET", `/api/bp/tracking-sites/${id}/status`);
  assert.equal(before.health.state, "receiving");
  assert.equal(before.summary.counts.page_view, 4);
  assert.equal(before.summary.counts.purchase, 2);
  assert.equal(before.summary.revenue_cents, 1798);
  assert.equal(before.recent.some((e) => e.is_test), false);
  assert.match(before.test_url, /utm_medium=test/);

  await demoAdapter.request("POST", `/api/bp/tracking-sites/${id}/simulate-test`, {});
  const after = await demoAdapter.request("GET", `/api/bp/tracking-sites/${id}/status`);
  assert.equal(after.recent[0].is_test, true);
  // A test visit is displayed but does not move the results.
  assert.equal(after.summary.counts.page_view, 4);

  await assert.rejects(
    () => demoAdapter.request("GET", "/api/bp/tracking-sites/nope/status"),
    (err) => err.status === 404
  );
});
