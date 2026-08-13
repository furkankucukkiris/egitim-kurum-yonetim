-- Function grant hardening, search_path fix, and RLS query-performance fixes.
--
-- Source: `supabase db advisors --linked` (Supabase security + performance
-- advisor) run against the live database, cross-checked against actual live
-- grants (pg_proc/aclexplode) and app source (no client .rpc() calls) before
-- changing anything, so nothing here is a guess.
--
-- Findings addressed:
--  1. function_search_path_mutable: set_updated_at() has no search_path set
--     at all (every other function in the schema sets one explicitly).
--  2. anon_security_definer_function_executable (13 functions): every
--     function in this schema gets EXECUTE granted to anon/authenticated
--     automatically at creation via this project's default privileges,
--     unless explicitly revoked. A handful of functions never had that
--     revoke applied. Confirmed via pg_proc which ones are genuinely
--     reachable (current_organization_id/current_app_role/is_admin/
--     can_manage_finance return real values to anon since they take no
--     parameters -- revoke anon here, but NOT authenticated: these 4 back
--     nearly every RLS policy in the schema, and revoking authenticated's
--     EXECUTE would break every query run by a logged-in user). Four more
--     (audit_message_templates_update, audit_organizations_update,
--     create_initial_accrual_for_enrollment, enforce_outbound_message_consent)
--     are trigger functions (returns trigger) that Postgres already refuses
--     to invoke outside trigger context regardless of grants, but are
--     cleaned up for hygiene/to stop them showing up as RPC endpoints.
--     store_admin_mfa_recovery_code/verify_and_consume_admin_recovery_code
--     were meant to be authenticated-only (per their own `grant ... to
--     authenticated` line) but their revoke only listed `public`, not
--     `anon` -- both functions already reject calls with a null auth.uid()
--     so this was not exploitable, just an inconsistency with the rest of
--     the codebase's `revoke ... from public, anon` convention.
--     has_any_organization() is intentionally anon-callable (checked: it's
--     called from the unauthenticated /kurulum setup page to decide whether
--     to show the setup form) and check_login_rate_limit/record_login_attempt
--     are intentionally anon-callable (pre-auth login flow) -- left as-is.
--  3. auth_rls_initplan (12 policies): policies that call auth.uid() or a
--     helper function directly get re-evaluated per row at scale. Fixed by
--     wrapping with (select ...), Supabase's documented pattern, which lets
--     Postgres evaluate the call once per query instead of once per row.
--  4. multiple_permissive_policies (9 tables): each of these tables has an
--     admin-only "manage everything" ALL policy plus a separate SELECT
--     policy whose condition is provably a superset of (or, for
--     enrollments/guardians/students/student_guardians/
--     teacher_course_meb_authorizations, exactly equal to, since
--     can_manage_finance() is defined as `select is_admin()`) what the ALL
--     policy grants for SELECT. Both are permissive and both match on
--     SELECT, so Postgres evaluates and ORs both for every query. Fixed by
--     splitting each ALL policy into INSERT/UPDATE/DELETE-only policies
--     (same exact condition, just no longer overlapping the SELECT policy)
--     -- access is unchanged, only the redundant double-evaluation is
--     removed.
--
-- Not changed here:
--  - rls_enabled_no_policy on admin_mfa_recovery_codes: reviewed, this is
--    intentional (see the comment already on that table from
--    20260814160000_add_security_hardening.sql) -- all access to that table
--    goes through the two SECURITY DEFINER recovery-code functions, which
--    bypass RLS as the function owner. Adding a policy would only ever
--    widen access, not needed.
--  - auth_leaked_password_protection: an Auth project setting (Dashboard ->
--    Authentication -> Policies), not a database object -- cannot be
--    changed via a SQL migration. Needs to be turned on manually.
--  - current_organization_id/current_app_role/is_admin's `search_path =
--    public` (instead of the `search_path = ''` used everywhere else):
--    left as-is. These 4 helpers back nearly every RLS policy in the
--    schema; every reference inside their bodies is already
--    schema-qualified, so the practical risk is low, and changing
--    search_path on functions this load-bearing is not worth the risk for
--    a stylistic-only fix.

-- ---------------------------------------------------------------------
-- 1. search_path fix
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. function grant hardening
-- ---------------------------------------------------------------------
revoke execute on function public.current_organization_id() from anon;
revoke execute on function public.current_app_role() from anon;
revoke execute on function public.is_admin() from anon;
revoke execute on function public.can_manage_finance() from anon;

revoke execute on function public.store_admin_mfa_recovery_code(text) from anon;
revoke execute on function public.verify_and_consume_admin_recovery_code(text) from anon;

revoke all on function public.audit_message_templates_update() from anon, authenticated;
revoke all on function public.audit_organizations_update() from anon, authenticated;
revoke all on function public.create_initial_accrual_for_enrollment() from anon, authenticated;
revoke all on function public.enforce_outbound_message_consent() from anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. auth_rls_initplan: wrap auth.uid()/helper calls in (select ...) so
-- they're evaluated once per query instead of once per row.
-- ---------------------------------------------------------------------

alter policy sessions_manage on public.lesson_sessions
  using ((organization_id = (select public.current_organization_id())) and ((select public.is_admin()) or (teacher_profile_id = (select auth.uid()))))
  with check ((organization_id = (select public.current_organization_id())) and ((select public.is_admin()) or (teacher_profile_id = (select auth.uid()))));

alter policy sessions_select_scoped on public.lesson_sessions
  using ((organization_id = (select public.current_organization_id())) and ((select public.is_admin()) or (((select public.current_app_role()) = 'teacher'::public.app_role) and (teacher_profile_id = (select auth.uid())))));

alter policy comments_select on public.lesson_session_comments
  using ((organization_id = (select public.current_organization_id())) and ((select public.is_admin()) or (exists (
    select 1 from public.lesson_sessions ls
    where ls.id = lesson_session_comments.lesson_session_id
      and ls.teacher_profile_id = (select auth.uid())
  ))));

alter policy comments_insert on public.lesson_session_comments
  with check ((organization_id = (select public.current_organization_id())) and (author_profile_id = (select auth.uid())) and ((select public.is_admin()) or (exists (
    select 1 from public.lesson_sessions ls
    where ls.id = lesson_session_comments.lesson_session_id
      and ls.teacher_profile_id = (select auth.uid())
  ))));

alter policy profiles_select_scoped on public.profiles
  using ((organization_id = (select public.current_organization_id())) and ((select public.is_admin()) or (id = (select auth.uid()))));

alter policy groups_select_scoped on public.class_groups
  using ((organization_id = (select public.current_organization_id())) and ((select public.is_admin()) or (teacher_profile_id = (select auth.uid()))));

alter policy teacher_course_meb_authorizations_select on public.teacher_course_meb_authorizations
  using ((organization_id = (select public.current_organization_id())) and ((select public.is_admin()) or (teacher_profile_id = (select auth.uid()))));

alter policy enrollment_meb_registrations_select on public.enrollment_meb_registrations
  using ((organization_id = (select public.current_organization_id())) and ((select public.is_admin()) or (exists (
    select 1 from public.enrollments e
    left join public.class_groups cg on cg.id = e.class_group_id
    where e.id = enrollment_meb_registrations.enrollment_id
      and coalesce(e.teacher_profile_id, cg.teacher_profile_id) = (select auth.uid())
  ))));

alter policy makeup_credits_select on public.makeup_credits
  using ((organization_id = (select public.current_organization_id())) and ((select public.is_admin()) or (exists (
    select 1 from public.enrollments e
    left join public.class_groups cg on cg.id = e.class_group_id
    where e.id = makeup_credits.enrollment_id
      and coalesce(e.teacher_profile_id, cg.teacher_profile_id) = (select auth.uid())
  ))));

alter policy session_change_requests_select on public.session_change_requests
  using ((organization_id = (select public.current_organization_id())) and ((select public.is_admin()) or (requested_by = (select auth.uid())) or public.teacher_owns_session(lesson_session_id)));

alter policy teacher_compensation_rules_select on public.teacher_compensation_rules
  using ((organization_id = (select public.current_organization_id())) and ((teacher_profile_id = (select auth.uid())) or (select public.is_admin())));

alter policy teacher_work_logs_select on public.teacher_work_logs
  using ((organization_id = (select public.current_organization_id())) and ((teacher_profile_id = (select auth.uid())) or (select public.is_admin())));

-- ---------------------------------------------------------------------
-- 4. multiple_permissive_policies: split each admin-only ALL policy into
-- INSERT/UPDATE/DELETE-only policies so it no longer overlaps the table's
-- dedicated SELECT policy. Access is unchanged -- verified for each table
-- that the SELECT policy's condition already covers everything the ALL
-- policy granted for SELECT.
-- ---------------------------------------------------------------------

-- class_groups
drop policy groups_admin_manage on public.class_groups;
create policy groups_insert on public.class_groups for insert
  with check ((organization_id = (select public.current_organization_id())) and (select public.is_admin()));
create policy groups_update on public.class_groups for update
  using ((organization_id = (select public.current_organization_id())) and (select public.is_admin()))
  with check ((organization_id = (select public.current_organization_id())) and (select public.is_admin()));
create policy groups_delete on public.class_groups for delete
  using ((organization_id = (select public.current_organization_id())) and (select public.is_admin()));

-- courses
drop policy courses_admin_manage on public.courses;
create policy courses_insert on public.courses for insert
  with check ((organization_id = (select public.current_organization_id())) and (select public.is_admin()));
create policy courses_update on public.courses for update
  using ((organization_id = (select public.current_organization_id())) and (select public.is_admin()))
  with check ((organization_id = (select public.current_organization_id())) and (select public.is_admin()));
create policy courses_delete on public.courses for delete
  using ((organization_id = (select public.current_organization_id())) and (select public.is_admin()));

-- enrollment_meb_registrations
drop policy enrollment_meb_registrations_manage on public.enrollment_meb_registrations;
create policy enrollment_meb_registrations_insert on public.enrollment_meb_registrations for insert
  with check ((organization_id = (select public.current_organization_id())) and (select public.can_manage_finance()));
create policy enrollment_meb_registrations_update on public.enrollment_meb_registrations for update
  using ((organization_id = (select public.current_organization_id())) and (select public.can_manage_finance()))
  with check ((organization_id = (select public.current_organization_id())) and (select public.can_manage_finance()));
create policy enrollment_meb_registrations_delete on public.enrollment_meb_registrations for delete
  using ((organization_id = (select public.current_organization_id())) and (select public.can_manage_finance()));

-- enrollments
drop policy enrollments_manage_org on public.enrollments;
create policy enrollments_insert on public.enrollments for insert
  with check ((organization_id = (select public.current_organization_id())) and (select public.can_manage_finance()));
create policy enrollments_update on public.enrollments for update
  using ((organization_id = (select public.current_organization_id())) and (select public.can_manage_finance()))
  with check ((organization_id = (select public.current_organization_id())) and (select public.can_manage_finance()));
create policy enrollments_delete on public.enrollments for delete
  using ((organization_id = (select public.current_organization_id())) and (select public.can_manage_finance()));

-- guardians
drop policy guardians_manage_org on public.guardians;
create policy guardians_insert on public.guardians for insert
  with check ((organization_id = (select public.current_organization_id())) and (select public.can_manage_finance()));
create policy guardians_update on public.guardians for update
  using ((organization_id = (select public.current_organization_id())) and (select public.can_manage_finance()))
  with check ((organization_id = (select public.current_organization_id())) and (select public.can_manage_finance()));
create policy guardians_delete on public.guardians for delete
  using ((organization_id = (select public.current_organization_id())) and (select public.can_manage_finance()));

-- lesson_sessions (sessions_manage also allows a teacher to write their own
-- sessions, not just admins -- preserved exactly, just split by command)
drop policy sessions_manage on public.lesson_sessions;
create policy sessions_insert on public.lesson_sessions for insert
  with check ((organization_id = (select public.current_organization_id())) and ((select public.is_admin()) or (teacher_profile_id = (select auth.uid()))));
create policy sessions_update on public.lesson_sessions for update
  using ((organization_id = (select public.current_organization_id())) and ((select public.is_admin()) or (teacher_profile_id = (select auth.uid()))))
  with check ((organization_id = (select public.current_organization_id())) and ((select public.is_admin()) or (teacher_profile_id = (select auth.uid()))));
create policy sessions_delete on public.lesson_sessions for delete
  using ((organization_id = (select public.current_organization_id())) and ((select public.is_admin()) or (teacher_profile_id = (select auth.uid()))));

-- student_guardians
drop policy student_guardians_manage_org on public.student_guardians;
create policy student_guardians_insert on public.student_guardians for insert
  with check ((select public.can_manage_finance()) and (exists (
    select 1 from public.students s
    where s.id = student_guardians.student_id
      and s.organization_id = (select public.current_organization_id())
  )));
create policy student_guardians_update on public.student_guardians for update
  using ((select public.can_manage_finance()) and (exists (
    select 1 from public.students s
    where s.id = student_guardians.student_id
      and s.organization_id = (select public.current_organization_id())
  )))
  with check ((select public.can_manage_finance()) and (exists (
    select 1 from public.students s
    where s.id = student_guardians.student_id
      and s.organization_id = (select public.current_organization_id())
  )));
create policy student_guardians_delete on public.student_guardians for delete
  using ((select public.can_manage_finance()) and (exists (
    select 1 from public.students s
    where s.id = student_guardians.student_id
      and s.organization_id = (select public.current_organization_id())
  )));

-- students
drop policy students_manage_org on public.students;
create policy students_insert on public.students for insert
  with check ((organization_id = (select public.current_organization_id())) and (select public.can_manage_finance()));
create policy students_update on public.students for update
  using ((organization_id = (select public.current_organization_id())) and (select public.can_manage_finance()))
  with check ((organization_id = (select public.current_organization_id())) and (select public.can_manage_finance()));
create policy students_delete on public.students for delete
  using ((organization_id = (select public.current_organization_id())) and (select public.can_manage_finance()));

-- teacher_course_meb_authorizations
drop policy teacher_course_meb_authorizations_admin_manage on public.teacher_course_meb_authorizations;
create policy teacher_course_meb_authorizations_insert on public.teacher_course_meb_authorizations for insert
  with check ((organization_id = (select public.current_organization_id())) and (select public.is_admin()));
create policy teacher_course_meb_authorizations_update on public.teacher_course_meb_authorizations for update
  using ((organization_id = (select public.current_organization_id())) and (select public.is_admin()))
  with check ((organization_id = (select public.current_organization_id())) and (select public.is_admin()));
create policy teacher_course_meb_authorizations_delete on public.teacher_course_meb_authorizations for delete
  using ((organization_id = (select public.current_organization_id())) and (select public.is_admin()));

notify pgrst, 'reload schema';
