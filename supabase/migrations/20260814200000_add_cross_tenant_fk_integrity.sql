-- Cross-tenant referential integrity hardening.
--
-- Problem: every foreign key in this schema is a plain single-column FK
-- (e.g. payments.student_id references students(id)). Postgres only checks
-- that the referenced row exists, not that it belongs to the same
-- organization_id as the referencing row. Today the app-level SECURITY
-- DEFINER RPCs re-validate ownership before writing, but the schema itself
-- has no defense-in-depth: a bug in any future RPC, a direct service_role
-- write, or a missed check could silently link org A's payment to org B's
-- student with nothing to stop it.
--
-- Fix: convert every FK between two organization-scoped tables into a
-- composite FK that also pins organization_id, so a row can never
-- reference another organization's record at the database level. This is
-- the standard hardening pattern for row-level-security multi-tenant
-- Postgres schemas (composite FK, not a trigger), and is strictly safer
-- than the trigger/RPC-validation alternative: it can't be bypassed by an
-- RPC bug, it's enforced atomically at write time, and it doesn't need a
-- schema-aware read-then-check step.
--
-- Verified before writing this migration: a data audit of all 98
-- candidate relationships against the live database found zero existing
-- cross-tenant references, so every VALIDATE CONSTRAINT below is expected
-- to succeed immediately. NOT VALID + VALIDATE CONSTRAINT is used instead
-- of a plain ADD CONSTRAINT to avoid holding a long-lived exclusive lock
-- during the validation scan. Original ON DELETE/ON UPDATE actions are
-- preserved exactly where the existing constraint had one.
--
-- Two junction tables (student_guardians, prospect_course_interests) link
-- two organization-scoped entities but have no organization_id column of
-- their own, so the composite-FK pattern doesn't apply to them directly.
-- They get a small BEFORE INSERT/UPDATE trigger instead (the trigger/RPC
-- alternative, used only where composite FK doesn't fit).

-- ---------------------------------------------------------------------
-- Step 1: parent tables need UNIQUE(id, organization_id) so a composite
-- FK below can reference it. This is additional to the existing primary
-- key on id and does not change any existing behavior or query plan.
-- ---------------------------------------------------------------------
alter table public.accruals add constraint accruals_id_organization_id_key unique (id, organization_id);
alter table public.attendance add constraint attendance_id_organization_id_key unique (id, organization_id);
alter table public.bank_accounts add constraint bank_accounts_id_organization_id_key unique (id, organization_id);
alter table public.bank_deposits add constraint bank_deposits_id_organization_id_key unique (id, organization_id);
alter table public.cash_accounts add constraint cash_accounts_id_organization_id_key unique (id, organization_id);
alter table public.cash_movements add constraint cash_movements_id_organization_id_key unique (id, organization_id);
alter table public.class_groups add constraint class_groups_id_organization_id_key unique (id, organization_id);
alter table public.courses add constraint courses_id_organization_id_key unique (id, organization_id);
alter table public.enrollments add constraint enrollments_id_organization_id_key unique (id, organization_id);
alter table public.expense_categories add constraint expense_categories_id_organization_id_key unique (id, organization_id);
alter table public.guardians add constraint guardians_id_organization_id_key unique (id, organization_id);
alter table public.lesson_sessions add constraint lesson_sessions_id_organization_id_key unique (id, organization_id);
alter table public.message_templates add constraint message_templates_id_organization_id_key unique (id, organization_id);
alter table public.outbound_messages add constraint outbound_messages_id_organization_id_key unique (id, organization_id);
alter table public.payment_refunds add constraint payment_refunds_id_organization_id_key unique (id, organization_id);
alter table public.payments add constraint payments_id_organization_id_key unique (id, organization_id);
alter table public.profiles add constraint profiles_id_organization_id_key unique (id, organization_id);
alter table public.prospects add constraint prospects_id_organization_id_key unique (id, organization_id);
alter table public.recurring_expense_templates add constraint recurring_expense_templates_id_organization_id_key unique (id, organization_id);
alter table public.students add constraint students_id_organization_id_key unique (id, organization_id);
alter table public.teacher_compensation_rules add constraint teacher_compensation_rules_id_organization_id_key unique (id, organization_id);

-- ---------------------------------------------------------------------
-- Step 2: convert every child->parent FK between two organization-scoped
-- tables into a composite FK.
-- ---------------------------------------------------------------------

-- accruals
alter table public.accruals drop constraint accruals_enrollment_id_fkey;
alter table public.accruals add constraint accruals_enrollment_id_fkey foreign key (enrollment_id, organization_id) references public.enrollments (id, organization_id) not valid;
alter table public.accruals validate constraint accruals_enrollment_id_fkey;
alter table public.accruals drop constraint accruals_student_id_fkey;
alter table public.accruals add constraint accruals_student_id_fkey foreign key (student_id, organization_id) references public.students (id, organization_id) not valid;
alter table public.accruals validate constraint accruals_student_id_fkey;

-- attendance
alter table public.attendance drop constraint attendance_enrollment_id_fkey;
alter table public.attendance add constraint attendance_enrollment_id_fkey foreign key (enrollment_id, organization_id) references public.enrollments (id, organization_id) not valid;
alter table public.attendance validate constraint attendance_enrollment_id_fkey;
alter table public.attendance drop constraint attendance_lesson_session_id_fkey;
alter table public.attendance add constraint attendance_lesson_session_id_fkey foreign key (lesson_session_id, organization_id) references public.lesson_sessions (id, organization_id) on delete cascade not valid;
alter table public.attendance validate constraint attendance_lesson_session_id_fkey;
alter table public.attendance drop constraint attendance_marked_by_fkey;
alter table public.attendance add constraint attendance_marked_by_fkey foreign key (marked_by, organization_id) references public.profiles (id, organization_id) not valid;
alter table public.attendance validate constraint attendance_marked_by_fkey;
alter table public.attendance drop constraint attendance_student_id_fkey;
alter table public.attendance add constraint attendance_student_id_fkey foreign key (student_id, organization_id) references public.students (id, organization_id) not valid;
alter table public.attendance validate constraint attendance_student_id_fkey;

-- audit_logs
alter table public.audit_logs drop constraint audit_logs_actor_profile_id_fkey;
alter table public.audit_logs add constraint audit_logs_actor_profile_id_fkey foreign key (actor_profile_id, organization_id) references public.profiles (id, organization_id) not valid;
alter table public.audit_logs validate constraint audit_logs_actor_profile_id_fkey;

-- automation_job_runs
alter table public.automation_job_runs drop constraint automation_job_runs_triggered_by_profile_id_fkey;
alter table public.automation_job_runs add constraint automation_job_runs_triggered_by_profile_id_fkey foreign key (triggered_by_profile_id, organization_id) references public.profiles (id, organization_id) not valid;
alter table public.automation_job_runs validate constraint automation_job_runs_triggered_by_profile_id_fkey;

-- bank_deposit_items
alter table public.bank_deposit_items drop constraint bank_deposit_items_bank_deposit_id_fkey;
alter table public.bank_deposit_items add constraint bank_deposit_items_bank_deposit_id_fkey foreign key (bank_deposit_id, organization_id) references public.bank_deposits (id, organization_id) on delete cascade not valid;
alter table public.bank_deposit_items validate constraint bank_deposit_items_bank_deposit_id_fkey;
alter table public.bank_deposit_items drop constraint bank_deposit_items_cash_movement_id_fkey;
alter table public.bank_deposit_items add constraint bank_deposit_items_cash_movement_id_fkey foreign key (cash_movement_id, organization_id) references public.cash_movements (id, organization_id) not valid;
alter table public.bank_deposit_items validate constraint bank_deposit_items_cash_movement_id_fkey;

-- bank_deposits
alter table public.bank_deposits drop constraint bank_deposits_bank_account_id_fkey;
alter table public.bank_deposits add constraint bank_deposits_bank_account_id_fkey foreign key (bank_account_id, organization_id) references public.bank_accounts (id, organization_id) not valid;
alter table public.bank_deposits validate constraint bank_deposits_bank_account_id_fkey;
alter table public.bank_deposits drop constraint bank_deposits_cash_account_id_fkey;
alter table public.bank_deposits add constraint bank_deposits_cash_account_id_fkey foreign key (cash_account_id, organization_id) references public.cash_accounts (id, organization_id) not valid;
alter table public.bank_deposits validate constraint bank_deposits_cash_account_id_fkey;
alter table public.bank_deposits drop constraint bank_deposits_cash_movement_id_fkey;
alter table public.bank_deposits add constraint bank_deposits_cash_movement_id_fkey foreign key (cash_movement_id, organization_id) references public.cash_movements (id, organization_id) not valid;
alter table public.bank_deposits validate constraint bank_deposits_cash_movement_id_fkey;
alter table public.bank_deposits drop constraint bank_deposits_deposited_by_fkey;
alter table public.bank_deposits add constraint bank_deposits_deposited_by_fkey foreign key (deposited_by, organization_id) references public.profiles (id, organization_id) not valid;
alter table public.bank_deposits validate constraint bank_deposits_deposited_by_fkey;

-- cash_movements
alter table public.cash_movements drop constraint cash_movements_cash_account_id_fkey;
alter table public.cash_movements add constraint cash_movements_cash_account_id_fkey foreign key (cash_account_id, organization_id) references public.cash_accounts (id, organization_id) not valid;
alter table public.cash_movements validate constraint cash_movements_cash_account_id_fkey;
alter table public.cash_movements drop constraint cash_movements_payment_id_fkey;
alter table public.cash_movements add constraint cash_movements_payment_id_fkey foreign key (payment_id, organization_id) references public.payments (id, organization_id) not valid;
alter table public.cash_movements validate constraint cash_movements_payment_id_fkey;
alter table public.cash_movements drop constraint cash_movements_recorded_by_fkey;
alter table public.cash_movements add constraint cash_movements_recorded_by_fkey foreign key (recorded_by, organization_id) references public.profiles (id, organization_id) not valid;
alter table public.cash_movements validate constraint cash_movements_recorded_by_fkey;
alter table public.cash_movements drop constraint cash_movements_reverses_movement_id_fkey;
alter table public.cash_movements add constraint cash_movements_reverses_movement_id_fkey foreign key (reverses_movement_id, organization_id) references public.cash_movements (id, organization_id) not valid;
alter table public.cash_movements validate constraint cash_movements_reverses_movement_id_fkey;

-- class_groups
alter table public.class_groups drop constraint class_groups_course_id_fkey;
alter table public.class_groups add constraint class_groups_course_id_fkey foreign key (course_id, organization_id) references public.courses (id, organization_id) not valid;
alter table public.class_groups validate constraint class_groups_course_id_fkey;
alter table public.class_groups drop constraint class_groups_teacher_profile_id_fkey;
alter table public.class_groups add constraint class_groups_teacher_profile_id_fkey foreign key (teacher_profile_id, organization_id) references public.profiles (id, organization_id) not valid;
alter table public.class_groups validate constraint class_groups_teacher_profile_id_fkey;

-- courses
alter table public.courses drop constraint courses_meb_checked_by_fkey;
alter table public.courses add constraint courses_meb_checked_by_fkey foreign key (meb_checked_by, organization_id) references public.profiles (id, organization_id) not valid;
alter table public.courses validate constraint courses_meb_checked_by_fkey;
alter table public.courses drop constraint courses_meb_responsible_profile_id_fkey;
alter table public.courses add constraint courses_meb_responsible_profile_id_fkey foreign key (meb_responsible_profile_id, organization_id) references public.profiles (id, organization_id) not valid;
alter table public.courses validate constraint courses_meb_responsible_profile_id_fkey;

-- delivery_attempts
alter table public.delivery_attempts drop constraint delivery_attempts_attempted_by_fkey;
alter table public.delivery_attempts add constraint delivery_attempts_attempted_by_fkey foreign key (attempted_by, organization_id) references public.profiles (id, organization_id) not valid;
alter table public.delivery_attempts validate constraint delivery_attempts_attempted_by_fkey;
alter table public.delivery_attempts drop constraint delivery_attempts_message_id_fkey;
alter table public.delivery_attempts add constraint delivery_attempts_message_id_fkey foreign key (message_id, organization_id) references public.outbound_messages (id, organization_id) not valid;
alter table public.delivery_attempts validate constraint delivery_attempts_message_id_fkey;

-- enrollment_meb_registrations
alter table public.enrollment_meb_registrations drop constraint enrollment_meb_registrations_checked_by_fkey;
alter table public.enrollment_meb_registrations add constraint enrollment_meb_registrations_checked_by_fkey foreign key (checked_by, organization_id) references public.profiles (id, organization_id) not valid;
alter table public.enrollment_meb_registrations validate constraint enrollment_meb_registrations_checked_by_fkey;
alter table public.enrollment_meb_registrations drop constraint enrollment_meb_registrations_course_id_fkey;
alter table public.enrollment_meb_registrations add constraint enrollment_meb_registrations_course_id_fkey foreign key (course_id, organization_id) references public.courses (id, organization_id) on delete cascade not valid;
alter table public.enrollment_meb_registrations validate constraint enrollment_meb_registrations_course_id_fkey;
alter table public.enrollment_meb_registrations drop constraint enrollment_meb_registrations_enrollment_id_fkey;
alter table public.enrollment_meb_registrations add constraint enrollment_meb_registrations_enrollment_id_fkey foreign key (enrollment_id, organization_id) references public.enrollments (id, organization_id) on delete cascade not valid;
alter table public.enrollment_meb_registrations validate constraint enrollment_meb_registrations_enrollment_id_fkey;
alter table public.enrollment_meb_registrations drop constraint enrollment_meb_registrations_responsible_profile_id_fkey;
alter table public.enrollment_meb_registrations add constraint enrollment_meb_registrations_responsible_profile_id_fkey foreign key (responsible_profile_id, organization_id) references public.profiles (id, organization_id) not valid;
alter table public.enrollment_meb_registrations validate constraint enrollment_meb_registrations_responsible_profile_id_fkey;
alter table public.enrollment_meb_registrations drop constraint enrollment_meb_registrations_student_id_fkey;
alter table public.enrollment_meb_registrations add constraint enrollment_meb_registrations_student_id_fkey foreign key (student_id, organization_id) references public.students (id, organization_id) on delete cascade not valid;
alter table public.enrollment_meb_registrations validate constraint enrollment_meb_registrations_student_id_fkey;

-- enrollments
alter table public.enrollments drop constraint enrollments_class_group_id_fkey;
alter table public.enrollments add constraint enrollments_class_group_id_fkey foreign key (class_group_id, organization_id) references public.class_groups (id, organization_id) not valid;
alter table public.enrollments validate constraint enrollments_class_group_id_fkey;
alter table public.enrollments drop constraint enrollments_course_id_fkey;
alter table public.enrollments add constraint enrollments_course_id_fkey foreign key (course_id, organization_id) references public.courses (id, organization_id) not valid;
alter table public.enrollments validate constraint enrollments_course_id_fkey;
alter table public.enrollments drop constraint enrollments_student_id_fkey;
alter table public.enrollments add constraint enrollments_student_id_fkey foreign key (student_id, organization_id) references public.students (id, organization_id) not valid;
alter table public.enrollments validate constraint enrollments_student_id_fkey;
alter table public.enrollments drop constraint enrollments_teacher_profile_id_fkey;
alter table public.enrollments add constraint enrollments_teacher_profile_id_fkey foreign key (teacher_profile_id, organization_id) references public.profiles (id, organization_id) not valid;
alter table public.enrollments validate constraint enrollments_teacher_profile_id_fkey;

-- expenses
alter table public.expenses drop constraint expenses_cash_movement_id_fkey;
alter table public.expenses add constraint expenses_cash_movement_id_fkey foreign key (cash_movement_id, organization_id) references public.cash_movements (id, organization_id) not valid;
alter table public.expenses validate constraint expenses_cash_movement_id_fkey;
alter table public.expenses drop constraint expenses_category_id_fkey;
alter table public.expenses add constraint expenses_category_id_fkey foreign key (category_id, organization_id) references public.expense_categories (id, organization_id) not valid;
alter table public.expenses validate constraint expenses_category_id_fkey;
alter table public.expenses drop constraint expenses_course_id_fkey;
alter table public.expenses add constraint expenses_course_id_fkey foreign key (course_id, organization_id) references public.courses (id, organization_id) not valid;
alter table public.expenses validate constraint expenses_course_id_fkey;
alter table public.expenses drop constraint expenses_recorded_by_fkey;
alter table public.expenses add constraint expenses_recorded_by_fkey foreign key (recorded_by, organization_id) references public.profiles (id, organization_id) not valid;
alter table public.expenses validate constraint expenses_recorded_by_fkey;
alter table public.expenses drop constraint expenses_template_id_fkey;
alter table public.expenses add constraint expenses_template_id_fkey foreign key (template_id, organization_id) references public.recurring_expense_templates (id, organization_id) not valid;
alter table public.expenses validate constraint expenses_template_id_fkey;

-- lesson_session_comments
alter table public.lesson_session_comments drop constraint lesson_session_comments_author_profile_id_fkey;
alter table public.lesson_session_comments add constraint lesson_session_comments_author_profile_id_fkey foreign key (author_profile_id, organization_id) references public.profiles (id, organization_id) not valid;
alter table public.lesson_session_comments validate constraint lesson_session_comments_author_profile_id_fkey;
alter table public.lesson_session_comments drop constraint lesson_session_comments_lesson_session_id_fkey;
alter table public.lesson_session_comments add constraint lesson_session_comments_lesson_session_id_fkey foreign key (lesson_session_id, organization_id) references public.lesson_sessions (id, organization_id) on delete cascade not valid;
alter table public.lesson_session_comments validate constraint lesson_session_comments_lesson_session_id_fkey;

-- lesson_sessions
alter table public.lesson_sessions drop constraint lesson_sessions_attendance_locked_by_fkey;
alter table public.lesson_sessions add constraint lesson_sessions_attendance_locked_by_fkey foreign key (attendance_locked_by, organization_id) references public.profiles (id, organization_id) not valid;
alter table public.lesson_sessions validate constraint lesson_sessions_attendance_locked_by_fkey;
alter table public.lesson_sessions drop constraint lesson_sessions_class_group_id_fkey;
alter table public.lesson_sessions add constraint lesson_sessions_class_group_id_fkey foreign key (class_group_id, organization_id) references public.class_groups (id, organization_id) not valid;
alter table public.lesson_sessions validate constraint lesson_sessions_class_group_id_fkey;
alter table public.lesson_sessions drop constraint lesson_sessions_course_id_fkey;
alter table public.lesson_sessions add constraint lesson_sessions_course_id_fkey foreign key (course_id, organization_id) references public.courses (id, organization_id) not valid;
alter table public.lesson_sessions validate constraint lesson_sessions_course_id_fkey;
alter table public.lesson_sessions drop constraint lesson_sessions_prospect_id_fkey;
alter table public.lesson_sessions add constraint lesson_sessions_prospect_id_fkey foreign key (prospect_id, organization_id) references public.prospects (id, organization_id) not valid;
alter table public.lesson_sessions validate constraint lesson_sessions_prospect_id_fkey;
alter table public.lesson_sessions drop constraint lesson_sessions_teacher_profile_id_fkey;
alter table public.lesson_sessions add constraint lesson_sessions_teacher_profile_id_fkey foreign key (teacher_profile_id, organization_id) references public.profiles (id, organization_id) not valid;
alter table public.lesson_sessions validate constraint lesson_sessions_teacher_profile_id_fkey;

-- makeup_credits
alter table public.makeup_credits drop constraint makeup_credits_cancelled_by_fkey;
alter table public.makeup_credits add constraint makeup_credits_cancelled_by_fkey foreign key (cancelled_by, organization_id) references public.profiles (id, organization_id) not valid;
alter table public.makeup_credits validate constraint makeup_credits_cancelled_by_fkey;
alter table public.makeup_credits drop constraint makeup_credits_created_by_fkey;
alter table public.makeup_credits add constraint makeup_credits_created_by_fkey foreign key (created_by, organization_id) references public.profiles (id, organization_id) not valid;
alter table public.makeup_credits validate constraint makeup_credits_created_by_fkey;
alter table public.makeup_credits drop constraint makeup_credits_enrollment_id_fkey;
alter table public.makeup_credits add constraint makeup_credits_enrollment_id_fkey foreign key (enrollment_id, organization_id) references public.enrollments (id, organization_id) not valid;
alter table public.makeup_credits validate constraint makeup_credits_enrollment_id_fkey;
alter table public.makeup_credits drop constraint makeup_credits_source_attendance_id_fkey;
alter table public.makeup_credits add constraint makeup_credits_source_attendance_id_fkey foreign key (source_attendance_id, organization_id) references public.attendance (id, organization_id) not valid;
alter table public.makeup_credits validate constraint makeup_credits_source_attendance_id_fkey;
alter table public.makeup_credits drop constraint makeup_credits_source_lesson_session_id_fkey;
alter table public.makeup_credits add constraint makeup_credits_source_lesson_session_id_fkey foreign key (source_lesson_session_id, organization_id) references public.lesson_sessions (id, organization_id) not valid;
alter table public.makeup_credits validate constraint makeup_credits_source_lesson_session_id_fkey;
alter table public.makeup_credits drop constraint makeup_credits_student_id_fkey;
alter table public.makeup_credits add constraint makeup_credits_student_id_fkey foreign key (student_id, organization_id) references public.students (id, organization_id) not valid;
alter table public.makeup_credits validate constraint makeup_credits_student_id_fkey;
alter table public.makeup_credits drop constraint makeup_credits_used_lesson_session_id_fkey;
alter table public.makeup_credits add constraint makeup_credits_used_lesson_session_id_fkey foreign key (used_lesson_session_id, organization_id) references public.lesson_sessions (id, organization_id) not valid;
alter table public.makeup_credits validate constraint makeup_credits_used_lesson_session_id_fkey;

-- outbound_messages
alter table public.outbound_messages drop constraint outbound_messages_approved_by_fkey;
alter table public.outbound_messages add constraint outbound_messages_approved_by_fkey foreign key (approved_by, organization_id) references public.profiles (id, organization_id) not valid;
alter table public.outbound_messages validate constraint outbound_messages_approved_by_fkey;
alter table public.outbound_messages drop constraint outbound_messages_cancelled_by_fkey;
alter table public.outbound_messages add constraint outbound_messages_cancelled_by_fkey foreign key (cancelled_by, organization_id) references public.profiles (id, organization_id) not valid;
alter table public.outbound_messages validate constraint outbound_messages_cancelled_by_fkey;
alter table public.outbound_messages drop constraint outbound_messages_created_by_fkey;
alter table public.outbound_messages add constraint outbound_messages_created_by_fkey foreign key (created_by, organization_id) references public.profiles (id, organization_id) not valid;
alter table public.outbound_messages validate constraint outbound_messages_created_by_fkey;
alter table public.outbound_messages drop constraint outbound_messages_guardian_id_fkey;
alter table public.outbound_messages add constraint outbound_messages_guardian_id_fkey foreign key (guardian_id, organization_id) references public.guardians (id, organization_id) not valid;
alter table public.outbound_messages validate constraint outbound_messages_guardian_id_fkey;
alter table public.outbound_messages drop constraint outbound_messages_student_id_fkey;
alter table public.outbound_messages add constraint outbound_messages_student_id_fkey foreign key (student_id, organization_id) references public.students (id, organization_id) not valid;
alter table public.outbound_messages validate constraint outbound_messages_student_id_fkey;
alter table public.outbound_messages drop constraint outbound_messages_template_id_fkey;
alter table public.outbound_messages add constraint outbound_messages_template_id_fkey foreign key (template_id, organization_id) references public.message_templates (id, organization_id) on delete restrict not valid;
alter table public.outbound_messages validate constraint outbound_messages_template_id_fkey;

-- payment_allocations
alter table public.payment_allocations drop constraint payment_allocations_accrual_id_fkey;
alter table public.payment_allocations add constraint payment_allocations_accrual_id_fkey foreign key (accrual_id, organization_id) references public.accruals (id, organization_id) not valid;
alter table public.payment_allocations validate constraint payment_allocations_accrual_id_fkey;
alter table public.payment_allocations drop constraint payment_allocations_payment_id_fkey;
alter table public.payment_allocations add constraint payment_allocations_payment_id_fkey foreign key (payment_id, organization_id) references public.payments (id, organization_id) on delete cascade not valid;
alter table public.payment_allocations validate constraint payment_allocations_payment_id_fkey;

-- payment_refund_allocations
alter table public.payment_refund_allocations drop constraint payment_refund_allocations_accrual_id_fkey;
alter table public.payment_refund_allocations add constraint payment_refund_allocations_accrual_id_fkey foreign key (accrual_id, organization_id) references public.accruals (id, organization_id) not valid;
alter table public.payment_refund_allocations validate constraint payment_refund_allocations_accrual_id_fkey;
alter table public.payment_refund_allocations drop constraint payment_refund_allocations_refund_id_fkey;
alter table public.payment_refund_allocations add constraint payment_refund_allocations_refund_id_fkey foreign key (refund_id, organization_id) references public.payment_refunds (id, organization_id) not valid;
alter table public.payment_refund_allocations validate constraint payment_refund_allocations_refund_id_fkey;

-- payment_refunds
alter table public.payment_refunds drop constraint payment_refunds_created_by_fkey;
alter table public.payment_refunds add constraint payment_refunds_created_by_fkey foreign key (created_by, organization_id) references public.profiles (id, organization_id) not valid;
alter table public.payment_refunds validate constraint payment_refunds_created_by_fkey;
alter table public.payment_refunds drop constraint payment_refunds_payment_id_fkey;
alter table public.payment_refunds add constraint payment_refunds_payment_id_fkey foreign key (payment_id, organization_id) references public.payments (id, organization_id) not valid;
alter table public.payment_refunds validate constraint payment_refunds_payment_id_fkey;

-- payments
alter table public.payments drop constraint payments_course_id_fkey;
alter table public.payments add constraint payments_course_id_fkey foreign key (course_id, organization_id) references public.courses (id, organization_id) not valid;
alter table public.payments validate constraint payments_course_id_fkey;
alter table public.payments drop constraint payments_guardian_id_fkey;
alter table public.payments add constraint payments_guardian_id_fkey foreign key (guardian_id, organization_id) references public.guardians (id, organization_id) not valid;
alter table public.payments validate constraint payments_guardian_id_fkey;
alter table public.payments drop constraint payments_recorded_by_fkey;
alter table public.payments add constraint payments_recorded_by_fkey foreign key (recorded_by, organization_id) references public.profiles (id, organization_id) not valid;
alter table public.payments validate constraint payments_recorded_by_fkey;
alter table public.payments drop constraint payments_student_id_fkey;
alter table public.payments add constraint payments_student_id_fkey foreign key (student_id, organization_id) references public.students (id, organization_id) not valid;
alter table public.payments validate constraint payments_student_id_fkey;

-- prospects
alter table public.prospects drop constraint prospects_assigned_profile_id_fkey;
alter table public.prospects add constraint prospects_assigned_profile_id_fkey foreign key (assigned_profile_id, organization_id) references public.profiles (id, organization_id) not valid;
alter table public.prospects validate constraint prospects_assigned_profile_id_fkey;
alter table public.prospects drop constraint prospects_converted_student_id_fkey;
alter table public.prospects add constraint prospects_converted_student_id_fkey foreign key (converted_student_id, organization_id) references public.students (id, organization_id) not valid;
alter table public.prospects validate constraint prospects_converted_student_id_fkey;
alter table public.prospects drop constraint prospects_created_by_fkey;
alter table public.prospects add constraint prospects_created_by_fkey foreign key (created_by, organization_id) references public.profiles (id, organization_id) not valid;
alter table public.prospects validate constraint prospects_created_by_fkey;
alter table public.prospects drop constraint prospects_trial_lesson_id_fkey;
alter table public.prospects add constraint prospects_trial_lesson_id_fkey foreign key (trial_lesson_id, organization_id) references public.lesson_sessions (id, organization_id) not valid;
alter table public.prospects validate constraint prospects_trial_lesson_id_fkey;

-- recurring_expense_templates
alter table public.recurring_expense_templates drop constraint recurring_expense_templates_category_id_fkey;
alter table public.recurring_expense_templates add constraint recurring_expense_templates_category_id_fkey foreign key (category_id, organization_id) references public.expense_categories (id, organization_id) not valid;
alter table public.recurring_expense_templates validate constraint recurring_expense_templates_category_id_fkey;
alter table public.recurring_expense_templates drop constraint recurring_expense_templates_course_id_fkey;
alter table public.recurring_expense_templates add constraint recurring_expense_templates_course_id_fkey foreign key (course_id, organization_id) references public.courses (id, organization_id) not valid;
alter table public.recurring_expense_templates validate constraint recurring_expense_templates_course_id_fkey;

-- session_change_requests
alter table public.session_change_requests drop constraint session_change_requests_lesson_session_id_fkey;
alter table public.session_change_requests add constraint session_change_requests_lesson_session_id_fkey foreign key (lesson_session_id, organization_id) references public.lesson_sessions (id, organization_id) not valid;
alter table public.session_change_requests validate constraint session_change_requests_lesson_session_id_fkey;
alter table public.session_change_requests drop constraint session_change_requests_requested_by_fkey;
alter table public.session_change_requests add constraint session_change_requests_requested_by_fkey foreign key (requested_by, organization_id) references public.profiles (id, organization_id) not valid;
alter table public.session_change_requests validate constraint session_change_requests_requested_by_fkey;
alter table public.session_change_requests drop constraint session_change_requests_reviewed_by_fkey;
alter table public.session_change_requests add constraint session_change_requests_reviewed_by_fkey foreign key (reviewed_by, organization_id) references public.profiles (id, organization_id) not valid;
alter table public.session_change_requests validate constraint session_change_requests_reviewed_by_fkey;

-- student_registration_forms
alter table public.student_registration_forms drop constraint student_registration_forms_enrollment_id_fkey;
alter table public.student_registration_forms add constraint student_registration_forms_enrollment_id_fkey foreign key (enrollment_id, organization_id) references public.enrollments (id, organization_id) not valid;
alter table public.student_registration_forms validate constraint student_registration_forms_enrollment_id_fkey;
alter table public.student_registration_forms drop constraint student_registration_forms_generated_by_fkey;
alter table public.student_registration_forms add constraint student_registration_forms_generated_by_fkey foreign key (generated_by, organization_id) references public.profiles (id, organization_id) not valid;
alter table public.student_registration_forms validate constraint student_registration_forms_generated_by_fkey;
alter table public.student_registration_forms drop constraint student_registration_forms_student_id_fkey;
alter table public.student_registration_forms add constraint student_registration_forms_student_id_fkey foreign key (student_id, organization_id) references public.students (id, organization_id) on delete cascade not valid;
alter table public.student_registration_forms validate constraint student_registration_forms_student_id_fkey;

-- students
alter table public.students drop constraint students_created_by_fkey;
alter table public.students add constraint students_created_by_fkey foreign key (created_by, organization_id) references public.profiles (id, organization_id) not valid;
alter table public.students validate constraint students_created_by_fkey;

-- teacher_compensation_rules
alter table public.teacher_compensation_rules drop constraint teacher_compensation_rules_created_by_fkey;
alter table public.teacher_compensation_rules add constraint teacher_compensation_rules_created_by_fkey foreign key (created_by, organization_id) references public.profiles (id, organization_id) not valid;
alter table public.teacher_compensation_rules validate constraint teacher_compensation_rules_created_by_fkey;
alter table public.teacher_compensation_rules drop constraint teacher_compensation_rules_teacher_profile_id_fkey;
alter table public.teacher_compensation_rules add constraint teacher_compensation_rules_teacher_profile_id_fkey foreign key (teacher_profile_id, organization_id) references public.profiles (id, organization_id) not valid;
alter table public.teacher_compensation_rules validate constraint teacher_compensation_rules_teacher_profile_id_fkey;

-- teacher_course_meb_authorizations
alter table public.teacher_course_meb_authorizations drop constraint teacher_course_meb_authorizations_checked_by_fkey;
alter table public.teacher_course_meb_authorizations add constraint teacher_course_meb_authorizations_checked_by_fkey foreign key (checked_by, organization_id) references public.profiles (id, organization_id) not valid;
alter table public.teacher_course_meb_authorizations validate constraint teacher_course_meb_authorizations_checked_by_fkey;
alter table public.teacher_course_meb_authorizations drop constraint teacher_course_meb_authorizations_course_id_fkey;
alter table public.teacher_course_meb_authorizations add constraint teacher_course_meb_authorizations_course_id_fkey foreign key (course_id, organization_id) references public.courses (id, organization_id) on delete cascade not valid;
alter table public.teacher_course_meb_authorizations validate constraint teacher_course_meb_authorizations_course_id_fkey;
alter table public.teacher_course_meb_authorizations drop constraint teacher_course_meb_authorizations_responsible_profile_id_fkey;
alter table public.teacher_course_meb_authorizations add constraint teacher_course_meb_authorizations_responsible_profile_id_fkey foreign key (responsible_profile_id, organization_id) references public.profiles (id, organization_id) not valid;
alter table public.teacher_course_meb_authorizations validate constraint teacher_course_meb_authorizations_responsible_profile_id_fkey;
alter table public.teacher_course_meb_authorizations drop constraint teacher_course_meb_authorizations_teacher_profile_id_fkey;
alter table public.teacher_course_meb_authorizations add constraint teacher_course_meb_authorizations_teacher_profile_id_fkey foreign key (teacher_profile_id, organization_id) references public.profiles (id, organization_id) on delete cascade not valid;
alter table public.teacher_course_meb_authorizations validate constraint teacher_course_meb_authorizations_teacher_profile_id_fkey;

-- teacher_work_logs
alter table public.teacher_work_logs drop constraint teacher_work_logs_approved_by_fkey;
alter table public.teacher_work_logs add constraint teacher_work_logs_approved_by_fkey foreign key (approved_by, organization_id) references public.profiles (id, organization_id) not valid;
alter table public.teacher_work_logs validate constraint teacher_work_logs_approved_by_fkey;
alter table public.teacher_work_logs drop constraint teacher_work_logs_lesson_session_id_fkey;
alter table public.teacher_work_logs add constraint teacher_work_logs_lesson_session_id_fkey foreign key (lesson_session_id, organization_id) references public.lesson_sessions (id, organization_id) not valid;
alter table public.teacher_work_logs validate constraint teacher_work_logs_lesson_session_id_fkey;
alter table public.teacher_work_logs drop constraint teacher_work_logs_paid_by_fkey;
alter table public.teacher_work_logs add constraint teacher_work_logs_paid_by_fkey foreign key (paid_by, organization_id) references public.profiles (id, organization_id) not valid;
alter table public.teacher_work_logs validate constraint teacher_work_logs_paid_by_fkey;
alter table public.teacher_work_logs drop constraint teacher_work_logs_rule_id_fkey;
alter table public.teacher_work_logs add constraint teacher_work_logs_rule_id_fkey foreign key (rule_id, organization_id) references public.teacher_compensation_rules (id, organization_id) not valid;
alter table public.teacher_work_logs validate constraint teacher_work_logs_rule_id_fkey;
alter table public.teacher_work_logs drop constraint teacher_work_logs_teacher_profile_id_fkey;
alter table public.teacher_work_logs add constraint teacher_work_logs_teacher_profile_id_fkey foreign key (teacher_profile_id, organization_id) references public.profiles (id, organization_id) not valid;
alter table public.teacher_work_logs validate constraint teacher_work_logs_teacher_profile_id_fkey;

-- waitlist_entries
alter table public.waitlist_entries drop constraint waitlist_entries_class_group_id_fkey;
alter table public.waitlist_entries add constraint waitlist_entries_class_group_id_fkey foreign key (class_group_id, organization_id) references public.class_groups (id, organization_id) not valid;
alter table public.waitlist_entries validate constraint waitlist_entries_class_group_id_fkey;
alter table public.waitlist_entries drop constraint waitlist_entries_converted_enrollment_id_fkey;
alter table public.waitlist_entries add constraint waitlist_entries_converted_enrollment_id_fkey foreign key (converted_enrollment_id, organization_id) references public.enrollments (id, organization_id) not valid;
alter table public.waitlist_entries validate constraint waitlist_entries_converted_enrollment_id_fkey;
alter table public.waitlist_entries drop constraint waitlist_entries_course_id_fkey;
alter table public.waitlist_entries add constraint waitlist_entries_course_id_fkey foreign key (course_id, organization_id) references public.courses (id, organization_id) not valid;
alter table public.waitlist_entries validate constraint waitlist_entries_course_id_fkey;
alter table public.waitlist_entries drop constraint waitlist_entries_created_by_fkey;
alter table public.waitlist_entries add constraint waitlist_entries_created_by_fkey foreign key (created_by, organization_id) references public.profiles (id, organization_id) not valid;
alter table public.waitlist_entries validate constraint waitlist_entries_created_by_fkey;
alter table public.waitlist_entries drop constraint waitlist_entries_prospect_id_fkey;
alter table public.waitlist_entries add constraint waitlist_entries_prospect_id_fkey foreign key (prospect_id, organization_id) references public.prospects (id, organization_id) not valid;
alter table public.waitlist_entries validate constraint waitlist_entries_prospect_id_fkey;
alter table public.waitlist_entries drop constraint waitlist_entries_student_id_fkey;
alter table public.waitlist_entries add constraint waitlist_entries_student_id_fkey foreign key (student_id, organization_id) references public.students (id, organization_id) not valid;
alter table public.waitlist_entries validate constraint waitlist_entries_student_id_fkey;

-- ---------------------------------------------------------------------
-- Step 3: junction tables without their own organization_id column.
-- student_guardians links a student and a guardian; prospect_course_interests
-- links a prospect and a course. Neither has organization_id, so the
-- composite-FK approach above doesn't apply -- use a trigger instead to
-- guarantee both sides belong to the same organization.
-- ---------------------------------------------------------------------

create or replace function public.enforce_student_guardian_same_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_org uuid;
  v_guardian_org uuid;
begin
  select organization_id into v_student_org from public.students where id = new.student_id;
  select organization_id into v_guardian_org from public.guardians where id = new.guardian_id;

  if v_student_org is distinct from v_guardian_org then
    raise exception 'Öğrenci ve veli farklı kurumlara ait olamaz'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_student_guardian_same_organization() from public, anon, authenticated;

create trigger student_guardians_same_org_check
before insert or update of student_id, guardian_id on public.student_guardians
for each row execute function public.enforce_student_guardian_same_organization();

create or replace function public.enforce_prospect_course_interest_same_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prospect_org uuid;
  v_course_org uuid;
begin
  select organization_id into v_prospect_org from public.prospects where id = new.prospect_id;
  select organization_id into v_course_org from public.courses where id = new.course_id;

  if v_prospect_org is distinct from v_course_org then
    raise exception 'Aday öğrenci ve ders farklı kurumlara ait olamaz'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_prospect_course_interest_same_organization() from public, anon, authenticated;

create trigger prospect_course_interests_same_org_check
before insert or update of prospect_id, course_id on public.prospect_course_interests
for each row execute function public.enforce_prospect_course_interest_same_organization();

notify pgrst, 'reload schema';
