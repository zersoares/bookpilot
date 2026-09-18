// The Meta client: the Graph version it speaks, and that everything it
// creates is created paused. Fetch is stubbed; nothing here reaches Meta.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.META_APP_ID = "123";
process.env.META_APP_SECRET = "secret";
process.env.META_REDIRECT_URI = "https://example.test/api/bp-meta/callback";
process.env.BOOKPILOT_OAUTH_STATE_SECRET = "state-secret";

const meta = await import("../netlify/functions/bookpilot-lib/meta.js");

function stubFetch(reply = { id: "999" }) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: new URL(url), init });
    return new Response(JSON.stringify(reply), { status: 200 });
  };
  return calls;
}

test("the Graph version is one Meta still supports", () => {
  const dialog = new URL(meta.authorizeUrl("state"));
  const version = /\/(v\d+\.\d+)\/dialog\/oauth$/.exec(dialog.pathname)?.[1];
  assert.ok(version, "the OAuth dialog URL carries a version");
  const [major] = version.slice(1).split(".").map(Number);
  // v21 is retired on 2027-01-21; anything older is already gone.
  assert.ok(major >= 22, `${version} is too old to rely on`);
});

test("API calls and the OAuth dialog use the same version", async () => {
  const dialog = new URL(meta.authorizeUrl("s"));
  const dialogVersion = /\/(v\d+\.\d+)\//.exec(dialog.pathname)[1];
  const calls = stubFetch({ data: [] });
  await meta.listAdAccounts("tok");
  assert.match(calls[0].url.pathname, new RegExp(`^/${dialogVersion.replace(".", "\.")}/me/adaccounts`));
});

test("an ad set sets its budget-sharing flag and is created paused", async () => {
  const calls = stubFetch();
  await meta.createAdSet("tok", "act_1", {
    name: "Set", campaignId: "c1", dailyBudgetCents: 500, targeting: { age_min: 25 },
  });
  const p = calls[0].url.searchParams;
  // Mandatory alongside an ad-set budget from Graph v24.
  assert.equal(p.get("is_adset_budget_sharing_enabled"), "false");
  assert.equal(p.get("daily_budget"), "500");
  assert.equal(p.get("status"), "PAUSED");
});

test("campaigns and ads are created paused", async () => {
  const campaign = stubFetch();
  await meta.createCampaign("tok", "act_1", { name: "C" });
  assert.equal(campaign[0].url.searchParams.get("status"), "PAUSED");

  const ads = stubFetch();
  await meta.createAd("tok", "act_1", {
    name: "Ad", adSetId: "s1", pageId: "p1", message: "m", headline: "h", description: "d", linkUrl: "https://x.test",
  });
  const adCall = ads.find((c) => c.url.pathname.endsWith("/ads"));
  assert.equal(adCall.url.searchParams.get("status"), "PAUSED");
});
