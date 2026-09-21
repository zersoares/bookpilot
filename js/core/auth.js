// Authentication against Supabase Auth (GoTrue), over its REST API.
//
// No SDK: the whole front end is plain ES modules served as static
// files, so a dependency would mean a build step. The endpoints used
// here are stable and few.
//
// The session lives in localStorage. That is the standard trade-off for
// a single-page app talking to Supabase — the token is scoped by RLS,
// short-lived, and refreshed from a rotating refresh token — and it is
// why every value rendered from user data goes through the escaping in
// dom.js.

const SESSION_KEY = "bookpilot.session";

let config = { url: "", anonKey: "" };
let session = null;
let refreshTimer = null;
const listeners = new Set();

function store(next) {
  session = next;
  try {
    if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* session simply won't survive a reload */
  }
  scheduleRefresh();
  listeners.forEach((fn) => fn(session));
}

function restore() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) session = JSON.parse(raw);
  } catch {
    session = null;
  }
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  if (!session?.expires_at) return;
  // Refresh a minute before expiry, and never schedule into the past.
  const delay = Math.max(5_000, session.expires_at * 1000 - Date.now() - 60_000);
  refreshTimer = setTimeout(() => {
    refreshSession().catch(() => signOut());
  }, delay);
}

export function configure(authConfig) {
  config = { url: (authConfig?.url || "").replace(/\/$/, ""), anonKey: authConfig?.anonKey || "" };
  restore();
  scheduleRefresh();
}

export function isConfigured() {
  return Boolean(config.url && config.anonKey);
}

/** Where Supabase lives, for the one call that goes straight to Storage. */
export function storageConfig() {
  return { url: config.url, anonKey: config.anonKey };
}

export function onChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function currentUser() {
  return session?.user || null;
}

async function authFetch(path, { method = "POST", body, token } = {}) {
  if (!isConfigured()) throw new Error("Authentication isn't set up on this deployment.");
  const res = await fetch(`${config.url}/auth/v1${path}`, {
    method,
    headers: {
      apikey: config.anonKey,
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // GoTrue's messages are already user-facing ("Invalid login
    // credentials"), but a couple are worth softening.
    const message = data.error_description || data.msg || data.message || "";
    throw new Error(friendlyAuthError(message, res.status));
  }
  return data;
}

function friendlyAuthError(message, status) {
  const text = String(message).toLowerCase();
  if (text.includes("invalid login")) return "That email and password don't match an account.";
  if (text.includes("already registered")) return "There's already an account with that email. Try signing in.";
  if (text.includes("password")) return "Please choose a password of at least 8 characters.";
  if (text.includes("email")) return "Please enter a valid email address.";
  if (status === 429) return "Too many attempts. Please wait a minute and try again.";
  return message || "We couldn't complete that. Please try again.";
}

function adopt(data) {
  if (!data?.access_token) return null;
  const next = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    user: data.user || null,
  };
  store(next);
  return next;
}

export async function signUp({ email, password, fullName }) {
  const data = await authFetch("/signup", {
    body: {
      email,
      password,
      data: { full_name: fullName || "" },
      options: { emailRedirectTo: `${location.origin}/app.html` },
    },
  });
  // With email confirmation switched on, Supabase returns a user but no
  // session — the caller shows "check your inbox" in that case.
  return { session: adopt(data), needsConfirmation: !data.access_token };
}

export async function signIn({ email, password }) {
  const data = await authFetch("/token?grant_type=password", { body: { email, password } });
  return adopt(data);
}

/** Google OAuth, when the provider is enabled on the Supabase project. */
export function signInWithGoogle() {
  if (!isConfigured()) throw new Error("Authentication isn't set up on this deployment.");
  const redirect = encodeURIComponent(`${location.origin}/app.html`);
  location.href = `${config.url}/auth/v1/authorize?provider=google&redirect_to=${redirect}`;
}

export async function requestPasswordReset(email) {
  await authFetch("/recover", {
    body: { email, options: { redirectTo: `${location.origin}/app.html` } },
  });
}

export async function refreshSession() {
  if (!session?.refresh_token) return null;
  const data = await authFetch("/token?grant_type=refresh_token", {
    body: { refresh_token: session.refresh_token },
  });
  return adopt(data);
}

export async function signOut() {
  const token = session?.access_token;
  store(null);
  if (token) {
    try {
      await authFetch("/logout", { token });
    } catch {
      // The local session is already gone; a failed server-side logout
      // shouldn't keep the user staring at a spinner.
    }
  }
}

/** A valid access token, refreshing first if it is about to expire. */
export async function accessToken() {
  if (!session) return null;
  if (session.expires_at && session.expires_at * 1000 - Date.now() < 30_000) {
    try {
      await refreshSession();
    } catch {
      store(null);
      return null;
    }
  }
  return session?.access_token || null;
}

/**
 * Supabase returns OAuth and magic-link sessions in the URL fragment.
 * Consume it, then scrub it from the address bar so the token isn't
 * left in history.
 */
export function consumeUrlSession() {
  const hash = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  if (!hash.includes("access_token=")) return false;
  const params = new URLSearchParams(hash);
  const adopted = adopt({
    access_token: params.get("access_token"),
    refresh_token: params.get("refresh_token"),
    expires_in: Number(params.get("expires_in")) || 3600,
  });
  history.replaceState(null, "", `${location.pathname}${location.search}#/overview`);
  return Boolean(adopted);
}
