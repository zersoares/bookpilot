// AI-content disclosure: what KDP actually asks for, from a book's own
// chapters.
//
// Amazon's distinction is binary, not a percentage: "AI-generated" is
// text an AI tool produced, even if a human substantially edited it
// afterward — editing never reclassifies it back to human-authored.
// "AI-assisted" (brainstorming, outlining, grammar-checking on text the
// author actually wrote) needs no disclosure at all. That is exactly
// what book_chapters.ai_generated tracks (see sql/022_ai_provenance.sql)
// — this module only has to summarise it, not re-derive it.
//
// Pure functions, no DOM, no network.

/** Sections that would actually ship (excluded ones don't count either way). */
function shippingChapters(chapters) {
  return (chapters || []).filter((c) => c.include !== false && (c.word_count || 0) > 0);
}

/**
 * @param {object[]} chapters  the project's book_chapters rows
 * @returns {{
 *   total: number, flagged: object[], clear: object[],
 *   anyFlagged: boolean, allFlagged: boolean, models: string[],
 * }}
 */
export function disclosureSummary(chapters) {
  const shipping = shippingChapters(chapters);
  const flagged = shipping.filter((c) => c.ai_generated);
  const clear = shipping.filter((c) => !c.ai_generated);
  const models = [...new Set(flagged.flatMap((c) => (Array.isArray(c.ai_models) ? c.ai_models : [])))];
  return {
    total: shipping.length,
    flagged,
    clear,
    anyFlagged: flagged.length > 0,
    allFlagged: shipping.length > 0 && flagged.length === shipping.length,
    models,
  };
}

const sectionLabel = (c) => c.number ? `Chapter ${c.number}: ${c.title}` : c.title;

/**
 * The text an author can paste into their own compliance notes. Not
 * Amazon's disclosure form itself — Amazon's is a yes/no question inside
 * KDP, not a document — but a plain record of what was disclosed and why,
 * for an author who wants one.
 */
export function disclosureText(book, chapters) {
  const { flagged, clear, total, models } = disclosureSummary(chapters);
  const title = book?.title || "This book";
  const lines = [];

  if (!total) {
    return `${title}: no chapters with content yet — nothing to disclose.`;
  }

  if (!flagged.length) {
    lines.push(`${title}: no AI-generated text detected in any of its ${total} section${total === 1 ? "" : "s"}.`);
    lines.push("KDP's AI-content question can be answered “No” on this basis — you know your own manuscript best.");
    return lines.join("\n");
  }

  lines.push(`${title} contains AI-generated text and requires disclosure on KDP.`);
  lines.push("");
  lines.push(`Sections with AI-generated text (${flagged.length} of ${total}):`);
  for (const c of flagged) lines.push(`  • ${sectionLabel(c)}`);
  if (clear.length) {
    lines.push("");
    lines.push(`Sections with no AI-generated text (${clear.length} of ${total}):`);
    for (const c of clear) lines.push(`  • ${sectionLabel(c)}`);
  }
  if (models.length) {
    lines.push("");
    lines.push(`Generated with: ${models.join(", ")}.`);
  }
  lines.push("");
  lines.push("This is a record for your own files, not Amazon's disclosure form itself — answer KDP's own AI-content question directly.");
  return lines.join("\n");
}
