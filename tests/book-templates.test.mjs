// The Book Builder's starting templates live in two places: the database
// seed (sql/008 + sql/017) and js/data/book-templates.js, which the demo
// workspace serves because it has no database. These tests keep them honest.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { BOOK_TEMPLATES } from "../js/data/book-templates.js";
import { themeList } from "../js/doc/themes.js";

// The demo's export path needs Blob; the test runner has it only via node:buffer.
if (typeof globalThis.Blob === "undefined") {
  const { Blob } = await import("node:buffer");
  globalThis.Blob = Blob;
}
const { freshBuilderState, handleBuilder } = await import("../js/data/demo-builder.js");

function workspace() {
  const state = freshBuilderState();
  const account = { profile: { ai_credits: 500 }, spend: () => 1 };
  const call = (method, path, body) =>
    handleBuilder(method, path.split("/").filter(Boolean).slice(1), body || {}, state, account);
  return { call };
}

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sql = read("sql/008_book_builder_seed.sql") + "\n" + read("sql/017_more_book_templates.sql");
const api = read("netlify/functions/bookbuilder-api.mjs");

const unquote = (s) => s.replace(/''/g, "'");
const listFrom = (name) => {
  const block = api.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`))[1];
  return [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
};

// Only the book_templates inserts: the seed also holds the design themes,
// whose rows have the same leading shape.
const templateSql = [...sql.matchAll(/insert into public\.book_templates[\s\S]*?on conflict/g)]
  .map((m) => m[0]).join(String.fromCharCode(10));

// Rows in the SQL look like:  ('id', 'Category', 'Name',
const sqlRows = [...templateSql.matchAll(/^\s*\('([a-z_]+)', '((?:[^']|'')*)', '((?:[^']|'')*)',\s*$/gm)]
  .map(([, id, category, name]) => ({ id, category: unquote(category), name: unquote(name) }));

test("the demo and the database seed define the same templates", () => {
  const fromSql = new Map(sqlRows.map((row) => [row.id, row]));
  assert.equal(fromSql.size, BOOK_TEMPLATES.length, "same number of templates in SQL and in the demo");
  for (const t of BOOK_TEMPLATES) {
    const row = fromSql.get(t.id);
    assert.ok(row, `${t.id} is in the demo but not in the SQL seed`);
    assert.equal(row.category, t.category, `${t.id}: category differs`);
    assert.equal(row.name, t.name, `${t.id}: name differs`);
  }
});

test("every template uses values the server will accept", () => {
  const themes = new Set(themeList().map((theme) => theme.id));
  const purposes = new Set(listFrom("PURPOSES"));
  const styles = new Set(listFrom("STYLES"));
  assert.ok(purposes.size > 3 && styles.size > 5, "could not read the server's allowed values");

  for (const t of BOOK_TEMPLATES) {
    assert.ok(themes.has(t.theme_id), `${t.id}: unknown theme ${t.theme_id}`);
    assert.ok(purposes.has(t.purpose), `${t.id}: purpose ${t.purpose} is not accepted`);
    assert.ok(styles.has(t.writing_style), `${t.id}: writing style ${t.writing_style} is not accepted`);
  }
});

test("templates are complete, unique and sensibly sized", () => {
  const ids = BOOK_TEMPLATES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
  assert.equal(new Set(BOOK_TEMPLATES.map((t) => t.name)).size, ids.length, "names are unique");
  assert.deepEqual(
    BOOK_TEMPLATES.map((t) => t.sort_order),
    BOOK_TEMPLATES.map((_, i) => i),
    "sort_order runs 0..n in order, so the page lists them as written",
  );

  for (const t of BOOK_TEMPLATES) {
    assert.ok(t.description.length > 20, `${t.id}: needs a description`);
    assert.ok(t.audience_hint, `${t.id}: needs an audience`);
    assert.ok(t.target_pages >= 30 && t.target_pages <= 400, `${t.id}: implausible length`);
    const parts = t.structure.parts;
    assert.ok(parts.length >= 3, `${t.id}: at least three parts`);
    for (const part of parts) {
      assert.ok(part.title, `${t.id}: a part has no title`);
      assert.ok(part.chapters.length >= 2, `${t.id}/${part.title}: at least two chapters`);
      assert.ok(part.chapters.every((c) => c.trim()), `${t.id}/${part.title}: blank chapter title`);
    }
  }
});

test("the demo serves the templates and applies them when a book is started from one", () => {
  const { call } = workspace();
  const { templates } = call("GET", "/api/bb/templates");
  assert.equal(templates.length, BOOK_TEMPLATES.length);

  const t = templates.find((x) => x.id === "guided_workbook");
  const { project } = call("POST", "/api/bb/projects", { title: "My workbook", template_id: t.id });
  assert.equal(project.theme_id, t.theme_id);
  assert.equal(project.purpose, t.purpose);
  assert.equal(project.writing_style, t.writing_style);
  assert.equal(project.target_pages, t.target_pages);
  assert.equal(project.target_words, t.target_pages * 260);

  // What the author chose wins over the template, and an unknown id is dropped.
  const own = call("POST", "/api/bb/projects", { title: "Mine", template_id: t.id, target_pages: 90, theme_id: "luxury" });
  assert.equal(own.project.target_pages, 90);
  assert.equal(own.project.theme_id, "luxury");
  const unknown = call("POST", "/api/bb/projects", { title: "Odd", template_id: "no_such_template" });
  assert.equal(unknown.project.template_id, null);
});
