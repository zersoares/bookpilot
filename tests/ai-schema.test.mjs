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

const { strictSchema } = await import("../netlify/functions/bookpilot-lib/ai.js");
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
  const out = strictSchema(schema);
  const objects = objectNodes(out);
  assert.equal(objects.length, 3, "expected the root, the item and the nested persona");
  for (const o of objects) {
    assert.equal(o.additionalProperties, false);
  }
});

test("an explicit additionalProperties is left alone", () => {
  const out = strictSchema({ type: "object", additionalProperties: true, properties: {} });
  assert.equal(out.additionalProperties, true, "an author's deliberate choice must survive");
});

test("the original schema is not mutated", () => {
  // PROMPTS is module-level and shared across invocations; mutating it
  // would leak one request's normalisation into the next.
  const schema = { type: "object", properties: { a: { type: "string" } } };
  const out = strictSchema(schema);
  assert.equal(schema.additionalProperties, undefined, "input must be untouched");
  assert.equal(out.additionalProperties, false);
  assert.notEqual(out, schema);
});

test("non-object nodes pass through unchanged", () => {
  assert.equal(strictSchema("plain"), "plain");
  assert.equal(strictSchema(7), 7);
  assert.equal(strictSchema(null), null);
  assert.deepEqual(strictSchema({ type: "string" }), { type: "string" });
});

test("every schema the prompts declare survives normalisation closed", () => {
  const withSchema = Object.entries(PROMPTS).filter(([, p]) => p?.schema);
  assert.ok(withSchema.length > 0, "expected prompts that declare a schema");

  for (const [name, prompt] of withSchema) {
    const objects = objectNodes(strictSchema(prompt.schema));
    assert.ok(objects.length > 0, `${name} has no object nodes`);
    for (const o of objects) {
      assert.equal(o.additionalProperties, false, `${name} still has an open object`);
    }
  }
});
