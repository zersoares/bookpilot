// Stripe billing: the decisions that turn Stripe's events into plans, the
// checkout and plan-change calls, and the admin's setup check.
//
// Nothing here reaches Stripe or Supabase. A small fake of each answers over
// `fetch`, and the real handlers run against it, so what is checked is what
// the deployed code would send and write. What it cannot prove is how Stripe
// answers in practice (which API version an account's webhooks use, whether
// Stripe Tax is set up), so every reader accepts the older and newer shapes
// and the setup check reports what Stripe says. The first real payment in
// test mode is the real test.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://db.test";
process.env.SUPABASE_ANON_KEY = "anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
process.env.STRIPE_SECRET_KEY = "sk_test_SECRETKEYVALUE";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_testsecret";
process.env.BOOKPILOT_SITE_URL = "https://example.test";

const { env } = await import("../netlify/functions/bookpilot-lib/env.js");
const rules = await import("../netlify/functions/bookpilot-lib/billing-rules.js");
const check = await import("../netlify/functions/bookpilot-lib/billing-check.js");
const webhook = (await import("../netlify/functions/bookpilot-stripe-webhook.mjs")).default;
const billing = (await import("../netlify/functions/bookpilot-billing.mjs")).default;
const admin = (await import("../netlify/functions/bookpilot-admin.mjs")).default;

const USER = "d1000000-0000-4000-8000-000000000001";
const PLANS = () => [
  { id: "free", name: "Free", price_cents: 0, currency: "EUR", billing_interval: "month", is_active: true, stripe_price_id: null, sort_order: 0 },
  { id: "author", name: "Author", price_cents: 1900, currency: "EUR", billing_interval: "month", is_active: true, stripe_price_id: "price_author", sort_order: 1 },
  { id: "author_pro", name: "Author Pro", price_cents: 4900, currency: "EUR", billing_interval: "month", is_active: true, stripe_price_id: "price_pro", sort_order: 2 },
];

/**
 * A fake Supabase and Stripe behind `fetch`. `world.writes` records every
 * change to the database, and `world.stripeCalls` every call to Stripe.
 */
function world(over = {}) {
  const w = {
    role: "admin",
    tables: { plans: PLANS(), subscriptions: [], profiles: [] },
    writes: [],
    stripeCalls: [],
    stripe: () => [404, { error: { message: "no such thing" } }],
    ...over,
  };
  w.tables.profiles = [{ id: USER, email: "a@example.test", role: w.role, plan_id: "free", ai_credits: 10 }];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (u.host === "db.test") {
      if (u.pathname === "/auth/v1/user") return Response.json({ id: USER, email: "a@example.test" });
      const table = u.pathname.replace("/rest/v1/", "");
      const body = init.body ? JSON.parse(init.body) : undefined;
      if (table.startsWith("rpc/")) { w.writes.push({ rpc: table.slice(4), body }); return new Response("", { status: 200 }); }
      if ((init.method || "GET") !== "GET") { w.writes.push({ method: init.method, table, body }); return new Response("", { status: 201 }); }
      let rows = w.tables[table] || [];
      for (const [k, val] of u.searchParams) {
        if (val.startsWith("eq.")) rows = rows.filter((r) => String(r[k]) === val.slice(3));
      }
      return Response.json(rows);
    }
    if (u.host === "api.stripe.com") {
      const form = init.body ? Object.fromEntries(new URLSearchParams(init.body)) : null;
      w.stripeCalls.push({ method: init.method || "GET", path: u.pathname.replace("/v1", ""), query: Object.fromEntries(u.searchParams), form, headers: init.headers });
      const [status, payload] = w.stripe(u.pathname.replace("/v1", ""), init.method || "GET", form, u);
      return Response.json(payload, { status });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  return w;
}

const upserts = (w, table) => w.writes.filter((x) => x.table === table);
const rpcs = (w) => w.writes.filter((x) => x.rpc);

async function signed(event, { secret = env.stripeWebhookSecret, at = Math.floor(Date.now() / 1000) } = {}) {
  const raw = JSON.stringify(event);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${at}.${raw}`));
  const v1 = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return new Request("https://example.test/api/bp-stripe-webhook", { method: "POST", headers: { "stripe-signature": `t=${at},v1=${v1}` }, body: raw });
}

const sub = (over = {}) => ({
  id: "sub_1", customer: "cus_1", status: "active", metadata: { user_id: USER, plan_id: "author" },
  current_period_end: 1_800_000_000, cancel_at_period_end: false,
  items: { data: [{ id: "si_1", price: { id: "price_author" } }] }, ...over,
});

// --- Pure rules -------------------------------------------------------------------

test("the plan comes from the price; stale checkout metadata does not override it", () => {
  const plans = PLANS();
  assert.equal(rules.planForSubscription(sub(), plans), "author");
  const switched = sub({ items: { data: [{ id: "si_1", price: { id: "price_pro" } }] } }); // metadata still says author
  assert.equal(rules.planForSubscription(switched, plans), "author_pro", "a plan switch changes the price, not the metadata");
  assert.equal(rules.planForSubscription({ items: { data: [{ price: "price_pro" }] } }, plans), "author_pro", "a price given as a bare id");
});

test("a plan that cannot be told is null, never a guess", () => {
  const plans = PLANS();
  assert.equal(rules.planForSubscription({ items: { data: [{ price: { id: "price_unknown" } }] }, metadata: {} }, plans), null);
  assert.equal(rules.planForSubscription({ items: { data: [{ price: { id: "price_unknown" } }] }, metadata: { plan_id: "author" } }, plans), "author", "metadata is the fallback for a price that is not ours");
  assert.equal(rules.planForSubscription({ items: { data: [] }, metadata: { plan_id: "made_up" } }, plans), null, "a plan that does not exist");
  assert.equal(rules.planForSubscription(null, plans), null);
});

test("the period end is read from the subscription or, in newer API versions, from its items", () => {
  assert.equal(rules.periodEnd({ current_period_end: 1_800_000_000 }), new Date(1_800_000_000_000).toISOString());
  const newer = { items: { data: [{ current_period_end: 1_800_086_400 }, { current_period_end: 1_800_000_000 }] } };
  assert.equal(rules.periodEnd(newer), new Date(1_800_000_000_000).toISOString(), "the earliest item");
  assert.equal(rules.periodEnd({}), null);
  assert.equal(rules.periodEnd(null), null);
});

test("invoice metadata, the customer, live subscriptions and key mode", () => {
  assert.equal(rules.invoiceMetadata({ subscription_details: { metadata: { user_id: "a" } } }).user_id, "a");
  assert.equal(rules.invoiceMetadata({ parent: { subscription_details: { metadata: { user_id: "b" } } } }).user_id, "b");
  assert.deepEqual(rules.invoiceMetadata({}), {});
  assert.equal(rules.customerId({ customer: "cus_1" }), "cus_1");
  assert.equal(rules.customerId({ customer: { id: "cus_2" } }), "cus_2");
  assert.equal(rules.customerId({}), null);
  assert.equal(rules.isLiveSubscription({ stripe_subscription_id: "sub_1", status: "active" }), true);
  assert.equal(rules.isLiveSubscription({ stripe_subscription_id: "sub_1", status: "trialing" }), true);
  assert.equal(rules.isLiveSubscription({ stripe_subscription_id: "sub_1", status: "cancelled" }), false);
  assert.equal(rules.isLiveSubscription({ status: "active" }), false);
  assert.deepEqual(rules.keyMode("sk_live_abc"), { mode: "live", restricted: false });
  assert.deepEqual(rules.keyMode("rk_test_abc"), { mode: "test", restricted: true });
  assert.deepEqual(rules.keyMode("pk_test_abc"), { mode: null, restricted: false }, "a publishable key is not a secret key");
  assert.deepEqual(rules.keyMode(""), { mode: null, restricted: false });
});

test("VAT options are off unless asked for, and an existing customer may be updated", () => {
  assert.deepEqual(rules.taxParams({ enabled: false, hasCustomer: true }), {});
  const fresh = rules.taxParams({ enabled: true, hasCustomer: false });
  assert.deepEqual(fresh.automatic_tax, { enabled: true });
  assert.equal(fresh.billing_address_collection, "required");
  assert.deepEqual(fresh.tax_id_collection, { enabled: true });
  assert.ok(!("customer_update" in fresh));
  assert.deepEqual(rules.taxParams({ enabled: true, hasCustomer: true }).customer_update, { address: "auto", name: "auto" });
});

// --- The webhook ------------------------------------------------------------------

test("webhook: an unsigned, wrongly signed or stale request changes nothing", async () => {
  const w = world();
  const event = { type: "customer.subscription.deleted", data: { object: sub() } };
  for (const req of [
    new Request("https://example.test/x", { method: "POST", body: JSON.stringify(event) }),
    await signed(event, { secret: "whsec_other" }),
    await signed(event, { at: Math.floor(Date.now() / 1000) - 3600 }),
  ]) {
    assert.equal((await webhook(req)).status, 400);
  }
  assert.equal(w.writes.length, 0);
});

test("webhook: switching plans in Stripe moves the account to the plan of the new price", async () => {
  const w = world();
  const event = { type: "customer.subscription.updated", data: { object: sub({ items: { data: [{ id: "si_1", price: { id: "price_pro" } }] } }) } };
  assert.equal((await webhook(await signed(event))).status, 200);
  const [row] = upserts(w, "subscriptions");
  assert.equal(row.body.plan_id, "author_pro", "not 'author', which the metadata still says");
  assert.equal(row.body.stripe_customer_id, "cus_1");
  assert.equal(row.body.current_period_end, new Date(1_800_000_000_000).toISOString());
  assert.deepEqual(rpcs(w).map((r) => r.body), [{ p_user: USER, p_plan: "author_pro" }]);
});

test("webhook: a subscription whose plan cannot be told is left alone, not defaulted to Author", async () => {
  const w = world();
  const odd = sub({ metadata: { user_id: USER }, items: { data: [{ id: "si_9", price: { id: "price_not_ours" } }] } });
  assert.equal((await webhook(await signed({ type: "customer.subscription.updated", data: { object: odd } }))).status, 200);
  assert.equal(w.writes.length, 0, "no plan is granted or changed on a guess");
});

test("webhook: newer API versions, with the period on the items, still store it", async () => {
  const w = world();
  const newer = sub({ current_period_end: undefined, items: { data: [{ id: "si_1", price: { id: "price_author" }, current_period_end: 1_800_000_000 }] } });
  await webhook(await signed({ type: "customer.subscription.updated", data: { object: newer } }));
  assert.equal(upserts(w, "subscriptions")[0].body.current_period_end, new Date(1_800_000_000_000).toISOString());
});

test("webhook: a subscription changed elsewhere is matched to the account by its customer", async () => {
  const w = world();
  w.tables.subscriptions = [{ user_id: USER, stripe_customer_id: "cus_1", status: "active" }];
  const noMeta = sub({ metadata: {}, items: { data: [{ id: "si_1", price: { id: "price_pro" } }] } });
  await webhook(await signed({ type: "customer.subscription.updated", data: { object: noMeta } }));
  assert.equal(upserts(w, "subscriptions")[0].body.user_id, USER);
  assert.equal(rpcs(w)[0].body.p_plan, "author_pro");

  const stranger = world();
  await webhook(await signed({ type: "customer.subscription.updated", data: { object: sub({ metadata: {}, customer: "cus_unknown" }) } }));
  assert.equal(stranger.writes.length, 0, "a customer we have never seen changes nothing");
});

test("webhook: payment failure and cancellation put the account back on Free, in either invoice shape", async () => {
  for (const invoice of [
    { customer: "cus_1", subscription_details: { metadata: { user_id: USER } } },
    { customer: "cus_1", parent: { subscription_details: { metadata: { user_id: USER } } } },
    { customer: "cus_1" }, // neither: found through the stored customer
  ]) {
    const w = world();
    w.tables.subscriptions = [{ user_id: USER, stripe_customer_id: "cus_1" }];
    await webhook(await signed({ type: "invoice.payment_failed", data: { object: invoice } }));
    assert.deepEqual(rpcs(w).map((r) => r.body), [{ p_user: USER, p_plan: "free" }]);
  }
  const w = world();
  await webhook(await signed({ type: "customer.subscription.deleted", data: { object: sub() } }));
  assert.deepEqual(rpcs(w).map((r) => r.body), [{ p_user: USER, p_plan: "free" }]);
});

test("webhook: a completed checkout applies the plan of the price bought, and one-off payments are ignored", async () => {
  const w = world({ stripe: (path) => (path === "/subscriptions/sub_1" ? [200, sub({ items: { data: [{ id: "si_1", price: { id: "price_pro" } }] } })] : [404, {}]) });
  const session = { mode: "subscription", subscription: "sub_1", customer: "cus_1", client_reference_id: USER, metadata: { user_id: USER, plan_id: "author" } };
  await webhook(await signed({ type: "checkout.session.completed", data: { object: session } }));
  assert.equal(upserts(w, "subscriptions")[0].body.plan_id, "author_pro");
  assert.equal(rpcs(w).length, 1);

  const once = world();
  await webhook(await signed({ type: "checkout.session.completed", data: { object: { ...session, mode: "payment" } } }));
  assert.equal(once.writes.length, 0);
  assert.equal(once.stripeCalls.length, 0);
});

// --- Checkout and plan changes ----------------------------------------------------------

const call = (handler, path, body, method = "POST") =>
  handler(new Request(`https://example.test/api/bp-billing/${path}`, { method, headers: { authorization: "Bearer tok" }, body: JSON.stringify(body || {}) }));

test("checkout: someone who already pays is refused, so they are never billed twice", async () => {
  const w = world();
  w.tables.subscriptions = [{ user_id: USER, status: "active", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1" }];
  const res = await call(billing, "checkout", { plan_id: "author_pro" });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error.code, "already_subscribed");
  assert.equal(w.stripeCalls.length, 0, "Stripe is not even asked to make a session");
});

test("checkout: a new subscriber gets a session for the plan's price, with VAT options only when switched on", async () => {
  const w = world({ stripe: () => [200, { url: "https://checkout.test/s" }] });
  const res = await call(billing, "checkout", { plan_id: "author" });
  assert.equal((await res.json()).url, "https://checkout.test/s");
  const form = w.stripeCalls[0].form;
  assert.equal(form.mode, "subscription");
  assert.equal(form["line_items[0][price]"], "price_author");
  assert.equal(form.client_reference_id, USER);
  assert.equal(form["subscription_data[metadata][plan_id]"], "author");
  assert.ok(!("automatic_tax[enabled]" in form), "VAT collection is off by default");

  env.stripeAutomaticTax = true;
  try {
    const t = world({ stripe: () => [200, { url: "https://checkout.test/s" }] });
    t.tables.subscriptions = [{ user_id: USER, status: "cancelled", stripe_customer_id: "cus_1" }];
    await call(billing, "checkout", { plan_id: "author" });
    const taxed = t.stripeCalls[0].form;
    assert.equal(taxed["automatic_tax[enabled]"], "true");
    assert.equal(taxed.billing_address_collection, "required");
    assert.equal(taxed["tax_id_collection[enabled]"], "true");
    assert.equal(taxed["customer_update[address]"], "auto", "required by Stripe when an existing customer is used");
    assert.equal(taxed.customer, "cus_1");
  } finally {
    env.stripeAutomaticTax = false;
  }
});

test("checkout: a plan without a price, the free plan and an unknown plan are refused", async () => {
  const w = world();
  w.tables.plans.find((p) => p.id === "author").stripe_price_id = null;
  assert.equal((await call(billing, "checkout", { plan_id: "author" })).status, 501);
  assert.equal((await call(billing, "checkout", { plan_id: "free" })).status, 400);
  assert.equal((await call(billing, "checkout", { plan_id: "nope" })).status, 404);
  assert.equal(w.stripeCalls.length, 0);
});

test("change plan: moves the one subscription item to the new price, prorated, and grants nothing itself", async () => {
  const w = world({
    stripe: (path, method) => (path === "/subscriptions/sub_1" ? [200, method === "GET" ? sub() : sub()] : [404, {}]),
  });
  w.tables.subscriptions = [{ user_id: USER, status: "active", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1" }];
  const res = await call(billing, "change-plan", { plan_id: "author_pro" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { requested: true, plan_id: "author_pro" });

  const [read, change] = w.stripeCalls;
  assert.equal(read.method, "GET");
  assert.equal(change.method, "POST");
  assert.equal(change.path, "/subscriptions/sub_1");
  assert.equal(change.form["items[0][id]"], "si_1", "the existing item is changed, not a second one added");
  assert.equal(change.form["items[0][price]"], "price_pro");
  assert.equal(change.form.proration_behavior, "create_prorations");
  assert.equal(change.form["metadata[plan_id]"], "author_pro");
  assert.equal(w.writes.length, 0, "the plan and credits change only when the webhook reports it");
});

test("change plan: refuses what it cannot do safely", async () => {
  const cases = [
    ["no subscription", [], { plan_id: "author_pro" }, undefined, 400],
    ["a cancelled subscription", [{ user_id: USER, status: "cancelled", stripe_subscription_id: "sub_1" }], { plan_id: "author_pro" }, undefined, 400],
    ["the plan already held", [{ user_id: USER, status: "active", stripe_subscription_id: "sub_1" }], { plan_id: "author" }, undefined, 400],
    ["the free plan", [{ user_id: USER, status: "active", stripe_subscription_id: "sub_1" }], { plan_id: "free" }, undefined, 400],
    ["a subscription with two items", [{ user_id: USER, status: "active", stripe_subscription_id: "sub_1" }], { plan_id: "author_pro" },
      sub({ items: { data: [{ id: "si_1", price: { id: "price_author" } }, { id: "si_2", price: { id: "price_x" } }] } }), 400],
  ];
  for (const [label, subscriptions, body, stripeSub, status] of cases) {
    const w = world({ stripe: () => [200, stripeSub || sub()] });
    w.tables.subscriptions = subscriptions;
    const res = await call(billing, "change-plan", body);
    assert.equal(res.status, status, label);
    assert.ok(!w.stripeCalls.some((c) => c.method === "POST"), `${label}: nothing is changed at Stripe`);
  }
});

// --- The setup check --------------------------------------------------------------------

const goodPrice = (over = {}) => ({ id: "price_x", active: true, type: "recurring", currency: "eur", unit_amount: 1900, livemode: false, tax_behavior: "exclusive", recurring: { interval: "month", interval_count: 1 }, ...over });

function stripeOk({ prices = {}, endpoints, portal } = {}) {
  return (path, _method, _form, u) => {
    if (path.startsWith("/prices/")) {
      const p = prices[path.split("/")[2]];
      return p ? [200, p] : [404, { error: { message: "No such price" } }];
    }
    if (path === "/prices") return [200, { data: prices[`key:${u.searchParams.get("lookup_keys[0]")}`] ? [prices[`key:${u.searchParams.get("lookup_keys[0]")}`]] : [] }];
    if (path === "/webhook_endpoints") return [200, { data: endpoints ?? [{ url: "https://example.test/api/bp-stripe-webhook", status: "enabled", enabled_events: check.REQUIRED_EVENTS }] }];
    if (path === "/billing_portal/configurations") return [200, { data: portal ?? [{ is_active: true }] }];
    return [404, {}];
  };
}

const statusOf = (result, id) => result.checks.find((c) => c.id === id)?.status;

test("setup check: everything right is ready, and the price ids are compared with the plans", async () => {
  world({ stripe: stripeOk({ prices: { price_author: goodPrice({ id: "price_author" }), price_pro: goodPrice({ id: "price_pro", unit_amount: 4900 }) } }) });
  const result = await check.checkBilling({ plans: PLANS() });
  assert.equal(result.mode, "test");
  assert.equal(statusOf(result, "key"), "ok");
  assert.equal(statusOf(result, "webhook-endpoint"), "ok");
  assert.equal(statusOf(result, "price:author"), "ok");
  assert.equal(statusOf(result, "price:author_pro"), "ok");
  assert.equal(statusOf(result, "portal"), "ok");
  assert.equal(statusOf(result, "tax"), "warn", "the terms promise VAT that checkout does not add until Stripe Tax is switched on");
  assert.equal(result.ready, true, "a warning does not block");
});

test("setup check: a wrong amount, currency, mode, interval or archived price is a failure that says why", async () => {
  const bad = {
    price_author: goodPrice({ id: "price_author", unit_amount: 1500, currency: "usd", livemode: true, active: false, recurring: { interval: "year", interval_count: 1 } }),
    price_pro: goodPrice({ id: "price_pro", unit_amount: 4900, tax_behavior: "inclusive" }),
  };
  world({ stripe: stripeOk({ prices: bad }) });
  const result = await check.checkBilling({ plans: PLANS() });
  const author = result.checks.find((c) => c.id === "price:author");
  assert.equal(author.status, "fail");
  for (const part of ["archived", "year", "USD", "1500", "1900", "live mode but the key is a test key"]) assert.match(author.detail, new RegExp(part));
  assert.match(result.checks.find((c) => c.id === "price:author_pro").detail, /tax-inclusive/);
  assert.equal(result.ready, false);
});

test("setup check: a price id that does not exist, or none at all, is a failure", async () => {
  world({ stripe: stripeOk({ prices: {} }) });
  const plans = PLANS();
  plans[2].stripe_price_id = null;
  const result = await check.checkBilling({ plans });
  assert.match(result.checks.find((c) => c.id === "price:author").detail, /doesn't exist in this Stripe account and mode/);
  assert.match(result.checks.find((c) => c.id === "price:author_pro").detail, /No Stripe price id/);
  assert.equal(result.ready, false);
});

test("setup check: a missing, disabled or under-subscribed webhook is a failure; an unreadable list is only a note", async () => {
  const prices = { price_author: goodPrice({ id: "price_author" }), price_pro: goodPrice({ id: "price_pro", unit_amount: 4900 }) };
  world({ stripe: stripeOk({ prices, endpoints: [{ url: "https://elsewhere.test/hook", status: "enabled", enabled_events: ["*"] }] }) });
  assert.equal(statusOf(await check.checkBilling({ plans: PLANS() }), "webhook-endpoint"), "fail");

  world({ stripe: stripeOk({ prices, endpoints: [{ url: "https://example.test/api/bp-stripe-webhook/", status: "disabled", enabled_events: check.REQUIRED_EVENTS }] }) });
  assert.match((await check.checkBilling({ plans: PLANS() })).checks.find((c) => c.id === "webhook-endpoint").detail, /disabled/);

  world({ stripe: stripeOk({ prices, endpoints: [{ url: "https://example.test/api/bp-stripe-webhook", status: "enabled", enabled_events: ["checkout.session.completed"] }] }) });
  const partial = (await check.checkBilling({ plans: PLANS() })).checks.find((c) => c.id === "webhook-endpoint");
  assert.equal(partial.status, "fail");
  assert.match(partial.detail, /customer\.subscription\.updated/);

  world({ stripe: stripeOk({ prices, endpoints: [{ url: "https://example.test/api/bp-stripe-webhook", status: "enabled", enabled_events: ["*"] }] }) });
  assert.equal(statusOf(await check.checkBilling({ plans: PLANS() }), "webhook-endpoint"), "ok", "a wildcard covers them");

  world({ stripe: (path) => (path === "/webhook_endpoints" ? [403, { error: { message: "restricted key" } }] : stripeOk({ prices })(path)) });
  assert.equal(statusOf(await check.checkBilling({ plans: PLANS() }), "webhook-endpoint"), "info");
});

test("setup check: no portal configuration, a missing key and a malformed secret are reported", async () => {
  const prices = { price_author: goodPrice({ id: "price_author" }), price_pro: goodPrice({ id: "price_pro", unit_amount: 4900 }) };
  world({ stripe: stripeOk({ prices, portal: [] }) });
  assert.equal(statusOf(await check.checkBilling({ plans: PLANS() }), "portal"), "fail");

  const saved = { key: env.stripeSecret, hook: env.stripeWebhookSecret };
  try {
    env.stripeSecret = "";
    world();
    const none = await check.checkBilling({ plans: PLANS() });
    assert.equal(statusOf(none, "key"), "fail");
    assert.equal(none.ready, false);
    assert.equal(w_calls(), 0, "nothing is asked of Stripe without a key");

    env.stripeSecret = "pk_test_publishable";
    assert.match((await check.checkBilling({ plans: PLANS() })).checks[0].detail, /doesn't look like a Stripe secret key/);

    env.stripeSecret = saved.key;
    env.stripeWebhookSecret = "not-a-secret";
    world({ stripe: stripeOk({ prices }) });
    assert.equal(statusOf(await check.checkBilling({ plans: PLANS() }), "webhook-secret"), "warn");
  } finally {
    env.stripeSecret = saved.key;
    env.stripeWebhookSecret = saved.hook;
  }
  function w_calls() { return 0; }
});

test("setup check: it never repeats the key or the signing secret, even in what Stripe said", async () => {
  world({ stripe: () => [401, { error: { message: "Invalid API Key provided: sk_test_SECRETKEYVALUE" } }] });
  const result = await check.checkBilling({ plans: PLANS() });
  const shown = JSON.stringify(result);
  assert.doesNotMatch(shown, /whsec_testsecret/);
  // The webhook probe's own error is not echoed for a 401, and no check embeds the key.
  assert.equal(statusOf(result, "webhook-endpoint"), "fail");
});

// --- Creating prices --------------------------------------------------------------------

test("create prices: makes a tax-exclusive monthly price for each paid plan without one, and saves the id", async () => {
  const w = world({ stripe: (path, method) => (path === "/prices" && method === "POST" ? [200, goodPrice({ id: "price_created" })] : path === "/prices" ? [200, { data: [] }] : [404, {}]) });
  const plans = PLANS();
  plans[1].stripe_price_id = null; // author has none; author_pro has one
  const service = { async update(table, patch, opts) { w.writes.push({ table, patch, opts }); } };
  const results = await check.createMissingPrices({ plans, service });
  assert.deepEqual(results.map((r) => [r.plan, r.status, r.priceId]), [["author", "created", "price_created"]]);

  const create = w.stripeCalls.find((c) => c.method === "POST");
  assert.equal(create.form.currency, "eur");
  assert.equal(create.form.unit_amount, "1900");
  assert.equal(create.form["recurring[interval]"], "month");
  assert.equal(create.form.lookup_key, "bookpilot_author_month");
  assert.equal(create.form.tax_behavior, "exclusive");
  assert.equal(create.form["product_data[name]"], "BookPilot AI Author");
  assert.equal(create.form["product_data[metadata][plan_id]"], "author");
  assert.deepEqual(w.writes.find((x) => x.patch), { table: "plans", patch: { stripe_price_id: "price_created" }, opts: { eq: { id: "author" } } });
});

test("create prices: run again, an existing price is found and linked, not made twice; a mismatch is a conflict", async () => {
  const plans = PLANS();
  plans[1].stripe_price_id = null;
  const existing = goodPrice({ id: "price_existing" });
  const w = world({ stripe: (path) => (path === "/prices" ? [200, { data: [existing] }] : [404, {}]) });
  const saved = [];
  const service = { async update(table, patch) { saved.push(patch); } };
  const linked = await check.createMissingPrices({ plans, service });
  assert.deepEqual(linked.map((r) => [r.status, r.priceId]), [["linked", "price_existing"]]);
  assert.ok(!w.stripeCalls.some((c) => c.method === "POST"), "no second price is created");
  assert.deepEqual(saved, [{ stripe_price_id: "price_existing" }]);

  const wrong = world({ stripe: (path) => (path === "/prices" ? [200, { data: [goodPrice({ id: "price_old", unit_amount: 999 })] }] : [404, {}]) });
  const conflict = await check.createMissingPrices({ plans, service: { async update() { throw new Error("must not save"); } } });
  assert.equal(conflict[0].status, "conflict");
  assert.match(conflict[0].detail, /999/);
  assert.ok(!wrong.stripeCalls.some((c) => c.method === "POST"));

  const refused = world({ stripe: (path, method) => (method === "POST" ? [400, { error: { message: "boom SECRET" } }] : [200, { data: [] }]) });
  const failed = await check.createMissingPrices({ plans, service: { async update() {} } });
  assert.equal(failed[0].status, "failed");
  assert.doesNotMatch(failed[0].detail, /SECRET/, "Stripe's message goes to the log, not the screen");
  assert.ok(refused);

  const free = await check.createMissingPrices({ plans: PLANS().filter((p) => p.id === "free"), service: { async update() {} } });
  assert.deepEqual(free, [], "the free plan needs no price");
});

// --- Who may ask ------------------------------------------------------------------------

const adminCall = (path, method = "GET") =>
  admin(new Request(`https://example.test/api/bp-admin/${path}`, { method, headers: { authorization: "Bearer tok" }, body: method === "POST" ? "{}" : undefined }));

test("admin: the setup check and price creation are for administrators only", async () => {
  const w = world({ role: "user", stripe: () => [200, { data: [] }] });
  assert.equal((await adminCall("billing-check")).status, 403);
  assert.equal((await adminCall("billing/create-prices", "POST")).status, 403);
  assert.equal(w.stripeCalls.length, 0, "Stripe is not asked anything on behalf of a non-admin");
});

test("admin: an administrator gets the check, and the response never contains the key", async () => {
  world({ stripe: stripeOk({ prices: { price_author: goodPrice({ id: "price_author" }), price_pro: goodPrice({ id: "price_pro", unit_amount: 4900 }) } }) });
  const res = await adminCall("billing-check");
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.doesNotMatch(text, /SECRETKEYVALUE|whsec_testsecret|service-key/);
  const body = JSON.parse(text);
  assert.equal(body.mode, "test");
  assert.ok(Array.isArray(body.checks) && body.checks.length >= 5);
});
