// Pieces shared by the report importers (Amazon Attribution, TikTok Ads).

import { html } from "../core/dom.js";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const CURRENCIES = ["EUR", "USD", "GBP", "CAD", "AUD", "JPY", "SEK", "PLN", "BRL", "INR", "MXN", "AED"];

/** Read an uploaded report as text, whichever encoding the export used. */
export async function readFileText(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Spreadsheet exports are sometimes UTF-16, which a UTF-8 decoder
  // turns into text full of gaps.
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  return new TextDecoder("utf-8").decode(bytes);
}

/** One figure in a preview grid. */
export const stat = (label, value) => html`
  <div class="bp-panel" style="padding:var(--bp-3)">
    <div class="bp-tiny bp-subtle">${label}</div>
    <div style="font-size:1.1rem;font-variant-numeric:tabular-nums">${value}</div>
  </div>`;
