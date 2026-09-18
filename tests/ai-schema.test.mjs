// Anthropic's structured output refuses a schema whose objects are open:
//
//   output_config.format.schema: For 'object' type,
//   'additionalProperties' must be explicitly set to false
//
// The prompts declare their schemas without it, so every structured call
// failed with a 400 the moment requests finally reached the API. Rather
// than edit each schema — where the next one added would reintroduce the
// problem — the schema is closed on the way out.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY = "test-anon-key";

const { schemaForApi } = await import("../netlify/functions/bookpilot-lib/ai.js");
const { PROMPTS } = await import("../netlify/functions/bookpilot-lib/prompts.js");

/** Every object node in a schema, depth-first. */
function objectNodes(node, found = []) {
  if (Array.isArray(node)) {
    node.forEach((n) => objectNodes(n, found));
  } else if (node && typeof node === "object") {
    if (node.type === "object") found.push(node);
    Object.values(node).forEach((v) => objectNodes(v, found));
  }
  return found;
}

test("a nested schema has every object closed", () => {
  const schema = {
    type: "object",
    properties: {
      angles: {
        type: "array",
        items: {
          type: "object",
          properties: { persona: { type: "object", properties: { name: { type: "string" } } } },
        },
      },
    },
  };
  const out = schemaForApi(schema);
  const objects = objectNodes(out);
  assert.equal(objects.length, 3, "expected the root, the item and the nested persona");
  for (const o of objects) {
    assert.equal(o.additionalProperties, false);
  }
});

test("an explicit additionalProperties is left alone", () => {
  const out = schemaForApi({ type: "object", additionalProperties: true, properties: {} });
  assert.equal(out.additionalProperties, true, "an author's deliberate choice must survive");
});

test("the original schema is not mutated", () => {
  // PROMPTS is module-level and shared across invocations; mutating it
  // would leak one request's normalisation into the next.
  const schema = { type: "object", properties: { a: { type: "string" } } };
  const out = schemaForApi(schema);
  assert.equal(schema.additionalProperties, undefined, "input must be untouched");
  assert.equal(out.additionalProperties, false);
  assert.notEqual(out, schema);
});

test("non-object nodes pass through unchanged", () => {
  assert.equal(schemaForApi("plain"), "plain");
  assert.equal(schemaForApi(7), 7);
  assert.equal(schemaForApi(null), null);
  assert.deepEqual(schemaForApi({ type: "string" }), { type: "string" });
});

test("every schema the prompts declare survives normalisation closed", () => {
  const withSchema = Object.entries(PROMPTS).filter(([, p]) => p?.schema);
  assert.ok(withSchema.length > 0, "expected prompts that declare a schema");

  for (const [name, prompt] of withSchema) {
    const objects = objectNodes(schemaForApi(prompt.schema));
    assert.ok(objects.length > 0, `${name} has no object nodes`);
    for (const o of objects) {
      assert.equal(o.additionalProperties, false, `${name} still has an open object`);
    }
  }
});

// --- constraints the API rejects, preserved rather than dropped ---------

test("maxItems is removed but its meaning is kept", () => {
  const out = schemaForApi({ type: "array", items: { type: "string" }, maxItems: 5 });
  assert.equal(out.maxItems, undefined, "the API rejects maxItems outright");
  assert.match(out.description, /at most 5 items/i);
});

test("a minItems the API refuses becomes a description", () => {
  // This is the only place reader_personas says how many personas it
  // wants — the prompt wording never mentions a number. Deleting it would
  // have quietly changed what the model returns.
  const out = schemaForApi({ type: "array", items: { type: "object" }, minItems: 3, maxItems: 5 });
  assert.equal(out.minItems, undefined);
  assert.equal(out.maxItems, undefined);
  assert.match(out.description, /between 3 and 5 items/i);
});

test("minItems of 0 or 1 is kept, because the API accepts those", () => {
  assert.equal(schemaForApi({ type: "array", minItems: 0 }).minItems, 0);
  assert.equal(schemaForApi({ type: "array", minItems: 1 }).minItems, 1);
});

test("integer bounds move into the description", () => {
  const out = schemaForApi({ type: "integer", minimum: 0, maximum: 100 });
  assert.equal(out.minimum, undefined);
  assert.equal(out.maximum, undefined);
  assert.match(out.description, /from 0 to 100/i);
});

test("an existing description is added to, not replaced", () => {
  const out = schemaForApi({ type: "array", description: "Marketing angles.", minItems: 6 });
  assert.match(out.description, /^Marketing angles\./);
  assert.match(out.description, /at least 6 items/i);
});

test("no schema the prompts declare keeps a keyword the API rejects", () => {
  const offenders = [];
  const walk = (node, path = "") => {
    if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`));
    if (!node || typeof node !== "object") return;
    if (node.type === "array" && node.maxItems !== undefined) offenders.push(`${path}.maxItems`);
    if (node.type === "array" && node.minItems !== undefined
        && node.minItems !== 0 && node.minItems !== 1) offenders.push(`${path}.minItems`);
    if ((node.type === "integer" || node.type === "number")
        && (node.minimum !== undefined || node.maximum !== undefined)) offenders.push(`${path}.bounds`);
    Object.entries(node).forEach(([k, v]) => walk(v, `${path}.${k}`));
  };
  for (const [name, prompt] of Object.entries(PROMPTS)) {
    if (prompt?.schema) walk(schemaForApi(prompt.schema), name);
  }
  assert.deepEqual(offenders, [], `these would be rejected by the API: ${offenders.join(", ")}`);
});
