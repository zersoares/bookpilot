// Book Builder — export.
//
//   /api/bb-export/*
//
// Builds the file and streams it back. There is no storage step and no
// job queue: the document engine sets a 200-page book in well under a
// second, so the honest design is to generate on request and keep the
// history rather than keep the artefact.
//
// What that means in practice: a row in book_exports records that a file
// was produced, how big it was and how many pages it came to. Asking for
// it again rebuilds it from the current manuscript, which is what an
// author wants anyway — an export that quietly served last week's draft
// would be worse than no history at all.

import { deflateSync, deflateRawSync } from "node:zlib";
import { withGuards, json, readJson, pathSegments, corsHeaders } from "./bookpilot-lib/http.js";
import { authenticate } from "./bookpilot-lib/auth.js";
import { dbAsService } from "./bookpilot-lib/db.js";
import { Errors } from "./bookpilot-lib/errors.js";
import { memoryLimit } from "./bookpilot-lib/ratelimit.js";
import { planFor } from "./bookpilot-lib/credits.js";
import * as v from "./bookpilot-lib/validate.js";
import * as audit from "./bookpilot-lib/audit.js";
import { loadBookData, assembleBook } from "./bookpilot-lib/book-assembly.js";
import { layoutBook } from "../../js/doc/layout.js";
import { writePdf } from "../../js/doc/pdf.js";
import { writeEpub } from "../../js/doc/epub.js";
import { writeDocx } from "../../js/doc/docx.js";
import { renderDocument } from "../../js/doc/render-html.js";
import { trimSize } from "../../js/doc/themes.js";

const PREFIX = "/api/bb-export";

// The document engine takes its compressor as an argument, because it
// also runs in the browser where node:zlib does not exist. On the server
// there is a real one, and a 200-page PDF is five times smaller for it.
const zlibDeflate = (bytes) => new Uint8Array(deflateSync(Buffer.from(bytes)));
const zlibDeflateRaw = (bytes) => new Uint8Array(deflateRawSync(Buffer.from(bytes)));

const FORMATS = {
  pdf_digital: { extension: "pdf", type: "application/pdf", label: "Digital PDF" },
  pdf_print:   { extension: "pdf", type: "application/pdf", label: "Print-ready PDF" },
  epub:        { extension: "epub", type: "application/epub+zip", label: "EPUB" },
  docx:        { extension: "docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", label: "Word" },
  html:        { extension: "html", type: "text/html; charset=utf-8", label: "HTML" },
};

/** A filename a person would recognise in a downloads folder. */
function fileNameFor(project, format) {
  const base = String(project.title || "book")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60) || "book";
  const suffix = format === "pdf_print" ? "-print" : "";
  return `${base}${suffix}.${FORMATS[format].extension}`;
}

/**
 * Whether this account's exports carry a watermark.
 *
 * Read from settings rather than hard-coded, and stated plainly in the
 * response so the UI can say "your plan watermarks exports" instead of
 * letting the author discover it in the file.
 */
async function watermarkFor(profile) {
  let plans = ["free"];
  try {
    const row = await dbAsService().selectOne("app_settings", { eq: { key: "export_watermark_plans" } });
    if (Array.isArray(row?.value)) plans = row.value;
  } catch {
    /* settings unreachable: fall back to watermarking the free tier */
  }
  if (!plans.includes(profile.plan_id)) return null;
  return "Created with BookPilot Book Builder · bookpilot.org";
}

async function buildExport(ctx, format, projectId, options = {}) {
  const data = await loadBookData(ctx.db, projectId);
  if (!data.project) throw Errors.notFound("book project");
  if (!data.chapters.length) {
    throw Errors.invalid("There is nothing to export yet — generate an outline and write a chapter first.");
  }

  const assembled = assembleBook(data, { includeEmpty: false });
  if (!assembled.sections.length) {
    throw Errors.invalid("Every section of this book is still empty.");
  }

  const watermark = await watermarkFor(ctx.profile);
  const plan = await planFor(ctx.profile);
  const spec = FORMATS[format];
  const meta = {
    title: data.project.title,
    subtitle: data.project.subtitle,
    author: data.project.author_name,
    language: data.project.language,
    subject: data.project.genre,
    keywords: data.project.metadata?.keywords || [],
    publisher: data.project.metadata?.publisher || "",
    // An ISBN is the author's to obtain and ours to carry, never to
    // invent (spec 23).
    identifier: data.project.metadata?.isbn
      ? `urn:isbn:${String(data.project.metadata.isbn).replace(/[^0-9Xx]/g, "")}`
      : null,
    uuid: data.project.id,
    description: data.bible?.promise || null,
  };

  let bytes;
  let pageCount = null;

  if (format === "pdf_digital" || format === "pdf_print") {
    const print = format === "pdf_print";
    const laid = layoutBook(assembled, { print, watermark });
    const written = writePdf(laid, meta, { compress: true, deflate: zlibDeflate });
    bytes = written.bytes;
    pageCount = written.pageCount;
  } else if (format === "epub") {
    const written = writeEpub(assembled, meta, { deflate: zlibDeflateRaw });
    bytes = written.bytes;
  } else if (format === "docx") {
    const trim = trimSize(assembled.trimId);
    const written = writeDocx(
      { ...assembled, trimWidth: trim.width, trimHeight: trim.height },
      meta,
      { deflate: zlibDeflateRaw }
    );
    bytes = written.bytes;
  } else {
    const laid = layoutBook(assembled, { print: false, watermark });
    bytes = new TextEncoder().encode(renderDocument(laid, meta));
    pageCount = laid.pages.length;
  }

  // The export record is written with the service role: the client has
  // no insert grant on book_exports, because a client that could write
  // its own export history could claim a 400-page book it never made.
  const record = await dbAsService().insert("book_exports", {
    project_id: projectId,
    user_id: ctx.user.id,
    format,
    status: "ready",
    file_name: fileNameFor(data.project, format),
    byte_size: bytes.length,
    page_count: pageCount,
    watermark: Boolean(watermark),
    metadata: {
      theme: assembled.themeId,
      trim: assembled.trimId,
      sections: assembled.sections.length,
      figures: assembled.visuals.length,
      plan: plan?.id || null,
    },
  });

  await audit.record(ctx.user.id, "book_export.created", {
    entity: "book_project", entityId: projectId,
    detail: { format, bytes: bytes.length, pages: pageCount },
  });

  return { bytes, record, spec, watermark, options };
}

export default withGuards(async (req) => {
  const [format] = pathSegments(req, PREFIX);

  if (req.method === "GET" && !format) {
    return json({
      formats: Object.entries(FORMATS).map(([id, spec]) => ({ id, ...spec })),
    });
  }

  if (req.method !== "POST" || !FORMATS[format]) throw Errors.notFound("endpoint");

  const ctx = await authenticate(req);
  // Exports are cheap but not free; a tighter ceiling than the general
  // API keeps a stuck retry loop from rebuilding a book fifty times.
  memoryLimit(`bb-export:${ctx.user.id}`, 20, 60_000);

  const body = await readJson(req);
  const projectId = v.uuid(body.project_id, "Project");

  const { bytes, record, spec, watermark } = await buildExport(ctx, format, projectId);

  // The file itself, as a download. Returning binary rather than base64
  // JSON halves the transfer and lets the browser save it directly.
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": spec.type,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `attachment; filename="${record.file_name}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      // So the app can show what it just produced without a second call.
      "X-Export-Id": record.id,
      "X-Export-Pages": String(record.page_count ?? ""),
      "X-Export-Watermark": watermark ? "1" : "0",
      ...corsHeaders(req),
    },
  });
});

export const config = { path: "/api/bb-export/*" };
