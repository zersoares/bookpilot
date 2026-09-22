// BookPilot AI — public reader-magnet landing pages.
//
//   /l/:slug
//
// The one page in the product a stranger opens with no session: a
// shareable link an author puts in a bio, a newsletter, or a BookTok
// caption. GET renders the page (server-rendered, so it carries real
// Open Graph tags — a hash-routed SPA page cannot); POST to the same
// path is the email-capture form on that page.
//
// No bearer token is possible here, so every read and write goes through
// the service role. That is safe only because everything read back out
// is scoped to one published page by slug, and everything written is a
// lead row, not account data.

import { env } from "./bookpilot-lib/env.js";
import { dbAsService } from "./bookpilot-lib/db.js";
import { Errors, toResponseBody, AppError } from "./bookpilot-lib/errors.js";
import { memoryLimit } from "./bookpilot-lib/ratelimit.js";
import { renderPage, validateEmail } from "./bookpilot-lib/landing.js";

const PREFIX = "/l";
const HTML_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
};
const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

function html(body, status = 200) {
  return new Response(body, { status, headers: HTML_HEADERS });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function notFoundPage() {
  return html(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Page not found</title>
     <meta name="robots" content="noindex"></head>
     <body style="font-family:sans-serif;background:#0e0e13;color:#f2f1f6;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
     <p>That page doesn't exist, or its author has taken it down.</p></body></html>`,
    404
  );
}

async function findPublished(slug) {
  const service = dbAsService();
  const page = await service.selectOne("landing_pages", {
    select: "*", eq: { slug: slug.toLowerCase(), published: true },
  });
  if (!page) return null;
  const book = await service.selectOne("books", { select: "*", eq: { id: page.book_id } });
  if (!book) return null; // the book was deleted; the page has nothing to show
  return { page, book };
}

async function handleGet(slug) {
  const found = await findPublished(slug);
  if (!found) return notFoundPage();
  const { page, book } = found;
  const canonicalUrl = `${env.siteUrl.replace(/\/$/, "")}/l/${encodeURIComponent(page.slug)}`;
  return html(renderPage({ page: { ...page, canonicalUrl }, book }));
}

async function handleSubscribe(slug, req) {
  const found = await findPublished(slug);
  if (!found) return json(toResponseBody(Errors.notFound("page")), 404);
  const { page } = found;
  if (!page.magnet_enabled) return json(toResponseBody(Errors.invalid("This page isn't collecting emails.")), 400);

  // A per-slug ceiling, not per-visitor (there is no session to key on):
  // generous enough for a real launch day, tight enough that a script
  // cannot flood one author's lead list.
  memoryLimit(`lp-subscribe:${page.id}`, 60, 60_000);

  let body;
  try {
    body = JSON.parse(await req.text());
  } catch {
    return json(toResponseBody(Errors.invalid("We couldn't read that request.")), 400);
  }

  // A hidden field a real visitor never fills in. A bot that fills every
  // field gets a fake success instead of a reason to keep trying.
  if (body && typeof body.website === "string" && body.website.trim()) {
    return json({ ok: true, magnetUrl: page.magnet_url || null });
  }

  let email;
  try {
    email = validateEmail(body?.email);
  } catch (err) {
    return json(toResponseBody(err), err instanceof AppError ? err.status : 400);
  }

  const service = dbAsService();
  await service.upsert(
    "landing_page_leads",
    { landing_page_id: page.id, user_id: page.user_id, email, created_at: new Date().toISOString() },
    { onConflict: "landing_page_id,email", returning: false }
  );

  return json({ ok: true, magnetUrl: page.magnet_url || null });
}

export default async function handler(req) {
  try {
    const { pathname } = new URL(req.url);
    const rest = pathname.startsWith(PREFIX) ? pathname.slice(PREFIX.length) : pathname;
    const [rawSlug] = rest.split("/").filter(Boolean).map(decodeURIComponent);
    if (!rawSlug) return notFoundPage();

    if (req.method === "GET") return handleGet(rawSlug);
    if (req.method === "POST") return handleSubscribe(rawSlug, req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204 });
    return json(toResponseBody(Errors.notFound("endpoint")), 404);
  } catch (err) {
    if (!(err instanceof AppError)) console.error("[bookpilot] landing page error:", err);
    return json(toResponseBody(err), err instanceof AppError ? err.status : 500);
  }
}

export const config = { path: "/l/*" };
