// Reader-magnet landing pages: server-side validation and the HTML the
// public page is rendered from.
//
// The pure rules (slug shape, email shape, escaping) live in
// js/core/landing.js and are shared with the browser — see that file's
// header. This layer adds what only the server needs: turning a bad
// value into a thrown AppError, and building the actual page markup.
//
// This is the one page in the product a stranger loads with no session
// and no app shell around it — the whole point is that it is shareable
// and indexable. Every author-supplied string that reaches renderPage()
// is therefore escaped before it touches the response: a headline is
// public HTML the moment it is saved, and an unescaped one is a stored
// XSS hole served to every visitor of that link.

import { Errors } from "./errors.js";
import {
  RESERVED_SLUGS, slugify, isValidSlug, isValidEmail, normaliseEmail, escapeHtml, safeAttrUrl,
} from "../../../js/core/landing.js";

export { RESERVED_SLUGS, slugify, escapeHtml, safeAttrUrl };

/** Validate a slug the author chose or that the client generated. */
export function validateSlug(value) {
  const slug = String(value || "").trim().toLowerCase();
  if (!isValidSlug(slug)) {
    if (RESERVED_SLUGS.has(slug)) throw Errors.invalid(`"${slug}" is reserved. Choose a different page address.`);
    throw Errors.invalid("The page address can only use lowercase letters, numbers and hyphens, and must be 2–60 characters.");
  }
  return slug;
}

export function validateEmail(value) {
  const email = normaliseEmail(value);
  if (!isValidEmail(email)) throw Errors.invalid("That doesn't look like an email address.");
  return email;
}

/**
 * The public landing page. Everything from `page` and `book` is author
 * input and is escaped; nothing here is trusted to already be safe HTML.
 */
export function renderPage({ page, book, submitted = false }) {
  const title = escapeHtml(page.headline || book.title);
  const subhead = escapeHtml(page.subhead || book.subtitle || "");
  const description = escapeHtml((book.description || "").slice(0, 200));
  const cover = safeAttrUrl(book.cover_url);
  const ctaUrl = safeAttrUrl(page.cta_url || book.sales_url);
  const ctaLabel = escapeHtml(page.cta_label || "Get the book");
  const magnetLabel = escapeHtml(page.magnet_label || "Send me the first chapter");
  const authorName = escapeHtml(book.author_name || "");
  const pageUrl = escapeHtml(page.canonicalUrl || "");
  const showMagnet = page.magnet_enabled;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${description ? `<meta name="description" content="${description}">` : ""}
<meta property="og:type" content="book">
<meta property="og:title" content="${title}">
${description ? `<meta property="og:description" content="${description}">` : ""}
${cover ? `<meta property="og:image" content="${cover}">` : ""}
${pageUrl ? `<meta property="og:url" content="${pageUrl}">` : ""}
<meta name="twitter:card" content="${cover ? "summary_large_image" : "summary"}">
<link rel="icon" href="/favicon.svg">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; flex-direction: column; align-items: center;
    padding: 48px 20px; background: #0e0e13; color: #f2f1f6;
    font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .wrap { max-width: 560px; width: 100%; text-align: center; }
  img.cover { width: 220px; max-width: 60vw; border-radius: 10px; box-shadow: 0 20px 60px rgba(0,0,0,.5); margin-bottom: 28px; }
  h1 { font-size: 1.9rem; line-height: 1.25; margin: 0 0 10px; }
  .subhead { color: #b7b5c4; font-size: 1.05rem; margin: 0 0 28px; }
  .author { color: #8a8896; font-size: .9rem; margin: -18px 0 28px; }
  .card { background: #17171f; border: 1px solid #29283a; border-radius: 14px; padding: 28px 24px; margin-bottom: 16px; }
  .btn {
    display: inline-block; padding: 13px 26px; border-radius: 8px; font-weight: 600; text-decoration: none;
    border: none; cursor: pointer; font-size: 1rem;
  }
  .btn-primary { background: #7c6cf0; color: #fff; }
  .btn-primary:hover { background: #6c5ce6; }
  form { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
  input[type="email"] {
    flex: 1; min-width: 220px; padding: 12px 14px; border-radius: 8px; border: 1px solid #35334a;
    background: #0e0e13; color: #f2f1f6; font-size: 1rem;
  }
  .hp { position: absolute; left: -9999px; opacity: 0; height: 0; width: 0; }
  .fine { color: #6f6d7c; font-size: .78rem; margin-top: 14px; }
  .fine a { color: #9d94f5; }
  .ok { color: #7ee0a8; font-size: .95rem; }
  .err { color: #f0847c; font-size: .9rem; margin-top: 10px; }
  footer { margin-top: 36px; color: #55535f; font-size: .78rem; }
  footer a { color: #8a8896; }
</style>
</head>
<body>
<div class="wrap">
  ${cover ? `<img class="cover" src="${cover}" alt="${title} cover">` : ""}
  <h1>${title}</h1>
  ${subhead ? `<p class="subhead">${subhead}</p>` : ""}
  ${authorName ? `<p class="author">by ${authorName}</p>` : ""}

  ${ctaUrl ? `<p><a class="btn btn-primary" href="${ctaUrl}" target="_blank" rel="noopener noreferrer">${ctaLabel}</a></p>` : ""}

  ${showMagnet ? `<div class="card" id="magnet-card">
    ${submitted ? `<p class="ok">You're on the list. ${page.magnetUrl ? `<a href="${safeAttrUrl(page.magnetUrl)}" target="_blank" rel="noopener noreferrer">Get your download →</a>` : "Watch for it in your inbox."}</p>`
      : `<form id="magnet-form" method="post">
          <input type="email" name="email" placeholder="you@example.com" required maxlength="254">
          <label class="hp">Leave this empty<input type="text" name="website" tabindex="-1" autocomplete="off"></label>
          <button type="submit" class="btn btn-primary">${magnetLabel}</button>
        </form>
        <p class="fine">No spam — just this author's updates. Unsubscribe any time.</p>
        <p class="err" id="magnet-error" hidden></p>`}
  </div>` : ""}

  <footer>Powered by <a href="https://bookpilot.org" target="_blank" rel="noopener noreferrer">BookPilot</a></footer>
</div>
${showMagnet && !submitted ? `<script>
(function () {
  var form = document.getElementById("magnet-form");
  if (!form) return;
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var email = form.email.value;
    var website = form.website.value; // honeypot
    var err = document.getElementById("magnet-error");
    err.hidden = true;
    var btn = form.querySelector("button");
    btn.disabled = true;
    fetch(location.pathname, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, website: website }),
    }).then(function (r) { return r.json().then(function (body) { return { ok: r.ok, body: body }; }); })
      .then(function (res) {
        if (!res.ok) { err.textContent = (res.body && res.body.error && res.body.error.message) || "Something went wrong."; err.hidden = false; btn.disabled = false; return; }
        // Built with DOM calls, not innerHTML: magnetUrl is the author's
        // own saved value, but there is no reason to trust string
        // concatenation with it when textContent/href assignment costs
        // nothing extra.
        var card = document.getElementById("magnet-card");
        card.textContent = "";
        var p = document.createElement("p");
        p.className = "ok";
        p.appendChild(document.createTextNode("You're on the list. "));
        if (res.body.magnetUrl) {
          var a = document.createElement("a");
          a.href = res.body.magnetUrl;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.textContent = "Get your download \\u2192";
          p.appendChild(a);
        } else {
          p.appendChild(document.createTextNode("Watch for it in your inbox."));
        }
        card.appendChild(p);
      }).catch(function () {
        err.textContent = "Couldn't reach the server. Try again in a moment.";
        err.hidden = false;
        btn.disabled = false;
      });
  });
})();
</script>` : ""}
</body>
</html>`;
}
