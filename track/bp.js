/*!
 * BookPilot AI — website tracking (spec §17)
 *
 * Install on your own site:
 *   <script async src="https://…/track/bp.js" data-key="bp_…"></script>
 *
 * Then record a sale on your thank-you page:
 *   bookpilot('purchase', { value: 8.99, currency: 'EUR', id: 'order-123' });
 *
 * What this collects: which BookPilot campaign and creative sent the
 * visitor (from the UTM parameters on the ad link), which of five event
 * types happened, and the order value on a purchase.
 *
 * What it deliberately does not collect: no cookies, no device or
 * advertising identifier, no IP address or user agent recorded by the
 * collector, no referrer, no page content, no cross-site anything. The
 * session key is a random value held in sessionStorage that dies with
 * the tab and is never linked to a person.
 *
 * Consent: if your cookie or consent policy requires it, set
 *   window.bookpilotConsent = false
 * before this script loads and nothing is sent until you set it to true
 * and call bookpilot('page_view'). You are the controller of your
 * visitors' data on your own site; this is a tool, not legal advice.
 */
(function () {
  "use strict";

  var script = document.currentScript ||
    (function () {
      var all = document.getElementsByTagName("script");
      return all[all.length - 1];
    })();

  var key = script && script.getAttribute("data-key");
  if (!key) {
    if (window.console) console.warn("[bookpilot] tracking script has no data-key; nothing will be sent.");
    return;
  }

  var endpoint = (script.getAttribute("data-endpoint") ||
    new URL(script.src, location.href).origin + "/api/bp-track");

  var STORAGE_UTM = "bp.utm";
  var STORAGE_SESSION = "bp.sid";

  function consented() {
    // Undefined means "no gate configured", which is the default for
    // sites that don't need one. An explicit false blocks everything.
    return window.bookpilotConsent !== false;
  }

  function readStore(name) {
    try {
      return sessionStorage.getItem(name);
    } catch (err) {
      return null;
    }
  }

  function writeStore(name, value) {
    try {
      sessionStorage.setItem(name, value);
    } catch (err) {
      /* private mode, blocked storage — attribution just won't persist
         across pages in this session */
    }
  }

  function sessionId() {
    var existing = readStore(STORAGE_SESSION);
    if (existing) return existing;
    var generated;
    try {
      generated = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
    } catch (err) {
      generated = String(Date.now()) + Math.random().toString(36).slice(2, 10);
    }
    writeStore(STORAGE_SESSION, generated);
    return generated;
  }

  /**
   * UTM parameters arrive on the landing page and are needed again at
   * checkout, several pages later. Keep them for the tab's lifetime.
   */
  function utm() {
    var params = new URLSearchParams(location.search);
    var fresh = {
      source: params.get("utm_source"),
      medium: params.get("utm_medium"),
      campaign: params.get("utm_campaign"),
      content: params.get("utm_content"),
      term: params.get("utm_term"),
    };
    var hasFresh = fresh.source || fresh.campaign || fresh.content;
    if (hasFresh) {
      writeStore(STORAGE_UTM, JSON.stringify(fresh));
      return fresh;
    }
    var stored = readStore(STORAGE_UTM);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch (err) {
        return {};
      }
    }
    return {};
  }

  var VALID = ["click", "page_view", "add_to_cart", "checkout", "purchase"];
  var sentPurchases = {};

  function send(type, options) {
    if (!consented()) return;
    if (VALID.indexOf(type) === -1) return;
    options = options || {};

    // Guard against a thank-you page being reloaded or a purchase call
    // firing twice on the same order.
    if (type === "purchase" && options.id) {
      if (sentPurchases[options.id]) return;
      sentPurchases[options.id] = true;
    }

    var payload = {
      k: key,
      e: type,
      v: typeof options.value === "number" ? options.value : 0,
      c: options.currency || "EUR",
      utm: utm(),
      s: sessionId(),
    };
    var body = JSON.stringify(payload);

    // fetch with keepalive survives the page unload that follows a checkout
    // click, like sendBeacon, but it can be sent without credentials.
    // sendBeacon cannot: it is always a credentialed request, so on the
    // customer's own site (a different origin) the browser rejects it unless
    // the collector answers Access-Control-Allow-Credentials, and the event
    // is lost. sendBeacon is only the fallback for browsers without fetch.
    try {
      if (window.fetch) {
        fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body,
          keepalive: true,
          mode: "cors",
          credentials: "omit",
        }).catch(function () {
          /* a lost analytics event must never surface to a visitor */
        });
        return;
      }
    } catch (err) {
      /* fall through to sendBeacon */
    }
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(endpoint, new Blob([body], { type: "application/json" }));
      }
    } catch (err) {
      /* nothing more to try */
    }
  }

  // Public API. Any calls queued before the script loaded are replayed.
  var queue = window.bookpilot && window.bookpilot.q;
  window.bookpilot = function (type, options) {
    send(type, options);
  };
  window.bookpilot.version = "1.0.0";

  if (queue && queue.length) {
    for (var i = 0; i < queue.length; i += 1) {
      try {
        send(queue[i][0], queue[i][1]);
      } catch (err) {
        /* skip a malformed queued call */
      }
    }
  }

  // Automatic page view. Only counted when the visit carries BookPilot
  // attribution, so a site's ordinary traffic is not collected at all.
  var attribution = utm();
  if (attribution.campaign || attribution.content || attribution.source) {
    send("page_view");
  }
})();
