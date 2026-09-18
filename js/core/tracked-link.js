// Tracked links.
//
// The website tracking script reads `utm_campaign` and `utm_content` as
// BookPilot ids: a purchase carrying a campaign id is credited to that
// campaign, and a creative id credits the creative. A link built here is
// therefore what lets a sale on the author's own site be traced back to
// the ad that sent the visitor. Nothing about the visitor is in the link.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const SOURCES = {
  tiktok: { label: "TikTok", source: "tiktok", medium: "paid_social" },
  // Google Ads also auto-tags with a click id; these parameters travel alongside it.
  google: { label: "Google Ads", source: "google", medium: "cpc" },
  facebook: { label: "Facebook & Instagram", source: "facebook", medium: "paid_social" },
  other: { label: "Other", source: "ads", medium: "paid" },
};

/**
 * Add BookPilot's attribution parameters to a destination URL.
 * Existing query parameters and any #fragment are kept; existing utm_*
 * parameters are replaced, so a link cannot end up with two campaigns.
 *
 * @throws {Error} with a message fit to show the author
 */
export function buildTrackedLink({ url, platform = "tiktok", campaignId, creativeId = null }) {
  let target;
  try {
    target = new URL(String(url || "").trim());
  } catch {
    throw new Error("Enter the full address of the page the ad sends people to, starting with https://");
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    throw new Error("The address must start with https:// (or http://).");
  }
  if (!UUID.test(campaignId || "")) throw new Error("Choose a campaign first: its id is what credits a sale to it.");
  if (creativeId && !UUID.test(creativeId)) throw new Error("That creative id isn't valid.");

  const spec = SOURCES[platform] || SOURCES.other;
  for (const key of [...target.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_")) target.searchParams.delete(key);
  }
  target.searchParams.set("utm_source", spec.source);
  target.searchParams.set("utm_medium", spec.medium);
  target.searchParams.set("utm_campaign", campaignId.toLowerCase());
  if (creativeId) target.searchParams.set("utm_content", creativeId.toLowerCase());
  return target.toString();
}
