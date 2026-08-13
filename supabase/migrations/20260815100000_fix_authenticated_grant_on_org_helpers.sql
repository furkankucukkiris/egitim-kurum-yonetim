-- Fixes a real regression from 20260814230000: that migration revoked
-- EXECUTE on current_organization_id/current_app_role/is_admin/
-- can_manage_finance from the `public` pseudo-role to close an anon-access
-- gap (see that migration's own comment). The stated intent was for
-- `authenticated` to keep access -- these 4 helpers back nearly every RLS
-- policy in the schema -- but `authenticated` was never given its own
-- explicit grant on these functions; it only ever had access implicitly
-- (via the `public` grant, on some environments, or via this project's
-- default privileges on others). Revoking from `public` was therefore not
-- guaranteed to leave `authenticated` with access on every environment: a
-- clean rebuild from migrations (e.g. CI's `supabase db reset` against a
-- freshly started local stack) ended up with `authenticated` unable to
-- call these functions at all, breaking every RLS-gated query for logged
-- in users (surfaced by pgTAP: "permission denied for function
-- current_organization_id" while running as `authenticated`).
--
-- Fix: grant EXECUTE to `authenticated` explicitly and unconditionally, so
-- access no longer depends on ambient/default privileges that differ
-- across environments.

grant execute on function public.current_organization_id() to authenticated;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.can_manage_finance() to authenticated;

notify pgrst, 'reload schema';
