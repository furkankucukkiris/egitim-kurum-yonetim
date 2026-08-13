-- Fixes a real bug in the previous migration (20260814220000): revoking
-- EXECUTE from `anon` alone did nothing for 8 of the 10 functions, because
-- those functions also had a separate blanket grant to the `public`
-- pseudo-role (visible in pg_proc.proacl as a grantee with no name), which
-- applies to every role including anon regardless of anon's own individual
-- grants/revokes. Confirmed by re-running `supabase db advisors --linked`
-- after the previous migration: all 8 still showed up as anon-executable.
--
-- The two MFA recovery functions in that migration (which already had
-- `revoke all ... from public` from their original 20260814160000
-- migration) worked correctly, which is what exposed the difference: the
-- established codebase convention of `revoke all ... from public, anon`
-- (used 59+ times elsewhere) revokes both for exactly this reason.

revoke execute on function public.current_organization_id() from public;
revoke execute on function public.current_app_role() from public;
revoke execute on function public.is_admin() from public;
revoke execute on function public.can_manage_finance() from public;

revoke all on function public.audit_message_templates_update() from public;
revoke all on function public.audit_organizations_update() from public;
revoke all on function public.create_initial_accrual_for_enrollment() from public;
revoke all on function public.enforce_outbound_message_consent() from public;

notify pgrst, 'reload schema';
