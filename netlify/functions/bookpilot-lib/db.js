// Thin PostgREST client for Supabase.
//
// The important detail is *which key signs the request*:
//
//   dbAsUser(token)  — sends the caller's own JWT. Postgres applies the
//                      RLS policies in bookpilot/sql/002_rls.sql, so a
//                      query can only ever return that user's rows even
//                      if this file had a bug in its filters. This is
//                      how every request that serves a user's data runs.
//
//   dbAsService()    — sends the service-role key, which bypasses RLS.
//                      Used only for: Stripe webhooks (no user session),
//                      credit accounting, the tracking collector, prompt
//                      loading, and admin reads. Each call site says why.

import { env } from "./env.js";
import { AppError, Errors } from "./errors.js";

function buildQuery(options = {}) {
  const parts = [];
  if (options.select) parts.push(`select=${encodeURIComponent(options.select)}`);
  for (const [column, condition] of Object.entries(options.eq || {})) {
    if (condition === undefined) continue;
    parts.push(`${encodeURIComponent(column)}=eq.${encodeURIComponent(condition)}`);
  }
  for (const [column, condition] of Object.entries(options.filters || {})) {
    parts.push(`${encodeURIComponent(column)}=${encodeURIComponent(condition)}`);
  }
  if (options.in) {
    for (const [column, values] of Object.entries(options.in)) {
      if (!values?.length) continue;
      const list = values.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",");
      parts.push(`${encodeURIComponent(column)}=in.(${encodeURIComponent(list)})`);
    }
  }
  if (options.order) parts.push(`order=${encodeURIComponent(options.order)}`);
  if (options.limit) parts.push(`limit=${Number(options.limit)}`);
  if (options.offset) parts.push(`offset=${Number(options.offset)}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

function makeClient({ token, isService }) {
  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    throw Errors.notConfigured("The database");
  }
  const base = `${env.supabaseUrl.replace(/\/$/, "")}/rest/v1`;
  const apiKey = isService ? env.supabaseServiceKey : env.supabaseAnonKey;
  if (isService && !apiKey) throw Errors.notConfigured("Server database access");

  async function request(method, table, { body, options = {}, prefer } = {}) {
    const headers = {
      apikey: apiKey,
      Authorization: `Bearer ${token || apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (prefer) headers.Prefer = prefer;

    let res;
    try {
      res = await fetch(`${base}/${table}${buildQuery(options)}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      console.error("[bookpilot] database unreachable:", err);
      throw Errors.database();
    }

    const text = await res.text();
    if (!res.ok) {
      // PostgREST returns 401/403 when an RLS policy rejects the row.
      console.error(`[bookpilot] db ${method} ${table} -> ${res.status}: ${text}`);
      if (res.status === 401 || res.status === 403) throw Errors.forbidden();
      if (res.status === 404) throw Errors.notFound();
      if (res.status === 409) {
        throw new AppError("conflict", "That already exists.", 409);
      }
      throw Errors.database();
    }
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  return {
    isService,
    async select(table, options = {}) {
      return (await request("GET", table, { options })) || [];
    },
    async selectOne(table, options = {}) {
      const rows = await request("GET", table, { options: { ...options, limit: 1 } });
      return rows && rows.length ? rows[0] : null;
    },
    async insert(table, rows, { returning = true } = {}) {
      const result = await request("POST", table, {
        body: rows,
        prefer: returning ? "return=representation" : "return=minimal",
      });
      if (!returning) return null;
      return Array.isArray(rows) ? result : result?.[0] ?? null;
    },
    async upsert(table, rows, { onConflict, returning = true } = {}) {
      const result = await request("POST", table, {
        body: rows,
        options: onConflict ? { filters: { on_conflict: onConflict } } : {},
        prefer: `resolution=merge-duplicates,${returning ? "return=representation" : "return=minimal"}`,
      });
      if (!returning) return null;
      return Array.isArray(rows) ? result : result?.[0] ?? null;
    },
    async update(table, patch, options = {}) {
      const result = await request("PATCH", table, {
        body: patch,
        options,
        prefer: "return=representation",
      });
      return result?.[0] ?? null;
    },
    async remove(table, options = {}) {
      await request("DELETE", table, { options, prefer: "return=minimal" });
      return true;
    },
    async rpc(fn, args = {}) {
      return request("POST", `rpc/${fn}`, { body: args });
    },
  };
}

export function dbAsUser(token) {
  if (!token) throw Errors.unauthorized();
  return makeClient({ token, isService: false });
}

export function dbAsService() {
  return makeClient({ token: env.supabaseServiceKey, isService: true });
}

/**
 * Transport-level check: does the Supabase project answer at all?
 *
 * Any HTTP reply counts as reachable, including 401 and 404 — those prove
 * the project is there and merely disagreed with the request. Only a
 * connection failure or a timeout means it is gone. That distinction is
 * the whole point: a missing table or an RLS refusal is a query problem,
 * and must not be mistaken for a dead project.
 *
 * Used by the config endpoint so `capabilities.database` can mean "the
 * database answers" rather than "someone set the environment variables".
 */
export async function databaseReachable({ timeoutMs = 3000 } = {}) {
  if (!env.supabaseUrl || !env.supabaseAnonKey) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(`${env.supabaseUrl.replace(/\/$/, "")}/rest/v1/`, {
      method: "GET",
      headers: { apikey: env.supabaseAnonKey },
      signal: controller.signal,
    });
    return true;
  } catch (err) {
    // A paused project stops resolving in DNS, so this is the branch a
    // free-tier project that has idled out actually lands in.
    console.error("[bookpilot] database unreachable:", err?.message || err);
    return false;
  } finally {
    clearTimeout(timer);
  }
}
