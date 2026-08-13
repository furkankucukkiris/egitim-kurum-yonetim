-- Resmî öğrenci kayıt/başvuru formu modülü.
--
-- Öğrenciye ait adres/acil durum/sağlık/onay alanları `students`
-- tablosuna eklenir (tablo zaten yalnızca admin'e açık RLS ile
-- korunuyor, bkz. 20260810150000). Kurumun onaylı kural/KVKK
-- metinleri ve MEB logosu `organizations`'a eklenir.
--
-- `student_registration_forms` her "form oluştur" çağrısında
-- ilgili anda geçerli olan tüm bilgiyi (ücret, adres, onay metinleri
-- dahil) satıra kopyalar (snapshot) — kaynak kayıtlar sonradan
-- değişse bile daha önce üretilmiş/imzalanmış form değişmez. Yeni
-- sürüm üretildiğinde önceki satır silinmez, yalnızca `is_current`
-- false yapılır; böylece sürüm ve yeniden basım geçmişi korunur.

-- =========================================================
-- 1. students: adres, acil durum, sağlık, onay alanları
-- =========================================================

alter table public.students
add column if not exists home_address text,
add column if not exists emergency_contact_name text,
add column if not exists emergency_contact_phone text,
add column if not exists health_notes text,
add column if not exists photo_video_consent text not null default 'izinsiz',
add column if not exists kvkk_consent_accepted boolean not null default false,
add column if not exists kvkk_consent_accepted_at timestamptz,
add column if not exists institution_rules_accepted boolean not null default false,
add column if not exists institution_rules_accepted_at timestamptz;

alter table public.students
add constraint students_photo_video_consent_check
check (photo_video_consent in ('izinli', 'sadece_kurum_ici', 'izinsiz'));

-- =========================================================
-- 2. organizations: onaylı şablon metinleri + MEB logosu
-- =========================================================

alter table public.organizations
add column if not exists registration_institution_rules_text text,
add column if not exists registration_kvkk_notice_text text,
add column if not exists meb_logo_path text;

-- =========================================================
-- 3. Form numarası sayacı
-- =========================================================

create sequence if not exists public.student_registration_form_number_seq;

-- =========================================================
-- 4. Snapshot tablosu
-- =========================================================

create table public.student_registration_forms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  enrollment_id uuid references public.enrollments(id),

  form_number text not null unique,
  version integer not null check (version > 0),
  is_current boolean not null default true,

  student_first_name text not null,
  student_last_name text not null,
  student_identity_number text,
  birth_date date,
  registration_date date,

  guardian_full_name text,
  guardian_identity_number text,
  guardian_relationship text,
  guardian_phone text,
  guardian_email text,

  home_address text,
  emergency_contact_name text,
  emergency_contact_phone text,
  health_notes text,

  course_name text,
  class_group_name text,
  starts_on date,

  list_monthly_fee numeric(12,2),
  discount_type text,
  discount_value numeric(12,2),
  net_monthly_fee numeric(12,2),
  due_day smallint,

  institution_rules_text text,
  institution_rules_accepted boolean not null default false,
  institution_rules_accepted_at timestamptz,

  kvkk_notice_text text,
  kvkk_consent_accepted boolean not null default false,
  kvkk_consent_accepted_at timestamptz,

  photo_video_consent text,

  generated_by uuid references public.profiles(id),
  generated_at timestamptz not null default now()
);

create index student_registration_forms_student_idx
on public.student_registration_forms (student_id, version desc);

create unique index student_registration_forms_current_unique
on public.student_registration_forms (student_id)
where is_current;

-- =========================================================
-- 5. Basım / yeniden basım geçmişi
-- =========================================================

create table public.student_registration_form_prints (
  id bigint generated always as identity primary key,
  form_id uuid not null references public.student_registration_forms(id) on delete cascade,
  printed_by uuid references public.profiles(id),
  printed_at timestamptz not null default now()
);

create index student_registration_form_prints_form_idx
on public.student_registration_form_prints (form_id, printed_at desc);

-- =========================================================
-- 6. RLS — yalnızca admin okuyabilir, teacher hiç erişemez.
--    Yazma yalnızca aşağıdaki security definer fonksiyonlar
--    üzerinden yapılır (bkz. create_student_with_guardian örüntüsü).
-- =========================================================

alter table public.student_registration_forms enable row level security;
alter table public.student_registration_form_prints enable row level security;

create policy student_registration_forms_admin_select
on public.student_registration_forms
for select
to authenticated
using (
  organization_id = public.current_organization_id()
  and public.is_admin()
);

create policy student_registration_form_prints_admin_select
on public.student_registration_form_prints
for select
to authenticated
using (
  exists (
    select 1
    from public.student_registration_forms f
    where f.id = form_id
      and f.organization_id = public.current_organization_id()
  )
  and public.is_admin()
);

-- =========================================================
-- 7. Form üretim fonksiyonu
-- =========================================================

create or replace function public.generate_student_registration_form(
  p_student_id uuid,
  p_enrollment_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_form_id uuid;
  v_version integer;
  v_form_number text;
  v_student public.students;
  v_org public.organizations;

  v_guardian_full_name text;
  v_guardian_identity_number text;
  v_guardian_relationship text;
  v_guardian_phone text;
  v_guardian_email text;

  v_course_name text;
  v_class_group_name text;
  v_starts_on date;
  v_list_monthly_fee numeric(12,2);
  v_discount_type text;
  v_discount_value numeric(12,2);
  v_net_monthly_fee numeric(12,2);
  v_due_day smallint;
begin
  v_organization_id := public.current_organization_id();

  if v_organization_id is null or not public.is_admin() then
    raise exception 'Resmî kayıt formu oluşturma yetkiniz bulunmuyor.';
  end if;

  select s.* into v_student
  from public.students s
  where s.id = p_student_id
    and s.organization_id = v_organization_id;

  if v_student.id is null then
    raise exception 'Öğrenci bulunamadı.';
  end if;

  select g.full_name, g.identity_number, g.phone, g.email, sg.relationship
  into v_guardian_full_name, v_guardian_identity_number, v_guardian_phone, v_guardian_email, v_guardian_relationship
  from public.student_guardians sg
  join public.guardians g on g.id = sg.guardian_id
  where sg.student_id = p_student_id
  order by sg.is_primary desc
  limit 1;

  if p_enrollment_id is not null then
    select c.name, cg.name, e.starts_on, e.list_monthly_fee, e.discount_type, e.discount_value, e.net_monthly_fee, e.due_day
    into v_course_name, v_class_group_name, v_starts_on, v_list_monthly_fee, v_discount_type, v_discount_value, v_net_monthly_fee, v_due_day
    from public.enrollments e
    join public.courses c on c.id = e.course_id
    left join public.class_groups cg on cg.id = e.class_group_id
    where e.id = p_enrollment_id
      and e.student_id = p_student_id
      and e.organization_id = v_organization_id;

    if v_course_name is null then
      raise exception 'Seçilen ders kaydı bulunamadı.';
    end if;
  end if;

  select o.* into v_org
  from public.organizations o
  where o.id = v_organization_id;

  select pg_catalog.coalesce(pg_catalog.max(version), 0) + 1 into v_version
  from public.student_registration_forms
  where student_id = p_student_id;

  v_form_number :=
    'KY-' || pg_catalog.to_char(pg_catalog.now(), 'YYYY') || '-' ||
    pg_catalog.lpad(pg_catalog.nextval('public.student_registration_form_number_seq')::text, 5, '0');

  update public.student_registration_forms
  set is_current = false
  where student_id = p_student_id
    and is_current = true;

  insert into public.student_registration_forms (
    organization_id, student_id, enrollment_id, form_number, version, is_current,
    student_first_name, student_last_name, student_identity_number, birth_date, registration_date,
    guardian_full_name, guardian_identity_number, guardian_relationship, guardian_phone, guardian_email,
    home_address, emergency_contact_name, emergency_contact_phone, health_notes,
    course_name, class_group_name, starts_on,
    list_monthly_fee, discount_type, discount_value, net_monthly_fee, due_day,
    institution_rules_text, institution_rules_accepted, institution_rules_accepted_at,
    kvkk_notice_text, kvkk_consent_accepted, kvkk_consent_accepted_at,
    photo_video_consent,
    generated_by
  )
  values (
    v_organization_id, p_student_id, p_enrollment_id, v_form_number, v_version, true,
    v_student.first_name, v_student.last_name, v_student.identity_number, v_student.birth_date, v_student.registration_date,
    v_guardian_full_name, v_guardian_identity_number, v_guardian_relationship, v_guardian_phone, v_guardian_email,
    v_student.home_address, v_student.emergency_contact_name, v_student.emergency_contact_phone, v_student.health_notes,
    v_course_name, v_class_group_name, v_starts_on,
    v_list_monthly_fee, v_discount_type, v_discount_value, v_net_monthly_fee, v_due_day,
    v_org.registration_institution_rules_text, v_student.institution_rules_accepted, v_student.institution_rules_accepted_at,
    v_org.registration_kvkk_notice_text, v_student.kvkk_consent_accepted, v_student.kvkk_consent_accepted_at,
    v_student.photo_video_consent,
    auth.uid()
  )
  returning id into v_form_id;

  return v_form_id;
end;
$$;

revoke all on function public.generate_student_registration_form(uuid, uuid) from public;
revoke all on function public.generate_student_registration_form(uuid, uuid) from anon;
grant execute on function public.generate_student_registration_form(uuid, uuid) to authenticated;

-- =========================================================
-- 8. Basım kaydı fonksiyonu
-- =========================================================

create or replace function public.log_registration_form_print(
  p_form_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Bu işlem için yetkiniz bulunmuyor.';
  end if;

  if not exists (
    select 1
    from public.student_registration_forms f
    where f.id = p_form_id
      and f.organization_id = public.current_organization_id()
  ) then
    raise exception 'Form bulunamadı.';
  end if;

  insert into public.student_registration_form_prints (form_id, printed_by)
  values (p_form_id, auth.uid());
end;
$$;

revoke all on function public.log_registration_form_print(uuid) from public;
revoke all on function public.log_registration_form_print(uuid) from anon;
grant execute on function public.log_registration_form_print(uuid) to authenticated;

notify pgrst, 'reload schema';
