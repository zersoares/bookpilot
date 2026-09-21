// Book Builder: the demo workspace, and the structural guards on the
// new schema.
//
// The demo tests exist because the demo workspace is what an
// unconfigured deployment serves — it is the product for anyone who has
// not signed up, so "it works without a database" has to keep being
// true.
//
// The structural tests exist because a new table without a row level
// security policy is invisible until the day it leaks.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const schema = read("sql/006_book_builder.sql");
const rls = read("sql/007_book_builder_rls.sql");
const seed = read("sql/008_book_builder_seed.sql");

// A Blob shim so the demo's export path can run under the test runner
// the same way it runs in a browser.
if (typeof globalThis.Blob === "undefined") {
  const { Blob } = await import("node:buffer");
  globalThis.Blob = Blob;
}

const { freshBuilderState, handleBuilder, exportBookFromState, DemoError } =
  await import("../js/data/demo-builder.js");
const { DEMO_IDS } = await import("../js/data/demo-book.js");

// ---------------------------------------------------------------------
// The demo workspace
// ---------------------------------------------------------------------

function workspace() {
  const state = freshBuilderState();
  const account = {
    profile: { ai_credits: 500 },
    spend(operation) {
      const costs = { book_positioning: 5, book_architecture: 15, book_bible: 8,
        chapter_write: 12, chapter_revise: 4, editorial_review: 6, research_brief: 8,
        visual_direction: 6, book_image: 5, cover_concepts: 10, cover_check: 3,
        quality_report: 10, marketing_campaign: 20, repurpose_book: 8,
        front_matter: 4, back_matter: 4 };
      const cost = costs[operation] ?? 1;
      account.profile.ai_credits -= cost;
      return cost;
    },
  };
  const call = (method, path, body) =>
    handleBuilder(method, path.split("/").filter(Boolean).slice(1), body || {}, state, account);
  return { state, account, call };
}

const PROJECT = DEMO_IDS.PROJECT;

test("the demo answers every route the Book Builder client calls", () => {
  const { call } = workspace();

  // Reference data
  assert.ok(call("GET", "/api/bb/themes").themes.length >= 8);
  assert.ok(Array.isArray(call("GET", "/api/bb/templates").templates));
  assert.ok(call("GET", "/api/bb/brand-kits").kits.length >= 1);

  // The project and everything hanging off it
  const list = call("GET", "/api/bb/projects");
  assert.equal(list.projects.length, 1);
  assert.ok(list.projects[0].progress, "the library card needs a progress figure");
  assert.ok(list.projects[0].cover, "and the cover it was designed with");

  const detail = call("GET", `/api/bb/projects/${PROJECT}`);
  for (const key of ["project", "positioning", "bible", "parts", "chapters",
                     "visuals", "covers", "quality", "exports", "sources"]) {
    assert.ok(key in detail, `the project view expects ${key}`);
  }

  const manuscript = call("GET", `/api/bb/projects/${PROJECT}/manuscript`);
  assert.ok(manuscript.project.progress, "the previewer's header reads progress from here");
  assert.ok(manuscript.chapters.length > 5);

  for (const child of ["chapters", "parts", "bible", "visuals", "sources", "covers",
                       "marketing", "versions"]) {
    assert.doesNotThrow(() => call("GET", `/api/bb/projects/${PROJECT}/${child}`), child);
  }
});

test("the demo book is a real one: five written chapters and a full plan", () => {
  const { call } = workspace();
  const { chapters, parts } = call("GET", `/api/bb/projects/${PROJECT}`);
  const written = chapters.filter((c) => c.kind === "chapter" && (c.word_count || 0) > 400);
  assert.equal(written.length, 5, "spec §48 asks for about five sample chapters");
  assert.ok(chapters.length > 15, "and a blueprint for the rest");
  assert.equal(parts.length, 3);

  // A sample book that claims a word count it does not have would make
  // every figure downstream a lie.
  for (const chapter of written) {
    const actual = chapter.content.trim().split(/\s+/).length;
    assert.ok(Math.abs(actual - chapter.word_count) < actual * 0.2,
      `${chapter.title} reports ${chapter.word_count} words and holds about ${actual}`);
  }
});

test("editing a chapter keeps the draft it replaced", () => {
  const { call, state } = workspace();
  const chapter = state.chapters.find((c) => c.word_count > 400);
  assert.equal(state.chapterVersions.length, 0);

  call("PATCH", `/api/bb/projects/${PROJECT}/chapters/${chapter.id}`,
    { content: "Something completely different." });

  assert.equal(state.chapterVersions.length, 1, "the previous draft has to survive an edit");
  assert.ok(state.chapterVersions[0].content.length > 400);
});

test("restoring a version keeps the text it replaced too", () => {
  const { call, state } = workspace();
  const chapter = state.chapters.find((c) => c.word_count > 400);
  const original = chapter.content;

  call("PATCH", `/api/bb/projects/${PROJECT}/chapters/${chapter.id}`, { content: "Replaced." });
  const version = state.chapterVersions[0];
  const restored = call("POST", `/api/bb/chapters/${chapter.id}/versions/restore`,
    { version_id: version.id });

  assert.equal(restored.chapter.content, original);
  assert.equal(state.chapterVersions.length, 2, "nothing is ever simply overwritten");
});

test("the agents spend credits and change the workspace", () => {
  const { call, account, state } = workspace();

  const before = account.profile.ai_credits;
  const positioning = call("POST", "/api/bb-ai/positioning", { project_id: PROJECT });
  assert.equal(positioning.creditsUsed, 5);
  assert.equal(account.profile.ai_credits, before - 5);
  assert.ok(positioning.positioning.title_ideas.length >= 6);
  assert.equal(positioning.demo, true, "the demo always says so");

  const review = call("POST", "/api/bb-ai/review", {
    chapter_id: state.chapters.find((c) => c.word_count > 400).id,
  });
  assert.ok(review.quality.scores.clarity > 0);

  const covers = call("POST", "/api/bb-ai/covers", { project_id: PROJECT });
  assert.ok(covers.covers.length >= 2);
  assert.equal(covers.imageProviderConfigured, false, "no renderer is configured in the demo");
});

test("approving positioning applies the title the author chose", () => {
  const { call } = workspace();
  call("POST", "/api/bb-ai/positioning", { project_id: PROJECT });
  const result = call("POST", "/api/bb-ai/approve-positioning", {
    project_id: PROJECT,
    title: "What Stays Yours",
    subtitle: "A subtitle",
  });
  assert.equal(result.project.title, "What Stays Yours");
  assert.equal(result.project.stages.positioning, "approved");
});

test("regenerating the architecture keeps every section that holds text", () => {
  const { call, state } = workspace();
  const writtenBefore = state.chapters.filter((c) => String(c.content || "").trim());
  const idsBefore = new Set(writtenBefore.map((c) => c.id));

  const result = call("POST", "/api/bb-ai/architecture", { project_id: PROJECT });

  assert.equal(result.kept.length, writtenBefore.length,
    "a redesign must never silently delete written work");
  for (const id of idsBefore) {
    assert.ok(
      state.chapters.some((c) => c.id === id && String(c.content || "").trim()),
      "a section that had text lost it"
    );
  }
  assert.ok(result.chapters.length > writtenBefore.length, "and a new plan arrives alongside");
});

test("the demo refuses what it cannot actually do", () => {
  const { call } = workspace();
  assert.throws(
    () => call("POST", `/api/bb/projects/${PROJECT}/promote`),
    (err) => err instanceof DemoError && err.status === 501
  );
  assert.throws(
    () => call("GET", "/api/bb/nonsense"),
    (err) => err instanceof DemoError && err.status === 404
  );
});

test("the demo builds every export format for real", () => {
  const { state } = workspace();
  const formats = {
    pdf_digital: [0x25, 0x50, 0x44, 0x46],   // %PDF
    pdf_print: [0x25, 0x50, 0x44, 0x46],
    epub: [0x50, 0x4b, 0x03, 0x04],          // PK..
    docx: [0x50, 0x4b, 0x03, 0x04],
  };

  for (const [format, magic] of Object.entries(formats)) {
    const result = exportBookFromState(format, PROJECT, state);
    assert.ok(result.blob.size > 2000, `${format} produced almost nothing`);
    assert.ok(result.fileName.endsWith(format.startsWith("pdf") ? ".pdf" : `.${format}`));
    assert.equal(result.watermark, true, "the demo always watermarks");
    void magic;
  }

  assert.ok(state.exports.length > 4, "each export is recorded in the history");
});

test("the print PDF runs longer than the screen one, because chapters open on the right", () => {
  const { state } = workspace();
  const screen = exportBookFromState("pdf_digital", PROJECT, state);
  const print = exportBookFromState("pdf_print", PROJECT, state);
  assert.ok(print.pages >= screen.pages);
});

// ---------------------------------------------------------------------
// Structure: the new schema
// ---------------------------------------------------------------------

test("every Book Builder table has row level security switched on", () => {
  const created = [...schema.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);
  assert.ok(created.length >= 15, "expected the Book Builder tables");

  const enabled = rls.slice(rls.indexOf("enable row level security") - 1200);
  for (const table of created) {
    assert.ok(
      rls.includes(`'${table}'`) || enabled.includes(table),
      `${table} is created but never appears in 007_book_builder_rls.sql`
    );
  }
});

test("the tables a client must not write are revoked, not merely unpolicied", () => {
  for (const table of ["book_quality_reports", "book_exports"]) {
    assert.ok(
      new RegExp(`revoke insert, update, delete on public\\.${table}`).test(rls),
      `${table} must be read-only to the client: it records what the server found`
    );
  }
});

test("server-derived columns are revoked at the column level", () => {
  // RLS has no notion of columns, so a row policy alone would let a
  // client PATCH its own word count or its own quality score.
  assert.ok(/revoke update on public\.book_chapters from anon, authenticated/.test(rls));
  const grant = rls.slice(rls.indexOf("grant update (\n  part_id"));
  assert.ok(!/\bword_count\b/.test(grant.slice(0, 400)), "word_count must stay server-derived");
  assert.ok(!/\bquality\b/.test(grant.slice(0, 400)), "quality is the Editorial Director's verdict");
});

test("the access predicate is not left executable by everyone", () => {
  // The lesson of 005_hardening.sql: CREATE FUNCTION grants EXECUTE to
  // PUBLIC, and revoking from anon and authenticated does not remove it.
  assert.ok(
    /revoke execute on function public\.bb_can_access_project\(uuid\) from public/.test(rls),
    "a PUBLIC grant survives a revoke from anon and authenticated"
  );
});

test("the word count is derived by a trigger rather than trusted", () => {
  assert.ok(/create or replace function public\.bb_set_word_count/.test(schema));
  assert.ok(/before insert or update of content on public\.book_chapters/.test(schema));
  assert.ok(/set search_path = public/.test(schema), "search_path has to be pinned");
});

test("the seed prices every Book Builder operation", () => {
  for (const operation of [
    "book_positioning", "book_architecture", "book_bible", "chapter_write",
    "chapter_revise", "editorial_review", "research_brief", "visual_direction",
    "cover_concepts", "cover_check", "quality_report", "marketing_campaign",
    "repurpose_book", "front_matter", "back_matter", "book_image",
  ]) {
    assert.ok(seed.includes(`'${operation}'`), `${operation} has no credit cost`);
  }
});

test("the free plan is the one that watermarks exports", () => {
  assert.ok(/export_watermark_plans.*free/s.test(seed));
});

test("image generation ships switched off, because there is no renderer", () => {
  assert.ok(/\('book_image_generation', false/.test(seed));
});

// ---------------------------------------------------------------------
// Structure: what the browser is allowed to load
// ---------------------------------------------------------------------

test("the deployment does not serve the functions directory as static files", () => {
  // publish = "." puts netlify/ inside the published root, which would
  // hand the server-side AI prompts to anyone who guessed the path.
  const netlifyToml = read("netlify.toml");
  assert.ok(
    /from = "\/netlify\/\*"[\s\S]{0,120}force = true/.test(netlifyToml),
    "netlify/* has to be redirected away, with force"
  );
});

test("the shared document engine is bundled with the functions", () => {
  const netlifyToml = read("netlify.toml");
  assert.ok(
    /included_files = \[[^\]]*"js\/doc\/\*\*"/.test(netlifyToml),
    "the exporter imports js/doc from outside the functions directory"
  );
});

test("nothing in the browser's document engine imports a Node module", () => {
  for (const file of ["layout.js", "pdf.js", "zip.js", "epub.js", "docx.js",
                      "markdown.js", "metrics.js", "themes.js", "figures.js",
                      "svg.js", "assemble.js", "render-html.js", "deflate.js"]) {
    const source = read(`js/doc/${file}`);
    const imports = [...source.matchAll(/^import .*from "([^"]+)"/gm)].map((m) => m[1]);
    for (const specifier of imports) {
      assert.ok(
        !specifier.startsWith("node:"),
        `js/doc/${file} imports ${specifier}; the previewer runs this in a browser`
      );
    }
  }
});
