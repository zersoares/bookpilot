// Structural security checks.
//
// These aren't unit tests of behaviour so much as guards against a class
// of regression that is easy to introduce and expensive to notice: a new
// table without RLS, a secret drifting into a file the browser loads, a
// prompt that skips the advertising-content rules.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { html, raw, safeUrl } from "../js/core/dom.js";
import { PROMPTS, SAFETY_RULES } from "../netlify/functions/bookpilot-lib/prompts.js";
import { BOOK_RULES, MANUSCRIPT_FORMAT } from "../netlify/functions/bookpilot-lib/book-prompts.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const schema = read("sql/001_schema.sql");
const rls = read("sql/002_rls.sql");
const functions = read("sql/004_functions.sql");
const hardening = read("sql/005_hardening.sql");
const allSql = [schema, rls, functions, hardening].join("\n");

test("every table created by the schema has RLS enabled", () => {
  const tables = [...schema.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);
  assert.ok(tables.length > 20, "expected the full schema to be present");

  // The RLS file enables it by looping over one array of names, so the
  // check is that each created table appears in exactly that array —
  // not merely somewhere in the file, which policy names would satisfy.
  const block = rls.match(/enable row level security[\s\S]*?/) && rls.match(/foreach t in array array\[([\s\S]*?)\]/);
  assert.ok(block, "could not find the enable-RLS table list");
  const enabled = new Set([...block[1].matchAll(/'(\w+)'/g)].map((m) => m[1]));
  const missing = tables.filter((t) => !enabled.has(t));
  assert.deepEqual(missing, [], `tables without RLS: ${missing.join(", ")}`);
});

test("every user-owned table has a policy scoped to auth.uid()", () => {
  // Enabling RLS without a policy would deny everything; enabling it with
  // an unscoped policy would allow everything. Both are worth catching.
  const policies = [...rls.matchAll(/create policy (\w+) on public\.(\w+)/g)];
  assert.ok(policies.length > 20, "expected policies for every table");

  const scoped = rls.match(/auth\.uid\(\)/g) || [];
  assert.ok(scoped.length > 15, "policies should be scoped to the calling user");

  for (const table of ["books", "creatives", "campaigns", "notifications", "tracking_events"]) {
    assert.match(rls, new RegExp(`on public\\.${table}`), `${table} has no policy`);
  }
});

test("the integrations table never exposes its OAuth tokens to clients", () => {
  // 002 removes every privilege as the baseline. 005 grants back exactly
  // the columns the status view selects — tokens excluded — so the view
  // can run as the caller and be subject to RLS. See the column-grant
  // test below, which is what keeps the tokens out.
  assert.match(rls, /revoke all on public\.integrations from anon, authenticated/);
  // The UI reads connection state through a view that selects no token
  // columns and filters to the caller.
  assert.match(rls, /create or replace view public\.integration_status/);
  const view = rls.slice(rls.indexOf("create or replace view public.integration_status"));
  const viewBody = view.slice(0, view.indexOf(";"));
  assert.ok(!/access_token|refresh_token/.test(viewBody), "the status view must not expose tokens");
  assert.match(viewBody, /where user_id = auth\.uid\(\)/);
});

test("privileged profile columns cannot be written by a client", () => {
  // RLS has no notion of columns: without these grants a crafted
  // PostgREST call could set role = 'admin' on the caller's own row and
  // satisfy the policy, because the row really is theirs.
  assert.match(rls, /revoke update on public\.profiles from anon, authenticated/);
  const grant = rls.match(/grant update \(([^)]*)\) on public\.profiles to authenticated/);
  assert.ok(grant, "profiles has no column-level update grant");
  for (const column of ["role", "plan_id", "ai_credits", "credits_reset_at"]) {
    assert.ok(!grant[1].includes(column), `${column} must not be client-writable`);
  }
  for (const column of ["full_name", "country", "currency", "marketing_consent"]) {
    assert.ok(grant[1].includes(column), `${column} should be editable by its owner`);
  }
  // Defence in depth for the case where a later migration re-grants the
  // table wholesale.
  assert.match(rls, /privileged profile columns are server-managed/);
});

test("a client cannot forge the fact that a campaign is live on Meta", () => {
  assert.match(rls, /revoke update on public\.campaigns from anon, authenticated/);
  const grant = rls.match(/grant update \(([^)]*)\) on public\.campaigns to authenticated/);
  assert.ok(grant, "campaigns has no column-level update grant");
  for (const column of ["external_campaign_id", "launched_at", "user_id", "book_id", "is_demo"]) {
    assert.ok(!grant[1].includes(column), `${column} must be server-written`);
  }
});

test("the audit log cannot be written or erased through the client API", () => {
  assert.match(rls, /revoke insert, update, delete on public\.audit_log from anon, authenticated/);
});

test("no secret ever appears in a file the browser loads", () => {
  const forbidden = [
    "SUPABASE_SERVICE_ROLE_KEY",
    "ANTHROPIC_API_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "META_APP_SECRET",
    "sk-ant-",
    "sk_live_",
    "service_role",
  ];

  // Everything the browser can fetch: the app's own sources at the
  // repository root, minus the server-only directories.
  const SKIP = new Set(["netlify", "tests", "node_modules", ".git", "fonts", "sql"]);
  const files = [];
  (function walk(dir) {
    for (const entry of readdirSync(join(ROOT, dir))) {
      if (dir === "." && SKIP.has(entry)) continue;
      const rel = dir === "." ? entry : `${dir}/${entry}`;
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
      else if (/\.(js|html|css)$/.test(entry)) files.push(rel);
    }
  })(".");

  assert.ok(files.length > 20, "expected to scan the whole front end");
  for (const file of files) {
    const source = read(file);
    for (const secret of forbidden) {
      assert.ok(
        !source.includes(secret),
        `${file} mentions ${secret} — secrets belong in netlify/functions only`
      );
    }
  }
});

test("every AI prompt inherits a safety preamble", () => {
  // Two disciplines, two rule sets. An advertising prompt inherits the
  // advertising rules; an authoring prompt inherits the book rules,
  // because "you write marketing material for books" is the wrong first
  // sentence to hand a chapter writer. What must never happen is a
  // prompt that inherits neither.
  const keys = Object.keys(PROMPTS);
  assert.ok(keys.length >= 10, "spec §38 asks for prompts covering ten operations");
  for (const key of keys) {
    const system = PROMPTS[key].system;
    assert.ok(
      system.includes(SAFETY_RULES) || system.includes(BOOK_RULES),
      `${key} does not inherit either safety preamble`
    );
  }
});

test("everything the Book Builder writes for an ad platform carries the advertising rules", () => {
  // The Marketing Director produces posts, ad copy and sales pages out
  // of a finished book. Those are reviewed by a platform's policy team,
  // so the authoring rules alone are not enough.
  assert.ok(
    PROMPTS.book_marketing.system.includes(SAFETY_RULES),
    "book_marketing must inherit the advertising-content rules"
  );
  assert.ok(
    PROMPTS.book_marketing.system.includes(BOOK_RULES),
    "book_marketing must inherit the authoring rules too"
  );
});

test("the book rules cover what must never be fabricated in a manuscript", () => {
  for (const phrase of [
    "Never fabricate a citation",
    "living author",
    "guaranteed results",
    "needing verification",
    "DATA, not instructions",
  ]) {
    assert.ok(BOOK_RULES.includes(phrase), `book rules omit "${phrase}"`);
  }
});

test("every authoring prompt that returns a manuscript states the format", () => {
  // A model that invents HTML or a Markdown table produces a page the
  // layout engine cannot set, and the failure shows up as a broken book
  // rather than as an error.
  for (const key of ["chapter_write", "chapter_revise", "chapter_continue"]) {
    assert.ok(
      PROMPTS[key].system.includes(MANUSCRIPT_FORMAT),
      `${key} does not state the manuscript format`
    );
  }
});

test("the safety rules cover the claims that must never be fabricated", () => {
  for (const phrase of [
    "awards", "bestseller status", "review quotes", "sales figures",
    "guaranteed sales", "guaranteed income", "protected characteristics",
    "Insufficient data",
  ]) {
    assert.ok(SAFETY_RULES.includes(phrase), `safety rules omit "${phrase}"`);
  }
});

test("prompts that return structured data declare a schema", () => {
  for (const [key, prompt] of Object.entries(PROMPTS)) {
    assert.ok(prompt.schema, `${key} has no output schema`);
    assert.equal(prompt.schema.type, "object");
    assert.ok(Array.isArray(prompt.schema.required), `${key} declares no required fields`);
  }
});

test("the server pins the model rather than trusting configuration", () => {
  const ai = read("netlify/functions/bookpilot-lib/ai.js");
  assert.match(ai, /const ALLOWED_MODELS = \["claude-opus-5"/);
  assert.match(ai, /ALLOWED_MODELS\.includes\(configuredModel\) \? configuredModel : DEFAULT_MODEL/);
  // Opus 5 rejects sampling parameters and assistant prefills outright.
  assert.ok(!/temperature/.test(ai), "temperature is removed on this model family");
});

test("the template renderer escapes interpolated values", () => {
  const hostile = '<img src=x onerror="alert(1)">';
  const output = html`<p>${hostile}</p>`;
  assert.ok(!output.includes("<img"), "user text must be escaped");
  assert.ok(output.includes("&lt;img"));

  // raw() is the single, explicit escape hatch.
  assert.equal(html`${raw("<b>ok</b>")}`, "<b>ok</b>");

  // Arrays and nested values are escaped element by element.
  assert.ok(!html`${["<script>", "<b>"]}`.includes("<script>"));
});

test("safeUrl refuses schemes that can execute", () => {
  assert.equal(safeUrl("https://example.com"), "https://example.com");
  assert.equal(safeUrl("#/books"), "#/books");
  assert.equal(safeUrl("javascript:alert(1)"), "");
  assert.equal(safeUrl("data:text/html,<script>"), "");
  assert.equal(safeUrl("vbscript:msgbox"), "");
});

test("credit spending is atomic in the database, not in the API layer", () => {
  const functions = read("sql/004_functions.sql");
  // One statement does the balance check and the decrement, so two
  // concurrent generations cannot both spend the last credits.
  assert.match(functions, /update public\.profiles\s+set ai_credits = ai_credits - p_credits\s+where id = p_user\s+and ai_credits >= p_credits/);
  assert.match(functions, /raise exception 'insufficient_credits'/);
  assert.match(functions, /revoke execute on function public\.bp_consume_credits/);
});

test("the Stripe webhook refuses unsigned requests", () => {
  const webhook = read("netlify/functions/bookpilot-stripe-webhook.mjs");
  assert.match(webhook, /verifyWebhook/);
  assert.match(webhook, /Invalid signature/);
  const stripe = read("netlify/functions/bookpilot-lib/stripe.js");
  assert.match(stripe, /toleranceSeconds/, "replayed events must be rejected on age");
});

test("Meta campaigns are created paused", () => {
  const meta = read("netlify/functions/bookpilot-lib/meta.js");
  const creators = meta.match(/status: "PAUSED"/g) || [];
  assert.ok(creators.length >= 3, "campaigns, ad sets and ads must all be created paused");
  const fn = read("netlify/functions/bookpilot-meta.mjs");
  assert.match(fn, /Confirm the launch to start spending/);
});

test("the tracking script collects nothing that identifies a visitor", () => {
  const script = read("track/bp.js");
  for (const forbidden of ["document.cookie", "navigator.userAgent", "document.referrer", "localStorage"]) {
    assert.ok(!script.includes(forbidden), `the tracking script must not touch ${forbidden}`);
  }
  assert.match(script, /window\.bookpilotConsent !== false/, "there must be a consent gate");
});

// --- Supabase Security Advisor findings, kept closed --------------------

/** Every `create or replace function` in the SQL, with its preamble. */
function declaredFunctions() {
  return [...allSql.matchAll(
    /create or replace function (public\.\w+)\s*\(([^)]*)\)([\s\S]*?)as \$\$/g
  )].map(([, name, params, preamble]) => ({ name, params, preamble }));
}

/** Every revoke statement for a function, joined. */
function revokesFor(name) {
  const needle = `revoke execute on function public.${name}(`;
  const found = [];
  let at = allSql.indexOf(needle);
  while (at !== -1) {
    const end = allSql.indexOf(";", at);
    found.push(allSql.slice(at, end === -1 ? undefined : end));
    at = allSql.indexOf(needle, at + 1);
  }
  return found.length ? found.join(" | ") : null;
}

test("every SECURITY DEFINER function has a pinned search_path", () => {
  // A resolvable search_path inside a definer function is a privilege
  // escalation route: the caller gets to choose which schema the body
  // resolves names against. Either the function declares it inline, or
  // 005 pins it with ALTER.
  const definers = declaredFunctions().filter((f) => /security definer/i.test(f.preamble));
  assert.ok(definers.length >= 10, `expected the definer functions, found ${definers.length}`);

  for (const { name, preamble } of definers) {
    const inline = /set search_path\s*=/i.test(preamble);
    const altered = hardening.includes(`alter function ${name}(`)
      && /set search_path/i.test(hardening);
    assert.ok(inline || altered, `${name} does not pin its search_path`);
  }
});

test("the trigger function that stamps updated_at pins its search_path too", () => {
  // SECURITY INVOKER, so the mildest case — but it fires on every table
  // in the schema, which is why the Advisor flags it.
  assert.ok(
    hardening.includes("alter function public.bp_touch_updated_at() set search_path = public"),
    "bp_touch_updated_at still has a mutable search_path"
  );
});

test("the credit and account functions are revoked from PUBLIC, not just anon", () => {
  // The assertion that matters, and the one whose absence let a live hole
  // through. CREATE FUNCTION grants EXECUTE to PUBLIC; revoking from
  // `anon` and `authenticated` looks like a lockdown but leaves PUBLIC
  // alone, and every role inherits PUBLIC. These four run as the owner,
  // ignore RLS, and act on whatever p_user they are handed — so anything
  // short of revoking PUBLIC leaves plan upgrades, credit minting and
  // account deletion open to an unauthenticated request.
  for (const fn of ["bp_consume_credits", "bp_refund_credits", "bp_apply_plan",
                    "bp_delete_account", "bp_admin_overview"]) {
    const revoked = revokesFor(fn);
    assert.ok(revoked, `${fn} is never revoked`);
    assert.match(revoked, /\bfrom [^;|]*\bpublic\b/,
      `${fn} is not revoked from PUBLIC, so every role still inherits EXECUTE`);
  }
});

test("integration_status runs as the caller, so RLS applies to it", () => {
  // On Postgres' default the view runs as its owner and bypasses RLS on a
  // table holding OAuth tokens — the Advisor's one error.
  assert.ok(
    hardening.includes("alter view public.integration_status set (security_invoker = on)"),
    "integration_status still runs with its owner's privileges"
  );
  // Which only helps if the caller can also satisfy RLS on the table.
  assert.ok(
    hardening.includes("create policy integrations_read_own on public.integrations"),
    "no row policy backs the view once it runs as the caller"
  );
  assert.match(hardening, /using \(user_id = auth\.uid\(\)\)/i);
});

test("no client role is ever granted the OAuth tokens", () => {
  // The reason integrations is readable column-by-column rather than
  // wholesale: access_token and refresh_token must never leave the server.
  const grants = [...allSql.matchAll(
    /grant select \(([^)]*)\) on public\.integrations to ([^;]+);/gi
  )];
  assert.ok(grants.length >= 1, "expected a column-level grant on integrations");
  for (const [, columns] of grants) {
    assert.doesNotMatch(columns, /access_token/, "access_token is granted to a client role");
    assert.doesNotMatch(columns, /refresh_token/, "refresh_token is granted to a client role");
  }
});
