// The Pinterest connection: signed OAuth state, request shapes, and the
// logic that turns Pinterest's answers into BookPilot rows.
//
// Nothing here reaches Pinterest, and none of it has been run against a
// live Pinterest account (that needs an approved app). Fetch is stubbed and
// the requests are checked against Pinterest's published OpenAPI description:
// endpoint paths, the Basic-auth token request, repeated campaign_ids and a
// comma-separated columns list. What this cannot prove is how Pinterest
// answers in practice, which is why the answers below are treated as
// untrusted and the first live sync is the real test.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.PINTEREST_APP_ID = "1234567";
process.env.PINTEREST_APP_SECRET = "app-secret";
process.env.PINTEREST_REDIRECT_URI = "https://example.test/api/bp-pinterest/callback";
process.env.BOOKPILOT_OAUTH_STATE_SECRET = "state-secret";

const pin = await import("../netlify/functions/bookpilot-lib/pinterest.js");
const state = await import("../netlify/functions/bookpilot-lib/oauth-state.js");

const USER = "d1000000-0000-4000-8000-000000000001";

/** Stub fetch with a queue of replies; returns the recorded calls. */
function stubFetch(...replies) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: new URL(url), init, body: init.body ? String(init.body) : "" });
    const reply = replies.length > 1 ? replies.shift() : replies[0];
    const status = reply.status ?? 200;
    return new Response(JSON.stringify(reply.body ?? reply), { status });
  };
  return calls;
}

// --- Signed state ------------------------------------------------------------

test("state: a signed state returns its user, once, for its provider", async () => {
  const s = await state.signState("pinterest", USER, "secret");
  assert.equal(await state.verifyState("pinterest", s, "secret"), USER);
});

test("state: tampering, the wrong provider, the wrong secret and age all fail", async () => {
  const s = await state.signState("pinterest", USER, "secret");
  const [provider, user, at, sig] = s.split(".");
  assert.equal(await state.verifyState("pinterest", `${provider}.${user}.${at}.${sig.replace(/.$/, sig.endsWith("0") ? "1" : "0")}`, "secret"), null, "a changed signature");
  assert.equal(await state.verifyState("pinterest", `${provider}.d1000000-0000-4000-8000-0000000000ff.${at}.${sig}`, "secret"), null, "a different user id");
  assert.equal(await state.verifyState("meta", s, "secret"), null, "a state issued for another platform");
  assert.equal(await state.verifyState("pinterest", s, "another-secret"), null);
  assert.equal(await state.verifyState("pinterest", s, "secret", -1), null, "older than allowed");
  assert.equal(await state.verifyState("pinterest", "not.a.state", "secret"), null);
  assert.equal(await state.verifyState("pinterest", s, ""), null, "no secret configured");
  await assert.rejects(() => state.signState("pinterest", USER, ""), (e) => e.status === 501);
});

// --- Authorisation ------------------------------------------------------------

test("authorize URL: read-only scope, our redirect, a code flow", async () => {
  const url = new URL(pin.authorizeUrl(await pin.signState(USER)));
  assert.equal(url.origin + url.pathname, "https://www.pinterest.com/oauth/");
  assert.equal(url.searchParams.get("client_id"), "1234567");
  assert.equal(url.searchParams.get("redirect_uri"), "https://example.test/api/bp-pinterest/callback");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("scope"), "ads:read", "read-only and nothing more");
  assert.equal(await pin.verifyState(url.searchParams.get("state")), USER);
  assert.deepEqual(pin.SCOPES, ["ads:read"]);
});

test("token exchange: a Basic-authenticated form POST to the token endpoint", async () => {
  const calls = stubFetch({ access_token: "at", refresh_token: "rt", expires_in: 2592000, scope: "ads:read", token_type: "bearer" });
  const tokens = await pin.exchangeCode("the-code");
  const [call] = calls;
  assert.equal(call.url.href, "https://api.pinterest.com/v5/oauth/token");
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.headers.Authorization, `Basic ${btoa("1234567:app-secret")}`);
  assert.equal(call.init.headers["Content-Type"], "application/x-www-form-urlencoded");
  const form = new URLSearchParams(call.body);
  assert.equal(form.get("grant_type"), "authorization_code");
  assert.equal(form.get("code"), "the-code");
  assert.equal(form.get("redirect_uri"), "https://example.test/api/bp-pinterest/callback");
  assert.equal(form.get("continuous_refresh"), "true");
  assert.deepEqual(tokens, { accessToken: "at", refreshToken: "rt", expiresIn: 2592000, scope: "ads:read" });
});

test("token refresh uses the refresh grant", async () => {
  const calls = stubFetch({ access_token: "at2", refresh_token: "rt2", expires_in: 100 });
  await pin.refreshTokens("rt");
  const form = new URLSearchParams(calls[0].body);
  assert.equal(form.get("grant_type"), "refresh_token");
  assert.equal(form.get("refresh_token"), "rt");
});

test("a failed token request throws a plain error and never repeats Pinterest's body", async () => {
  stubFetch({ status: 400, body: { code: 1, message: "Invalid authorization code SECRET-DETAIL" } });
  await assert.rejects(() => pin.exchangeCode("bad"), (e) => {
    assert.equal(e.code, "pinterest_connection_failed");
    assert.doesNotMatch(e.message, /SECRET-DETAIL|Invalid authorization/);
    return true;
  });
});

// --- Reading -----------------------------------------------------------------

test("ad accounts: bearer token, paging by bookmark, tidy output", async () => {
  const calls = stubFetch(
    { body: { items: [{ id: "111", name: "Books", currency: "EUR", country: "DE" }], bookmark: "next" } },
    { body: { items: [{ id: "222", currency: "USD" }], bookmark: null } },
  );
  const accounts = await pin.listAdAccounts("tok");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.pathname, "/v5/ad_accounts");
  assert.equal(calls[0].init.headers.Authorization, "Bearer tok");
  assert.equal(calls[1].url.searchParams.get("bookmark"), "next");
  assert.deepEqual(accounts, [
    { id: "111", name: "Books", currency: "EUR", country: "DE" },
    { id: "222", name: "Ad account 222", currency: "USD", country: null },
  ]);
});

test("campaigns are listed under the chosen ad account", async () => {
  const calls = stubFetch({ items: [{ id: 5, name: "Spring Pins", status: "ACTIVE" }, { id: 6, status: "PAUSED" }] });
  const campaigns = await pin.listCampaigns("tok", "111");
  assert.equal(calls[0].url.pathname, "/v5/ad_accounts/111/campaigns");
  assert.deepEqual(campaigns, [
    { id: "5", name: "Spring Pins", status: "ACTIVE" },
    { id: "6", name: "Campaign 6", status: "PAUSED" },
  ]);
});

test("analytics: daily, repeated campaign_ids, comma-separated columns, batches of 250", async () => {
  const calls = stubFetch([]);
  const ids = Array.from({ length: 251 }, (_, i) => String(1000 + i));
  await pin.campaignAnalytics("tok", "111", ids, { since: "2026-08-20", until: "2026-09-18" });

  assert.equal(calls.length, 2, "251 ids need two requests");
  const first = calls[0].url;
  assert.equal(first.pathname, "/v5/ad_accounts/111/campaigns/analytics");
  assert.equal(first.searchParams.get("start_date"), "2026-08-20");
  assert.equal(first.searchParams.get("end_date"), "2026-09-18");
  assert.equal(first.searchParams.get("granularity"), "DAY");
  assert.equal(first.searchParams.get("columns"), pin.COLUMNS.join(","));
  assert.equal(first.searchParams.getAll("campaign_ids").length, 250);
  assert.equal(calls[1].url.searchParams.getAll("campaign_ids").length, 1);
  assert.ok(pin.COLUMNS.includes("OUTBOUND_CLICK_1") && pin.COLUMNS.includes("TOTAL_CHECKOUT"));
});

test("errors are plain sentences: expired login, rate limit, anything else", async () => {
  stubFetch({ status: 401, body: { message: "UPSTREAM-401" } });
  await assert.rejects(() => pin.listAdAccounts("t"), (e) => e.code === "pinterest_connection_failed" && !/UPSTREAM/.test(e.message));
  stubFetch({ status: 429, body: { message: "UPSTREAM-429" } });
  await assert.rejects(() => pin.listAdAccounts("t"), (e) => e.status === 429 && !/UPSTREAM/.test(e.message));
  stubFetch({ status: 500, body: { message: "UPSTREAM-500" } });
  await assert.rejects(() => pin.listAdAccounts("t"), (e) => e.code === "pinterest_action_failed" && !/UPSTREAM/.test(e.message));
});

// --- Turning answers into rows --------------------------------------------------

test("micro-units become cents", () => {
  assert.equal(pin.microToCents(12_345_678), 1235, "12.345678 units is 1234.5678 cents");
  assert.equal(pin.microToCents(1_000_000), 100);
  assert.equal(pin.microToCents(0), 0);
  assert.equal(pin.microToCents(undefined), 0);
});

test("the date range never exceeds Pinterest's 90 days", () => {
  const now = Date.parse("2026-09-18T12:00:00Z");
  assert.deepEqual(pin.dateRange(30, now), { since: "2026-08-20", until: "2026-09-18", days: 30 });
  const ninety = pin.dateRange(90, now);
  const span = (Date.parse(ninety.until) - Date.parse(ninety.since)) / 86_400_000;
  assert.ok(span <= 89, "start and end are at most 90 days apart, inclusive");
  assert.equal(pin.dateRange(500, now).days, 90, "clamped");
  assert.equal(pin.dateRange(-5, now).days, 1, "never less than a day");
  assert.equal(pin.dateRange(0, now).days, 30, "nothing given means the default");
  assert.equal(pin.dateRange("x", now).days, 30, "default");
  assert.equal(pin.dateRange(1, now).since, pin.dateRange(1, now).until);
});

test("rows: figures mapped, missing columns are zero, outbound clicks over link clicks", () => {
  const map = new Map([["55", "campaign-uuid"]]);
  const rows = pin.toPerformanceRows([
    { CAMPAIGN_ID: "55", DATE: "2026-09-01", SPEND_IN_MICRO_DOLLAR: 12_400_000, IMPRESSION_1: 900, OUTBOUND_CLICK_1: 40, CLICKTHROUGH_1: 99, TOTAL_CHECKOUT: 2, TOTAL_CHECKOUT_VALUE_IN_MICRO_DOLLAR: 17_980_000 },
    { CAMPAIGN_ID: "55", DATE: "2026-09-02", SPEND_IN_MICRO_DOLLAR: 5_000_000, IMPRESSION_1: 100, CLICKTHROUGH_1: 7 },
    { CAMPAIGN_ID: "55", DATE: "2026-09-03" },
  ], map, "2026-09-18T00:00:00Z");

  assert.deepEqual(rows[0], {
    campaign_id: "campaign-uuid", ad_id: null, metric_date: "2026-09-01", source: "pinterest",
    impressions: 900, reach: 0, clicks: 40, spend_cents: 1240, conversions: 2, revenue_cents: 1798,
    synced_at: "2026-09-18T00:00:00Z",
  });
  assert.equal(rows[1].clicks, 7, "link clicks when outbound clicks are not reported");
  assert.equal(rows[1].conversions, 0);
  assert.deepEqual([rows[2].impressions, rows[2].clicks, rows[2].spend_cents], [0, 0, 0], "a day with nothing is zeros, not an error");
});

test("rows: unknown campaigns, bad dates and negative or junk figures are not stored", () => {
  const map = new Map([["55", "u"]]);
  const rows = pin.toPerformanceRows([
    { CAMPAIGN_ID: "999", DATE: "2026-09-01", IMPRESSION_1: 5 },
    { CAMPAIGN_ID: "55", DATE: "01/09/2026", IMPRESSION_1: 5 },
    { CAMPAIGN_ID: "55" },
    { CAMPAIGN_ID: "55", DATE: "2026-09-01", IMPRESSION_1: -5, SPEND_IN_MICRO_DOLLAR: "junk", TOTAL_CHECKOUT: null },
  ], map);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].impressions, rows[0].spend_cents, rows[0].conversions], [0, 0, 0]);
  assert.ok(rows.every((r) => r.source === "pinterest" && r.ad_id === null));
});

test("status words follow what Pinterest reports", () => {
  assert.equal(pin.statusFor("ACTIVE"), "active");
  assert.equal(pin.statusFor("PAUSED"), "paused");
  assert.equal(pin.statusFor("ARCHIVED"), "completed");
  assert.equal(pin.statusFor("DRAFT"), "paused");
  assert.equal(pin.statusFor(undefined), "paused");
});

test("planning: match by Pinterest id, link by a unique name, never guess between duplicates", () => {
  const local = [
    { id: "L1", name: "Spring Pins", external_campaign_id: "10" },
    { id: "L2", name: "From a CSV", external_campaign_id: null },
    { id: "L3", name: "Twin", external_campaign_id: null },
    { id: "L4", name: "twin", external_campaign_id: null },
  ];
  const remote = [
    { id: "10", name: "Renamed on Pinterest" },
    { id: "20", name: "  from a csv " },
    { id: "30", name: "Twin" },
    { id: "40", name: "Brand new" },
  ];
  const plan = pin.planCampaigns(remote, local);
  assert.deepEqual(plan.map((p) => [p.remote.id, p.action, p.local?.id ?? null]), [
    ["10", "match", "L1"],
    ["20", "link", "L2"],
    ["30", "create", null],
    ["40", "create", null],
  ]);
});

test("planning: one local campaign is claimed by only one Pinterest campaign", () => {
  const plan = pin.planCampaigns(
    [{ id: "1", name: "Same" }, { id: "2", name: "Same" }],
    [{ id: "L1", name: "Same", external_campaign_id: null }],
  );
  assert.deepEqual(plan.map((p) => p.action), ["link", "create"]);
});
