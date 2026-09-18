// BookPilot AI — website event collector (spec §17).
//
//   /api/bp-track
//
// Receives events from bp.js running on an author's own site. Unlike
// every other endpoint here it is called cross-origin, so the origin is
// checked against the domain registered for that tracking key rather
// than against this site.
//
// What is deliberately NOT collected: IP address, user agent, cookie or
// device id, referrer, or anything else that identifies a visitor. The
// product needs to know which ad produced a sale, and that is all this
// stores (GDPR data minimisation, spec §34).

import { json } from "./bookpilot-lib/http.js";
import { dbAsService } from "./bookpilot-lib/db.js";
import { memoryLimit } from "./bookpilot-lib/ratelimit.js";
import { AppError } from "./bookpilot-lib/errors.js";
import { EVENT_TYPES, hostMatches, hostOf } from "./bookpilot-lib/tracking.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function corsFor(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

// One breadcrumb per key per instance per ten minutes is plenty for the
// "wrong domain" diagnostic, and keeps a misconfigured site from turning
// every page view into a database write.
const REJECT_NOTE_MS = 10 * 60_000;
const lastRejectNote = new Map();

async function noteRejectedOrigin(service, site, key, origin) {
  const host = hostOf(origin);
  if (!host) return;
  const now = Date.now();
  if (now - (lastRejectNote.get(key) || 0) < REJECT_NOTE_MS) return;
  lastRejectNote.set(key, now);
  try {
    await service.update(
      "tracking_sites",
      { last_rejected_host: host, last_rejected_at: new Date(now).toISOString() },
      { eq: { id: site.id } }
    );
  } catch (err) {
    // Migration 009 not applied yet, or a transient error. The diagnostic
    // is a convenience; the collector must not care.
    console.warn("[bookpilot] could not record a rejected origin:", err?.message || err);
  }
}

function clean(value, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : null;
}

export default async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsFor(origin) });
  }
  if (req.method !== "POST") {
    return json({ error: { message: "Method not allowed" } }, 405);
  }

  let body;
  try {
    const raw = await req.text();
    if (raw.length > 8192) throw new Error("too large");
    body = JSON.parse(raw);
  } catch {
    return new Response(JSON.stringify({ ok: false }), { status: 400, headers: corsFor(origin) });
  }

  const key = clean(body.k, 80);
  const eventType = EVENT_TYPES.includes(body.e) ? body.e : null;
  if (!key || !eventType) {
    return new Response(JSON.stringify({ ok: false }), { status: 400, headers: corsFor(origin) });
  }

  try {
    memoryLimit(`track:${key}`, 600, 60_000);
  } catch (err) {
    const status = err instanceof AppError ? err.status : 429;
    return new Response(JSON.stringify({ ok: false }), { status, headers: corsFor(origin) });
  }

  const service = dbAsService();
  const site = await service.selectOne("tracking_sites", {
    select: "id,user_id,domain,is_active",
    eq: { public_key: key },
  });
  // An unknown or disabled key gets the same answer as a valid one, so
  // the endpoint can't be used to enumerate live tracking keys.
  if (!site || !site.is_active) {
    return new Response(JSON.stringify({ ok: true }), { status: 202, headers: corsFor(origin) });
  }
  if (!hostMatches(origin, site.domain)) {
    await noteRejectedOrigin(service, site, key, origin);
    return new Response(JSON.stringify({ ok: true }), { status: 202, headers: corsFor(origin) });
  }

  const utm = {
    source: clean(body.utm?.source, 80),
    medium: clean(body.utm?.medium, 80),
    campaign: clean(body.utm?.campaign, 120),
    content: clean(body.utm?.content, 120),
    term: clean(body.utm?.term, 120),
  };

  // utm_campaign and utm_content carry BookPilot ids when the link was
  // built by the campaign wizard; anything else is stored as-is and
  // simply doesn't attribute to a campaign.
  const campaignId = UUID_RE.test(utm.campaign || "") ? utm.campaign : null;
  const creativeId = UUID_RE.test(utm.content || "") ? utm.content : null;

  const valueCents = Number.isFinite(Number(body.v)) ? Math.max(0, Math.round(Number(body.v) * 100)) : 0;
  const currency = /^[A-Z]{3}$/.test(body.c || "") ? body.c : "EUR";

  try {
    await service.insert(
      "tracking_events",
      {
        user_id: site.user_id,
        site_id: site.id,
        campaign_id: campaignId,
        creative_id: creativeId,
        event_type: eventType,
        value_cents: eventType === "purchase" ? valueCents : 0,
        currency,
        utm,
        session_hash: clean(body.s, 64),
      },
      { returning: false }
    );

    // A purchase also updates the day's website-attributed rollup, kept
    // in its own `source` so it is never mixed with Meta's numbers.
    if (eventType === "purchase" && campaignId) {
      const today = new Date().toISOString().slice(0, 10);
      const existing = await service.selectOne("performance_metrics", {
        select: "id,conversions,revenue_cents",
        eq: { campaign_id: campaignId, metric_date: today, source: "website" },
      });
      if (existing) {
        await service.update(
          "performance_metrics",
          {
            conversions: Number(existing.conversions) + 1,
            revenue_cents: Number(existing.revenue_cents) + valueCents,
            synced_at: new Date().toISOString(),
          },
          { eq: { id: existing.id } }
        );
      } else {
        await service.insert(
          "performance_metrics",
          {
            campaign_id: campaignId,
            metric_date: today,
            source: "website",
            conversions: 1,
            revenue_cents: valueCents,
          },
          { returning: false }
        );
      }
    }
  } catch (err) {
    console.error("[bookpilot] tracking write failed:", err);
    // Never surface an error to a visitor's browser on someone else's
    // site; the event is simply lost.
  }

  return new Response(JSON.stringify({ ok: true }), { status: 202, headers: corsFor(origin) });
};

export const config = { path: "/api/bp-track" };
