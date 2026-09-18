// The Book Builder's demo workspace.
//
// Implements the same request surface as core/builder-api.js against an
// in-memory copy of the sample book, so the whole authoring product is
// explorable with no account, no database and no API key.
//
// Two things here are not simulated at all, and they are the two that
// matter most:
//
//   * The page previewer runs the real layout engine. Those are the
//     actual pages.
//   * Export runs the real PDF, EPUB, DOCX and HTML writers, in the
//     browser. The file that downloads from the demo is built by the
//     same code the server would have run, from the same manuscript.
//
// Everything the model would have written is canned, and every screen
// that shows it carries the DEMO DATA badge.

import {
  DEMO_IDS, DEMO_PROJECT, DEMO_POSITIONING, DEMO_BIBLE, DEMO_PARTS, DEMO_CHAPTERS,
  DEMO_VISUALS, DEMO_COVERS, DEMO_SOURCES, DEMO_QUALITY, DEMO_MARKETING,
  DEMO_EXPORTS, DEMO_VERSIONS, DEMO_BRAND_KIT,
} from "./demo-book.js";
import { themeList, TRIM_SIZES, trimSize } from "../doc/themes.js";
import { assembleBook } from "../doc/assemble.js";
import { layoutBook } from "../doc/layout.js";
import { writePdf } from "../doc/pdf.js";
import { writeEpub } from "../doc/epub.js";
import { writeDocx } from "../doc/docx.js";
import { renderDocument } from "../doc/render-html.js";
import { wordCount } from "../doc/markdown.js";

const clone = (value) => JSON.parse(JSON.stringify(value));
const uid = () =>
  `d${Date.now().toString(16)}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`;

export class DemoError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function freshBuilderState() {
  return {
    projects: [clone(DEMO_PROJECT)],
    positioning: [clone(DEMO_POSITIONING)],
    bibles: [clone(DEMO_BIBLE)],
    parts: clone(DEMO_PARTS),
    chapters: clone(DEMO_CHAPTERS),
    chapterVersions: [],
    projectVersions: clone(DEMO_VERSIONS),
    visuals: clone(DEMO_VISUALS),
    covers: clone(DEMO_COVERS),
    sources: clone(DEMO_SOURCES),
    quality: [clone(DEMO_QUALITY)],
    marketing: clone(DEMO_MARKETING),
    exports: clone(DEMO_EXPORTS),
    brandKits: [clone(DEMO_BRAND_KIT)],
  };
}

// ---------------------------------------------------------------------
// Derived figures — the same arithmetic the server does
// ---------------------------------------------------------------------

function progressOf(project, chapters) {
  const body = chapters.filter((c) => c.include !== false && c.kind !== "front");
  const planned = body.reduce((sum, c) => sum + (c.target_words || 0), 0);
  const written = body.reduce((sum, c) => sum + (c.word_count || 0), 0);
  const done = body.filter((c) => ["draft", "reviewed", "approved", "final"].includes(c.status)).length;
  const stages = project.stages || {};
  const stageWeight =
    (stages.positioning === "approved" ? 8 : 0) +
    (stages.blueprint === "approved" ? 10 : 0) +
    (stages.design === "approved" ? 6 : 0) +
    (stages.cover === "approved" ? 6 : 0);
  const writing = planned > 0 ? Math.min(1, written / planned) : 0;
  return {
    percent: Math.min(100, Math.round(stageWeight + writing * 70)),
    chapters: body.length,
    chaptersWritten: done,
    words: written,
    plannedWords: planned,
    estimatedPages: Math.max(0, Math.round(written / 260)),
  };
}

const forProject = (rows, id) => rows.filter((row) => row.project_id === id);

function findProject(state, id) {
  const project = state.projects.find((p) => p.id === id);
  if (!project) throw new DemoError("not_found", "We couldn't find that book.", 404);
  return project;
}

function findChapter(state, id) {
  const chapter = state.chapters.find((c) => c.id === id);
  if (!chapter) throw new DemoError("not_found", "We couldn't find that chapter.", 404);
  return chapter;
}

function touch(project) {
  project.updated_at = new Date().toISOString();
}

// ---------------------------------------------------------------------
// The demo's own canned generations
// ---------------------------------------------------------------------

const DEMO_NOTE =
  "Demo workspace: this text is part of the sample book, not something a model wrote just now.";

function cannedChapter(chapter) {
  return (
    `This chapter has not been written in the demo workspace.\n\n` +
    `In a configured deployment the Book Writer would draft "${chapter.title}" here — to its ` +
    `stated purpose (${chapter.purpose || "no purpose set"}), to a ${chapter.target_words || 2500}-word ` +
    `budget, in the voice the Book Bible sets, knowing what the chapters either side of it do.\n\n` +
    `## What you can do instead\n\n` +
    `Open chapters one to five. Those are written, and they are what the engine produces: ` +
    `panels, figures, an editorial review on chapter one, and a page preview that is the real ` +
    `typeset page rather than a mock-up.\n\n` +
    `:::callout ${DEMO_NOTE}\nNothing in the demo reaches an AI provider, and no credits are really spent.\n:::`
  );
}

// ---------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------

/**
 * @param {string} method
 * @param {string[]} segments  path after /api/, e.g. ["bb","projects","<id>"]
 * @param {object} body
 * @param {object} state       the demo workspace's builder slice
 * @param {object} account     { profile, spend(operation) }
 */
export function handleBuilder(method, segments, body, state, account) {
  const [section, resource, id, child, childId] = segments;

  if (section === "bb") return handleData(method, { resource, id, child, childId }, body, state, account);
  if (section === "bb-ai") return handleAgents(resource, body, state, account);
  throw new DemoError("not_found", "That isn't part of the demo.", 404);
}

function handleData(method, { resource, id, child, childId }, body, state, account) {
  switch (resource) {
    case "themes":
      return {
        themes: themeList().map((theme) => ({ ...theme, tagline: "", description: "" })),
        trimSizes: Object.entries(TRIM_SIZES).map(([key, size]) => ({ id: key, ...size })),
      };

    case "templates":
      // Templates are reference data the demo has no copy of; saying so
      // is better than inventing a marketplace that does not exist here.
      return { templates: [] };

    case "brand-kits": {
      if (method === "GET") return { kits: state.brandKits };
      if (method === "POST") {
        const kit = { ...body, id: uid(), user_id: "demo", created_at: new Date().toISOString() };
        if (kit.is_default) state.brandKits.forEach((k) => { k.is_default = false; });
        state.brandKits.unshift(kit);
        return { kit };
      }
      if (method === "PATCH") {
        const kit = state.brandKits.find((k) => k.id === id);
        if (!kit) throw new DemoError("not_found", "We couldn't find that brand kit.", 404);
        if (body.is_default) state.brandKits.forEach((k) => { k.is_default = false; });
        Object.assign(kit, body);
        return { kit };
      }
      if (method === "DELETE") {
        state.brandKits = state.brandKits.filter((k) => k.id !== id);
        return { deleted: true };
      }
      break;
    }

    case "chapters": {
      // /api/bb/chapters/:id/versions
      const chapter = findChapter(state, id);
      if (method === "GET") {
        return { versions: state.chapterVersions.filter((v) => v.chapter_id === chapter.id) };
      }
      if (method === "POST") {
        const version = state.chapterVersions.find((v) => v.id === body.version_id);
        if (!version) throw new DemoError("not_found", "We couldn't find that version.", 404);
        saveChapterVersion(state, chapter, `Before restoring v${version.version}`, "restore");
        chapter.content = version.content;
        chapter.word_count = wordCount(version.content);
        return { chapter, restored: version.version };
      }
      break;
    }

    case "projects":
      return handleProjects(method, { id, child, childId }, body, state, account);

    default:
      break;
  }
  throw new DemoError("not_found", "That isn't part of the demo.", 404);
}

function handleProjects(method, { id, child, childId }, body, state, account) {
  if (!id) {
    if (method === "GET") {
      return {
        projects: state.projects.map((project) => ({
          ...project,
          progress: progressOf(project, forProject(state.chapters, project.id)),
          cover: state.covers.find((c) => c.project_id === project.id && c.is_selected) || null,
        })),
      };
    }
    if (method === "POST") {
      const project = {
        ...clone(DEMO_PROJECT),
        ...body,
        id: uid(),
        title: body.title || "Untitled book",
        status: "draft",
        stages: {},
        is_demo: true,
        book_id: null,
        target_words: body.target_pages ? Math.round(Number(body.target_pages) * 260) : 40000,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      state.projects.unshift(project);
      state.bibles.push({ project_id: project.id, chapter_summaries: [], voice_rules: [],
        terminology: [], key_concepts: [], facts: [], recurring_examples: [], characters: [],
        brand_colors: [], typography: {} });
      return { project };
    }
    throw new DemoError("not_found", "That isn't part of the demo.", 404);
  }

  const project = findProject(state, id);

  if (!child) {
    if (method === "GET") {
      const chapters = forProject(state.chapters, id);
      return {
        project: { ...project, progress: progressOf(project, chapters) },
        positioning: state.positioning.find((p) => p.project_id === id) || null,
        bible: state.bibles.find((b) => b.project_id === id) || null,
        parts: forProject(state.parts, id),
        chapters,
        visuals: forProject(state.visuals, id),
        covers: forProject(state.covers, id),
        quality: state.quality.find((q) => q.project_id === id && q.scope === "book") || null,
        exports: forProject(state.exports, id),
        sources: forProject(state.sources, id),
      };
    }
    if (method === "PATCH") {
      Object.assign(project, body);
      touch(project);
      return { project };
    }
    if (method === "DELETE") {
      state.projects = state.projects.filter((p) => p.id !== id);
      state.chapters = state.chapters.filter((c) => c.project_id !== id);
      return { deleted: true };
    }
  }

  switch (child) {
    case "manuscript": {
      const chapters = forProject(state.chapters, id);
      return {
        project: { ...project, progress: progressOf(project, chapters) },
        parts: forProject(state.parts, id),
        chapters,
        visuals: forProject(state.visuals, id),
        bible: state.bibles.find((b) => b.project_id === id) || null,
      };
    }

    case "promote":
      throw new DemoError(
        "not_configured",
        "Handing a book to the marketing side needs an account — the demo has no library to put it in.",
        501
      );

    case "duplicate": {
      const copy = { ...clone(project), id: uid(), title: `${project.title} (copy)`, status: "draft" };
      state.projects.unshift(copy);
      for (const chapter of forProject(state.chapters, id)) {
        state.chapters.push({ ...clone(chapter), id: uid(), project_id: copy.id });
      }
      return { project: copy };
    }

    case "chapters":
      return handleChapters(method, { projectId: id, childId }, body, state);

    case "parts": {
      if (method === "GET") return { parts: forProject(state.parts, id) };
      if (method === "POST") {
        const part = { ...body, id: uid(), project_id: id };
        state.parts.push(part);
        return { part };
      }
      if (method === "PATCH") {
        const part = state.parts.find((p) => p.id === childId);
        Object.assign(part, body);
        return { part };
      }
      if (method === "DELETE") {
        state.parts = state.parts.filter((p) => p.id !== childId);
        return { deleted: true };
      }
      break;
    }

    case "bible": {
      const bible = state.bibles.find((b) => b.project_id === id) || null;
      if (method === "GET") return { bible };
      if (method === "PATCH") {
        Object.assign(bible, body);
        return { bible };
      }
      break;
    }

    case "visuals": {
      if (method === "GET") return { visuals: forProject(state.visuals, id) };
      if (method === "POST") {
        const visual = { ...body, id: uid(), project_id: id, status: body.status || "suggested" };
        state.visuals.push(visual);
        return { visual };
      }
      if (method === "PATCH") {
        const visual = state.visuals.find((v) => v.id === childId);
        if (!visual) throw new DemoError("not_found", "We couldn't find that figure.", 404);
        Object.assign(visual, body);
        return { visual };
      }
      if (method === "DELETE") {
        state.visuals = state.visuals.filter((v) => v.id !== childId);
        return { deleted: true };
      }
      break;
    }

    case "sources": {
      if (method === "GET") return { sources: forProject(state.sources, id) };
      if (method === "POST") {
        const source = { ...body, id: uid(), project_id: id, created_at: new Date().toISOString() };
        state.sources.unshift(source);
        return { source };
      }
      if (method === "PATCH") {
        const source = state.sources.find((s) => s.id === childId);
        Object.assign(source, body);
        return { source };
      }
      if (method === "DELETE") {
        state.sources = state.sources.filter((s) => s.id !== childId);
        return { deleted: true };
      }
      break;
    }

    case "covers": {
      if (method === "GET") return { covers: forProject(state.covers, id) };
      if (method === "PATCH") {
        const cover = state.covers.find((c) => c.id === childId);
        if (!cover) throw new DemoError("not_found", "We couldn't find that cover.", 404);
        if (body.is_selected) {
          state.covers.filter((c) => c.project_id === id).forEach((c) => { c.is_selected = false; });
          project.stages = { ...(project.stages || {}), cover: "approved" };
        }
        Object.assign(cover, body);
        return { cover };
      }
      if (method === "DELETE") {
        state.covers = state.covers.filter((c) => c.id !== childId);
        return { deleted: true };
      }
      break;
    }

    case "marketing": {
      if (method === "GET") return { assets: forProject(state.marketing, id) };
      if (method === "PATCH") {
        const asset = state.marketing.find((a) => a.id === childId);
        Object.assign(asset, body);
        return { asset };
      }
      if (method === "DELETE") {
        state.marketing = state.marketing.filter((a) => a.id !== childId);
        return { deleted: true };
      }
      break;
    }

    case "versions": {
      if (method === "GET") return { versions: forProject(state.projectVersions, id) };
      if (childId === "restore") {
        return { restored: 1 };
      }
      if (method === "POST") {
        const version = {
          id: uid(),
          project_id: id,
          version: forProject(state.projectVersions, id).length + 1,
          label: body.label || `Version ${forProject(state.projectVersions, id).length + 1}`,
          note: body.note || null,
          created_at: new Date().toISOString(),
        };
        state.projectVersions.unshift(version);
        return { version };
      }
      break;
    }

    default:
      break;
  }

  throw new DemoError("not_found", "That isn't part of the demo.", 404);
}

function handleChapters(method, { projectId, childId }, body, state) {
  if (method === "GET" && !childId) {
    return { chapters: forProject(state.chapters, projectId) };
  }
  if (method === "POST" && childId === "reorder") {
    (body.order || []).forEach((item, index) => {
      const chapter = state.chapters.find((c) => c.id === item.id);
      if (chapter) chapter.sort_order = index;
    });
    return { chapters: forProject(state.chapters, projectId) };
  }
  if (method === "POST" && !childId) {
    const chapter = {
      id: uid(),
      project_id: projectId,
      part_id: null,
      kind: body.kind || "chapter",
      front_type: null,
      number: null,
      title: body.title || "New chapter",
      purpose: body.purpose || null,
      promise: null,
      key_concepts: [],
      target_words: body.target_words || 2000,
      estimated_pages: Math.round((body.target_words || 2000) / 260),
      visual_opportunities: [],
      exercises: [],
      case_studies: [],
      content: "",
      word_count: 0,
      status: "planned",
      quality: null,
      include: true,
      sort_order: forProject(state.chapters, projectId).length + 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    state.chapters.push(chapter);
    return { chapter };
  }
  if (method === "GET" && childId) {
    const chapter = findChapter(state, childId);
    return {
      chapter,
      versions: state.chapterVersions.filter((v) => v.chapter_id === chapter.id),
      visuals: state.visuals.filter((v) => v.chapter_id === chapter.id),
    };
  }
  if (method === "PATCH" && childId) {
    const chapter = findChapter(state, childId);
    if (body.content !== undefined && chapter.content && body.content !== chapter.content) {
      saveChapterVersion(state, chapter, body.version_label || "Before editing", "manual");
    }
    Object.assign(chapter, body);
    if (body.content !== undefined) chapter.word_count = wordCount(body.content);
    chapter.updated_at = new Date().toISOString();
    return { chapter };
  }
  if (method === "DELETE" && childId) {
    state.chapters = state.chapters.filter((c) => c.id !== childId);
    return { deleted: true };
  }
  throw new DemoError("not_found", "That isn't part of the demo.", 404);
}

function saveChapterVersion(state, chapter, label, action) {
  const existing = state.chapterVersions.filter((v) => v.chapter_id === chapter.id);
  state.chapterVersions.unshift({
    id: uid(),
    chapter_id: chapter.id,
    project_id: chapter.project_id,
    version: existing.length + 1,
    label,
    content: chapter.content,
    word_count: chapter.word_count,
    action,
    model: "demo",
    created_at: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------
// The agents, in the demo
// ---------------------------------------------------------------------

function handleAgents(operation, body, state, account) {
  const project = body.project_id ? findProject(state, body.project_id) : null;

  switch (operation) {
    case "positioning": {
      const credits = account.spend("book_positioning");
      const row = { ...clone(DEMO_POSITIONING), id: uid(), project_id: project.id, approved_at: null };
      state.positioning = state.positioning.filter((p) => p.project_id !== project.id).concat(row);
      project.stages = { ...(project.stages || {}), positioning: "generated" };
      project.status = "positioning";
      return { positioning: row, creditsUsed: credits, demo: true };
    }

    case "approve-positioning": {
      const row = state.positioning.find((p) => p.project_id === project.id);
      if (!row) throw new DemoError("invalid_input", "Generate positioning first.", 400);
      row.approved_at = new Date().toISOString();
      project.title = body.title;
      project.subtitle = body.subtitle || "";
      project.stages = { ...(project.stages || {}), positioning: "approved" };
      if (project.status === "draft" || project.status === "positioning") project.status = "architecture";
      touch(project);
      return { project, positioning: row };
    }

    case "architecture": {
      const credits = account.spend("book_architecture");
      // The sample book's own architecture, rebound to this project.
      const written = forProject(state.chapters, project.id).filter((c) => String(c.content || "").trim());
      state.chapters = state.chapters.filter(
        (c) => c.project_id !== project.id || written.includes(c));
      state.parts = state.parts.filter((p) => p.project_id !== project.id);

      const partMap = new Map();
      for (const part of DEMO_PARTS) {
        const copy = { ...clone(part), id: uid(), project_id: project.id };
        partMap.set(part.id, copy.id);
        state.parts.push(copy);
      }
      for (const chapter of DEMO_CHAPTERS) {
        if (chapter.kind === "front" || chapter.kind === "back") continue;
        state.chapters.push({
          ...clone(chapter),
          id: uid(),
          project_id: project.id,
          part_id: chapter.part_id ? partMap.get(chapter.part_id) : null,
          content: "",
          word_count: 0,
          status: "planned",
          quality: null,
        });
      }
      project.stages = { ...(project.stages || {}), blueprint: "generated" };
      project.status = "architecture";
      touch(project);
      return {
        chapters: forProject(state.chapters, project.id),
        parts: forProject(state.parts, project.id),
        reasoning:
          "Demo workspace: this is the sample book's own architecture, applied to your project " +
          "so the blueprint screen has something real to show.",
        kept: written.map((c) => ({ id: c.id, title: c.title, words: c.word_count })),
        creditsUsed: credits,
        demo: true,
      };
    }

    case "bible": {
      const credits = account.spend("book_bible");
      const bible = state.bibles.find((b) => b.project_id === project.id);
      Object.assign(bible, clone(DEMO_BIBLE), {
        project_id: project.id,
        chapter_summaries: bible.chapter_summaries || [],
      });
      project.stages = { ...(project.stages || {}), bible: "generated" };
      return { bible, creditsUsed: credits, demo: true };
    }

    case "chapter": {
      const credits = account.spend("chapter_write");
      const chapter = findChapter(state, body.chapter_id);
      if (chapter.content) saveChapterVersion(state, chapter, "Before the AI rewrote it", "generate");
      chapter.content = cannedChapter(chapter);
      chapter.word_count = wordCount(chapter.content);
      chapter.status = "draft";
      chapter.updated_at = new Date().toISOString();
      return {
        chapter,
        placeholders: [],
        notes_for_author: DEMO_NOTE,
        creditsUsed: credits,
        demo: true,
      };
    }

    case "revise": {
      const credits = account.spend("chapter_revise");
      const chapter = findChapter(state, body.chapter_id);
      const passage = body.passage || chapter.content || "";
      return {
        content: passage,
        what_changed:
          "Demo workspace: the passage is returned unchanged, because nothing here reaches a " +
          "model. In a configured deployment the Book Writer would apply: " +
          `"${body.instruction}".`,
        notes_for_author: null,
        is_selection: Boolean(body.passage),
        creditsUsed: credits,
        demo: true,
      };
    }

    case "continue": {
      const credits = account.spend("chapter_revise");
      return {
        content:
          "Demo workspace: continuing a chapter needs a model, and nothing here reaches one. " +
          "The five written chapters show what the Book Writer produces.",
        appendTo: body.chapter_id,
        creditsUsed: credits,
        demo: true,
      };
    }

    case "front-matter":
    case "back-matter": {
      const credits = account.spend(operation === "front-matter" ? "front_matter" : "back_matter");
      return {
        created: 0,
        sections: forProject(state.chapters, project.id),
        replaceable: [],
        creditsUsed: credits,
        demo: true,
      };
    }

    case "review": {
      const credits = account.spend("editorial_review");
      const chapter = findChapter(state, body.chapter_id);
      const sample = DEMO_CHAPTERS.find((c) => c.quality);
      chapter.quality = clone(sample.quality);
      chapter.status = "reviewed";
      return { quality: chapter.quality, creditsUsed: credits, demo: true };
    }

    case "research": {
      const credits = account.spend("research_brief");
      return {
        claims: [
          { claim: body.topic, kind: "fact", confidence: "medium", needs_source: true,
            note: "Demo workspace: a configured deployment would separate this into its factual, interpretive and illustrative parts." },
        ],
        open_questions: ["What would change in the chapter if this turned out to be false?"],
        sources: forProject(state.sources, project.id),
        creditsUsed: credits,
        demo: true,
      };
    }

    case "visuals": {
      const credits = account.spend("visual_direction");
      const chapter = findChapter(state, body.chapter_id);
      const visuals = state.visuals.filter((v) => v.chapter_id === chapter.id);
      return {
        visuals: visuals.map((v) => ({ ...v, drawn: true })),
        reasoning:
          "Demo workspace: these are the sample book's own figures. They are drawn by the layout " +
          "engine, so what you see is what prints.",
        imageProviderConfigured: false,
        creditsUsed: credits,
        demo: true,
      };
    }

    case "image-prompt": {
      const credits = account.spend("book_image");
      const visual = state.visuals.find((v) => v.id === body.visual_id);
      if (!visual) throw new DemoError("not_found", "We couldn't find that figure.", 404);
      return {
        visual,
        image: { id: uid(), status: "unavailable", prompt: visual.prompt },
        imageProviderConfigured: false,
        creditsUsed: credits,
        demo: true,
      };
    }

    case "covers": {
      const credits = account.spend("cover_concepts");
      const copies = clone(DEMO_COVERS).map((cover) => ({
        ...cover,
        id: uid(),
        project_id: project.id,
        is_selected: false,
        check_report: null,
      }));
      state.covers = state.covers.concat(copies);
      project.stages = { ...(project.stages || {}), cover: "generated" };
      return { covers: forProject(state.covers, project.id), imageProviderConfigured: false,
        creditsUsed: credits, demo: true };
    }

    case "cover-check": {
      const credits = account.spend("cover_check");
      const cover = state.covers.find((c) => c.id === body.cover_id);
      if (!cover) throw new DemoError("not_found", "We couldn't find that cover.", 404);
      cover.check_report = clone(DEMO_COVERS[0].check_report);
      return { report: cover.check_report, creditsUsed: credits, demo: true };
    }

    case "quality": {
      const credits = account.spend("quality_report");
      // The mechanical half is real even in the demo: the layout engine
      // runs and the page count is the page count.
      const data = manuscriptFor(state, project.id);
      const laid = layoutBook(assembleBook(data), { print: false });
      const report = { ...clone(DEMO_QUALITY), id: uid(), project_id: project.id,
        created_at: new Date().toISOString() };
      state.quality = state.quality.filter((q) => q.project_id !== project.id).concat(report);
      return { report, measured: { pages: laid.pages.length }, pageCount: laid.pages.length,
        creditsUsed: credits, demo: true };
    }

    case "marketing": {
      const credits = account.spend("marketing_campaign");
      const assets = clone(DEMO_MARKETING).map((asset) => ({
        ...asset, id: uid(), project_id: project.id,
      }));
      state.marketing = state.marketing.filter((a) => a.project_id !== project.id).concat(assets);
      return { assets, scope: body.scope, creditsUsed: credits, demo: true };
    }

    case "repurpose": {
      const credits = account.spend("repurpose_book");
      const asset = {
        id: uid(),
        project_id: project.id,
        user_id: "demo",
        channel: "repurpose",
        kind: body.format,
        title: `${project.title} — ${String(body.format).replace(/_/g, " ")}`,
        content:
          "Demo workspace: repurposing needs a model, and nothing here reaches one.\n\n" +
          "In a configured deployment this would be built from the book's own chapters, shaped " +
          "for its new job rather than excerpted.",
        body: { description: DEMO_NOTE, sections: [] },
        status: "draft",
        sort_order: 0,
        created_at: new Date().toISOString(),
      };
      state.marketing.unshift(asset);
      return { asset, creditsUsed: credits, demo: true };
    }

    default:
      throw new DemoError("not_found", "That isn't part of the demo.", 404);
  }
}

function manuscriptFor(state, projectId) {
  return {
    project: findProject(state, projectId),
    parts: forProject(state.parts, projectId),
    chapters: forProject(state.chapters, projectId),
    visuals: forProject(state.visuals, projectId),
    cover: state.covers.find((c) => c.project_id === projectId && c.is_selected) || null,
  };
}

// ---------------------------------------------------------------------
// Export — the real writers, in the browser
// ---------------------------------------------------------------------

const EXTENSION = { pdf_digital: "pdf", pdf_print: "pdf", epub: "epub", docx: "docx", html: "html" };
const MEDIA_TYPE = {
  pdf_digital: "application/pdf",
  pdf_print: "application/pdf",
  epub: "application/epub+zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  html: "text/html;charset=utf-8",
};

export function exportBookFromState(format, projectId, state) {
  const data = manuscriptFor(state, projectId);
  const book = assembleBook(data);
  if (!book.sections.length) {
    throw new DemoError("invalid_input", "There is nothing to export yet.", 400);
  }

  const meta = {
    title: data.project.title,
    subtitle: data.project.subtitle,
    author: data.project.author_name,
    language: data.project.language,
    subject: data.project.genre,
    keywords: data.project.metadata?.keywords || [],
    uuid: data.project.id,
  };
  const watermark = "Created with BookPilot Book Builder · demo workspace";

  let bytes;
  let pages = null;

  if (format === "pdf_digital" || format === "pdf_print") {
    const laid = layoutBook(book, { print: format === "pdf_print", watermark });
    const written = writePdf(laid, meta, { compress: true });
    bytes = written.bytes;
    pages = written.pageCount;
  } else if (format === "epub") {
    bytes = writeEpub(book, meta).bytes;
  } else if (format === "docx") {
    const trim = trimSize(book.trimId);
    bytes = writeDocx({ ...book, trimWidth: trim.width, trimHeight: trim.height }, meta).bytes;
  } else {
    const laid = layoutBook(book, { print: false, watermark });
    bytes = new TextEncoder().encode(renderDocument(laid, meta));
    pages = laid.pages.length;
  }

  const fileName = `${String(data.project.title || "book")
    .replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "book"}` +
    `${format === "pdf_print" ? "-print" : ""}.${EXTENSION[format]}`;

  state.exports.unshift({
    id: uid(),
    project_id: projectId,
    user_id: "demo",
    format,
    status: "ready",
    file_name: fileName,
    byte_size: bytes.length,
    page_count: pages,
    watermark: true,
    metadata: {},
    created_at: new Date().toISOString(),
  });

  return {
    blob: new Blob([bytes], { type: MEDIA_TYPE[format] }),
    fileName,
    pages,
    watermark: true,
  };
}

export { DEMO_IDS };
