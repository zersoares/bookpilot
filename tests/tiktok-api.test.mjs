// The TikTok connection: request shapes, error handling, and the logic that
// turns TikTok's answers into BookPilot rows.
//
// Nothing here reaches TikTok, and none of it has been run against a live
// TikTok account (that needs an approved developer app). Fetch is stubbed and
// the requests are checked against TikTok's own documentation and its
// official SDK's OpenAPI files: endpoint paths, the Access-Token header, JSON
// bodies for the token calls, JSON-encoded array query parameters, the
// 30-day window for a daily report. What this cannot prove is how TikTok
// answers in practice, so its answers are treated as untrusted and the first
// live sync is the real test.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.TIKTOK_APP_ID = "7000000000";
process.env.TIKTOK_APP_SECRET = "app-secret";
process.env.TIKTOK_AUTH_URL =
  "https://business-api.tiktok.com/portal/auth?app_id=7000000000&state=your_custom_params&redirect_uri=https%3A%2F%2Fexample.test%2Fapi%2Fbp-tiktok%2Fcallback";
process.env.BOOKPILOT_OAUTH_STATE_SECRET = "state-secret";

const tt = await import("../netlify/functions/bookpilot-lib/tiktok.js");
const { env } = await import("../netlify/functions/bookpilot-lib/env.js");
const { readFileSync } = await import("node:fs");

const USER = "d1000000-0000-4000-8000-000000000001";

/** Stub fetch with a queue of replies; returns the recorded calls. */
function stubFetch(...replies) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: new URL(url), init, body: init.body ? JSON.parse(String(init.body)) : null });
    const reply = replies.length > 1 ? replies.shift() : replies[0];
    return new Response(JSON.stringify(reply.body ?? { code: 0, message: "OK", data: reply.data ?? {} }), { status: reply.status ?? 200 });
  };
  return calls;
}
const ok = (data) => ({ data });
const fail = (code, message, status = 200) => ({ status, body: { code, message, request_id: "r" } });

// --- Authorization -------------------------------------------------------------

test("the authorization URL is TikTok's own, with only our state set", async () => {
  const state = await tt.signState(USER);
  const url = new URL(tt.authorizeUrl(state));
  assert.equal(url.origin + url.pathname, "https://business-api.tiktok.com/portal/auth");
  assert.equal(url.searchParams.get("app_id"), "7000000000");
  assert.equal(url.searchParams.get("redirect_uri"), "https://example.test/api/bp-tiktok/callback", "the portal's redirect is kept as given");
  assert.equal(url.searchParams.get("state"), state, "the placeholder state is replaced");
  assert.equal(await tt.verifyState(url.searchParams.get("state")), USER);
});

test("a wrong authorization URL is refused, not used", () => {
  const good = env.tiktokAuthUrl;
  try {
    for (const bad of [
      "https://evil.example/portal/auth?app_id=7000000000",
      "http://business-api.tiktok.com/portal/auth?app_id=7000000000",
      "https://tiktok.com.evil.example/portal/auth?app_id=7000000000",
      "https://business-api.tiktok.com/portal/auth?app_id=999",
      "not a url",
    ]) {
      env.tiktokAuthUrl = bad;
      assert.throws(() => tt.authorizeUrl("s"), (e) => e.status === 501, bad);
    }
    env.tiktokAuthUrl = "https://ads.tiktok.com/marketing_api/auth?app_id=7000000000";
    assert.doesNotThrow(() => tt.authorizeUrl("s"), "TikTok's other host is fine");
  } finally {
    env.tiktokAuthUrl = good;
  }
});

test("token exchange: a JSON POST with the app credentials and the auth_code", async () => {
  const calls = stubFetch(ok({ access_token: "long-term", advertiser_ids: ["111", 222], scope: [10, 4] }));
  const tokens = await tt.exchangeCode("the-auth-code");
  const [call] = calls;
  assert.equal(call.url.href, "https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/");
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.headers["Content-Type"], "application/json");
  assert.equal(call.init.headers["Access-Token"], undefined, "there is no token yet");
  assert.deepEqual(call.body, { app_id: "7000000000", secret: "app-secret", auth_code: "the-auth-code" });
  assert.deepEqual(tokens, { accessToken: "long-term", advertiserIds: ["111", "222"], scope: [10, 4] });
});

test("a failed exchange throws a plain error and never repeats TikTok's message", async () => {
  stubFetch(fail(40002, "auth_code is invalid SECRET-DETAIL"));
  await assert.rejects(() => tt.exchangeCode("bad"), (e) => {
    assert.equal(e.code, "tiktok_action_failed");
    assert.doesNotMatch(e.message, /SECRET-DETAIL|auth_code/);
    return true;
  });
  stubFetch(ok({}));
  await assert.rejects(() => tt.exchangeCode("x"), (e) => e.code === "tiktok_connection_failed", "no token in the answer");
});

test("tokens are revoked with the Access-Token header and a body naming the token", async () => {
  const calls = stubFetch(ok({ advertiser_ids: ["111"], app_id: "7000000000" }));
  await tt.revokeToken("long-term");
  const [call] = calls;
  assert.equal(call.url.pathname, "/open_api/v1.3/oauth2/revoke_token/");
  assert.equal(call.init.headers["Access-Token"], "long-term");
  assert.deepEqual(call.body, { app_id: "7000000000", secret: "app-secret", access_token: "long-term" });
});

// --- Errors ----------------------------------------------------------------------

test("errors are plain sentences: revoked access, rate limit, anything else", async () => {
  // TikTok answers HTTP 200 with a non-zero code, so the code is what counts.
  stubFetch(fail(40105, "Access token is incorrect or has been revoked UPSTREAM-1"));
  await assert.rejects(() => tt.listAdAccounts("t"), (e) => e.code === "tiktok_connection_failed" && !/UPSTREAM/.test(e.message));
  stubFetch({ status: 401, body: { code: 40105, message: "UPSTREAM-2" } });
  await assert.rejects(() => tt.listAdAccounts("t"), (e) => e.code === "tiktok_connection_failed" && !/UPSTREAM/.test(e.message));
  stubFetch({ status: 429, body: { code: 40100, message: "UPSTREAM-3" } });
  await assert.rejects(() => tt.listAdAccounts("t"), (e) => e.status === 429 && !/UPSTREAM/.test(e.message));
  stubFetch(fail(50000, "System error UPSTREAM-4"));
  await assert.rejects(() => tt.listAdAccounts("t"), (e) => e.code === "tiktok_action_failed" && !/UPSTREAM/.test(e.message));
  stubFetch({ status: 200, body: "not json" });
  await assert.rejects(() => tt.listAdAccounts("t"), (e) => e.code === "tiktok_action_failed");
});

// --- Reading -----------------------------------------------------------------------

test("ad accounts: the list from OAuth, details from the account endpoint, arrays as JSON", async () => {
  const calls = stubFetch(
    ok({ list: [{ advertiser_id: 111, advertiser_name: "Books EU" }, { advertiser_id: 222 }] }),
    ok({ list: [{ advertiser_id: "111", name: "Books EU (real)", currency: "EUR", timezone: "Europe/Berlin" }] }),
  );
  const accounts = await tt.listAdAccounts("tok");

  assert.equal(calls[0].url.pathname, "/open_api/v1.3/oauth2/advertiser/get/");
  assert.equal(calls[0].init.headers["Access-Token"], "tok");
  assert.equal(calls[0].url.searchParams.get("app_id"), "7000000000");
  assert.equal(calls[0].url.searchParams.get("secret"), "app-secret");

  assert.equal(calls[1].url.pathname, "/open_api/v1.3/advertiser/info/");
  assert.deepEqual(JSON.parse(calls[1].url.searchParams.get("advertiser_ids")), ["111", "222"]);
  assert.deepEqual(JSON.parse(calls[1].url.searchParams.get("fields")), ["advertiser_id", "name", "currency", "timezone"]);

  assert.deepEqual(accounts, [
    { id: "111", name: "Books EU (real)", currency: "EUR", timezone: "Europe/Berlin" },
    { id: "222", name: "Ad account 222", currency: null, timezone: null },
  ]);
});

test("ad accounts: still listed, with no currency, if the details cannot be read", async () => {
  stubFetch(
    ok({ list: [{ advertiser_id: 111, advertiser_name: "Books EU" }] }),
    fail(40001, "No permission to access this endpoint"),
  );
  const accounts = await tt.listAdAccounts("tok");
  assert.deepEqual(accounts, [{ id: "111", name: "Books EU", currency: null, timezone: null }]);
});

test("the report: basic, campaign level, daily, JSON arrays, the documented metric names", async () => {
  const calls = stubFetch(ok({ list: [], page_info: { page: 1, total_page: 1 } }));
  await tt.reportRows("tok", "111", [{ since: "2026-08-20", until: "2026-09-18" }]);
  const [call] = calls;
  const q = call.url.searchParams;
  assert.equal(call.init.method, "GET");
  assert.equal(call.url.pathname, "/open_api/v1.3/report/integrated/get/");
  assert.equal(call.init.headers["Access-Token"], "tok");
  assert.equal(q.get("advertiser_id"), "111");
  assert.equal(q.get("report_type"), "BASIC");
  assert.equal(q.get("data_level"), "AUCTION_CAMPAIGN");
  assert.deepEqual(JSON.parse(q.get("dimensions")), ["campaign_id", "stat_time_day"]);
  const metrics = JSON.parse(q.get("metrics"));
  for (const name of ["campaign_name", "spend", "impressions", "clicks", "complete_payment", "total_complete_payment_rate"]) {
    assert.ok(metrics.includes(name), name);
  }
  assert.equal(q.get("start_date"), "2026-08-20");
  assert.equal(q.get("end_date"), "2026-09-18");
  assert.equal(q.get("page_size"), "1000");
});

test("the report: one request per window and per page", async () => {
  const calls = stubFetch(
    ok({ list: [{ n: 1 }], page_info: { page: 1, total_page: 2 } }),
    ok({ list: [{ n: 2 }], page_info: { page: 2, total_page: 2 } }),
    ok({ list: [{ n: 3 }], page_info: { page: 1, total_page: 1 } }),
  );
  const rows = await tt.reportRows("tok", "111", [
    { since: "2026-08-01", until: "2026-08-30" },
    { since: "2026-08-31", until: "2026-09-18" },
  ]);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((c) => [c.url.searchParams.get("start_date"), c.url.searchParams.get("page")]),
    [["2026-08-01", "1"], ["2026-08-01", "2"], ["2026-08-31", "1"]]);
  assert.deepEqual(rows.map((r) => r.n), [1, 2, 3]);
});

// --- Pure helpers ------------------------------------------------------------------

test("figures: strings from TikTok, with dashes, junk and negatives as zero", () => {
  assert.equal(tt.figure("12.40"), 12.4);
  assert.equal(tt.figure("1,234.50"), 1234.5);
  assert.equal(tt.figure("-"), 0);
  assert.equal(tt.figure(""), 0);
  assert.equal(tt.figure(undefined), 0);
  assert.equal(tt.figure("-5"), 0);
  assert.equal(tt.figure("abc"), 0);
});

test("cents: exact from the string, so half a cent cannot round the wrong way", () => {
  assert.equal(tt.cents("12.40"), 1240);
  assert.equal(tt.cents("1.005"), 101);
  assert.equal(tt.cents("0.29"), 29);
  assert.equal(tt.cents("1,234.50"), 123450);
  assert.equal(tt.cents("100"), 10000);
  assert.equal(tt.cents(".5"), 50);
  for (const junk of ["-", "", undefined, null, "-5", "abc", "1e3", "1.2.3"]) assert.equal(tt.cents(junk), 0, String(junk));
});

test("windows: never more than 30 days, contiguous, ending yesterday", () => {
  const now = Date.parse("2026-09-19T12:00:00Z");
  const one = tt.dateWindows(30, now);
  assert.equal(one.windows.length, 1);
  assert.deepEqual(one.windows[0], { since: "2026-08-20", until: "2026-09-18" });
  assert.equal(one.until, "2026-09-18", "yesterday, not today");

  for (const days of [7, 31, 45, 60, 90]) {
    const w = tt.dateWindows(days, now);
    let total = 0;
    w.windows.forEach((win, i) => {
      const span = (Date.parse(win.until) - Date.parse(win.since)) / 86_400_000 + 1;
      assert.ok(span <= 30, `${days}: window ${i} is ${span} days`);
      total += span;
      if (i > 0) assert.equal((Date.parse(win.since) - Date.parse(w.windows[i - 1].until)) / 86_400_000, 1, "no gap and no overlap");
    });
    assert.equal(total, days, `${days} days covered exactly`);
    assert.equal(w.windows.at(-1).until, "2026-09-18");
  }
  assert.equal(tt.dateWindows(500, now).days, 90, "clamped");
  assert.equal(tt.dateWindows(-3, now).days, 1);
  assert.equal(tt.dateWindows(0, now).days, 30, "nothing given means the default");
});

test("campaigns: named as TikTok names them, with a fallback for the unnamed", () => {
  const list = [
    { dimensions: { campaign_id: "5" }, metrics: { campaign_name: "Spring TikTok" } },
    { dimensions: { campaign_id: "5" }, metrics: { campaign_name: "Spring TikTok" } },
    { dimensions: { campaign_id: "6" }, metrics: { campaign_name: "-" } },
    { dimensions: { campaign_id: "7" }, metrics: {} },
    { dimensions: {}, metrics: { campaign_name: "no id" } },
  ];
  assert.deepEqual(tt.campaignsFromReport(list), [
    { id: "5", name: "Spring TikTok" }, { id: "6", name: "Campaign 6" }, { id: "7", name: "Campaign 7" },
  ]);
});

test("rows: documented metrics mapped, money to cents, the purchase value from its odd name", () => {
  const map = new Map([["5", "campaign-uuid"]]);
  const rows = tt.toPerformanceRows([
    { dimensions: { campaign_id: "5", stat_time_day: "2026-09-01 00:00:00" },
      metrics: { campaign_name: "x", spend: "12.40", impressions: "900", clicks: "40", complete_payment: "2", total_complete_payment_rate: "17.98" } },
    { dimensions: { campaign_id: "5", stat_time_day: "2026-09-02 00:00:00" }, metrics: { spend: "-", impressions: "100" } },
  ], map, "2026-09-19T00:00:00Z");

  assert.deepEqual(rows[0], {
    campaign_id: "campaign-uuid", ad_id: null, metric_date: "2026-09-01", source: "tiktok",
    impressions: 900, reach: 0, clicks: 40, spend_cents: 1240, conversions: 2, revenue_cents: 1798,
    synced_at: "2026-09-19T00:00:00Z",
  });
  assert.deepEqual([rows[1].spend_cents, rows[1].clicks, rows[1].conversions], [0, 0, 0], "a dash is zero, not an error");
  assert.equal(tt.toPerformanceRows([{ dimensions: { campaign_id: "5", stat_time_day: "2026-09-01 00:00:00" }, metrics: { spend: "0.29" } }], map)[0].spend_cents, 29);
  assert.equal(tt.toPerformanceRows([{ dimensions: { campaign_id: "5", stat_time_day: "2026-09-01 00:00:00" }, metrics: { spend: "1.005" } }], map)[0].spend_cents, 101, "half a cent rounds up");
});

test("rows: unknown campaigns and bad dates are not stored", () => {
  const map = new Map([["5", "u"]]);
  const rows = tt.toPerformanceRows([
    { dimensions: { campaign_id: "999", stat_time_day: "2026-09-01 00:00:00" }, metrics: { spend: "1" } },
    { dimensions: { campaign_id: "5", stat_time_day: "yesterday" }, metrics: { spend: "1" } },
    { dimensions: { campaign_id: "5" }, metrics: { spend: "1" } },
    { metrics: { spend: "1" } },
  ], map);
  assert.equal(rows.length, 0);
});

test("status is inferred from recent spend, because status itself is not requested", () => {
  const rows = (...pairs) => pairs.map(([metric_date, spend_cents]) => ({ metric_date, spend_cents }));
  assert.equal(tt.statusFromSpend(rows(["2026-09-18", 500]), "2026-09-18"), "active");
  assert.equal(tt.statusFromSpend(rows(["2026-09-16", 500]), "2026-09-18"), "active", "within the last three days");
  assert.equal(tt.statusFromSpend(rows(["2026-09-15", 500]), "2026-09-18"), "paused");
  assert.equal(tt.statusFromSpend(rows(["2026-09-18", 0]), "2026-09-18"), "paused", "delivering nothing is not running");
  assert.equal(tt.statusFromSpend([], "2026-09-18"), "paused");
});

test("it asks for no more than reporting and ad-account information, and never writes", () => {
  const source = readFileSync(new URL("../netlify/functions/bookpilot-lib/tiktok.js", import.meta.url), "utf8");
  const paths = [...source.matchAll(/call\("(GET|POST)", "([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(paths.sort(), [
    "GET /advertiser/info/",
    "GET /oauth2/advertiser/get/",
    "GET /report/integrated/get/",
    "POST /oauth2/access_token/",
    "POST /oauth2/revoke_token/",
  ]);
  assert.doesNotMatch(source, /\/campaign\/(create|update)|\/adgroup\/|\/ad\/(create|update)|status\/update|\/budget\//, "no write endpoints anywhere");
});
