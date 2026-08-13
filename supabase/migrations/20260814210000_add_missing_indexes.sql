-- Missing-index hardening.
--
-- Source of truth for this migration: `supabase db advisors --linked` (official
-- Supabase performance advisor) plus a manual trace of the app's real hot-path
-- queries (dashboard, ödemeler, yoklama, program, raporlar) against
-- `pg_indexes`. The advisor found 93 foreign keys with no covering index at
-- all; on top of that, several tables that ARE indexed are indexed on the
-- wrong leading column for what the app actually queries (e.g.
-- `expenses_org_status_date_idx` covers `expense_date`, but the cash-flow
-- report filters on `paid_at`; `accruals` had no index usable for the
-- `(organization_id, period_start)` filter used by the dashboard, ödemeler,
-- and raporlar screens; `enrollments` had nothing leading with
-- `class_group_id`, despite that being the join key for attendance roster,
-- mark_attendance, capacity checks, and makeup/reschedule conflict checks).
--
-- Section 1 below adds purpose-built composite indexes for those specific
-- hot paths. Section 2 adds the remaining plain single-column indexes for
-- FK columns (mostly audit-trail actor columns like recorded_by/approved_by)
-- that don't have a natural composite query pattern but still need a
-- covering index so parent-row deletes/updates and future per-actor lookups
-- don't force a sequential scan.

-- ---------------------------------------------------------------------
-- Section 1: composite indexes for real query patterns.
-- ---------------------------------------------------------------------

-- Dashboard, ödemeler (this month + monthly export), and raporlar (both
-- accrual report RPCs) all filter accruals by organization_id + period_start
-- equality/range, then narrow by status. The only existing accruals index
-- (accruals_due_idx) leads with status/due_date and doesn't serve this.
create index if not exists accruals_org_period_status_idx
  on public.accruals (organization_id, period_start, status);

-- The attendance roster RPC, mark_attendance, enrollment capacity checks,
-- makeup roster counts, and reschedule/makeup conflict checks all join
-- enrollments on class_group_id + status, filtered by the session date
-- against starts_on/ends_on. No existing index leads with class_group_id.
create index if not exists enrollments_class_group_status_idx
  on public.enrollments (class_group_id, status, starts_on, ends_on);

-- get_student_balances and find_student_enrollment_conflict both filter
-- enrollments by student_id + status; no existing index leads with student_id.
create index if not exists enrollments_student_status_idx
  on public.enrollments (student_id, status);

-- Scheduling-conflict-engine's teacher/room overlap checks
-- (describe_session_scheduling_conflict) scan active, non-cancelled
-- lesson_sessions for a teacher or room within a time range.
create index if not exists lesson_sessions_teacher_conflict_idx
  on public.lesson_sessions (organization_id, teacher_profile_id, starts_at, ends_at)
  where cancelled_at is null;
create index if not exists lesson_sessions_room_conflict_idx
  on public.lesson_sessions (organization_id, room_name, starts_at, ends_at)
  where cancelled_at is null and room_name is not null;

-- "Upcoming sessions for makeup" scans lesson_sessions by course_id with a
-- starts_at lower bound, excluding cancelled sessions.
create index if not exists lesson_sessions_course_upcoming_idx
  on public.lesson_sessions (course_id, starts_at)
  where cancelled_at is null;

-- get_dashboard_financial_summary's advance-balance subquery aggregates
-- payment_allocations with no organization bound at all today, relying only
-- on the outer join to payments to scope it; this at least lets it filter by
-- organization_id and payment_id directly instead of a full table scan.
create index if not exists payment_allocations_org_payment_idx
  on public.payment_allocations (organization_id, payment_id);

-- audit_logs had zero indexes beyond the primary key despite being written
-- by ~75+ RPC call sites and read via an admin-only, organization-scoped
-- RLS policy on every view.
create index if not exists audit_logs_org_created_idx
  on public.audit_logs (organization_id, created_at);

-- get_cash_flow_report_monthly/by_method filter expenses by
-- organization_id + status = 'paid' + paid_at range; the existing
-- expenses_org_status_date_idx covers expense_date, not paid_at.
create index if not exists expenses_org_paid_at_idx
  on public.expenses (organization_id, paid_at)
  where status = 'paid';

-- find_class_group_conflict scans active class_groups for the same
-- teacher/room within an org before allowing a new/updated class group.
create index if not exists class_groups_org_teacher_active_idx
  on public.class_groups (organization_id, teacher_profile_id, is_active);
create index if not exists class_groups_org_room_active_idx
  on public.class_groups (organization_id, room_name, is_active)
  where room_name is not null;

-- cash_movements is read on every kasa/banka screen load, filtered by
-- organization_id (via RLS) and ordered by occurred_at; only an index
-- leading with cash_account_id existed.
create index if not exists cash_movements_org_occurred_idx
  on public.cash_movements (organization_id, occurred_at);

-- describe_student_session_conflict falls back to checking whether a
-- makeup credit was already used for a given session.
create index if not exists makeup_credits_used_lesson_session_idx
  on public.makeup_credits (used_lesson_session_id);

-- ---------------------------------------------------------------------
-- Section 2: remaining FK-covering indexes flagged by the Supabase
-- performance advisor (unindexed_foreign_keys) that don't fit a composite
-- pattern above -- mostly "who did this" audit-trail columns.
-- ---------------------------------------------------------------------

create index if not exists accruals_student_id_idx on public.accruals (student_id);
create index if not exists attendance_enrollment_id_idx on public.attendance (enrollment_id);
create index if not exists attendance_marked_by_idx on public.attendance (marked_by);
create index if not exists attendance_organization_id_idx on public.attendance (organization_id);
create index if not exists attendance_student_id_idx on public.attendance (student_id);
create index if not exists audit_logs_actor_profile_id_idx on public.audit_logs (actor_profile_id);
create index if not exists automation_job_runs_triggered_by_profile_id_idx on public.automation_job_runs (triggered_by_profile_id);
create index if not exists bank_accounts_organization_id_idx on public.bank_accounts (organization_id);
create index if not exists bank_deposit_items_organization_id_idx on public.bank_deposit_items (organization_id);
create index if not exists bank_deposits_bank_account_id_idx on public.bank_deposits (bank_account_id);
create index if not exists bank_deposits_cash_account_id_idx on public.bank_deposits (cash_account_id);
create index if not exists bank_deposits_cash_movement_id_idx on public.bank_deposits (cash_movement_id);
create index if not exists bank_deposits_deposited_by_idx on public.bank_deposits (deposited_by);
create index if not exists bank_deposits_organization_id_idx on public.bank_deposits (organization_id);
create index if not exists cash_movements_payment_id_idx on public.cash_movements (payment_id);
create index if not exists cash_movements_recorded_by_idx on public.cash_movements (recorded_by);
create index if not exists cash_movements_reverses_movement_id_idx on public.cash_movements (reverses_movement_id);
create index if not exists class_groups_course_id_idx on public.class_groups (course_id);
create index if not exists courses_meb_checked_by_idx on public.courses (meb_checked_by);
create index if not exists courses_meb_responsible_profile_id_idx on public.courses (meb_responsible_profile_id);
create index if not exists delivery_attempts_attempted_by_idx on public.delivery_attempts (attempted_by);
create index if not exists delivery_attempts_organization_id_idx on public.delivery_attempts (organization_id);
create index if not exists enrollment_meb_registrations_checked_by_idx on public.enrollment_meb_registrations (checked_by);
create index if not exists enrollment_meb_registrations_course_id_idx on public.enrollment_meb_registrations (course_id);
create index if not exists enrollment_meb_registrations_responsible_profile_id_idx on public.enrollment_meb_registrations (responsible_profile_id);
create index if not exists enrollment_meb_registrations_student_id_idx on public.enrollment_meb_registrations (student_id);
create index if not exists enrollments_course_id_idx on public.enrollments (course_id);
create index if not exists enrollments_teacher_profile_id_idx on public.enrollments (teacher_profile_id);
create index if not exists expenses_cash_movement_id_idx on public.expenses (cash_movement_id);
create index if not exists expenses_category_id_idx on public.expenses (category_id);
create index if not exists expenses_recorded_by_idx on public.expenses (recorded_by);
create index if not exists lesson_session_comments_author_profile_id_idx on public.lesson_session_comments (author_profile_id);
create index if not exists lesson_session_comments_organization_id_idx on public.lesson_session_comments (organization_id);
create index if not exists lesson_sessions_attendance_locked_by_idx on public.lesson_sessions (attendance_locked_by);
create index if not exists lesson_sessions_class_group_id_idx on public.lesson_sessions (class_group_id);
create index if not exists lesson_sessions_course_id_idx on public.lesson_sessions (course_id);
create index if not exists makeup_credits_cancelled_by_idx on public.makeup_credits (cancelled_by);
create index if not exists makeup_credits_created_by_idx on public.makeup_credits (created_by);
create index if not exists makeup_credits_enrollment_id_idx on public.makeup_credits (enrollment_id);
create index if not exists makeup_credits_source_lesson_session_id_idx on public.makeup_credits (source_lesson_session_id);
create index if not exists outbound_messages_approved_by_idx on public.outbound_messages (approved_by);
create index if not exists outbound_messages_cancelled_by_idx on public.outbound_messages (cancelled_by);
create index if not exists outbound_messages_created_by_idx on public.outbound_messages (created_by);
create index if not exists outbound_messages_student_id_idx on public.outbound_messages (student_id);
create index if not exists outbound_messages_template_id_idx on public.outbound_messages (template_id);
create index if not exists payment_allocations_accrual_id_idx on public.payment_allocations (accrual_id);
create index if not exists payment_refund_allocations_organization_id_idx on public.payment_refund_allocations (organization_id);
create index if not exists payment_refunds_created_by_idx on public.payment_refunds (created_by);
create index if not exists payments_course_id_idx on public.payments (course_id);
create index if not exists payments_guardian_id_idx on public.payments (guardian_id);
create index if not exists payments_recorded_by_idx on public.payments (recorded_by);
create index if not exists payments_student_id_idx on public.payments (student_id);
create index if not exists profiles_organization_id_idx on public.profiles (organization_id);
create index if not exists prospect_course_interests_course_id_idx on public.prospect_course_interests (course_id);
create index if not exists prospects_assigned_profile_id_idx on public.prospects (assigned_profile_id);
create index if not exists prospects_converted_student_id_idx on public.prospects (converted_student_id);
create index if not exists prospects_created_by_idx on public.prospects (created_by);
create index if not exists prospects_trial_lesson_id_idx on public.prospects (trial_lesson_id);
create index if not exists recurring_expense_templates_category_id_idx on public.recurring_expense_templates (category_id);
create index if not exists recurring_expense_templates_course_id_idx on public.recurring_expense_templates (course_id);
create index if not exists recurring_expense_templates_organization_id_idx on public.recurring_expense_templates (organization_id);
create index if not exists session_change_requests_lesson_session_id_idx on public.session_change_requests (lesson_session_id);
create index if not exists session_change_requests_requested_by_idx on public.session_change_requests (requested_by);
create index if not exists session_change_requests_reviewed_by_idx on public.session_change_requests (reviewed_by);
create index if not exists student_guardians_guardian_id_idx on public.student_guardians (guardian_id);
create index if not exists student_registration_form_prints_printed_by_idx on public.student_registration_form_prints (printed_by);
create index if not exists student_registration_forms_enrollment_id_idx on public.student_registration_forms (enrollment_id);
create index if not exists student_registration_forms_generated_by_idx on public.student_registration_forms (generated_by);
create index if not exists student_registration_forms_organization_id_idx on public.student_registration_forms (organization_id);
create index if not exists students_created_by_idx on public.students (created_by);
create index if not exists teacher_compensation_rules_created_by_idx on public.teacher_compensation_rules (created_by);
create index if not exists teacher_compensation_rules_organization_id_idx on public.teacher_compensation_rules (organization_id);
create index if not exists teacher_course_meb_authorizations_checked_by_idx on public.teacher_course_meb_authorizations (checked_by);
create index if not exists teacher_course_meb_authorizations_course_id_idx on public.teacher_course_meb_authorizations (course_id);
create index if not exists teacher_course_meb_authorizations_responsible_profile_id_idx on public.teacher_course_meb_authorizations (responsible_profile_id);
create index if not exists teacher_course_meb_authorizations_teacher_profile_id_idx on public.teacher_course_meb_authorizations (teacher_profile_id);
create index if not exists teacher_work_logs_approved_by_idx on public.teacher_work_logs (approved_by);
create index if not exists teacher_work_logs_organization_id_idx on public.teacher_work_logs (organization_id);
create index if not exists teacher_work_logs_paid_by_idx on public.teacher_work_logs (paid_by);
create index if not exists teacher_work_logs_rule_id_idx on public.teacher_work_logs (rule_id);
create index if not exists waitlist_entries_converted_enrollment_id_idx on public.waitlist_entries (converted_enrollment_id);
create index if not exists waitlist_entries_course_id_idx on public.waitlist_entries (course_id);
create index if not exists waitlist_entries_created_by_idx on public.waitlist_entries (created_by);
create index if not exists waitlist_entries_prospect_id_idx on public.waitlist_entries (prospect_id);
create index if not exists waitlist_entries_student_id_idx on public.waitlist_entries (student_id);

-- ---------------------------------------------------------------------
-- audit_logs archival/partitioning: evaluated, not implemented here.
-- audit_logs is append-only and legally/compliance relevant (MEB, KVKK),
-- so a retention/delete policy would be wrong -- the write-side and RLS
-- design already assume every row is kept forever. Native Postgres
-- partitioning would require rebuilding the table (ALTER TABLE ... PARTITION
-- BY cannot be applied to an existing table in place) and is not justified
-- at the current data volume; the org+created_at index added above is the
-- right fix for today's query patterns. Revisit range-partitioning by
-- created_at (e.g. monthly) if/when audit_logs grows into the tens of
-- millions of rows and sequential-scan-free per-organization pruning from
-- partition elimination becomes worth the migration complexity.
-- ---------------------------------------------------------------------
