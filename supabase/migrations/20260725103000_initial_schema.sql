-- Eğitim Kurumu Yönetim Sistemi - başlangıç veritabanı
create extension if not exists pgcrypto;

create type public.app_role as enum ('admin', 'finance', 'teacher', 'viewer');
create type public.record_status as enum ('active', 'frozen', 'left', 'archived');
create type public.course_type as enum ('individual', 'group');
create type public.enrollment_status as enum ('active', 'frozen', 'cancelled', 'completed');
create type public.attendance_status as enum ('present', 'absent', 'excused', 'makeup_due', 'makeup_completed', 'institution_cancelled');
create type public.accrual_status as enum ('open', 'partial', 'paid', 'overdue', 'cancelled', 'refunded');
create type public.payment_method as enum ('cash', 'bank_transfer', 'card', 'online', 'other');
create type public.cash_movement_type as enum ('cash_in', 'cash_out', 'bank_deposit', 'correction');
create type public.expense_status as enum ('planned', 'paid', 'cancelled');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text,
  tax_number text,
  phone text,
  email text,
  timezone text not null default 'Europe/Istanbul',
  currency_code text not null default 'TRY',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  full_name text not null,
  role public.app_role not null default 'viewer',
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  birth_date date,
  registration_date date not null default current_date,
  status public.record_status not null default 'active',
  exit_date date,
  exit_reason text,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index students_org_status_idx on public.students (organization_id, status);
create index students_name_idx on public.students (organization_id, last_name, first_name);

create table public.guardians (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  full_name text not null,
  phone text not null,
  secondary_phone text,
  email text,
  invoice_title text,
  tax_or_identity_number text,
  invoice_address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.student_guardians (
  student_id uuid not null references public.students(id) on delete cascade,
  guardian_id uuid not null references public.guardians(id) on delete cascade,
  relationship text,
  is_primary boolean not null default false,
  may_receive_financial_messages boolean not null default true,
  primary key (student_id, guardian_id)
);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  code text,
  course_type public.course_type not null,
  default_duration_minutes integer not null default 60 check (default_duration_minutes between 15 and 480),
  default_monthly_fee numeric(12,2) not null default 0 check (default_monthly_fee >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table public.class_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  course_id uuid not null references public.courses(id),
  teacher_profile_id uuid references public.profiles(id),
  name text not null,
  room_name text,
  capacity integer check (capacity is null or capacity > 0),
  weekday smallint check (weekday between 1 and 7),
  start_time time,
  duration_minutes integer not null default 60 check (duration_minutes between 15 and 480),
  starts_on date,
  ends_on date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  student_id uuid not null references public.students(id),
  course_id uuid not null references public.courses(id),
  class_group_id uuid references public.class_groups(id),
  teacher_profile_id uuid references public.profiles(id),
  starts_on date not null,
  ends_on date,
  status public.enrollment_status not null default 'active',
  list_monthly_fee numeric(12,2) not null check (list_monthly_fee >= 0),
  discount_type text check (discount_type in ('none', 'percent', 'fixed')) default 'none',
  discount_value numeric(12,2) not null default 0 check (discount_value >= 0),
  net_monthly_fee numeric(12,2) not null check (net_monthly_fee >= 0),
  due_day smallint not null default 1 check (due_day between 1 and 28),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index enrollments_active_idx on public.enrollments (organization_id, status, course_id);

create table public.lesson_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  class_group_id uuid references public.class_groups(id),
  course_id uuid not null references public.courses(id),
  teacher_profile_id uuid references public.profiles(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  room_name text,
  is_makeup boolean not null default false,
  cancelled_at timestamptz,
  cancellation_reason text,
  teacher_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index lesson_sessions_date_idx on public.lesson_sessions (organization_id, starts_at);

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lesson_session_id uuid not null references public.lesson_sessions(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id),
  student_id uuid not null references public.students(id),
  status public.attendance_status not null,
  notified_at timestamptz,
  note text,
  marked_by uuid references public.profiles(id),
  marked_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lesson_session_id, student_id)
);

create table public.accruals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id),
  student_id uuid not null references public.students(id),
  period_start date not null,
  due_date date not null,
  description text not null,
  gross_amount numeric(12,2) not null check (gross_amount >= 0),
  discount_amount numeric(12,2) not null default 0 check (discount_amount >= 0),
  net_amount numeric(12,2) not null check (net_amount >= 0),
  allocated_amount numeric(12,2) not null default 0 check (allocated_amount >= 0),
  status public.accrual_status not null default 'open',
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (enrollment_id, period_start),
  check (allocated_amount <= net_amount)
);

create index accruals_due_idx on public.accruals (organization_id, status, due_date);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  student_id uuid not null references public.students(id),
  guardian_id uuid references public.guardians(id),
  received_at timestamptz not null default now(),
  amount numeric(12,2) not null check (amount > 0),
  method public.payment_method not null,
  reference_number text,
  note text,
  is_refunded boolean not null default false,
  recorded_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payments_date_idx on public.payments (organization_id, received_at);

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payment_id uuid not null references public.payments(id) on delete cascade,
  accrual_id uuid not null references public.accruals(id),
  amount numeric(12,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (payment_id, accrual_id)
);

create table public.cash_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  bank_name text not null,
  account_name text,
  iban text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  cash_account_id uuid not null references public.cash_accounts(id),
  movement_type public.cash_movement_type not null,
  amount numeric(12,2) not null check (amount > 0),
  occurred_at timestamptz not null default now(),
  payment_id uuid references public.payments(id),
  note text,
  recorded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.bank_deposits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  cash_account_id uuid not null references public.cash_accounts(id),
  bank_account_id uuid not null references public.bank_accounts(id),
  deposited_at timestamptz not null,
  amount numeric(12,2) not null check (amount > 0),
  receipt_path text,
  note text,
  deposited_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.bank_deposit_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  bank_deposit_id uuid not null references public.bank_deposits(id) on delete cascade,
  cash_movement_id uuid not null references public.cash_movements(id),
  amount numeric(12,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (bank_deposit_id, cash_movement_id)
);

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  is_direct_course_cost boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  category_id uuid not null references public.expense_categories(id),
  course_id uuid references public.courses(id),
  expense_date date not null,
  due_date date,
  paid_at timestamptz,
  amount numeric(12,2) not null check (amount > 0),
  status public.expense_status not null default 'planned',
  vendor_name text,
  payment_method public.payment_method,
  document_path text,
  note text,
  is_recurring boolean not null default false,
  recorded_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.teacher_work_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  teacher_profile_id uuid not null references public.profiles(id),
  lesson_session_id uuid references public.lesson_sessions(id),
  work_date date not null,
  minutes_worked integer not null check (minutes_worked > 0),
  unit_amount numeric(12,2) not null default 0 check (unit_amount >= 0),
  total_amount numeric(12,2) not null default 0 check (total_amount >= 0),
  approved_at timestamptz,
  approved_by uuid references public.profiles(id),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete cascade,
  actor_profile_id uuid references public.profiles(id),
  table_name text not null,
  record_id text,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

-- updated_at yardımcı fonksiyonu
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger organizations_set_updated_at before update on public.organizations for each row execute function public.set_updated_at();
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger students_set_updated_at before update on public.students for each row execute function public.set_updated_at();
create trigger guardians_set_updated_at before update on public.guardians for each row execute function public.set_updated_at();
create trigger courses_set_updated_at before update on public.courses for each row execute function public.set_updated_at();
create trigger class_groups_set_updated_at before update on public.class_groups for each row execute function public.set_updated_at();
create trigger enrollments_set_updated_at before update on public.enrollments for each row execute function public.set_updated_at();
create trigger lesson_sessions_set_updated_at before update on public.lesson_sessions for each row execute function public.set_updated_at();
create trigger attendance_set_updated_at before update on public.attendance for each row execute function public.set_updated_at();
create trigger accruals_set_updated_at before update on public.accruals for each row execute function public.set_updated_at();
create trigger payments_set_updated_at before update on public.payments for each row execute function public.set_updated_at();
create trigger expenses_set_updated_at before update on public.expenses for each row execute function public.set_updated_at();
create trigger teacher_work_logs_set_updated_at before update on public.teacher_work_logs for each row execute function public.set_updated_at();

-- Oturum kullanıcısının kurum ve rol bilgileri; RLS içinde recursion olmaması için security definer.
create or replace function public.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from public.profiles where id = auth.uid() and is_active = true
$$;

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and is_active = true
$$;

create or replace function public.can_manage_finance()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_app_role() in ('admin', 'finance'), false)
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_app_role() = 'admin', false)
$$;

-- RLS aktif et
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.students enable row level security;
alter table public.guardians enable row level security;
alter table public.student_guardians enable row level security;
alter table public.courses enable row level security;
alter table public.class_groups enable row level security;
alter table public.enrollments enable row level security;
alter table public.lesson_sessions enable row level security;
alter table public.attendance enable row level security;
alter table public.accruals enable row level security;
alter table public.payments enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.cash_accounts enable row level security;
alter table public.bank_accounts enable row level security;
alter table public.cash_movements enable row level security;
alter table public.bank_deposits enable row level security;
alter table public.bank_deposit_items enable row level security;
alter table public.expense_categories enable row level security;
alter table public.expenses enable row level security;
alter table public.teacher_work_logs enable row level security;
alter table public.audit_logs enable row level security;

-- Kurum ve profil erişimleri
create policy organizations_select_own on public.organizations for select to authenticated
using (id = public.current_organization_id());
create policy organizations_admin_update on public.organizations for update to authenticated
using (id = public.current_organization_id() and public.is_admin())
with check (id = public.current_organization_id() and public.is_admin());

create policy profiles_select_same_org on public.profiles for select to authenticated
using (organization_id = public.current_organization_id());
create policy profiles_update_self_or_admin on public.profiles for update to authenticated
using (organization_id = public.current_organization_id() and (id = auth.uid() or public.is_admin()))
with check (organization_id = public.current_organization_id() and (id = auth.uid() or public.is_admin()));
create policy profiles_admin_insert on public.profiles for insert to authenticated
with check (organization_id = public.current_organization_id() and public.is_admin());

-- Ana kayıtlar: aynı kurum okuyabilir; yalnızca admin/finance yönetebilir.
create policy students_select_org on public.students for select to authenticated using (organization_id = public.current_organization_id());
create policy students_manage_org on public.students for all to authenticated using (organization_id = public.current_organization_id() and public.can_manage_finance()) with check (organization_id = public.current_organization_id() and public.can_manage_finance());
create policy guardians_select_org on public.guardians for select to authenticated using (organization_id = public.current_organization_id());
create policy guardians_manage_org on public.guardians for all to authenticated using (organization_id = public.current_organization_id() and public.can_manage_finance()) with check (organization_id = public.current_organization_id() and public.can_manage_finance());
create policy courses_select_org on public.courses for select to authenticated using (organization_id = public.current_organization_id());
create policy courses_admin_manage on public.courses for all to authenticated using (organization_id = public.current_organization_id() and public.is_admin()) with check (organization_id = public.current_organization_id() and public.is_admin());
create policy groups_select_org on public.class_groups for select to authenticated using (organization_id = public.current_organization_id());
create policy groups_admin_manage on public.class_groups for all to authenticated using (organization_id = public.current_organization_id() and public.is_admin()) with check (organization_id = public.current_organization_id() and public.is_admin());
create policy enrollments_select_org on public.enrollments for select to authenticated using (organization_id = public.current_organization_id());
create policy enrollments_manage_org on public.enrollments for all to authenticated using (organization_id = public.current_organization_id() and public.can_manage_finance()) with check (organization_id = public.current_organization_id() and public.can_manage_finance());

-- Ders/yoklama: öğretmen kendi dersini, yönetim tümünü yönetebilir.
create policy sessions_select_org on public.lesson_sessions for select to authenticated
using (organization_id = public.current_organization_id());
create policy sessions_manage on public.lesson_sessions for all to authenticated
using (organization_id = public.current_organization_id() and (public.is_admin() or teacher_profile_id = auth.uid()))
with check (organization_id = public.current_organization_id() and (public.is_admin() or teacher_profile_id = auth.uid()));
create policy attendance_select_org on public.attendance for select to authenticated using (organization_id = public.current_organization_id());
create policy attendance_manage on public.attendance for all to authenticated
using (organization_id = public.current_organization_id() and public.current_app_role() in ('admin', 'teacher'))
with check (organization_id = public.current_organization_id() and public.current_app_role() in ('admin', 'teacher'));

-- Finans tabloları yalnızca admin/finance.
create policy accruals_finance on public.accruals for all to authenticated using (organization_id = public.current_organization_id() and public.can_manage_finance()) with check (organization_id = public.current_organization_id() and public.can_manage_finance());
create policy payments_finance on public.payments for all to authenticated using (organization_id = public.current_organization_id() and public.can_manage_finance()) with check (organization_id = public.current_organization_id() and public.can_manage_finance());
create policy allocations_finance on public.payment_allocations for all to authenticated using (organization_id = public.current_organization_id() and public.can_manage_finance()) with check (organization_id = public.current_organization_id() and public.can_manage_finance());
create policy cash_accounts_finance on public.cash_accounts for all to authenticated using (organization_id = public.current_organization_id() and public.can_manage_finance()) with check (organization_id = public.current_organization_id() and public.can_manage_finance());
create policy bank_accounts_finance on public.bank_accounts for all to authenticated using (organization_id = public.current_organization_id() and public.can_manage_finance()) with check (organization_id = public.current_organization_id() and public.can_manage_finance());
create policy cash_movements_finance on public.cash_movements for all to authenticated using (organization_id = public.current_organization_id() and public.can_manage_finance()) with check (organization_id = public.current_organization_id() and public.can_manage_finance());
create policy deposits_finance on public.bank_deposits for all to authenticated using (organization_id = public.current_organization_id() and public.can_manage_finance()) with check (organization_id = public.current_organization_id() and public.can_manage_finance());
create policy deposit_items_finance on public.bank_deposit_items for all to authenticated using (organization_id = public.current_organization_id() and public.can_manage_finance()) with check (organization_id = public.current_organization_id() and public.can_manage_finance());
create policy expense_categories_finance on public.expense_categories for all to authenticated using (organization_id = public.current_organization_id() and public.can_manage_finance()) with check (organization_id = public.current_organization_id() and public.can_manage_finance());
create policy expenses_finance on public.expenses for all to authenticated using (organization_id = public.current_organization_id() and public.can_manage_finance()) with check (organization_id = public.current_organization_id() and public.can_manage_finance());

-- Öğretmen çalışma kayıtları: kişi kendini görebilir, yönetim tümünü yönetebilir.
create policy work_logs_select on public.teacher_work_logs for select to authenticated
using (organization_id = public.current_organization_id() and (teacher_profile_id = auth.uid() or public.can_manage_finance()));
create policy work_logs_insert on public.teacher_work_logs for insert to authenticated
with check (organization_id = public.current_organization_id() and (teacher_profile_id = auth.uid() or public.is_admin()));
create policy work_logs_update on public.teacher_work_logs for update to authenticated
using (organization_id = public.current_organization_id() and (teacher_profile_id = auth.uid() or public.is_admin()))
with check (organization_id = public.current_organization_id() and (teacher_profile_id = auth.uid() or public.is_admin()));

create policy audit_logs_admin_select on public.audit_logs for select to authenticated
using (organization_id = public.current_organization_id() and public.is_admin());

-- student_guardians tablosunda organization_id olmadığı için öğrenci üzerinden kontrol.
create policy student_guardians_select_org on public.student_guardians for select to authenticated
using (exists (select 1 from public.students s where s.id = student_id and s.organization_id = public.current_organization_id()));
create policy student_guardians_manage_org on public.student_guardians for all to authenticated
using (public.can_manage_finance() and exists (select 1 from public.students s where s.id = student_id and s.organization_id = public.current_organization_id()))
with check (public.can_manage_finance() and exists (select 1 from public.students s where s.id = student_id and s.organization_id = public.current_organization_id()));
