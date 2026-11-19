import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// The tracking script runs on the customer's own site, a different origin from
// the collector. sendBeacon is always a credentialed request, and the collector
// does not (and should not) answer Access-Control-Allow-Credentials, so a
// beacon from another origin is rejected by the browser and the event is lost.
// The script must therefore send with fetch + credentials: "omit".

const SOURCE = readFileSync(new URL("../track/bp.js", import.meta.url), "utf8");

function run({ withFetch = true, search = "?utm_source=bookpilot&utm_campaign=c1" } = {}) {
  const calls = { fetch: [], beacon: [] };
  const scriptEl = {
    src: "https://bookpilot.org/track/bp.js",
    getAttribute: (n) => (n === "data-key" ? "bp_testkey" : null),
  };
  const store = new Map();
  const window = {};
  const sandbox = {
    window,
    document: { currentScript: scriptEl, getElementsByTagName: () => [scriptEl] },
    location: { href: "https://gdprgard.eu/" + search, search },
    navigator: { sendBeacon: (url, blob) => (calls.beacon.push({ url, blob }), true) },
    sessionStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => void store.set(k, String(v)),
    },
    URL,
    URLSearchParams,
    Blob,
    JSON,
    console,
  };
  if (withFetch) {
    window.fetch = sandbox.fetch = (url, init) => {
      calls.fetch.push({ url, init });
      return Promise.resolve({ ok: true });
    };
  }
  window.location = sandbox.location;
  vm.runInNewContext(SOURCE, sandbox);
  return { calls, window };
}

test("a tagged visit sends its page view with fetch, keepalive and no credentials", () => {
  const { calls } = run();
  assert.equal(calls.fetch.length, 1);
  const { url, init } = calls.fetch[0];
  assert.equal(url, "https://bookpilot.org/api/bp-track");
  assert.equal(init.method, "POST");
  assert.equal(init.credentials, "omit");
  assert.equal(init.keepalive, true);
  assert.equal(init.mode, "cors");
  assert.equal(JSON.parse(init.body).e, "page_view");
  assert.equal(JSON.parse(init.body).k, "bp_testkey");
});

test("sendBeacon is not used while fetch is available", () => {
  const { calls } = run();
  assert.equal(calls.beacon.length, 0);
});

test("without fetch, sendBeacon is the fallback", () => {
  const { calls } = run({ withFetch: false });
  assert.equal(calls.fetch.length, 0);
  assert.equal(calls.beacon.length, 1);
  assert.equal(calls.beacon[0].url, "https://bookpilot.org/api/bp-track");
});

test("a visit without campaign tags sends nothing", () => {
  const { calls } = run({ search: "" });
  assert.equal(calls.fetch.length + calls.beacon.length, 0);
});

test("an explicit consent refusal sends nothing", () => {
  const calls = { fetch: 0, beacon: 0 };
  const scriptEl = { src: "https://bookpilot.org/track/bp.js", getAttribute: () => "bp_testkey" };
  const sandbox = {
    window: { bookpilotConsent: false, fetch: () => (calls.fetch++, Promise.resolve()) },
    document: { currentScript: scriptEl, getElementsByTagName: () => [scriptEl] },
    location: { href: "https://gdprgard.eu/?utm_source=bookpilot", search: "?utm_source=bookpilot" },
    navigator: { sendBeacon: () => (calls.beacon++, true) },
    sessionStorage: { getItem: () => null, setItem() {} },
    URL, URLSearchParams, Blob, JSON, console,
  };
  sandbox.fetch = sandbox.window.fetch;
  vm.runInNewContext(SOURCE, sandbox);
  assert.equal(calls.fetch + calls.beacon, 0);
});
