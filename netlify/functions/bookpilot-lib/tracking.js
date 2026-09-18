// Website-tracking helpers shared by the collector and the status API.
//
// Pure functions, no I/O, so the rules an author's "is it working?"
// answer rests on can be tested without a database.

export const EVENT_TYPES = ["click", "page_view", "add_to_cart", "checkout", "purchase"];

const DAY = 24 * 60 * 60 * 1000;

/**
 * Does a request's Origin belong to the domain registered for a key?
 * An absent Origin (sendBeacon from a same-origin page) is allowed.
 */
export function hostMatches(origin, domain) {
  if (!origin) return true;
  try {
    const host = new URL(origin).hostname.toLowerCase();
    const registered = String(domain || "").toLowerCase();
    if (!registered) return false;
    return host === registered || host.endsWith(`.${registered}`);
  } catch {
    return false;
  }
}

/** The hostname of an Origin, or null. Only ever a website's own domain. */
export function hostOf(origin) {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return host && host.length <= 253 ? host : null;
  } catch {
    return null;
  }
}

/**
 * The link an author opens to prove the script works on their real
 * site. bp.js only reports a visit that carries attribution, so the
 * test link carries some — clearly marked so it never looks like a
 * campaign.
 */
export function testUrl(domain) {
  const host = String(domain || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const params = new URLSearchParams({
    utm_source: "bookpilot",
    utm_medium: "test",
    utm_campaign: "installation-check",
  });
  return `https://${host}/?${params}`;
}

export function isTestEvent(event) {
  return event?.utm?.source === "bookpilot" && event?.utm?.medium === "test";
}

/** Shape one stored event for the browser: only what the screen shows. */
export function shapeEvent(event) {
  const utm = event.utm || {};
  return {
    id: event.id,
    occurred_at: event.occurred_at,
    event_type: event.event_type,
    value_cents: Number(event.value_cents) || 0,
    currency: event.currency || "EUR",
    // A campaign id we recognise is attributed; anything else is shown
    // as the raw label so the author can see why it was not.
    attributed: Boolean(event.campaign_id),
    label: utm.campaign || utm.source || null,
    is_test: isTestEvent(event),
  };
}

/**
 * Count recent events. `events` is newest-first and may be capped, so
 * the caller says so and the screen can be honest about it.
 */
export function summarise(events, { now = Date.now(), capped = false } = {}) {
  const counts = { page_view: 0, click: 0, add_to_cart: 0, checkout: 0, purchase: 0 };
  let revenueCents = 0;
  let last24h = 0;
  let lastEventAt = null;
  let lastRealEventAt = null;

  for (const event of events) {
    const at = Date.parse(event.occurred_at);
    if (!Number.isFinite(at)) continue;
    if (lastEventAt === null || at > lastEventAt) lastEventAt = at;
    if (!isTestEvent(event) && (lastRealEventAt === null || at > lastRealEventAt)) lastRealEventAt = at;
    if (isTestEvent(event)) continue; // a test visit is not a result
    if (event.event_type in counts) counts[event.event_type] += 1;
    if (event.event_type === "purchase") revenueCents += Number(event.value_cents) || 0;
    if (now - at <= DAY) last24h += 1;
  }

  return {
    counts,
    revenue_cents: revenueCents,
    last_24h: last24h,
    last_event_at: lastEventAt === null ? null : new Date(lastEventAt).toISOString(),
    last_real_event_at: lastRealEventAt === null ? null : new Date(lastRealEventAt).toISOString(),
    capped,
  };
}

/**
 * One word for the state of a site, and the reason.
 *
 *   receiving — real events in the last 7 days
 *   quiet     — events have arrived, but not recently
 *   mismatch  — the key was used from a domain that is not registered,
 *               and nothing has arrived since
 *   waiting   — nothing has ever arrived
 *
 * A mismatch only wins while it is the most recent thing that happened:
 * once events flow again the earlier rejection is history.
 */
export function health({ summary, site, now = Date.now() }) {
  const lastEvent = summary?.last_event_at ? Date.parse(summary.last_event_at) : null;
  const lastReal = summary?.last_real_event_at ? Date.parse(summary.last_real_event_at) : null;
  const rejectedAt = site?.last_rejected_at ? Date.parse(site.last_rejected_at) : null;

  if (rejectedAt && (lastEvent === null || rejectedAt > lastEvent)) {
    return { state: "mismatch", rejected_host: site.last_rejected_host || null };
  }
  if (lastReal !== null && now - lastReal <= 7 * DAY) return { state: "receiving" };
  if (lastEvent !== null) return { state: lastReal === null ? "tested" : "quiet" };
  return { state: "waiting" };
}
