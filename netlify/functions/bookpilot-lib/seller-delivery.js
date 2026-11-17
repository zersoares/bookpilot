// Delivery of a seller's book once it has been paid for.
//
// The file lives in a private Supabase Storage bucket and is never linked
// directly. A buyer holds a download link whose token is an HMAC of the sale
// id, so there is nothing to store and nothing to guess:
//
//   https://bookpilot.org/api/bp-seller/download?t=<saleId>.<hmac>
//
// Each use re-checks the sale (not refunded, not disputed, under the download
// limit) and then redirects to a 5-minute signed storage URL. Everything that
// touches the network (`db`, `storage`, `mail`) is passed in, so the rules can
// be tested without any of it.

import { env } from "./env.js";

export const MAX_DOWNLOADS = 10;
export const SIGNED_URL_SECONDS = 300;
export const BUCKET = "seller-files";
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const ALLOWED_TYPES = { pdf: "application/pdf", epub: "application/epub+zip" };

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function hmac(message, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

/** `<saleId>.<hmac>` — unguessable without the server secret, nothing to store. */
export async function signDownloadToken(saleId, secret) {
  if (!secret) throw new Error("download secret not configured");
  return `${saleId}.${await hmac(`download:${saleId}`, secret)}`;
}

/** @returns {Promise<string|null>} the sale id, or null if the token is not genuine. */
export async function verifyDownloadToken(token, secret) {
  if (!secret || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const saleId = token.slice(0, dot);
  const given = token.slice(dot + 1);
  const expected = await hmac(`download:${saleId}`, secret);
  if (given.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0 ? saleId : null;
}

/** Why a sale may not be downloaded, or null if it may. */
export function downloadBlock(sale) {
  if (!sale) return "not_found";
  if (sale.status === "refunded" || (sale.price_cents > 0 && sale.refunded_cents >= sale.price_cents)) return "refunded";
  if (sale.review_reason === "payment disputed") return "disputed";
  if ((sale.download_count || 0) >= MAX_DOWNLOADS) return "limit";
  return null;
}

export const downloadUrl = (siteUrl, token) => `${siteUrl.replace(/\/$/, "")}/api/bp-seller/download?t=${encodeURIComponent(token)}`;

/**
 * Check a token and hand back a short-lived storage URL.
 * @returns {Promise<{ok:true,url:string}|{ok:false,reason:string}>}
 */
export async function resolveDownload({ db, storage, token, secret }) {
  const saleId = await verifyDownloadToken(token, secret);
  if (!saleId) return { ok: false, reason: "not_found" };
  const sale = await db.selectOne("seller_sales", { eq: { id: saleId } });
  const block = downloadBlock(sale);
  if (block) return { ok: false, reason: block };
  const offer = sale.book_id ? await db.selectOne("seller_books", { eq: { book_id: sale.book_id } }) : null;
  if (!offer?.file_path) return { ok: false, reason: "no_file" };
  // Count before handing out the link, so a burst of requests cannot slip past the limit.
  await db.update("seller_sales", { download_count: (sale.download_count || 0) + 1 }, { eq: { id: sale.id } });
  const url = await storage.signDownload(offer.file_path, offer.file_name || "book");
  return { ok: true, url };
}

/** What the "thank you" page shows once Stripe has redirected the buyer back. */
export async function orderFor({ db, sessionId, secret, siteUrl }) {
  const sale = await db.selectOne("seller_sales", { eq: { stripe_session_id: sessionId } });
  // The webhook may land a moment after the redirect: the page polls.
  if (!sale) return { status: "pending" };
  const book = sale.book_id ? await db.selectOne("books", { select: "title,author_name", eq: { id: sale.book_id } }) : null;
  const block = downloadBlock(sale);
  if (block === "refunded" || block === "disputed") return { status: "unavailable", title: book?.title || null };
  const token = await signDownloadToken(sale.id, secret);
  return { status: "ready", title: book?.title || null, author: book?.author_name || null, downloadUrl: downloadUrl(siteUrl, token), limited: block === "limit" };
}

// --- storage (Supabase Storage REST, service role) -----------------------
export function supabaseStorage() {
  const base = `${env.supabaseUrl.replace(/\/$/, "")}/storage/v1`;
  const headers = { Authorization: `Bearer ${env.supabaseServiceKey}`, apikey: env.supabaseServiceKey, "Content-Type": "application/json" };
  const encPath = (p) => p.split("/").map(encodeURIComponent).join("/");
  return {
    async signDownload(path, filename) {
      const res = await fetch(`${base}/object/sign/${BUCKET}/${encPath(path)}`, {
        method: "POST", headers, body: JSON.stringify({ expiresIn: SIGNED_URL_SECONDS, download: filename }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.signedURL) throw new Error(`storage sign failed (${res.status})`);
      return `${base}${body.signedURL}`;
    },
    async signUpload(path) {
      const res = await fetch(`${base}/object/upload/sign/${BUCKET}/${encPath(path)}`, { method: "POST", headers });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.url) throw new Error(`storage upload-sign failed (${res.status})`);
      return { url: `${base}${body.url}`, token: body.token };
    },
  };
}

// --- the buyer's receipt email --------------------------------------------
export function resendMailer() {
  return {
    async send({ to, subject, html, text }) {
      if (!env.resendApiKey || !env.mailFrom) return { skipped: "mail not configured" };
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.resendApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: env.mailFrom, to: [to], reply_to: "hello@bookpilot.org", subject, html, text }),
      });
      if (!res.ok) throw new Error(`mail failed (${res.status})`);
      return { sent: true };
    },
  };
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function receiptEmail({ title, link, price }) {
  const subject = `Your book: ${title}`;
  const text = `Thank you for your purchase.\n\n${title}${price ? ` (${price})` : ""}\n\nDownload it here (the link works up to ${MAX_DOWNLOADS} times):\n${link}\n\nYou can ask for a refund within 14 days at hello@bookpilot.org.\n\nBookPilot AI`;
  const html = `<p>Thank you for your purchase.</p><p><b>${esc(title)}</b>${price ? ` (${esc(price)})` : ""}</p><p><a href="${esc(link)}">Download your book</a><br><small>The link works up to ${MAX_DOWNLOADS} times.</small></p><p>You can ask for a refund within 14 days at <a href="mailto:hello@bookpilot.org">hello@bookpilot.org</a>.</p><p>BookPilot AI</p>`;
  return { subject, text, html };
}

/**
 * Email the buyer their link. Called by the webhook after the sale is
 * recorded; a failure is logged and `receipt_sent_at` stays empty, so the
 * thank-you page (which also carries the link) is never the only way back.
 */
export async function sendReceipt({ db, mail, sale, secret, siteUrl }) {
  if (!sale?.reader_email || sale.receipt_sent_at) return { skipped: "nothing to send" };
  const book = sale.book_id ? await db.selectOne("books", { select: "title", eq: { id: sale.book_id } }) : null;
  const token = await signDownloadToken(sale.id, secret);
  const price = `${(sale.price_cents / 100).toFixed(2)} ${sale.currency}`;
  const message = receiptEmail({ title: book?.title || "Your book", link: downloadUrl(siteUrl, token), price });
  const result = await mail.send({ to: sale.reader_email, ...message });
  if (result?.sent) await db.update("seller_sales", { receipt_sent_at: new Date().toISOString() }, { eq: { id: sale.id } });
  return result;
}
