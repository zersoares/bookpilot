// Cover templates: fifty ready-made cover designs offered on the Create a book
// page, turned into a real cover on the Cover step.
//
// What is pinned: the data is sound and its measurements agree with themselves;
// a template becomes exactly the cover the renderer expects; the server builds
// it from the template it knows (never from a design the browser describes);
// and the whole path works through the real routes and the demo.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

process.env.SUPABASE_URL = "https://fake.supabase.test";
process.env.SUPABASE_ANON_KEY = "anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
process.env.URL = "https://bookpilot.example";

const {
  COVER_TEMPLATES, PALETTE_ROLES, FEATURED_COLLECTIONS, coverTemplateById, coverFromTemplate, sampleCover, templateGenres, paletteRows,
} = await import("../js/core/cover-templates.js");
const { coverPreview } = await import("../js/views/builder/cover-render.js");
const { coverGallery } = await import("../js/views/builder/cover-gallery.js");
const bb = (await import("../netlify/functions/bookbuilder-api.mjs")).default;

if (typeof globalThis.Blob === "undefined") globalThis.Blob = (await import("node:buffer")).Blob;
const { freshBuilderState, handleBuilder } = await import("../js/data/demo-builder.js");

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const HEX = /^#[0-9a-f]{6}$/i;
const POSITIONS = ["top", "upper", "middle", "lower", "bottom"];
const ALIGNS = ["left", "center", "right"];
const TYPES = ["serif", "sans", "condensed", "display"];
const CASES = ["upper", "lower", "none"];

// ---- the data ---------------------------------------------------------------

test("there are fifty templates, each with a unique id and name", () => {
  assert.equal(COVER_TEMPLATES.length, 50);
  assert.equal(new Set(COVER_TEMPLATES.map((t) => t.id)).size, 50);
  assert.equal(new Set(COVER_TEMPLATES.map((t) => t.name)).size, 50);
  for (const t of COVER_TEMPLATES) {
    assert.match(t.id, /^[a-z0-9-]{1,40}$/, `${t.id}: id is URL- and database-safe`);
    assert.ok(t.name.length >= 3 && t.blurb.length >= 10, `${t.id}: needs a name and a line about it`);
  }
});

test("every template has full-size artwork and a small gallery thumbnail, both compressed web images", () => {
  let thumbTotal = 0;
  for (const t of COVER_TEMPLATES) {
    assert.equal(t.thumb, `/assets/covers/templates/thumbs/${t.id}.webp`);
    const thumbKb = statSync(join(ROOT, t.thumb)).size / 1024;
    assert.ok(thumbKb > 1 && thumbKb < 80, `${t.id}: thumbnail is ${Math.round(thumbKb)} KB`);
    thumbTotal += thumbKb;
    assert.equal(t.image, `/assets/covers/templates/${t.id}.webp`);
    const file = join(ROOT, t.image);
    assert.ok(existsSync(file), `${t.image} is missing`);
    const bytes = readFileSync(file);
    assert.equal(bytes.subarray(0, 4).toString(), "RIFF", `${t.id}: not a WebP file`);
    assert.equal(bytes.subarray(8, 12).toString(), "WEBP");
    const kb = statSync(file).size / 1024;
    assert.ok(kb > 2 && kb < 200, `${t.id}: ${Math.round(kb)} KB is outside what a thumbnail gallery should carry`);
  }
  // Browsing all fifty is what the gallery is for: the thumbnails together must stay light.
  assert.ok(thumbTotal < 1500, `all thumbnails together are ${Math.round(thumbTotal)} KB`);
});

test("palettes and layouts use only what the cover renderer understands", () => {
  for (const t of COVER_TEMPLATES) {
    for (const role of PALETTE_ROLES) assert.match(t.palette[role], HEX, `${t.id}.${role}`);
    assert.ok(POSITIONS.includes(t.layout.title_position), `${t.id}: position`);
    assert.ok(ALIGNS.includes(t.layout.title_align), `${t.id}: align`);
    assert.ok(TYPES.includes(t.layout.type_style), `${t.id}: type`);
    assert.ok(CASES.includes(t.layout.title_case), `${t.id}: case`);
    assert.equal(typeof t.layout.rule, "boolean");
    for (const key of ["scrim", "author_scrim"]) {
      if (key in t.layout) assert.ok(["dark", "light"].includes(t.layout[key]), `${t.id}.${key}`);
    }
    assert.deepEqual(Object.keys(t.layout).filter((k) => !["title_position", "title_align", "type_style", "title_case", "rule", "scrim", "author_scrim"].includes(k)), [], `${t.id}: no stray layout keys`);
  }
});

test("the type colour was chosen so it can be read: ink and scrim always oppose each other", () => {
  for (const t of COVER_TEMPLATES) {
    for (const [ink, scrim] of [[t.palette.title, t.layout.scrim], [t.palette.author, t.layout.author_scrim]]) {
      assert.ok(["#ffffff", "#16161a"].includes(ink), `${t.id}: ink is white or near-black`);
      if (scrim) {
        assert.equal(scrim, ink === "#ffffff" ? "dark" : "light", `${t.id}: a ${scrim} scrim under ${ink} type`);
      }
    }
    // The fallback background (shown if the artwork fails to load) still has to carry the
    // author line, which sits at the foot of the cover.
    assert.ok(HEX.test(t.palette.background), `${t.id}: a fallback background exists`);
  }
});

test("travel, kids and marketing each have ten, and lead the filters in that order", () => {
  for (const collection of ["Travel", "Kids", "Marketing"]) {
    assert.equal(COVER_TEMPLATES.filter((t) => t.genres.includes(collection)).length, 10, `${collection} has ten templates`);
  }
  assert.deepEqual(templateGenres().slice(0, 3), ["Travel", "Kids", "Marketing"]);
  assert.deepEqual(FEATURED_COLLECTIONS, ["Travel", "Kids", "Marketing"]);
  // the collections are distinct: no template is both a kids book and a marketing book
  const kids = COVER_TEMPLATES.filter((t) => t.genres.includes("Kids")).map((t) => t.id);
  assert.ok(!COVER_TEMPLATES.some((t) => kids.includes(t.id) && (t.genres.includes("Marketing") || t.genres.includes("Travel"))));
});

test("the kinds of book cover a real range, with several templates each", () => {
  const genres = templateGenres();
  assert.ok(genres.length >= 12, `a useful set of filters, got ${genres.length}`);
  for (const g of genres) {
    assert.ok(COVER_TEMPLATES.filter((t) => t.genres.includes(g)).length >= 2, `"${g}" has only one template, so filtering it is pointless`);
  }
  for (const t of COVER_TEMPLATES) assert.ok(t.genres.length >= 1 && t.genres.length <= 3, `${t.id}: 1 to 3 kinds`);
});

// ---- the logic ---------------------------------------------------------------

test("only real template ids are accepted", () => {
  assert.equal(coverTemplateById("gold-geometry").name, "Gold Standard");
  for (const bad of ["", null, undefined, 7, "GOLD-GEOMETRY", "../etc/passwd", "__proto__", "constructor", "no-such-template", "a".repeat(41)]) {
    assert.equal(coverTemplateById(bad), null, `refuses ${String(bad).slice(0, 20)}`);
  }
});

test("a template becomes the cover the renderer expects, filled from the project", () => {
  const t = coverTemplateById("sunrise-doorway");
  const row = coverFromTemplate(t, { title: "  My Book  ", subtitle: "A subtitle", author: "Ann Author", origin: "https://bookpilot.org/" });
  assert.equal(row.concept_name, "New Beginnings");
  assert.equal(row.title_text, "My Book");
  assert.equal(row.subtitle_text, "A subtitle");
  assert.equal(row.author_text, "Ann Author");
  assert.equal(row.image_url, "https://bookpilot.org/assets/covers/templates/sunrise-doorway.webp");
  assert.equal(row.is_selected, false, "choosing the cover stays the author's decision");
  assert.deepEqual(row.palette.map((p) => p.role), PALETTE_ROLES);
  assert.match(row.rationale, /New Beginnings/);
  assert.ok(row.genre_signals.length >= 1);

  // no title yet: null, not a fake one; no origin: no broken relative address
  const early = coverFromTemplate(t, { title: "Untitled book" });
  assert.equal(early.title_text, null);
  assert.equal(early.image_url, null);
  assert.equal(coverFromTemplate(t, {}).author_text, null);

  // and building a cover never lets anyone edit the template itself
  row.layout.title_position = "bottom";
  assert.notEqual(t.layout.title_position, "bottom");
  row.palette[0].hex = "#000000";
  assert.notEqual(paletteRows(t.palette)[0].hex, "#000000");
});

test("thumbnails say plainly that the title is a stand-in, and use the small image", () => {
  const cover = sampleCover(coverTemplateById("cosmic-nebula"), { author: " " });
  assert.equal(cover.image_url, "/assets/covers/templates/thumbs/cosmic-nebula.webp");
  assert.equal(coverFromTemplate(coverTemplateById("cosmic-nebula"), { origin: "https://x.test" }).image_url,
    "https://x.test/assets/covers/templates/cosmic-nebula.webp", "but a real cover uses the full-size art");
  assert.equal(cover.title_text, "Your Book Title");
  assert.equal(cover.author_text, "Author Name");
  assert.equal(sampleCover(coverTemplateById("cosmic-nebula"), { author: "Ann" }).author_text, "Ann");
});

// ---- drawing -----------------------------------------------------------------

test("a scrim is drawn only from fixed values, only over artwork", () => {
  const withScrim = coverPreview({ ...sampleCover(coverTemplateById("sand-dunes")) });
  assert.match(withScrim, /bb-cover__scrim/);
  assert.match(withScrim, /rgba\(10, 10, 22/);

  const noArt = coverPreview({ ...sampleCover(coverTemplateById("sand-dunes")), image_url: null });
  assert.doesNotMatch(noArt, /bb-cover__scrim/, "no artwork, nothing to wash");

  const evil = coverPreview({ ...sampleCover(coverTemplateById("sand-dunes")), layout: { scrim: "red;background:url(x)", title_position: "lower" } });
  assert.doesNotMatch(evil, /bb-cover__scrim|url\(x\)/, "an unknown scrim value draws nothing");
});

test("the title goes where the cover says: top, middle or bottom of the space above the author", () => {
  const at = (title_position) => coverPreview({ ...sampleCover(coverTemplateById("sand-dunes")), layout: { title_position } });
  const zoneJustify = (html) => html.match(/class="bb-cover__zone" style="justify-content:([\w-]+)/)?.[1];
  assert.equal(zoneJustify(at("upper")), "flex-start");
  assert.equal(zoneJustify(at("top")), "flex-start");
  assert.equal(zoneJustify(at("middle")), "center");
  assert.equal(zoneJustify(at("lower")), "flex-end");
  assert.equal(zoneJustify(at("bottom")), "flex-end");
  // The bug this replaces: the placement lived on the outer box, where the author
  // line's auto margin absorbed all the free space, so every title sat at the top.
  assert.doesNotMatch(at("lower").split('class="bb-cover__zone"')[0], /justify-content/);
  assert.ok(at("lower").indexOf("bb-cover__zone") < at("lower").indexOf("bb-cover__author"), "and the author line stays below the title zone");
});

test("the gallery lists all fifty, marks the chosen one, shows counts, and posts with the form beside it", () => {
  const out = coverGallery({ selected: "gold-geometry", author: "Ann <b>" });
  assert.equal((out.match(/data-template="[a-z0-9-]+"/g) || []).length, 50);
  assert.match(out, /data-genre="Travel"[^>]*>Travel <span class="bb-tpl-chip__n">10<\/span>/, "each filter shows how many it holds");
  assert.ok(out.indexOf('data-genre="Travel"') < out.indexOf('data-genre="Kids"') && out.indexOf('data-genre="Kids"') < out.indexOf('data-genre="Marketing"'));
  assert.match(out, /data-template=""[^>]*data-genres="\*"/, "and a 'no template' choice");
  assert.match(out, /value="gold-geometry"[^>]*form="new-book"\s+checked/);
  assert.equal((out.match(/checked/g) || []).length, 1, "exactly one choice is selected");
  assert.equal((out.match(/type="radio" name="cover_template"/g) || []).length, 51);
  assert.ok((out.match(/form="new-book"/g) || []).length >= 51, "every choice belongs to the form though it sits outside it");
  assert.doesNotMatch(out, /Ann <b>/, "the author's name is escaped");
  assert.match(out, /Ann &lt;b&gt;/);

  assert.match(coverGallery({}), /value=""[^>]*checked/, "with no choice, 'no template' is selected");
});

// ---- through the real server routes ---------------------------------------------

const USER = { id: "11111111-1111-4111-8111-111111111111" };

function serverWorld() {
  return {
    tables: {
      profiles: [{ id: USER.id, ai_credits: 100, plan_id: "author", full_name: "Ann Author" }],
      plans: [{ id: "author", name: "Author", book_limit: null, sort_order: 0 }],
      book_projects: [], book_covers: [], book_bible: [], audit_log: [],
    },
  };
}

function installFetch(w) {
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const method = (init.method || "GET").toUpperCase();
    const body = init.body ? JSON.parse(init.body) : undefined;
    const reply = (data, status = 200) => new Response(data === undefined ? "" : JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    if (url.pathname === "/auth/v1/user") return reply({ id: USER.id, email: "a@example.com" });
    const table = url.pathname.match(/^\/rest\/v1\/(\w+)$/)?.[1];
    if (!table) return reply({ message: "not found" }, 404);
    const rows = (w.tables[table] ||= []);
    const matches = (row) => {
      for (const [key, value] of url.searchParams) {
        if (["select", "order", "limit", "offset"].includes(key)) continue;
        if (value.startsWith("eq.")) { if (String(row[key]) !== value.slice(3)) return false; }
        else if (value.startsWith("neq.")) { if (String(row[key]) === value.slice(4)) return false; }
      }
      return true;
    };
    if (method === "GET") {
      const out = rows.filter(matches);
      const limit = Number(url.searchParams.get("limit"));
      return reply(limit ? out.slice(0, limit) : out);
    }
    if (method === "POST") {
      const list = Array.isArray(body) ? body : [body];
      const saved = list.map((r, i) => ({ id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(rows.length + i + 1).padStart(12, "0")}`, created_at: new Date().toISOString(), ...r }));
      rows.push(...saved);
      return reply(saved, 201);
    }
    if (method === "PATCH") { const hit = rows.filter(matches); hit.forEach((r) => Object.assign(r, body)); return reply(hit); }
    return reply({}, 405);
  };
  return () => { globalThis.fetch = real; };
}

const call = (method, path, body) => bb(new Request(`http://localhost:8888${path}`, {
  method, headers: { authorization: "Bearer tok", "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
}));
const quiet = () => { const e = console.error; console.error = () => {}; return () => { console.error = e; }; };

test("the project remembers a valid template, and drops anything else", async () => {
  const w = serverWorld();
  const restore = installFetch(w), unquiet = quiet();
  try {
    const good = await (await call("POST", "/api/bb/projects", { idea: "A book about starting over after a big change.", cover_template: "gold-geometry" })).json();
    assert.deepEqual(good.project.design, { cover_template: "gold-geometry" });

    for (const bad of ["not-a-template", "__proto__", "../x", 12, null]) {
      const res = await (await call("POST", "/api/bb/projects", { idea: "A book about starting over after a big change.", cover_template: bad })).json();
      assert.deepEqual(res.project.design, {}, `ignores ${String(bad)}`);
    }
    const none = await (await call("POST", "/api/bb/projects", { idea: "A book about starting over after a big change." })).json();
    assert.deepEqual(none.project.design, {});
  } finally { unquiet(); restore(); }
});

test("a cover is built from the template the server knows, with the project's own text", async () => {
  const w = serverWorld();
  const restore = installFetch(w), unquiet = quiet();
  try {
    const { project } = await (await call("POST", "/api/bb/projects",
      { idea: "A book about starting over after a big change.", title: "Starting Over", subtitle: "A plan", author_name: "Ann Author" })).json();

    const made = await call("POST", `/api/bb/projects/${project.id}/covers`, { template_id: "gold-geometry" });
    assert.equal(made.status, 201);
    const { cover } = await made.json();
    assert.equal(cover.concept_name, "Gold Standard");
    assert.equal(cover.title_text, "Starting Over");
    assert.equal(cover.subtitle_text, "A plan");
    assert.equal(cover.author_text, "Ann Author");
    assert.equal(cover.image_url, "https://bookpilot.example/assets/covers/templates/gold-geometry.webp", "an absolute address on the site's own domain");
    assert.equal(cover.is_selected, false);
    assert.equal(cover.project_id, project.id);
    assert.deepEqual(cover.palette.map((p) => p.role), PALETTE_ROLES);
    assert.equal(cover.layout.type_style, "serif");

    // asking again does not stack a duplicate
    const again = await call("POST", `/api/bb/projects/${project.id}/covers`, { template_id: "gold-geometry" });
    assert.equal(again.status, 200);
    assert.equal((await again.json()).cover.id, cover.id);
    assert.equal(w.tables.book_covers.length, 1);
  } finally { unquiet(); restore(); }
});

test("the server refuses a template it does not have, and a cover design the browser makes up", async () => {
  const w = serverWorld();
  const restore = installFetch(w), unquiet = quiet();
  try {
    const { project } = await (await call("POST", "/api/bb/projects", { idea: "A book about starting over after a big change." })).json();
    for (const body of [{}, { template_id: "nope" }, { template_id: "__proto__" }, { template_id: "../x" }]) {
      const res = await call("POST", `/api/bb/projects/${project.id}/covers`, body);
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    // a design described by the client is not accepted in place of an id
    const forged = await call("POST", `/api/bb/projects/${project.id}/covers`,
      { palette: [{ role: "background", hex: "#000000" }], image_url: "https://evil.example/x.png", concept_name: "Mine" });
    assert.equal(forged.status, 400);
    assert.equal(w.tables.book_covers.length, 0, "nothing was created by any of that");

    // an untitled project gets a cover with no title on it yet, not a fake one
    const ok = await (await call("POST", `/api/bb/projects/${project.id}/covers`, { template_id: "cosmic-nebula" })).json();
    assert.equal(ok.cover.title_text, null);
  } finally { unquiet(); restore(); }
});

// ---- the demo, which must behave the same ------------------------------------------

function demoWorkspace() {
  const state = freshBuilderState();
  const account = { profile: { ai_credits: 500 }, spend: () => 1 };
  return (method, path, body) => handleBuilder(method, path.split("/").filter(Boolean).slice(1), body || {}, state, account);
}

test("the demo remembers the template, builds the same cover, and does not stack duplicates", () => {
  const call = demoWorkspace();
  const { project } = call("POST", "/api/bb/projects", { idea: "A book about starting over.", title: "Starting Over", author_name: "Ann", cover_template: "old-library" });
  assert.deepEqual(project.design, { cover_template: "old-library" });
  assert.ok(!("cover_template" in project), "the pick lives in design, not as a stray field");

  const { cover } = call("POST", `/api/bb/projects/${project.id}/covers`, { template_id: "old-library" });
  assert.equal(cover.concept_name, "Old Library");
  assert.equal(cover.title_text, "Starting Over");
  assert.equal(cover.author_text, "Ann");
  assert.equal(cover.is_selected, false);
  assert.equal(call("POST", `/api/bb/projects/${project.id}/covers`, { template_id: "old-library" }).cover.id, cover.id);
  assert.equal(call("GET", `/api/bb/projects/${project.id}/covers`).covers.filter((c) => c.concept_name === "Old Library").length, 1);

  assert.throws(() => call("POST", `/api/bb/projects/${project.id}/covers`, { template_id: "nope" }), /doesn't exist/);
  const plain = call("POST", "/api/bb/projects", { idea: "Another book about something else." });
  assert.deepEqual(plain.project.design, {});
});

// ---- how it is wired ------------------------------------------------------------------

test("the Create page shows the gallery on the left and sends the choice; the Cover step uses it", () => {
  const wizard = read("js/views/builder/projects.js");
  assert.match(wizard, /coverGallery\(\{ selected: preselectedCover \}\)[\s\S]*?<form id="new-book"/, "gallery comes before (left of) the form");
  assert.match(wizard, /bindCoverGallery\(container\)/);
  assert.match(wizard, /cover_template: coverTemplate/);

  const cover = read("js/views/builder/design.js");
  assert.match(cover, /createCoverFromTemplate\(data\.project\.id, picked\)/);
  assert.match(cover, /updateProject\(data\.project\.id, \{ design: rest \}\)/, "the pointer is cleared once used, so a deleted cover is not recreated");
  assert.match(cover, /c\.title_text == null && realTitle/, "a cover made before the title existed is lettered later");

  const css = read("assets/css/builder.css");
  assert.match(css, /\.bb-wizard__layout \{[^}]*grid-template-columns: 340px/);
  assert.match(css, /max-width: 980px[\s\S]*?\.bb-tpl-list \{[\s\S]*?overflow-x: auto/, "a swipeable strip on narrow screens");
  assert.match(read("netlify.toml"), /js\/core\/cover-templates\.js/, "the function bundle carries the template code");
});
