// Deciding which BookPilot campaign a platform's campaign lands on.
//
// Shared by every platform whose API connection syncs campaign figures
// (Pinterest, TikTok). Pure, so the rule can be tested without a database.

/**
 * For each remote campaign, decide:
 *
 *   match  — a BookPilot campaign already carries this platform id
 *   link   — a BookPilot campaign (from a CSV import) has the same name and
 *            no platform id yet, so it is claimed rather than duplicated
 *   create — nothing corresponds; a new one will be made
 *
 * A name is only used to link when it is unambiguous: two local campaigns
 * with the same name are left alone rather than guessed between, and one
 * local campaign is claimed by at most one remote campaign.
 *
 * @param {{id: string, name: string}[]} remote
 * @param {{id: string, name: string, external_campaign_id?: string|null}[]} local
 */
export function planCampaigns(remote, local) {
  const byExternal = new Map();
  const byName = new Map();
  for (const c of local) {
    if (c.external_campaign_id) byExternal.set(String(c.external_campaign_id), c);
    else {
      const key = c.name.trim().toLowerCase();
      byName.set(key, byName.has(key) ? null : c); // null marks an ambiguous name
    }
  }
  const claimed = new Set();
  return remote.map((r) => {
    const matched = byExternal.get(r.id);
    if (matched) return { remote: r, action: "match", local: matched };
    const named = byName.get(r.name.trim().toLowerCase());
    if (named && !claimed.has(named.id)) {
      claimed.add(named.id);
      return { remote: r, action: "link", local: named };
    }
    return { remote: r, action: "create", local: null };
  });
}
