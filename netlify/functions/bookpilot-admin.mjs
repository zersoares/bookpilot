// BookPilot AI — admin API (spec §31).
//
//   /api/bp-admin/*
//
// Every route re-checks `role = 'admin'` on the caller's own profile row
// (read through their JWT, so the check cannot be spoofed by a client)
// before switching to the service role for cross-account reads.

import { withGuards, json, readJson, pathSegments } from "./bookpilot-lib/http.js";
import { authenticate, requireAdmin } from "./bookpilot-lib/auth.js";
import { Errors } from "./bookpilot-lib/errors.js";
import { memoryLimit } from "./bookpilot-lib/ratelimit.js";
import { bundledPrompts, clearPromptCache } from "./bookpilot-lib/ai.js";
import { promptKeys } from "./bookpilot-lib/prompts.js";
import * as v from "./bookpilot-lib/validate.js";
import * as audit from "./bookpilot-lib/audit.js";
import * as stripe from "./bookpilot-lib/stripe.js";
import { checkBilling, createMissingPrices } from "./bookpilot-lib/billing-check.js";

const PREFIX = "/api/bp-admin";

async function overview(service) {
  const stats = await service.rpc("bp_admin_overview");
  return json({ stats });
}

async function listUsers(service, url) {
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 200);
  const users = await service.select("profiles", {
    select: "id,email,full_name,country,plan_id,ai_credits,role,created_at,onboarding_step",
    order: "created_at.desc",
    limit,
  });
  return json({ users });
}

async function updatePlan(service, ctx, planId, body) {
  const patch = v.pick(body, {
    name: (x) => v.str(x, "Name", { max: 80 }),
    price_cents: (x) => v.int(x, "Price", { min: 0, max: 1_000_000 }),
    currency: (x) => v.currency(x),
    book_limit: (x) => (x === null ? null : v.int(x, "Book limit", { min: 0, max: 10_000 })),
    creative_limit: (x) => (x === null ? null : v.int(x, "Creative limit", { min: 0, max: 100_000 })),
    monthly_credits: (x) => v.int(x, "Monthly credits", { min: 0, max: 1_000_000 }),
    team_seats: (x) => v.int(x, "Team seats", { min: 1, max: 500 }),
    stripe_price_id: (x) => v.str(x, "Stripe price id", { max: 80 }),
    is_active: (x) => v.bool(x),
  });
  if (!Object.keys(patch).length) throw Errors.invalid("Nothing to update.");
  const plan = await service.update("plans", patch, { eq: { id: planId } });
  await audit.record(ctx.user.id, "admin.plan_updated", { entity: "plan", entityId: planId });
  return json({ plan });
}

async function updateCreditCost(service, ctx, operation, body) {
  const credits = v.int(body.credits, "Credits", { min: 0, max: 1000, required: true });
  const cost = await service.update(
    "credit_costs",
    { credits, updated_at: new Date().toISOString() },
    { eq: { operation } }
  );
  if (!cost) throw Errors.notFound("operation");
  await audit.record(ctx.user.id, "admin.credit_cost_updated", {
    entity: "credit_cost", entityId: operation, detail: { credits },
  });
  return json({ cost });
}

async function listPrompts(service) {
  const [stored, bundled] = await Promise.all([
    service.select("ai_prompts", { select: "*" }),
    Promise.resolve(bundledPrompts()),
  ]);
  const storedByKey = Object.fromEntries(stored.map((p) => [p.key, p]));
  return json({
    prompts: bundled.map((b) => ({
      ...b,
      overridden: Boolean(storedByKey[b.key]),
      stored: storedByKey[b.key] || null,
    })),
  });
}

/** Copy the bundled defaults into the editable registry (see 003_seed.sql). */
async function publishDefaults(service, ctx) {
  const rows = bundledPrompts().map((p) => ({
    key: p.key,
    label: p.label,
    system_prompt: p.system_prompt,
    user_template: p.user_template,
    model: p.model,
    effort: p.effort,
    max_tokens: p.max_tokens,
    json_schema: p.json_schema,
    is_active: true,
  }));
  await service.upsert("ai_prompts", rows, { onConflict: "key", returning: false });
  clearPromptCache();
  await audit.record(ctx.user.id, "admin.prompts_published");
  return json({ published: rows.length });
}

async function updatePrompt(service, ctx, key, body) {
  if (!promptKeys().includes(key)) throw Errors.notFound("prompt");
  const patch = v.pick(body, {
    system_prompt: (x) => v.str(x, "System prompt", { max: 20_000 }),
    user_template: (x) => v.str(x, "User template", { max: 20_000 }),
    model: (x) => v.oneOf(x, "Model", ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"]),
    effort: (x) => v.oneOf(x, "Effort", ["low", "medium", "high", "xhigh", "max"]),
    max_tokens: (x) => v.int(x, "Max tokens", { min: 512, max: 16_000 }),
    is_active: (x) => v.bool(x),
  });
  if (!Object.keys(patch).length) throw Errors.invalid("Nothing to update.");
  patch.updated_at = new Date().toISOString();
  const prompt = await service.update("ai_prompts", patch, { eq: { key } });
  if (!prompt) throw Errors.invalid("Publish the default prompts before editing them.");
  clearPromptCache();
  await audit.record(ctx.user.id, "admin.prompt_updated", { entity: "prompt", entityId: key });
  return json({ prompt });
}

async function updateFlag(service, ctx, key, body) {
  const enabled = v.bool(body.enabled);
  const flag = await service.update(
    "feature_flags",
    { enabled, updated_at: new Date().toISOString() },
    { eq: { key } }
  );
  if (!flag) throw Errors.notFound("flag");
  await audit.record(ctx.user.id, "admin.flag_updated", {
    entity: "flag", entityId: key, detail: { enabled },
  });
  return json({ flag });
}

async function updateSetting(service, ctx, key, body) {
  if (body.value === undefined) throw Errors.invalid("A value is required.");
  const setting = await service.upsert(
    "app_settings",
    { key, value: body.value, updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
  clearPromptCache();
  await audit.record(ctx.user.id, "admin.setting_updated", { entity: "setting", entityId: key });
  return json({ setting });
}

/** Ask Stripe whether billing is set up right (see billing-check.js). */
async function billingCheck(service) {
  const plans = await service.select("plans", { select: "*", order: "sort_order" });
  return json(await checkBilling({ plans }));
}

async function createPrices(service, ctx) {
  if (!stripe.configured()) throw Errors.notConfigured("Billing");
  const plans = await service.select("plans", { select: "*", order: "sort_order" });
  const results = await createMissingPrices({ plans, service });
  await audit.record(ctx.user.id, "admin.stripe_prices_created", {
    entity: "plan", detail: { results: results.map((r) => ({ plan: r.plan, status: r.status })) },
  });
  return json({ results });
}

async function settings(service) {
  const [flags, plans, costs, appSettings] = await Promise.all([
    service.select("feature_flags", { select: "*" }),
    service.select("plans", { select: "*", order: "sort_order" }),
    service.select("credit_costs", { select: "*", order: "operation" }),
    service.select("app_settings", { select: "*" }),
  ]);
  return json({ flags, plans, creditCosts: costs, settings: appSettings });
}

export default withGuards(async (req) => {
  const ctx = await authenticate(req);
  const service = await requireAdmin(ctx);
  memoryLimit(`admin:${ctx.user.id}`, 120, 60_000);

  const segments = pathSegments(req, PREFIX);
  const url = new URL(req.url);
  const [resource, id] = segments;
  const body = ["POST", "PATCH"].includes(req.method) ? await readJson(req) : {};

  if (req.method === "GET") {
    if (resource === "overview") return overview(service);
    if (resource === "users") return listUsers(service, url);
    if (resource === "prompts") return listPrompts(service);
    if (resource === "settings") return settings(service);
    if (resource === "billing-check") return billingCheck(service);
  }
  if (req.method === "POST" && resource === "billing" && id === "create-prices") {
    return createPrices(service, ctx);
  }
  if (req.method === "POST" && resource === "prompts" && id === "publish-defaults") {
    return publishDefaults(service, ctx);
  }
  if (req.method === "PATCH" && id) {
    if (resource === "plans") return updatePlan(service, ctx, id, body);
    if (resource === "credit-costs") return updateCreditCost(service, ctx, id, body);
    if (resource === "prompts") return updatePrompt(service, ctx, id, body);
    if (resource === "flags") return updateFlag(service, ctx, id, body);
    if (resource === "settings") return updateSetting(service, ctx, id, body);
  }

  throw Errors.notFound("endpoint");
});

export const config = { path: "/api/bp-admin/*" };
