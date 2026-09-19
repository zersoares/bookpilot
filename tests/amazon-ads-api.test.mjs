// The Amazon Attribution connection: request shapes, error handling, and the
// logic that turns Amazon's answers into BookPilot rows.
//
// Nothing here reaches Amazon, and none of it has been run against a live
// Amazon Ads account (that needs Amazon Ads API access approved for
// BookPilot, and an author whose account has Amazon Attribution). Fetch is
// stubbed and the requests are checked against Amazon's published OpenAPI
// specification for the Attribution API and its documented Login with Amazon
// endpoints. The specification does not define a report entry's metric
// fields, so the tests pin the loose matching and the refusal to store an
// answer with none of them. The first live sync is the real test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.AMAZON_ADS_CLIENT_ID = "amzn1.application-oa2-client.abc";
process.env.AMAZON_ADS_CLIENT_SECRET = "client-secret";
process.env.AMAZON_ADS_REDIRECT_URI = "https://example.test/api/bp-amazon/callback";
process.env.BOOKPILOT_OAUTH_STATE_SECRET = "state-secret";

const a = await import("../netlify/functions/bookpilot-lib/amazon-ads.js");
const amazon = await import("../netlify/functions/bookpilot-lib/amazon.js");

const USER = "d1000000-0000-4000-8000-000000000001";

/** Route fetch by URL; every call is recorded. A reply is [status, body-or-text]. */
function route(handler) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body instanceof URLSearchParams ? Object.fromEntries(init.body)
      : init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url: u, init, body });
    const [status, payload] = handler(u, body, calls.length);
    return new Response(typeof payload === "string" ? payload : JSON.stringify(payload), { status });
  };
  return calls;
}

// --- Authorization --------------------------------------------------------------

test("authorize URL: the one Ads scope, our redirect and state, on the chosen region's login page", async () => {
  for (const [region, origin] of [["na", "https://www.amazon.com/ap/oa"], ["eu", "https://eu.account.amazon.com/ap/oa"]]) {
    const url = new URL(a.authorizeUrl(await a.signState(USER, region), region));
    assert.equal(url.origin + url.pathname, origin);
    const q = url.searchParams;
    assert.equal(q.get("client_id"), "amzn1.application-oa2-client.abc");
    assert.equal(q.get("scope"), "advertising::campaign_management", "exactly two colons");
    assert.equal(q.get("response_type"), "code");
    assert.equal(q.get("redirect_uri"), "https://example.test/api/bp-amazon/callback");
    assert.deepEqual(await a.verifyState(q.get("state")), { userId: USER, region });
  }
  assert.throws(() => a.authorizeUrl("s", "fe"), (e) => e.code === "invalid_input", "no Far East region is offered");
  await assert.rejects(() => a.signState(USER, "moon"), (e) => e.code === "invalid_input");
});

test("state: the region cannot be swapped, and a state for another provider is refused", async () => {
  const state = await a.signState(USER, "na");
  const parts = state.split(".");
  parts[0] = "amazon-eu";
  assert.equal(await a.verifyState(parts.join(".")), null, "changing the region breaks the signature");

  const { signState } = await import("../netlify/functions/bookpilot-lib/oauth-state.js");
  assert.equal(await a.verifyState(await signState("google", USER, "state-secret")), null);
  assert.equal(await a.verifyState("garbage"), null);
  assert.equal(await a.verifyState(null), null);
});

test("token exchange: a form POST to the region's token endpoint, and a refresh token is required", async () => {
  const calls = route(() => [200, { access_token: "at", refresh_token: "rt", token_type: "bearer", expires_in: 3600 }]);
  const tokens = await a.exchangeCode("eu", "the-code");
  const [call] = calls;
  assert.equal(call.url.href, "https://api.amazon.co.uk/auth/o2/token");
  assert.equal(call.init.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.deepEqual(call.body, {
    client_id: "amzn1.application-oa2-client.abc", client_secret: "client-secret",
    grant_type: "authorization_code", code: "the-code", redirect_uri: "https://example.test/api/bp-amazon/callback",
  });
  assert.deepEqual(tokens, { accessToken: "at", refreshToken: "rt", expiresIn: 3600 });

  const na = route(() => [200, { access_token: "at", refresh_token: "rt", expires_in: 3600 }]);
  await a.exchangeCode("na", "c");
  assert.equal(na[0].url.href, "https://api.amazon.com/auth/o2/token");

  route(() => [200, { access_token: "at", expires_in: 3600 }]);
  await assert.rejects(() => a.exchangeCode("na", "x"), (e) => e.code === "amazon_connection_failed", "no refresh token, no connection");
});

test("token refresh uses the refresh grant, and a failed exchange never repeats Amazon's body", async () => {
  const calls = route(() => [200, { access_token: "at2", expires_in: 3600 }]);
  await a.refreshTokens("na", "rt");
  assert.equal(calls[0].body.grant_type, "refresh_token");
  assert.equal(calls[0].body.refresh_token, "rt");

  route(() => [400, { error: "invalid_grant", error_description: "Token has been revoked SECRET-DETAIL" }]);
  await assert.rejects(() => a.refreshTokens("na", "rt"), (e) => e.code === "amazon_connection_failed" && !/SECRET-DETAIL/.test(e.message));

  globalThis.fetch = async () => { throw new Error("network down"); };
  await assert.rejects(() => a.refreshTokens("na", "rt"), (e) => e.code === "amazon_connection_failed");
});

// --- Requests -------------------------------------------------------------------

const PROFILES = `[
  {"profileId": 2810876412345678, "countryCode": "US", "currencyCode": "USD", "timezone": "America/Los_Angeles",
   "accountInfo": {"marketplaceStringId": "ATVPDKIKX0DER", "id": "A1B2C3", "type": "seller", "name": "Ada Author"}},
  {"profileId": 4400000000001, "countryCode": "CA", "currencyCode": "CAD", "timezone": "America/Toronto",
   "accountInfo": {"type": "seller", "name": "Ada Author"}},
  {"profileId": "not-a-number", "countryCode": "US"}
]`;

test("profiles: right host, bearer token and client id headers; ids survive as exact strings", async () => {
  const calls = route(() => [200, PROFILES]);
  const profiles = await a.listProfiles("eu", "the-token");
  const [call] = calls;
  assert.equal(call.url.href, "https://advertising-api-eu.amazon.com/v2/profiles");
  assert.equal(call.init.method, "GET");
  assert.equal(call.init.headers.Authorization, "Bearer the-token");
  assert.equal(call.init.headers["Amazon-Advertising-API-ClientId"], "amzn1.application-oa2-client.abc");
  assert.ok(!("Amazon-Advertising-API-Scope" in call.init.headers), "profiles is called before a profile is chosen");

  assert.deepEqual(profiles.map((p) => p.id), ["2810876412345678", "4400000000001"], "a malformed profile is left out");
  assert.deepEqual(profiles[0], { id: "2810876412345678", name: "Ada Author · seller", country: "US", currency: "USD", timezone: "America/Los_Angeles" });
});

test("a 16-digit profile id that a double would round is kept exactly", async () => {
  route(() => [200, '[{"profileId": 9007199254740993, "countryCode": "US", "currencyCode": "USD", "accountInfo": {"name": "X"}}]']);
  const [p] = await a.listProfiles("na", "t");
  assert.equal(p.id, "9007199254740993");
});

test("advertisers: the profile goes in the Scope header, and only the advertiser list is read", async () => {
  const calls = route(() => [200, { advertisers: [{ advertiserId: "111", advertiserName: "Ada Author" }, { advertiserName: "no id" }] }]);
  const list = await a.listAdvertisers("na", "t", "2810876412345678");
  assert.equal(calls[0].url.href, "https://advertising-api.amazon.com/attribution/advertisers");
  assert.equal(calls[0].init.headers["Amazon-Advertising-API-Scope"], "2810876412345678");
  assert.deepEqual(list, [{ id: "111", name: "Ada Author" }]);
});

test("errors: a limit, a refusal and a bad token each get their own plain message", async () => {
  route(() => [429, { code: "429", details: "Too many requests" }]);
  await assert.rejects(() => a.listProfiles("na", "t"), (e) => e.code === "amazon_rate_limited" && e.status === 429);

  route(() => [401, { code: "401", details: "Unauthorized" }]);
  await assert.rejects(() => a.listProfiles("na", "t"), (e) => e.code === "amazon_connection_failed");

  route(() => [403, { code: "403", details: "Forbidden SECRET-DETAIL" }]);
  await assert.rejects(
    () => a.listAdvertisers("na", "t", "1234567"),
    (e) => e.code === "amazon_not_available" && /Amazon Attribution/.test(e.message) && /approved/.test(e.message) && !/SECRET-DETAIL/.test(e.message),
    "names both possible reasons, blames neither, repeats nothing"
  );

  route(() => [500, { code: "500", details: "boom SECRET-DETAIL" }]);
  await assert.rejects(() => a.listProfiles("na", "t"), (e) => e.code === "amazon_action_failed" && !/SECRET-DETAIL/.test(e.message));

  globalThis.fetch = async () => { throw new Error("network down"); };
  await assert.rejects(() => a.listProfiles("na", "t"), (e) => e.code === "amazon_connection_failed");
});

// --- Reports --------------------------------------------------------------------

test("dateRange: n days ending yesterday, in Amazon's YYYYMMDD as well as ISO, capped at 90", () => {
  const now = Date.parse("2026-09-19T15:30:00Z");
  assert.deepEqual(a.dateRange(7, now), { since: "2026-09-12", until: "2026-09-18", startDate: "20260912", endDate: "20260918" });
  assert.equal(a.dateRange(1, now).since, "2026-09-18");
  assert.equal(a.dateRange(500, now).since, "2026-06-21", "90 days");
  assert.equal(a.dateRange("nonsense", now).since, "2026-08-20", "30 by default");
});

test("report request: performance by ad group, the metrics, a first empty cursor, the profile scope", async () => {
  const calls = route(() => [200, { reports: [], size: 0 }]);
  await a.report("na", "tok", "2810876412345678", { startDate: "20260901", endDate: "20260918" });
  const [call] = calls;
  assert.equal(call.url.href, "https://advertising-api.amazon.com/attribution/report");
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.headers["Amazon-Advertising-API-Scope"], "2810876412345678");
  assert.equal(call.init.headers["Content-Type"], "application/json");
  assert.deepEqual(call.body, {
    reportType: "PERFORMANCE", groupBy: "ADGROUP", startDate: "20260901", endDate: "20260918", count: 5000,
    metrics: "Click-throughs,attributedDetailPageViewsClicks14d,attributedAddToCartClicks14d,attributedPurchases14d,unitsSold14d,attributedSales14d,kindleEditionNormalizedPagesRead14d,kindleEditionNormalizedPagesRoyalties14d",
    cursorId: "",
  });

  const plain = route(() => [200, { reports: [] }]);
  await a.report("na", "tok", "2810876412345678", { startDate: "20260901", endDate: "20260918" }, { kindle: false });
  assert.equal(plain[0].body.metrics, "Click-throughs,attributedDetailPageViewsClicks14d,attributedAddToCartClicks14d,attributedPurchases14d,unitsSold14d,attributedSales14d");
  assert.ok(!("advertiserIds" in call.body), "all of the profile's advertisers");
  assert.ok(call.body.count >= 1 && call.body.count <= 5000, "the specification's range for count");
});

test("report paging: each cursor goes back, and it stops on an empty page or a repeated cursor", async () => {
  const calls = route((_u, body) => {
    if (body.cursorId === "") return [200, { reports: [{ n: 1 }, { n: 2 }], cursorId: "c1", size: 2 }];
    if (body.cursorId === "c1") return [200, { reports: [{ n: 3 }], cursorId: 'c"2', size: 1 }];
    return [200, { reports: [], cursorId: 'c"2', size: 0 }];
  });
  const out = await a.report("na", "t", "1234567", { startDate: "20260901", endDate: "20260918" });
  assert.equal(out.length, 3);
  assert.deepEqual(calls.map((c) => c.body.cursorId), ["", "c1", 'c"2']);

  route(() => [200, { reports: [{ n: 1 }], cursorId: "same" }]);
  const stuck = await a.report("na", "t", "1234567", { startDate: "20260901", endDate: "20260918" });
  assert.equal(stuck.length, 2, "a cursor that never advances ends the loop instead of running forever");

  let n = 0;
  route(() => [200, { reports: [{ n: 1 }], cursorId: `c${n += 1}` }]);
  await assert.rejects(() => a.report("na", "t", "1234567", { startDate: "20260901", endDate: "20260918" }), (e) => e.code === "invalid_input", "too big is an error, not a partial import");
});

// --- Turning a report into rows -------------------------------------------------

const entry = (over = {}) => ({
  campaignId: "123", adGroupId: "9", publisher: "Google Ads", date: "20260910",
  "Click-throughs": 10, attributedDetailPageViewsClicks14d: 8, attributedAddToCartClicks14d: 3,
  attributedPurchases14d: 2, unitsSold14d: 2, attributedSales14d: 17.98, ...over,
});

test("rows: ad groups add up within a campaign and day; sales become exact cents", () => {
  const { rows, dropped } = a.rowsFromReport([
    entry(),
    entry({ adGroupId: "10", "Click-throughs": 5, attributedSales14d: "1.005" }),
    entry({ date: "2026-09-11" }),
    entry({ publisher: "Meta", campaignId: "77" }),
  ]);
  assert.equal(dropped, 0);
  assert.equal(rows.length, 3);
  const day = rows.find((r) => r.campaign === "Google Ads · 123" && r.date === "2026-09-10");
  assert.deepEqual(day, {
    campaign: "Google Ads · 123", date: "2026-09-10", clicks: 15, detail_page_views: 16, add_to_carts: 6,
    purchases: 4, units_sold: 4, product_sales_cents: 1798 + 101, kindle_pages_read: 0, kindle_royalties_cents: 0,
  });
  assert.equal(a.cents("1.005"), 101, "not 100, which multiplying by 100 would give");
  assert.equal(a.cents(17.98), 1798);
});

test("rows: metric names are matched loosely, so a differently-cased or punctuated key still counts", () => {
  const { rows } = a.rowsFromReport([{
    campaignId: "5", date: "20260910", clickthroughs: 4, ATTRIBUTEDPURCHASES14D: "3", "attributed-sales-14d": "9.99",
  }]);
  assert.equal(rows[0].clicks, 4);
  assert.equal(rows[0].purchases, 3);
  assert.equal(rows[0].product_sales_cents, 999);
  assert.equal(rows[0].detail_page_views, 0, "a metric the entry lacks is zero");
});

test("rows: an answer with none of the requested metrics, or no usable dates, is refused rather than stored as zeros", () => {
  assert.throws(() => a.rowsFromReport([{ campaignId: "1", date: "20260910", somethingElse: 5 }]), (e) => e.code === "amazon_action_failed");
  assert.throws(() => a.rowsFromReport([{ campaignId: "1", date: "soon", "Click-throughs": 5 }]), (e) => e.code === "amazon_action_failed");
  assert.deepEqual(a.rowsFromReport([]), { rows: [], dropped: 0, kindle: false }, "no entries is a real empty answer");
  assert.throws(
    () => a.rowsFromReport([{ campaignId: "1", date: "20260910", kindleEditionNormalizedPagesRead14d: 900 }]),
    (e) => e.code === "amazon_action_failed",
    "Kindle figures alone do not make an answer look like the one that was asked for"
  );
  const mixed = a.rowsFromReport([entry(), entry({ date: "someday" })]);
  assert.equal(mixed.rows.length, 1);
  assert.equal(mixed.dropped, 1, "an undatable entry is counted, not silently lost");
});

test("dates and labels", () => {
  assert.equal(a.reportDate("20260910"), "2026-09-10");
  assert.equal(a.reportDate("2026-09-10"), "2026-09-10");
  assert.equal(a.reportDate("2026-13-45"), null);
  assert.equal(a.reportDate(20260910), "2026-09-10");
  assert.equal(a.reportDate(""), null);
  assert.equal(a.campaignLabel({ publisher: "Google Ads", campaignId: 123 }), "Google Ads · 123");
  assert.equal(a.campaignLabel({ campaignId: "123" }), "Amazon campaign 123");
  assert.equal(a.campaignLabel({ publisher: "Meta" }), "Meta");
  assert.equal(a.campaignLabel({}), amazon.UNNAMED);
  assert.ok(a.campaignLabel({ campaignId: "x".repeat(500) }).length <= 200);
});

test("what the sync builds passes the same validation an imported CSV gets", () => {
  const { rows } = a.rowsFromReport([entry(), entry({ date: "20260911", campaignId: "124" })]);
  const parsed = amazon.normaliseRows(rows, "2026-09-19");
  assert.equal(parsed.rows.length, 2);
  const [first] = parsed.rows;
  const db = amazon.toDbRow(first, { userId: USER, currency: "USD" });
  assert.equal(db.external_campaign, "Google Ads · 123");
  assert.equal(db.currency, "USD");
  assert.equal(db.campaign_id, null, "never linked to a campaign by guesswork");
});

// --- Reads only -----------------------------------------------------------------

const codeOnly = (source) => source.replace(/\/\*[^]*?\*\//g, "").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

test("it only ever reads: three endpoints, no write verbs against Amazon, and a report that asks for no more than the spec allows", () => {
  const source = codeOnly(readFileSync(new URL("../netlify/functions/bookpilot-lib/amazon-ads.js", import.meta.url), "utf8"));
  const calls = [...source.matchAll(/ads\(region, "(GET|POST|PUT|PATCH|DELETE)", "([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual([...new Set(calls)].sort(), [
    "GET /attribution/advertisers",
    "GET /v2/profiles",
    "POST /attribution/report", // a report is requested with POST; it changes nothing
  ]);
  assert.doesNotMatch(source, /"(PUT|PATCH|DELETE)"/, "no other verbs");
  assert.doesNotMatch(source, /\/(campaigns|adGroups|sp|sb|sd|dsp|targets|budgets|keywords)\b/i, "no advertising-resource paths");
  assert.doesNotMatch(source, /attribution\/tags|publisher-template|macroTag/, "no tag generation");
  assert.equal(a.SCOPE, "advertising::campaign_management");
});

test("the function file names no write path either, and returns through the callback page", () => {
  const source = codeOnly(readFileSync(new URL("../netlify/functions/bookpilot-amazon.mjs", import.meta.url), "utf8"));
  assert.doesNotMatch(source, /Response\.redirect\(/);
  assert.match(source, /backToApp\("amazon", "connected"\)/);
  assert.match(source, /backToApp\("amazon", "declined"\)/);
});

test("regions: Attribution's API is offered in North America and Europe only", () => {
  assert.deepEqual(Object.keys(a.REGIONS), ["na", "eu"]);
  for (const r of Object.values(a.REGIONS)) {
    assert.match(r.authorize, /^https:\/\/[a-z.]+amazon\.com\/ap\/oa$/);
    assert.match(r.token, /^https:\/\/api\.amazon\.(com|co\.uk)\/auth\/o2\/token$/);
    assert.match(r.api, /^https:\/\/advertising-api(-eu)?\.amazon\.com$/);
  }
  assert.ok(a.isRegion("na") && a.isRegion("eu") && !a.isRegion("fe") && !a.isRegion("toString") && !a.isRegion(undefined));
});

// --- Kindle pages read ----------------------------------------------------------

test("Kindle pages read and their estimated royalties are read, added up, and kept out of product sales", () => {
  const { rows, kindle } = a.rowsFromReport([
    entry({ kindleEditionNormalizedPagesRead14d: 1200, kindleEditionNormalizedPagesRoyalties14d: "4.32" }),
    entry({ adGroupId: "10", kindleEditionNormalizedPagesRead14d: "300", kindleEditionNormalizedPagesRoyalties14d: 1.08 }),
  ]);
  assert.equal(kindle, true);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kindle_pages_read, 1500);
  assert.equal(rows[0].kindle_royalties_cents, 540);
  assert.equal(rows[0].product_sales_cents, 1798 * 2, "royalties are not folded into sales");
});

test("no Kindle fields in the answer: zeros, and the caller is told none came back", () => {
  const { rows, kindle } = a.rowsFromReport([entry()]);
  assert.equal(kindle, false);
  assert.equal(rows[0].kindle_pages_read, 0);
  assert.equal(rows[0].kindle_royalties_cents, 0);
});

test("if Amazon rejects the Kindle metrics (400) the report is asked for again without them; nothing else falls back", async () => {
  const calls = route((_u, body) =>
    /kindle/i.test(body.metrics) ? [400, { code: "400", details: "Invalid metric for this advertiser" }] : [200, { reports: [{ n: 1 }] }]);
  const out = await a.reportWithKindle("na", "t", "1234567", { startDate: "20260901", endDate: "20260918" });
  assert.equal(out.kindle, false);
  assert.equal(out.entries.length, 1);
  assert.equal(calls.length, 2);
  assert.match(calls[0].body.metrics, /kindle/i);
  assert.doesNotMatch(calls[1].body.metrics, /kindle/i);

  const ok = route(() => [200, { reports: [{ n: 1 }] }]);
  assert.equal((await a.reportWithKindle("na", "t", "1234567", { startDate: "20260901", endDate: "20260918" })).kindle, true);
  assert.equal(ok.length, 1, "no second request when the first works");

  for (const status of [401, 403, 429, 500]) {
    const seen = route(() => [status, { code: String(status) }]);
    await assert.rejects(() => a.reportWithKindle("na", "t", "1234567", { startDate: "20260901", endDate: "20260918" }));
    assert.equal(seen.length, 1, `a ${status} is reported, not retried`);
  }

  route(() => [400, { code: "400" }]);
  await assert.rejects(
    () => a.reportWithKindle("na", "t", "1234567", { startDate: "20260901", endDate: "20260918" }),
    (e) => e.code === "amazon_action_failed",
    "a 400 that persists without Kindle is a real failure"
  );
});

test("the upstream status is kept for the caller but is not part of the message shown to the author", async () => {
  route(() => [400, { code: "400", details: "SECRET-DETAIL" }]);
  await assert.rejects(() => a.listProfiles("na", "t"), (e) => e.detail?.upstream === 400 && !/SECRET-DETAIL|400/.test(e.message));
});
