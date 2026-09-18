// Sending the browser back to the app after an OAuth callback.
//
// A platform redirects the browser to our callback with a one-time `code`
// and our signed `state` in the query string. The callback must then send
// the browser on to the app. Done as an HTTP redirect, the address that
// reaches the browser came back with that query string merged into it
// (app.html?code=…&state=…#/attribution?…), so the code and state ended up
// in the address bar, in history, and in anything the app page then linked
// to. The code was already spent and the state expires in 15 minutes, so it
// was untidy rather than dangerous, but there is no reason to keep it.
//
// So this does not redirect. It answers with a tiny page that moves the
// browser on by itself. There is no Location header to rewrite, the target
// is exactly what is written here, and the page asks the browser to send no
// Referer and not to cache it.

import { env } from "./env.js";

const escapeAttr = (value) =>
  String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Where the app shows a connection's result: the Attribution screen. */
export function appReturnUrl(provider, result) {
  return `${env.siteUrl.replace(/\/$/, "")}/app.html#/attribution?${provider}=${result}`;
}

/**
 * @param {string} provider  "meta" | "pinterest" — a fixed internal word
 * @param {string} result    "connected" | "declined" | "failed" — likewise
 */
export function backToApp(provider, result) {
  const target = escapeAttr(appReturnUrl(provider, result));
  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Returning to BookPilot…</title>
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<meta http-equiv="refresh" content="0;url=${target}">
</head>
<body>
<p>Returning to BookPilot… <a href="${target}">Continue</a></p>
</body>
</html>
`;
  return new Response(page, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
    },
  });
}
