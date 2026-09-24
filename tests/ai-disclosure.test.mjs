// AI-content disclosure summary and text.
//
// KDP's own distinction is binary (AI-generated vs. AI-assisted), so
// these tests check the summary and text against that shape, not
// against any percentage or word-level claim this module never makes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { disclosureSummary, disclosureText } from "../js/core/ai-disclosure.js";

const ch = (over = {}) => ({
  id: "c1", number: 1, title: "Untitled", word_count: 500, include: true,
  ai_generated: false, ai_models: [], ...over,
});

test("disclosureSummary: chapters with no content, or excluded from the book, never count either way", () => {
  const summary = disclosureSummary([
    ch({ id: "empty", word_count: 0, ai_generated: true }),
    ch({ id: "excluded", include: false, ai_generated: true }),
    ch({ id: "real", ai_generated: false }),
  ]);
  assert.equal(summary.total, 1);
  assert.deepEqual(summary.clear.map((c) => c.id), ["real"]);
  assert.equal(summary.anyFlagged, false);
});

test("disclosureSummary: flagged and clear sections are separated correctly", () => {
  const summary = disclosureSummary([
    ch({ id: "a", ai_generated: true, ai_models: ["claude-opus-5"] }),
    ch({ id: "b", ai_generated: false }),
    ch({ id: "c", ai_generated: true, ai_models: ["claude-opus-5", "claude-sonnet-5"] }),
  ]);
  assert.equal(summary.total, 3);
  assert.deepEqual(summary.flagged.map((c) => c.id), ["a", "c"]);
  assert.deepEqual(summary.clear.map((c) => c.id), ["b"]);
  assert.equal(summary.anyFlagged, true);
  assert.equal(summary.allFlagged, false);
  assert.deepEqual(summary.models.sort(), ["claude-opus-5", "claude-sonnet-5"]);
});

test("disclosureSummary: allFlagged is only true when every shipping section is AI-generated", () => {
  assert.equal(disclosureSummary([ch({ ai_generated: true })]).allFlagged, true);
  assert.equal(disclosureSummary([]).allFlagged, false, "an empty book is not \"all flagged\"");
});

test("disclosureSummary: a chapter with no ai_models still summarises without throwing", () => {
  const summary = disclosureSummary([ch({ ai_generated: true, ai_models: undefined })]);
  assert.deepEqual(summary.models, []);
});

// --- disclosureText -------------------------------------------------------

test("disclosureText: a book with nothing written yet says so plainly", () => {
  const text = disclosureText({ title: "My Book" }, []);
  assert.match(text, /nothing to disclose/);
});

test("disclosureText: no AI-generated text anywhere says \"No\" is defensible", () => {
  const text = disclosureText({ title: "My Book" }, [ch({ ai_generated: false })]);
  assert.match(text, /no AI-generated text detected/);
  assert.match(text, /answered .No./);
  assert.ok(!text.includes("requires disclosure"));
});

test("disclosureText: lists exactly the flagged sections by name, and the clear ones separately", () => {
  const text = disclosureText(
    { title: "The Long Walk Home" },
    [
      ch({ id: "a", number: 1, title: "The Beginning", ai_generated: true, ai_models: ["claude-opus-5"] }),
      ch({ id: "b", number: 2, title: "The Middle", ai_generated: false }),
    ]
  );
  assert.match(text, /requires disclosure on KDP/);
  assert.match(text, /Chapter 1: The Beginning/);
  assert.match(text, /Chapter 2: The Middle/);
  assert.match(text, /Sections with AI-generated text \(1 of 2\)/);
  assert.match(text, /Sections with no AI-generated text \(1 of 2\)/);
  assert.match(text, /Generated with: claude-opus-5/);
});

test("disclosureText: front/back matter with no chapter number is labelled by title alone", () => {
  const text = disclosureText({ title: "T" }, [ch({ number: null, title: "About the Author", ai_generated: true })]);
  assert.match(text, /• About the Author\n/);
  assert.ok(!text.includes("Chapter null"));
});

test("disclosureText: no Generated-with line when no model was ever recorded", () => {
  const text = disclosureText({ title: "T" }, [ch({ ai_generated: true, ai_models: [] })]);
  assert.ok(!text.includes("Generated with"));
});

test("disclosureText: falls back to a generic title when the book has none", () => {
  const text = disclosureText(null, [ch({ ai_generated: true })]);
  assert.match(text, /^This book contains/);
});
