// AI credits and plan limits (spec §29, §30).
//
// Costs live in the `credit_costs` table so an operator can retune them
// without a deploy. The actual spend goes through the bp_consume_credits
// database function, which does the balance check and the decrement in
// one statement — see bookpilot/sql/004_functions.sql for why that
// matters.

import { dbAsService } from "./db.js";
import { AppError, Errors } from "./errors.js";

// Fallbacks used only if the reference tables are unreachable. They
// match the seeded values so behaviour doesn't change silently.
const FALLBACK_COSTS = {
  book_analysis: 10,
  reader_personas: 10,
  marketing_angles: 5,
  ad_copy: 1,
  creative_concept: 1,
  creative_image: 5,
  creative_image_advanced: 8,
  video_concept: 5,
  video_generation: 20,
  creative_scoring: 1,
  advisor_message: 2,
  performance_analysis: 10,
  budget_recommendation: 2,
};

let costCache = null;
let costCacheExpires = 0;

export async function creditCosts() {
  if (costCache && costCacheExpires > Date.now()) return costCache;
  try {
    const rows = await dbAsService().select("credit_costs", {
      select: "operation,label,credits,is_active",
    });
    const map = {};
    for (const row of rows) if (row.is_active) map[row.operation] = row.credits;
    costCache = Object.keys(map).length ? map : { ...FALLBACK_COSTS };
  } catch (err) {
    console.error("[bookpilot] credit cost lookup failed, using defaults:", err);
    costCache = { ...FALLBACK_COSTS };
  }
  costCacheExpires = Date.now() + 300_000;
  return costCache;
}

export async function costOf(operation) {
  const costs = await creditCosts();
  const value = costs[operation];
  if (value === undefined) {
    throw Errors.invalid("That operation isn't available.");
  }
  return value;
}

/** An operator testing the product on their own account, not a discount tier. */
export function isAdmin(profile) {
  return profile?.role === "admin";
}

/**
 * Charge for an operation. Throws a 402 with the shortfall when the
 * balance is too low, so the UI can link straight to Billing.
 *
 * An admin's own account is never charged: the credit system exists to
 * meter what a customer pays for, not to stop the person running the
 * product from being able to check that a feature works. `remaining` is
 * reported as-is either way, so the screen never claims a balance that
 * isn't real.
 */
export async function charge(userId, operation, { bookId = null, model = null, available = 0, profile = null } = {}) {
  const credits = await costOf(operation);
  if (credits === 0 || isAdmin(profile)) return { credits: 0, remaining: available };

  const service = dbAsService();
  try {
    const remaining = await service.rpc("bp_consume_credits", {
      p_user: userId,
      p_operation: operation,
      p_credits: credits,
      p_book: bookId,
      p_model: model,
    });
    return { credits, remaining: typeof remaining === "number" ? remaining : null };
  } catch (err) {
    if (err instanceof AppError && err.code === "database_error") {
      // bp_consume_credits raises `insufficient_credits` when the
      // balance is short; PostgREST surfaces that as a 4xx.
      throw Errors.noCredits(credits, available);
    }
    throw err;
  }
}

/** Give credits back when a charged operation failed afterwards. */
export async function refund(userId, credits, reason = "operation_failed") {
  if (!credits) return;
  try {
    await dbAsService().rpc("bp_refund_credits", {
      p_user: userId,
      p_credits: credits,
      p_reason: reason,
    });
  } catch (err) {
    // A failed refund must not mask the original error the user is
    // about to see; log it for reconciliation instead.
    console.error("[bookpilot] credit refund failed:", err);
  }
}

let planCache = null;
let planCacheExpires = 0;

export async function plans() {
  if (planCache && planCacheExpires > Date.now()) return planCache;
  const rows = await dbAsService().select("plans", { select: "*", order: "sort_order" });
  planCache = rows;
  planCacheExpires = Date.now() + 300_000;
  return rows;
}

export async function planFor(profile) {
  const all = await plans();
  return all.find((p) => p.id === profile.plan_id) || all.find((p) => p.id === "free") || null;
}

/** Enforce the plan's book allowance before creating another book. */
export async function assertCanAddBook(db, profile) {
  const plan = await planFor(profile);
  if (!plan || plan.book_limit === null) return;
  const existing = await db.select("books", {
    select: "id",
    eq: { user_id: profile.id },
    limit: plan.book_limit + 1,
  });
  if (existing.length >= plan.book_limit) {
    throw Errors.planLimit(
      `Your ${plan.name} plan includes ${plan.book_limit} ${plan.book_limit === 1 ? "book" : "books"}. Upgrade to add more.`
    );
  }
}

/** Enforce the plan's monthly creative allowance. */
export async function assertCanAddCreative(db, profile, count = 1) {
  const plan = await planFor(profile);
  if (!plan || plan.creative_limit === null) return;
  const since = new Date();
  since.setDate(1);
  since.setHours(0, 0, 0, 0);
  const existing = await db.select("creatives", {
    select: "id",
    eq: { user_id: profile.id },
    filters: { created_at: `gte.${since.toISOString()}` },
    limit: plan.creative_limit + 1,
  });
  if (existing.length + count > plan.creative_limit) {
    throw Errors.planLimit(
      `Your ${plan.name} plan includes ${plan.creative_limit} creatives per month. Upgrade for more.`
    );
  }
}
