// BookPilot AI — seller payments.
//
//   /api/bp-seller/*
//
//   GET  status            the signed-in seller's account, books, balance, payouts
//   POST onboard           start or resume Stripe Connect onboarding (payout details)
//   POST dashboard         one-time link to the seller's Stripe Express dashboard
//   POST checkout          PUBLIC: a reader buys an approved book (see below)
//
// How the money moves (terms: /seller-terms):
//   1. The reader pays BookPilot — a normal Checkout Session on BookPilot's own
//      Stripe account. BookPilot is the seller to the reader (terms 8.1).
//   2. The webhook writes the sale to the ledger with the author's share
//      (70% own audience / 35% BookPilot audience of the Net Amount).
//   3. Once a month bookpilot-seller-payouts.mjs transfers the shares of sales
//      older than the 14-day refund window, if the balance is at least EUR 20.
//
// Sellers are approved by hand (terms 3.1): this code never approves anyone,
// and `checkout` refuses any book that is not `approved` in seller_books.
// The price is read from seller_books on the server — the browser sends only
// a book id and an optional referral code, so a reader cannot choose a price
// and an author cannot choose a share.

import { withGuards, json, readJson, pathSegments } from "./bookpilot-lib/http.js";
import { authenticate } from "./bookpilot-lib/auth.js";
import { dbAsService } from "./bookpilot-lib/db.js";
import { AppError, Errors } from "./bookpilot-lib/errors.js";
import { env } from "./bookpilot-lib/env.js";
import { memoryLimit } from "./bookpilot-lib/ratelimit.js";
import * as stripe from "./bookpilot-lib/stripe.js";
import * as v from "./bookpilot-lib/validate.js";
import { taxParams } from "./bookpilot-lib/billing-rules.js";
import { resolveDownload, orderFor, supabaseStorage, MAX_FILE_BYTES, ALLOWED_TYPES } from "./bookpilot-lib/seller-delivery.js";
import { classifyAudience, SHARES, REFUND_WINDOW_DAYS, MIN_PAYOUT_CENTS } from "./bookpilot-lib/seller-rules.js";

const PREFIX = "/api/bp-seller";
const siteUrl = () => env.siteUrl.replace(/\/$/, "");

async function approvedSeller(userId) {
  const row = await dbAsService().selectOne("seller_accounts", { eq: { user_id: userId } });
  if (!row?.approved) {
    throw new AppError(
      "not_approved",
      "Selling through BookPilot is by invitation. Tell us about your book and we will onboard you.",
      403
    );
  }
  return row;
}

async function status(ctx) {
  const service = dbAsService();
  const account = await service.selectOne("seller_accounts", { eq: { user_id: ctx.user.id } });
  if (!account) return json({ seller: false, shares: SHARES });
  const [books, sales, payouts] = await Promise.all([
    service.select("seller_books", { select: "*", eq: { user_id: ctx.user.id } }),
    service.select("seller_sales", {
      select: "id,book_id,audience,share_pct,price_cents,net_cents,share_cents,status,sold_at,eligible_at,clawback_cents,clawback_settled",
      eq: { seller_user_id: ctx.user.id },
      order: "sold_at.desc",
      limit: 200,
    }),
    service.select("seller_payouts", { select: "id,period,amount_cents,status,created_at", eq: { user_id: ctx.user.id }, order: "created_at.desc", limit: 24 }),
  ]);
  const now = Date.now();
  const sum = (rows) => rows.reduce((n, s) => n + s.share_cents, 0);
  const pending = sales.filter((s) => s.status === "pending");
  return json({
    seller: true,
    approved: account.approved,
    refCode: account.ref_code,
    ownLinkExample: `${siteUrl()}/books/?ref=${account.ref_code}`,
    onboarded: account.payouts_enabled,
    detailsSubmitted: account.details_submitted,
    shares: SHARES,
    refundWindowDays: REFUND_WINDOW_DAYS,
    minPayoutCents: MIN_PAYOUT_CENTS,
    books,
    balance: {
      // Still inside the refund window, or waiting for the minimum.
      pendingCents: sum(pending),
      payableNowCents: sum(pending.filter((s) => new Date(s.eligible_at).getTime() <= now)),
      clawbackCents: sales.filter((s) => s.clawback_cents > 0 && !s.clawback_settled).reduce((n, s) => n + s.clawback_cents, 0),
    },
    sales: sales.slice(0, 50),
    payouts,
  });
}

/** Start (or resume) Stripe Connect Express onboarding: where the author enters payout details. */
async function onboard(ctx, body) {
  if (!stripe.configured()) throw Errors.notConfigured("Payouts");
  const account = await approvedSeller(ctx.user.id);
  const service = dbAsService();
  let accountId = account.stripe_account_id;
  if (!accountId) {
    const country = (v.str(body.country, "Country", { max: 2 }) || "").toUpperCase() || undefined;
    const created = await stripe.createAccount({
      type: "express",
      ...(country ? { country } : {}),
      email: ctx.profile.email || ctx.user.email,
      // Transfers only: the author never takes card payments themselves.
      capabilities: { transfers: { requested: true } },
      tos_acceptance: { service_agreement: "recipient" },
      metadata: { user_id: ctx.user.id },
    });
    accountId = created.id;
    await service.update("seller_accounts", { stripe_account_id: accountId, country: created.country || country || null, updated_at: new Date().toISOString() }, { eq: { user_id: ctx.user.id } });
  }
  const link = await stripe.createAccountLink({
    account: accountId,
    type: "account_onboarding",
    refresh_url: `${siteUrl()}/app.html#/seller?onboarding=refresh`,
    return_url: `${siteUrl()}/app.html#/seller?onboarding=return`,
  });
  return json({ url: link.url });
}

async function dashboard(ctx) {
  if (!stripe.configured()) throw Errors.notConfigured("Payouts");
  const account = await approvedSeller(ctx.user.id);
  if (!account.stripe_account_id) throw Errors.invalid("Set up payouts first.");
  const link = await stripe.createLoginLink(account.stripe_account_id);
  return json({ url: link.url });
}

/**
 * PUBLIC. A reader buys an approved book.
 * Body: { book_id, ref? }  — nothing else is trusted from the browser.
 */
async function checkout(req, body) {
  if (!stripe.configured()) throw Errors.notConfigured("Checkout");
  const bookId = v.uuid(body.book_id, "Book");
  const ref = v.str(body.ref, "Referral code", { max: 40 });
  const service = dbAsService();

  const offer = await service.selectOne("seller_books", { eq: { book_id: bookId, status: "approved" } });
  if (!offer) throw Errors.notFound("book");
  const [book, seller] = await Promise.all([
    service.selectOne("books", { select: "id,title,author_name", eq: { id: bookId } }),
    service.selectOne("seller_accounts", { eq: { user_id: offer.user_id } }),
  ]);
  if (!book || !seller?.approved) throw Errors.notFound("book");
  // Never take money for a book that cannot be delivered.
  if (!offer.file_path) throw new AppError("not_ready", "This book is not ready to buy yet.", 409);

  const audience = classifyAudience({ ref, sellerRefCode: seller.ref_code });
  const session = await stripe.createCheckoutSession({
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: offer.currency.toLowerCase(),
          unit_amount: offer.price_cents,
          product_data: { name: book.title, description: book.author_name ? `by ${book.author_name}` : undefined },
        },
      },
    ],
    // Stripe fills {CHECKOUT_SESSION_ID}; the thank-you page uses it to find the sale.
    success_url: `${siteUrl()}/purchase/?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl()}/buy/?book=${book.id}`,
    customer_creation: "if_required",
    // The webhook reads these back. They are set here, on the server, from the
    // database — never from the request body.
    metadata: {
      kind: "seller_sale",
      book_id: book.id,
      seller_user_id: offer.user_id,
      audience,
    },
    payment_intent_data: {
      metadata: { kind: "seller_sale", book_id: book.id, seller_user_id: offer.user_id, audience },
      transfer_group: `book_${book.id}`,
    },
    ...taxParams({ enabled: env.stripeAutomaticTax, hasCustomer: false }),
  });
  return json({ url: session.url });
}

// --- public reads and delivery ---------------------------------------------

/** What a buyer may see about an approved book. No file path, no seller ids. */
const publicBook = (book, offer) => ({
  id: book.id,
  title: book.title,
  subtitle: book.subtitle,
  author: book.author_name,
  description: book.description,
  cover_url: book.cover_url,
  price_cents: offer.price_cents,
  currency: offer.currency,
});

async function readyOffers(ids) {
  const service = dbAsService();
  const offers = await service.select("seller_books", { select: "book_id,price_cents,currency,file_path,user_id", eq: { status: "approved" } });
  const ready = offers.filter((o) => o.file_path && (!ids || ids.includes(o.book_id)));
  if (!ready.length) return [];
  const accounts = await service.select("seller_accounts", { select: "user_id", eq: { approved: true } });
  const okUsers = new Set(accounts.map((a) => a.user_id));
  const books = await service.select("books", { select: "id,title,subtitle,author_name,description,cover_url", in: { id: ready.map((o) => o.book_id) } });
  return ready
    .filter((o) => okUsers.has(o.user_id))
    .map((o) => {
      const b = books.find((x) => x.id === o.book_id);
      return b ? publicBook(b, o) : null;
    })
    .filter(Boolean);
}

async function publicCatalogue() {
  return json({ books: await readyOffers() });
}

async function publicBookRead(url) {
  const id = v.uuid(url.searchParams.get("id"), "Book");
  const [one] = await readyOffers([id]);
  if (!one) throw Errors.notFound("book");
  return json({ book: one });
}

async function order(url) {
  const sessionId = v.str(url.searchParams.get("session_id"), "Session", { max: 200, required: true });
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) throw Errors.invalid("That order link isn't valid.");
  if (!env.downloadSecret) throw Errors.notConfigured("Downloads");
  return json(await orderFor({ db: dbAsService(), sessionId, secret: env.downloadSecret, siteUrl: siteUrl() }));
}

const DOWNLOAD_MESSAGES = {
  not_found: "That download link isn't valid.",
  refunded: "This order was refunded, so the download is no longer available.",
  disputed: "This order is under review, so the download is paused. Contact hello@bookpilot.org.",
  limit: "This link has reached its download limit. Contact hello@bookpilot.org and we will send a new one.",
  no_file: "We couldn't find the file for this book. Contact hello@bookpilot.org.",
};

async function download(url) {
  if (!env.downloadSecret) throw Errors.notConfigured("Downloads");
  const result = await resolveDownload({ db: dbAsService(), storage: supabaseStorage(), token: url.searchParams.get("t") || "", secret: env.downloadSecret });
  if (!result.ok) {
    throw new AppError(`download_${result.reason}`, DOWNLOAD_MESSAGES[result.reason] || DOWNLOAD_MESSAGES.not_found, result.reason === "not_found" ? 404 : 410);
  }
  return new Response(null, { status: 302, headers: { Location: result.url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

/**
 * A short-lived URL an approved seller uploads their book file to. The path is
 * fixed on the server (`<user>/<book>/book.<type>`), so a seller can write only
 * to their own book's slot, and only pdf or epub.
 */
async function uploadUrl(ctx, body) {
  await approvedSeller(ctx.user.id);
  const bookId = v.uuid(body.book_id, "Book");
  const type = v.oneOf(body.type, "File type", Object.keys(ALLOWED_TYPES), { required: true });
  const service = dbAsService();
  const offer = await service.selectOne("seller_books", { eq: { book_id: bookId, user_id: ctx.user.id } });
  if (!offer) throw Errors.notFound("book");
  const path = `${ctx.user.id}/${bookId}/book.${type}`;
  const signed = await supabaseStorage().signUpload(path);
  await service.update(
    "seller_books",
    { file_path: path, file_name: `book.${type}`, file_type: ALLOWED_TYPES[type], updated_at: new Date().toISOString() },
    { eq: { book_id: bookId } }
  );
  return json({ upload_url: signed.url, token: signed.token, max_bytes: MAX_FILE_BYTES, content_type: ALLOWED_TYPES[type] });
}

export default withGuards(async (req) => {
  const [action] = pathSegments(req, PREFIX);
  const url = new URL(req.url);

  if (req.method === "GET" && action === "catalogue") return publicCatalogue();
  if (req.method === "GET" && action === "book") return publicBookRead(url);
  if (req.method === "GET" && action === "order") return order(url);
  if (req.method === "GET" && action === "download") return download(url);

  if (req.method === "POST" && action === "checkout") {
    // Public: bound by IP so it cannot be used to spam Stripe.
    const ip = req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "unknown";
    memoryLimit(`seller-checkout:${ip}`, 20, 60_000);
    return checkout(req, await readJson(req));
  }

  const ctx = await authenticate(req);
  memoryLimit(`seller:${ctx.user.id}`, 30, 60_000);
  if (req.method === "GET" && (action === "status" || !action)) return status(ctx);
  if (req.method === "POST" && action === "onboard") return onboard(ctx, await readJson(req));
  if (req.method === "POST" && action === "dashboard") return dashboard(ctx);
  if (req.method === "POST" && action === "upload-url") return uploadUrl(ctx, await readJson(req));

  throw Errors.notFound("endpoint");
});

export const config = { path: "/api/bp-seller/*" };
