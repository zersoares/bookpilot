-- =====================================================================
-- BookPilot AI — security hardening
--
-- Answers the Supabase Security Advisor. Run after 004. Every statement
-- is idempotent, so re-running this file is safe.
--
-- Note on ordering: 002_rls.sql revokes all privileges on
-- public.integrations from the client roles, and section 3 below grants
-- a narrow subset back. Re-running 002 on its own would therefore undo
-- section 3 — always finish with this file.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Pin the one search_path that was left mutable
-- ---------------------------------------------------------------------
-- Every other function in this schema already declares
-- `set search_path = public`. This one does not, which is what the
-- Advisor's "Function Search Path Mutable" warning refers to. It is
-- SECURITY INVOKER and only stamps updated_at, so the exposure was
-- small — but a resolvable search_path inside a trigger that fires on
-- every table is not worth leaving open.

alter function public.bp_touch_updated_at() set search_path = public;

-- ---------------------------------------------------------------------
-- 2. The privileged functions were reachable by anyone. Close them.
-- ---------------------------------------------------------------------
-- This is the important part of this file.
--
-- CREATE FUNCTION grants EXECUTE to PUBLIC by default. 004_functions.sql
-- revokes from `anon` and `authenticated`, which reads like it locks
-- these down — but it leaves the PUBLIC grant untouched, and every role
-- inherits PUBLIC. The ACL made it plain: {=X/postgres,...} where the
-- empty grantee is PUBLIC.
--
-- So bp_consume_credits, bp_refund_credits, bp_apply_plan and
-- bp_delete_account were callable by anyone with the anon key, over the
-- public internet, at /rest/v1/rpc/<name>. They are SECURITY DEFINER, so
-- they run as the owner and ignore RLS, and not one of them checks the
-- caller — each takes `p_user uuid` and acts on whoever is named. That
-- is a plan upgrade, unlimited AI credits, or deleting another author's
-- entire account, for an unauthenticated request.
--
-- Revoking from PUBLIC is what actually closes it. service_role holds an
-- explicit grant on each, so the server keeps working.
--
-- bp_admin_overview also had explicit anon/authenticated grants that a
-- PUBLIC revoke does not remove, hence both statements for it. It does
-- refuse non-admins from inside, so it was never the hole the other four
-- were.

revoke execute on function public.bp_consume_credits(uuid, text, integer, uuid, text) from public;
revoke execute on function public.bp_refund_credits(uuid, integer, text) from public;
revoke execute on function public.bp_apply_plan(uuid, text) from public;
revoke execute on function public.bp_delete_account(uuid) from public;

revoke execute on function public.bp_admin_overview() from public;
revoke execute on function public.bp_admin_overview() from anon, authenticated;

-- Not revoked, deliberately: bp_is_admin, bp_is_org_member and the
-- bp_can_access_* predicates. Every policy in 002 is defined `to public`
-- and calls them, so a client that cannot execute them gets an error
-- instead of an empty result — it would break anon reads of `plans`.
-- They are stable, read-only booleans scoped to auth.uid(), so leaving
-- them callable is the correct trade. The trigger functions
-- (bp_handle_new_user, bp_guard_profile_columns, bp_touch_updated_at)
-- stay callable too: plpgsql refuses to run a trigger function outside a
-- trigger, and revoking risks the DML that fires them.

-- ---------------------------------------------------------------------
-- 3. integration_status: two controls instead of one WHERE clause
-- ---------------------------------------------------------------------
-- The view was created with Postgres' default semantics, so it runs with
-- its owner's privileges and bypasses RLS on public.integrations. That is
-- the Advisor's one error, and it is a fair one.
--
-- It was never exploitable: the view filters on auth.uid(), which
-- resolves per caller whoever owns the view. But that single clause was
-- the only thing between a client and every row of a table holding OAuth
-- access and refresh tokens. One editing mistake was the whole margin.
--
-- Switching to security_invoker makes the view run as the caller, which
-- means the caller needs privileges of its own and has to satisfy RLS.
-- Both are granted below, deliberately narrowly:
--
--   * The column list is exactly what the view selects. access_token and
--     refresh_token are absent, so `authenticated` can read the table
--     without being able to read the secrets in it. (002_rls.sql says
--     Postgres has no column-level RLS, which is true — but it does have
--     column-level GRANT, which this schema already uses on profiles and
--     campaigns, and that is enough here.)
--
--   * The policy restricts rows to the caller. Now if the view's WHERE
--     clause were ever dropped, RLS would still hold the line.
--
-- The server keeps writing tokens through the service role, which
-- bypasses both.

grant select (
  id, user_id, provider, status, account_id, account_name,
  scopes, expires_at, last_synced_at, last_error, created_at
) on public.integrations to authenticated;

drop policy if exists integrations_read_own on public.integrations;
create policy integrations_read_own on public.integrations
  for select using (user_id = auth.uid());

alter view public.integration_status set (security_invoker = on);
