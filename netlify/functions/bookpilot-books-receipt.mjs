// BookPilot — direct-sale book receipts.
//
//   /api/books-receipt
//
// Stripe webhook (checkout.session.completed) -> emails the buyer the
// download page of the book they paid for.
//
// Why: the delivery page is only reachable through Stripe's post-payment
// redirect. A buyer who closes that tab would have no way back, because
// Stripe's receipt carries no download link. This puts the link in their inbox.
//
// Setup, all outside this file:
//   Stripe (Bookpilot account) -> Developers -> Webhooks -> endpoint
//     https://bookpilot.org/api/books-receipt , event checkout.session.completed
//   Netlify env:  BOOKS_WEBHOOK_SECRET = whsec_...   (that endpoint's signing secret)
//                 RESEND_API_KEY       = re_...
//                 BOOKS_MAIL_FROM      = "BookPilot Books <hello@bookpilot.org>"  (sender on a verified Resend domain)
//
// No npm dependencies: the signature is verified with node:crypto and the
// email goes out through global fetch.

import crypto from "node:crypto";

const SITE = "https://bookpilot.org/books";
const REPLY_TO = "hello@bookpilot.org";

// Payment links (plink_ ids, NOT the short code in the buy.stripe.com URL).
// Any other payment link on this Stripe account is acknowledged and ignored.
export const BOOKS = {
  plink_1UUnBiLfqCbvloYwaTZwuSc1: {
    lang: "en",
    name: "Master Your Mind Before the World Masters Your Attention",
    page: "thanks-master-your-mind-bk-97cd6c87bc.html",
    files: [
      ["PDF", "Master-Your-Mind-bk-97cd6c87bc.pdf"],
      ["EPUB", "Master-Your-Mind-bk-97cd6c87bc.epub"],
    ],
  },
  plink_1UUnDhLfqCbvloYwZK7RQHnz: {
    lang: "en",
    name: "The Invisible Effect of AI",
    page: "thanks-invisible-effect-bk-6c6e5784b9.html",
    files: [["PDF", "The-Invisible-Effect-of-AI-bk-6c6e5784b9.pdf"]],
  },
  plink_1UUnHJLfqCbvloYw3jBJxLcg: {
    lang: "pt",
    name: "O Guia da Mulher Moderna para Recomeçar",
    page: "thanks-guia-mulher-moderna-bk-8efcbfd48f.html",
    files: [
      ["PDF", "O-Guia-da-Mulher-Moderna-para-Recomecar-bk-8efcbfd48f.pdf"],
      ["EPUB", "O-Guia-da-Mulher-Moderna-para-Recomecar-bk-8efcbfd48f.epub"],
    ],
  },
  plink_1UUsW3LfqCbvloYwcMnEZfMz: {
    lang: "en",
    name: "Building a Sustainable Business",
    page: "thanks-sustainable-business-bk-df8dbe78db.html",
    files: [
      ["PDF", "Building-a-Sustainable-Business-bk-df8dbe78db.pdf"],
    ],
  },
  plink_1UUsXxLfqCbvloYwkjBEYh8a: {
    lang: "en",
    name: "Business Plan 2030",
    page: "thanks-business-plan-2030-bk-12b610cc1c.html",
    files: [
      ["PDF", "Business-Plan-2030-bk-12b610cc1c.pdf"],
      ["EPUB", "Business-Plan-2030-bk-12b610cc1c.epub"],
      ["PDF · Português", "Plano-de-Negocios-2030-bk-12b610cc1c.pdf"],
      ["EPUB · Português", "Plano-de-Negocios-2030-bk-12b610cc1c.epub"],
    ],
  },
  plink_1UUsb2LfqCbvloYwHVrvzKDQ: {
    lang: "en",
    name: "Future Skills 2030",
    page: "thanks-future-skills-2030-bk-09e35aeb88.html",
    files: [
      ["PDF", "Future-Skills-2030-bk-09e35aeb88.pdf"],
      ["EPUB", "Future-Skills-2030-bk-09e35aeb88.epub"],
    ],
  },
  plink_1UUsd1LfqCbvloYwIiHsPYZe: {
    lang: "en",
    name: "Unleash Your Inner Girlboss",
    page: "thanks-girlboss-bk-9a5a9c5936.html",
    files: [
      ["PDF", "Unleash-Your-Inner-Girlboss-bk-9a5a9c5936.pdf"],
    ],
  },
  plink_1UUsecLfqCbvloYwVzxwEtPH: {
    lang: "en",
    name: "Glow Diary",
    page: "thanks-glow-diary-bk-a668adbced.html",
    files: [
      ["PDF", "Glow-Diary-bk-a668adbced.pdf"],
      ["EPUB", "Glow-Diary-bk-a668adbced.epub"],
    ],
  },
  plink_1UUsgELfqCbvloYwxVw7GbwZ: {
    lang: "en",
    name: "Master Your Finances",
    page: "thanks-master-your-finances-bk-53dfd10d73.html",
    files: [
      ["PDF", "Master-Your-Finances-bk-53dfd10d73.pdf"],
      ["EPUB", "Master-Your-Finances-bk-53dfd10d73.epub"],
      ["PDF · Português", "Domine-Suas-Financas-bk-53dfd10d73.pdf"],
      ["EPUB · Português", "Domine-Suas-Financas-bk-53dfd10d73.epub"],
    ],
  },
  plink_1UUshkLfqCbvloYweEHR5Ujk: {
    lang: "en",
    name: "Money Hack",
    page: "thanks-money-hack-bk-78df02c7b7.html",
    files: [
      ["PDF", "Money-Hack-bk-78df02c7b7.pdf"],
    ],
  },
  plink_1UUsjLLfqCbvloYwDgrAVrEI: {
    lang: "en",
    name: "Online Business: From Zero to Success",
    page: "thanks-online-business-bk-8dcf83580f.html",
    files: [
      ["PDF", "Online-Business-From-Zero-to-Success-bk-8dcf83580f.pdf"],
      ["EPUB", "Online-Business-From-Zero-to-Success-bk-8dcf83580f.epub"],
    ],
  },
  plink_1UUskvLfqCbvloYwi4hIPtZD: {
    lang: "en",
    name: "Rise Above",
    page: "thanks-rise-above-bk-ac3c045577.html",
    files: [
      ["PDF", "Rise-Above-bk-ac3c045577.pdf"],
      ["EPUB", "Rise-Above-bk-ac3c045577.epub"],
      ["PDF · Português (BR)", "Rise-Above-PT-BR-bk-ac3c045577.pdf"],
    ],
  },
  plink_1UUsmTLfqCbvloYw2Q3du7Fm: {
    lang: "en",
    name: "Stop Thinking Negative",
    page: "thanks-stop-thinking-negative-bk-14c8cba963.html",
    files: [
      ["PDF", "Stop-Thinking-Negative-bk-14c8cba963.pdf"],
    ],
  },
};

const TEXT = {
  en: {
    subject: (n) => `Your book: ${n}`,
    hello: "Thank you for your purchase.",
    intro: (n) => `Your copy of <strong>${n}</strong> is ready.`,
    button: "Open your download page",
    direct: "Or download the files directly:",
    keep: "Keep this email: the links work any time.",
    help: "Any problem with a download, or want a refund? Just reply to this email.",
  },
  pt: {
    subject: (n) => `O seu livro: ${n}`,
    hello: "Obrigada pela sua compra.",
    intro: (n) => `A sua cópia de <strong>${n}</strong> está pronta.`,
    button: "Abrir a página de download",
    direct: "Ou descarregue os ficheiros diretamente:",
    keep: "Guarde este email: as ligações funcionam a qualquer momento.",
    help: "Algum problema com um download, ou quer um reembolso? Basta responder a este email.",
  },
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function buildEmail(book) {
  const t = TEXT[book.lang];
  const page = `${SITE}/${book.page}`;
  const links = book.files.map(([label, f]) => `<a href="${SITE}/${f}">${label}</a>`).join(" &nbsp;·&nbsp; ");
  const html = `<!doctype html><html lang="${book.lang}"><body style="font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;color:#1c1b22;max-width:560px;margin:0 auto;padding:24px">
<p>${t.hello}</p>
<p>${t.intro(esc(book.name))}</p>
<p><a href="${page}" style="display:inline-block;background:#1f3a8a;color:#fff;font-weight:600;padding:12px 20px;border-radius:10px;text-decoration:none">${t.button}</a></p>
<p>${t.direct}<br>${links}</p>
<p style="color:#5b5a66">${t.keep}<br>${t.help}</p>
</body></html>`;
  const text = [t.hello, "", t.intro(book.name).replace(/<[^>]+>/g, ""), "", `${t.button}: ${page}`, "", t.direct, ...book.files.map(([l, f]) => `${l}: ${SITE}/${f}`), "", t.keep, t.help].join("\n");
  return { subject: t.subject(book.name), html, text };
}

const TOLERANCE_SECONDS = 300;

export function verifySignature(rawBody, header, secret, now = Date.now()) {
  if (!header || !secret) return false;
  const parts = { v1: [] };
  for (const piece of header.split(",")) {
    const i = piece.indexOf("=");
    if (i === -1) continue;
    const k = piece.slice(0, i).trim();
    const v = piece.slice(i + 1).trim();
    if (k === "v1") parts.v1.push(v);
    else if (k === "t") parts.t = v;
  }
  const ts = parseInt(parts.t, 10);
  if (!ts || Math.abs(Math.floor(now / 1000) - ts) > TOLERANCE_SECONDS) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest();
  return parts.v1.some((sig) => {
    const got = Buffer.from(sig, "hex");
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  });
}

const reply = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export default async (req) => {
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  const secret = process.env.BOOKS_WEBHOOK_SECRET;
  const resendKey = process.env.RESEND_API_KEY;
  if (!secret || !resendKey) {
    console.error("[books-receipt] not configured (BOOKS_WEBHOOK_SECRET / RESEND_API_KEY)");
    return reply({ error: "Not configured" }, 501);
  }

  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("stripe-signature"), secret)) {
    console.warn("[books-receipt] rejected webhook with bad signature");
    return reply({ error: "Invalid signature" }, 400);
  }

  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return reply({ error: "Invalid payload" }, 400);
  }
  if (event.type !== "checkout.session.completed") return reply({ received: true });

  const session = event.data?.object || {};
  const book = BOOKS[session.payment_link];
  if (!book) return reply({ received: true, ignored: true });
  if (session.payment_status && session.payment_status !== "paid") return reply({ received: true, ignored: true });

  const to = session.customer_details?.email || session.customer_email;
  if (!to) {
    console.error("[books-receipt] paid session without an email:", session.id);
    return reply({ received: true });
  }

  const { subject, html, text } = buildEmail(book);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${resendKey}`, "content-type": "application/json", "idempotency-key": `books-receipt-${event.id}` },
    body: JSON.stringify({
      from: process.env.BOOKS_MAIL_FROM || "BookPilot Books <hello@bookpilot.org>",
      to: [to],
      reply_to: REPLY_TO,
      subject,
      html,
      text,
    }),
  });
  if (!res.ok) {
    // 500 makes Stripe retry; the idempotency key stops a retry double-sending.
    console.error("[books-receipt] Resend failed:", res.status, await res.text());
    return reply({ received: false }, 500);
  }
  return reply({ received: true, sent: true });
};

export const config = { path: "/api/books-receipt" };
