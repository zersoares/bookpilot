// The Google Ads connection: request shapes, error handling, and the logic
// that turns Google's answers into BookPilot rows.
//
// Nothing here reaches Google, and none of it has been run against a live
// Google Ads account (that needs a developer token approved for production
// and an OAuth app Google has verified). Fetch is stubbed and the requests
// are checked against Google's published discovery document for v25 and its
// documented OAuth endpoints. What this cannot prove is how Google answers in
// practice, so its answers are treated as untrusted and the first live sync
// is the real test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.GOOGLE_ADS_CLIENT_ID = "client-id.apps.googleusercontent.com";
process.env.GOOGLE_ADS_CLIENT_SECRET = "client-secret";
process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "dev-token";
process.env.GOOGLE_ADS_REDIRECT_URI = "https://example.test/api/bp-google/callback";
process.env.BOOKPILOT_OAUTH_STATE_SECRET = "state-secret";

const g = await import("../netlify/functions/bookpilot-lib/google-ads.js");

const USER = "d1000000-0000-4000-8000-000000000001";

/** Route fetch by URL; every call is recorded. A reply is [status, body]. */
function route(handler) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body instanceof URLSearchParams ? Object.fromEntries(init.body)
      : init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url: u, init, body });
    const [status, payload] = handler(u, body, calls.length);
    return new Response(JSON.stringify(payload), { status });
  };
  return calls;
}
const gaqlFailure = (status, family, code, message = "UPSTREAM") =>
  [status, { error: { code: status, message, status: "X", details: [{ errors: [{ errorCode: { [family]: code }, message }] }] } }];

// --- Authorization --------------------------------------------------------------

test("authorize URL: the one Ads scope, offline access, a consent prompt, our redirect and state", async () => {
  const url = new URL(g.authorizeUrl(await g.signState(USER)));
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  const q = url.searchParams;
  assert.equal(q.get("client_id"), "client-id.apps.googleusercontent.com");
  assert.equal(q.get("redirect_uri"), "https://example.test/api/bp-google/callback");
  assert.equal(q.get("response_type"), "code");
  assert.equal(q.get("scope"), "https://www.googleapis.com/auth/adwords", "the only scope this API has");
  assert.equal(q.get("access_type"), "offline", "a refresh token, or the connection ends in an hour");
  assert.equal(q.get("prompt"), "consent", "so a returning author still gets one");
  assert.equal(q.get("include_granted_scopes"), "false");
  assert.equal(await g.verifyState(q.get("state")), USER);
});

test("token exchange: a form POST to Google's token endpoint, and a refresh token is required", async () => {
  const calls = route(() => [200, { access_token: "at", refresh_token: "rt", expires_in: 3599, scope: g.SCOPE, token_type: "Bearer" }]);
  const tokens = await g.exchangeCode("the-code");
  const [call] = calls;
  assert.equal(call.url.href, "https://oauth2.googleapis.com/token");
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.deepEqual(call.body, {
    client_id: "client-id.apps.googleusercontent.com", client_secret: "client-secret",
    grant_type: "authorization_code", code: "the-code", redirect_uri: "https://example.test/api/bp-google/callback",
  });
  assert.deepEqual(tokens, { accessToken: "at", refreshToken: "rt", expiresIn: 3599, scope: g.SCOPE });

  route(() => [200, { access_token: "at", expires_in: 3599 }]);
  await assert.rejects(() => g.exchangeCode("x"), (e) => e.code === "google_connection_failed", "no refresh token, no connection");
});

test("token refresh uses the refresh grant, and a failed exchange never repeats Google's body", async () => {
  const calls = route(() => [200, { access_token: "at2", expires_in: 3599 }]);
  const fresh = await g.refreshTokens("rt");
  assert.equal(calls[0].body.grant_type, "refresh_token");
  assert.equal(calls[0].body.refresh_token, "rt");
  assert.equal(fresh.refreshToken, null, "Google does not rotate refresh tokens");

  route(() => [400, { error: "invalid_grant", error_description: "SECRET-DETAIL Token has been expired or revoked." }]);
  await assert.rejects(() => g.exchangeCode("bad"), (e) => e.code === "google_connection_failed" && !/SECRET-DETAIL|expired/.test(e.message));
});

test("revoking posts the token to Google's revoke endpoint", async () => {
  const calls = route(() => [200, {}]);
  await g.revokeToken("the-refresh-token");
  assert.equal(calls[0].url.href, "https://oauth2.googleapis.com/revoke");
  assert.deepEqual(calls[0].body, { token: "the-refresh-token" });
  route(() => [400, { error: "invalid_token" }]);
  await assert.rejects(() => g.revokeToken("dead"), (e) => e.code === "google_action_failed");
});

// --- Errors ---------------------------------------------------------------------

test("errors are plain sentences, and an unapproved developer token is named as ours", async () => {
  route(() => gaqlFailure(403, "authorizationError", "DEVELOPER_TOKEN_NOT_APPROVED", "UPSTREAM-1"));
  await assert.rejects(() => g.search("t", "1234567890", "SELECT customer.id FROM customer"), (e) => {
    assert.equal(e.code, "google_ads_not_approved");
    assert.equal(e.status, 503);
    assert.match(e.message, /on our side/);
    assert.doesNotMatch(e.message, /UPSTREAM/);
    return true;
  });
  route(() => gaqlFailure(401, "authenticationError", "OAUTH_TOKEN_INVALID", "UPSTREAM-2"));
  await assert.rejects(() => g.search("t", "1234567890", "q"), (e) => e.code === "google_connection_failed" && !/UPSTREAM/.test(e.message));
  route(() => [401, { error: { code: 401, status: "UNAUTHENTICATED", message: "UPSTREAM-3" } }]);
  await assert.rejects(() => g.search("t", "1234567890", "q"), (e) => e.code === "google_connection_failed");
  route(() => [429, { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "UPSTREAM-4" } }]);
  await assert.rejects(() => g.search("t", "1234567890", "q"), (e) => e.status === 429 && !/UPSTREAM/.test(e.message));
  route(() => gaqlFailure(400, "queryError", "UNRECOGNIZED_FIELD", "UPSTREAM-5"));
  await assert.rejects(() => g.search("t", "1234567890", "q"), (e) => e.code === "google_action_failed" && !/UPSTREAM/.test(e.message));
  route(() => [500, "not json"]);
  await assert.rejects(() => g.search("t", "1234567890", "q"), (e) => e.code === "google_action_failed");
});

test("error codes are read out of Google's nested detail", () => {
  const body = { error: { details: [{ errors: [{ errorCode: { authorizationError: "USER_PERMISSION_DENIED" } }, { errorCode: { quotaError: "RESOURCE_EXHAUSTED" } }] }] } };
  assert.deepEqual(g.errorCodes(body), [["authorizationError", "USER_PERMISSION_DENIED"], ["quotaError", "RESOURCE_EXHAUSTED"]]);
  assert.deepEqual(g.errorCodes({}), []);
  assert.deepEqual(g.errorCodes(null), []);
});

// --- Reading ----------------------------------------------------------------------

test("search: a POST to the account's googleAds:search with the token and developer token, and no pageSize", async () => {
  const calls = route(() => [200, { results: [] }]);
  await g.search("tok", "1234567890", "SELECT customer.id FROM customer");
  const [call] = calls;
  assert.equal(call.url.href, "https://googleads.googleapis.com/v25/customers/1234567890/googleAds:search");
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.headers.Authorization, "Bearer tok");
  assert.equal(call.init.headers["developer-token"], "dev-token");
  assert.deepEqual(call.body, { query: "SELECT customer.id FROM customer" });
  assert.equal("pageSize" in call.body, false, "v25 rejects pageSize with PAGE_SIZE_NOT_SUPPORTED");
});

test("search: follows nextPageToken to the end", async () => {
  const calls = route((_u, body) => (body.pageToken === "p2" ? [200, { results: [{ n: 2 }] }] : [200, { results: [{ n: 1 }], nextPageToken: "p2" }]));
  const rows = await g.search("tok", "1234567890", "q");
  assert.deepEqual(rows, [{ n: 1 }, { n: 2 }]);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.pageToken, "p2");
});

test("search: a malformed account id never reaches the network", async () => {
  const calls = route(() => [200, { results: [] }]);
  for (const bad of ["../../x", "12 34", "", "abc", "1234567890/../x"]) {
    await assert.rejects(() => g.search("tok", bad, "q"), (e) => e.status === 400, bad);
  }
  assert.equal(calls.length, 0);
});

test("accounts: listed with currency and time zone; managers and unreadable accounts are left out", async () => {
  const calls = route((u, body) => {
    if (u.pathname.endsWith("listAccessibleCustomers")) return [200, { resourceNames: ["customers/1111111111", "customers/2222222222", "customers/3333333333", "customers/4444444444", "junk"] }];
    const id = u.pathname.split("/")[3]; // /v25/customers/<id>/googleAds:search
    if (id === "1111111111") return [200, { results: [{ customer: { id: "1111111111", descriptiveName: "Books EU", currencyCode: "EUR", timeZone: "Europe/Berlin", manager: false } }] }];
    if (id === "2222222222") return [200, { results: [{ customer: { id: "2222222222", descriptiveName: "Agency", currencyCode: "USD", manager: true } }] }];
    if (id === "3333333333") return gaqlFailure(403, "authorizationError", "CUSTOMER_NOT_ENABLED");
    return [200, { results: [{ customer: { id: "4444444444", currencyCode: "GBP", timeZone: "Europe/London" } }] }];
  });
  const accounts = await g.listAdAccounts("tok");

  assert.equal(calls[0].url.href, "https://googleads.googleapis.com/v25/customers:listAccessibleCustomers");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers["developer-token"], "dev-token");
  assert.deepEqual(accounts, [
    { id: "1111111111", name: "Books EU", currency: "EUR", timezone: "Europe/Berlin" },
    { id: "4444444444", name: "Account 4444444444", currency: "GBP", timezone: "Europe/London" },
  ]);
  const detail = calls.find((c) => c.body?.query);
  assert.match(detail.body.query, /customer\.currency_code/);
  assert.match(detail.body.query, /customer\.manager/);
});

test("accounts: a revoked login stops the listing instead of hiding behind empty results", async () => {
  route((u) => (u.pathname.endsWith("listAccessibleCustomers")
    ? [200, { resourceNames: ["customers/1111111111"] }]
    : gaqlFailure(401, "authenticationError", "OAUTH_TOKEN_INVALID")));
  await assert.rejects(() => g.listAdAccounts("tok"), (e) => e.code === "google_connection_failed");
});

// --- The reports -----------------------------------------------------------------------

test("the campaign query: by day, cost in micros, the real status, removed campaigns excluded", () => {
  const q = g.campaignQuery({ since: "2026-08-20", until: "2026-09-18" });
  for (const part of ["campaign.id", "campaign.name", "campaign.status", "segments.date", "metrics.impressions", "metrics.clicks", "metrics.cost_micros", "FROM campaign"]) {
    assert.ok(q.includes(part), part);
  }
  assert.match(q, /segments\.date BETWEEN '2026-08-20' AND '2026-09-18'/);
  assert.match(q, /campaign\.status != 'REMOVED'/);
  assert.doesNotMatch(q, /metrics\.conversions/, "purchases come from their own query");
});

test("the purchase query counts the Purchase category only, and selects the segment it filters on", () => {
  const q = g.purchaseQuery({ since: "2026-08-20", until: "2026-09-18" });
  assert.match(q, /segments\.conversion_action_category = 'PURCHASE'/);
  assert.match(q, /SELECT [^]*segments\.conversion_action_category[^]* FROM campaign/, "selected as well as filtered");
  assert.ok(q.includes("metrics.conversions_value") && q.includes("metrics.conversions"));
});

test("dates are validated before they go into a query", () => {
  for (const bad of ["2026-08-20' OR '1'='1", "yesterday", "2026-8-2", "", null]) {
    assert.throws(() => g.campaignQuery({ since: bad, until: "2026-09-18" }), (e) => e.status === 400, String(bad));
    assert.throws(() => g.purchaseQuery({ since: "2026-08-20", until: bad }), (e) => e.status === 400, String(bad));
  }
});

test("report: runs both queries against the chosen account", async () => {
  const calls = route((_u, body) => [200, { results: [{ q: body.query.includes("conversion_action_category") ? "purchases" : "base" }] }]);
  const { base, purchases } = await g.report("tok", "1234567890", { since: "2026-08-20", until: "2026-09-18" });
  assert.equal(calls.length, 2);
  assert.deepEqual([base[0].q, purchases[0].q], ["base", "purchases"]);
});

// --- Pure helpers -----------------------------------------------------------------------

test("figures: int64 strings and doubles; junk and negatives are zero; micros become cents", () => {
  assert.equal(g.figure("12345"), 12345);
  assert.equal(g.figure(2.5), 2.5);
  assert.equal(g.figure(undefined), 0);
  assert.equal(g.figure("-3"), 0);
  assert.equal(g.figure("abc"), 0);
  assert.equal(g.microsToCents("12400000"), 1240);
  assert.equal(g.microsToCents(1_000_000), 100);
  assert.equal(g.microsToCents(4_999), 0);
  assert.equal(g.microsToCents(5_000), 1);
});

test("the date range is n days ending yesterday", () => {
  const now = Date.parse("2026-09-19T12:00:00Z");
  assert.deepEqual(g.dateRange(30, now), { since: "2026-08-20", until: "2026-09-18", days: 30 });
  const span = (r) => (Date.parse(r.until) - Date.parse(r.since)) / 86_400_000 + 1;
  assert.equal(span(g.dateRange(90, now)), 90);
  assert.equal(span(g.dateRange(1, now)), 1);
  assert.equal(g.dateRange(500, now).days, 90, "clamped");
  assert.equal(g.dateRange(-2, now).days, 1);
  assert.equal(g.dateRange(0, now).days, 30, "nothing given means the default");
});

test("status is Google's own: enabled is active, anything else is paused", () => {
  assert.equal(g.statusFor("ENABLED"), "active");
  assert.equal(g.statusFor("PAUSED"), "paused");
  assert.equal(g.statusFor("UNKNOWN"), "paused");
  assert.equal(g.statusFor(undefined), "paused");
});

test("campaigns: as Google names them, with the latest status and a fallback name", () => {
  const rows = [
    { campaign: { id: "5", name: "Spring Search", status: "ENABLED" } },
    { campaign: { id: "5", name: "Spring Search", status: "PAUSED" } },
    { campaign: { id: "6", name: "  ", status: "ENABLED" } },
    { campaign: {} },
    {},
  ];
  assert.deepEqual(g.campaignsFromReport(rows), [
    { id: "5", name: "Spring Search", status: "PAUSED" },
    { id: "6", name: "Campaign 6", status: "ENABLED" },
  ]);
});

test("rows: the two reports merge per campaign-day, cost in cents, purchases from the purchase report only", () => {
  const map = new Map([["5", "campaign-uuid"]]);
  const base = [
    { campaign: { id: "5" }, segments: { date: "2026-09-01" }, metrics: { impressions: "900", clicks: "40", costMicros: "12400000" } },
    { campaign: { id: "5" }, segments: { date: "2026-09-02" }, metrics: { impressions: "100", clicks: "5", costMicros: "0" } },
  ];
  const purchases = [
    { campaign: { id: "5" }, segments: { date: "2026-09-01", conversionActionCategory: "PURCHASE" }, metrics: { conversions: 1.6, conversionsValue: 17.98 } },
  ];
  const rows = g.toPerformanceRows(base, purchases, map, "2026-09-19T00:00:00Z");

  assert.deepEqual(rows.find((r) => r.metric_date === "2026-09-01"), {
    campaign_id: "campaign-uuid", ad_id: null, metric_date: "2026-09-01", source: "google",
    impressions: 900, reach: 0, clicks: 40, spend_cents: 1240, conversions: 2, revenue_cents: 1798,
    synced_at: "2026-09-19T00:00:00Z",
  });
  const quiet = rows.find((r) => r.metric_date === "2026-09-02");
  assert.deepEqual([quiet.conversions, quiet.revenue_cents], [0, 0], "a day with no purchases has none");
  assert.equal(rows.length, 2);
});

test("rows: a purchase on a day with no other activity still counts; strangers and bad dates do not", () => {
  const map = new Map([["5", "u"]]);
  const rows = g.toPerformanceRows(
    [
      { campaign: { id: "999" }, segments: { date: "2026-09-01" }, metrics: { impressions: "5" } },
      { campaign: { id: "5" }, segments: { date: "01/09/2026" }, metrics: { impressions: "5" } },
      { campaign: { id: "5" }, metrics: { impressions: "5" } },
    ],
    [{ campaign: { id: "5" }, segments: { date: "2026-09-03" }, metrics: { conversions: 2, conversionsValue: 9 } }],
    map,
  );
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].metric_date, rows[0].conversions, rows[0].revenue_cents, rows[0].impressions], ["2026-09-03", 2, 900, 0]);
});

// --- What it will and will not do --------------------------------------------------------

/** Source without comments, so a guard tests what runs, not what is explained. */
const codeOnly = (source) => source.replace(/\/\*[^]*?\*\//g, "").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

test("it only ever reads: two endpoints, no mutate, no pageSize, and a current API version", () => {
  const source = codeOnly(readFileSync(new URL("../netlify/functions/bookpilot-lib/google-ads.js", import.meta.url), "utf8"));
  const calls = [...source.matchAll(/ads\("(GET|POST)", [`"]([^`"]+)[`"]/g)].map((m) => `${m[1]} ${m[2].replace(/\$\{[^}]+\}/g, "{id}")}`);
  assert.deepEqual([...new Set(calls)].sort(), [
    "GET /customers:listAccessibleCustomers",
    "POST /customers/{id}/googleAds:search",
  ]);
  assert.doesNotMatch(source, /:mutate|Service\/Mutate|googleAds:mutate|batchJobs|\/campaigns:|\/adGroups:|\/customers\/\{id\}\/(campaigns|adGroups|ads|campaignBudgets)/, "no write endpoints anywhere");
  assert.doesNotMatch(source, /pageSize\s*[:=]/, "pageSize is never sent");
  assert.ok(Number(g.API_VERSION.replace("v", "")) >= 25, `${g.API_VERSION} is older than the version the fields were checked against`);
});

test("the function file names no write path either, and returns through the callback page", () => {
  const source = codeOnly(readFileSync(new URL("../netlify/functions/bookpilot-google.mjs", import.meta.url), "utf8"));
  assert.doesNotMatch(source, /mutate|Response\.redirect\(/);
  assert.match(source, /backToApp\("google", "connected"\)/);
});
