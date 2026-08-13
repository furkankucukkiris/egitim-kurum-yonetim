-- MEB Yönetimi / MEB Yoklama'yı operasyonel bir takip sistemine dönüştürür:
-- her MEB satırına sorumlu kişi + otomatik "giderildi" damgası eklenir,
-- aylık defter hesaplaması öğrenci durumunu (arşiv/ayrılış) da hesaba
-- katar, ve tüm eksik/süresi yaklaşan kayıtları tek ekranda listeleyen
-- yeni bir RPC eklenir.

-- =========================================================
-- 1. Sorumlu kişi + giderildi alanları
-- =========================================================

alter table public.courses
add column if not exists meb_responsible_profile_id uuid references public.profiles(id),
add column if not exists meb_checked_at timestamptz,
add column if not exists meb_checked_by uuid references public.profiles(id),
add column if not exists meb_resolved_at timestamptz;

alter table public.teacher_course_meb_authorizations
add column if not exists responsible_profile_id uuid references public.profiles(id),
add column if not exists resolved_at timestamptz;

alter table public.enrollment_meb_registrations
add column if not exists responsible_profile_id uuid references public.profiles(id),
add column if not exists resolved_at timestamptz;

-- =========================================================
-- 2. set_course_meb_info — sorumlu kişi + checked/resolved damgası
-- =========================================================

-- Parametre eklemek Postgres'te "replace" değil yeni bir overload
-- oluşturur (bkz. record_payment_for_course örneği) — eski imzayı
-- açıkça düşürmek gerekiyor.
drop function if exists public.set_course_meb_info(uuid, text, text, text, text, date, date, text);

create or replace function public.set_course_meb_info(
  p_course_id uuid,
  p_status text,
  p_program_name text,
  p_program_code text,
  p_approval_number text,
  p_valid_from date,
  p_valid_until date,
  p_note text,
  p_responsible_profile_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();

  v_old_status text;
  v_old_resolved_at timestamptz;
  v_resolved_at timestamptz;

  v_old_data jsonb;
  v_new_data jsonb;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'MEB ders bilgilerini değiştirme yetkiniz bulunmuyor.';
  end if;

  if p_status not in ('approved', 'pending', 'not_registered', 'expired', 'unchecked') then
    raise exception 'Geçerli bir MEB ders durumu seçilmelidir.';
  end if;

  if p_valid_until is not null and p_valid_from is not null and p_valid_until < p_valid_from then
    raise exception 'Geçerlilik bitiş tarihi başlangıç tarihinden önce olamaz.';
  end if;

  if p_responsible_profile_id is not null and not exists (
    select 1 from public.profiles pr
    where pr.id = p_responsible_profile_id
      and pr.organization_id = v_organization_id
  ) then
    raise exception 'Sorumlu kişi bulunamadı.';
  end if;

  select
    c.meb_status,
    c.meb_resolved_at,
    pg_catalog.jsonb_build_object(
      'meb_status', c.meb_status,
      'meb_program_name', c.meb_program_name,
      'meb_program_code', c.meb_program_code,
      'meb_approval_number', c.meb_approval_number,
      'meb_valid_from', c.meb_valid_from,
      'meb_valid_until', c.meb_valid_until,
      'meb_note', c.meb_note,
      'meb_responsible_profile_id', c.meb_responsible_profile_id,
      'meb_resolved_at', c.meb_resolved_at
    )
  into v_old_status, v_old_resolved_at, v_old_data
  from public.courses c
  where c.id = p_course_id
    and c.organization_id = v_organization_id;

  if v_old_data is null then
    raise exception 'Ders kaydı bulunamadı.';
  end if;

  v_resolved_at := case
    when p_status = 'approved' and v_old_status is distinct from 'approved' then pg_catalog.now()
    when p_status = 'approved' then v_old_resolved_at
    else null
  end;

  update public.courses
  set
    meb_status = p_status,
    meb_program_name = nullif(pg_catalog.btrim(coalesce(p_program_name, '')), ''),
    meb_program_code = nullif(pg_catalog.btrim(coalesce(p_program_code, '')), ''),
    meb_approval_number = nullif(pg_catalog.btrim(coalesce(p_approval_number, '')), ''),
    meb_valid_from = p_valid_from,
    meb_valid_until = p_valid_until,
    meb_note = nullif(pg_catalog.btrim(coalesce(p_note, '')), ''),
    meb_responsible_profile_id = p_responsible_profile_id,
    meb_checked_at = pg_catalog.now(),
    meb_checked_by = v_user_id,
    meb_resolved_at = v_resolved_at
  where id = p_course_id
    and organization_id = v_organization_id;

  select pg_catalog.jsonb_build_object(
    'meb_status', p_status,
    'meb_program_name', nullif(pg_catalog.btrim(coalesce(p_program_name, '')), ''),
    'meb_program_code', nullif(pg_catalog.btrim(coalesce(p_program_code, '')), ''),
    'meb_approval_number', nullif(pg_catalog.btrim(coalesce(p_approval_number, '')), ''),
    'meb_valid_from', p_valid_from,
    'meb_valid_until', p_valid_until,
    'meb_note', nullif(pg_catalog.btrim(coalesce(p_note, '')), ''),
    'meb_responsible_profile_id', p_responsible_profile_id,
    'meb_resolved_at', v_resolved_at
  )
  into v_new_data;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'courses', p_course_id::text, 'set_meb_info', v_old_data, v_new_data
  );
end;
$$;

revoke all on function public.set_course_meb_info(uuid, text, text, text, text, date, date, text, uuid) from public;
revoke all on function public.set_course_meb_info(uuid, text, text, text, text, date, date, text, uuid) from anon;
grant execute on function public.set_course_meb_info(uuid, text, text, text, text, date, date, text, uuid) to authenticated;

-- =========================================================
-- 3. set_teacher_course_meb_authorization — sorumlu kişi + resolved
-- =========================================================

drop function if exists public.set_teacher_course_meb_authorization(uuid, uuid, text, text, date, date, text);

create or replace function public.set_teacher_course_meb_authorization(
  p_teacher_profile_id uuid,
  p_course_id uuid,
  p_status text,
  p_document_number text,
  p_valid_from date,
  p_valid_until date,
  p_note text,
  p_responsible_profile_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();

  v_authorization_id uuid;
  v_old_data jsonb;
  v_old_status text;
  v_old_resolved_at timestamptz;
  v_resolved_at timestamptz;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Öğretmen MEB yetkisini değiştirme yetkiniz bulunmuyor.';
  end if;

  if p_status not in ('approved', 'pending', 'not_registered', 'expired', 'unchecked') then
    raise exception 'Geçerli bir öğretmen MEB durumu seçilmelidir.';
  end if;

  if p_valid_until is not null and p_valid_from is not null and p_valid_until < p_valid_from then
    raise exception 'Geçerlilik bitiş tarihi başlangıç tarihinden önce olamaz.';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = p_teacher_profile_id
      and p.organization_id = v_organization_id
      and p.role in ('teacher'::public.app_role, 'admin'::public.app_role)
  ) then
    raise exception 'Öğretmen kaydı bulunamadı.';
  end if;

  if not exists (
    select 1 from public.courses c
    where c.id = p_course_id
      and c.organization_id = v_organization_id
  ) then
    raise exception 'Ders kaydı bulunamadı.';
  end if;

  if p_responsible_profile_id is not null and not exists (
    select 1 from public.profiles pr
    where pr.id = p_responsible_profile_id
      and pr.organization_id = v_organization_id
  ) then
    raise exception 'Sorumlu kişi bulunamadı.';
  end if;

  select pg_catalog.to_jsonb(a)
  into v_old_data
  from public.teacher_course_meb_authorizations a
  where a.organization_id = v_organization_id
    and a.teacher_profile_id = p_teacher_profile_id
    and a.course_id = p_course_id;

  v_old_status := v_old_data->>'status';
  v_old_resolved_at := (v_old_data->>'resolved_at')::timestamptz;

  v_resolved_at := case
    when p_status = 'approved' and v_old_status is distinct from 'approved' then pg_catalog.now()
    when p_status = 'approved' then v_old_resolved_at
    else null
  end;

  insert into public.teacher_course_meb_authorizations (
    organization_id, teacher_profile_id, course_id, status, document_number,
    valid_from, valid_until, note, checked_at, checked_by,
    responsible_profile_id, resolved_at
  )
  values (
    v_organization_id, p_teacher_profile_id, p_course_id, p_status,
    nullif(pg_catalog.btrim(coalesce(p_document_number, '')), ''),
    p_valid_from, p_valid_until,
    nullif(pg_catalog.btrim(coalesce(p_note, '')), ''),
    pg_catalog.now(), v_user_id,
    p_responsible_profile_id, v_resolved_at
  )
  on conflict (organization_id, teacher_profile_id, course_id)
  do update set
    status = excluded.status,
    document_number = excluded.document_number,
    valid_from = excluded.valid_from,
    valid_until = excluded.valid_until,
    note = excluded.note,
    checked_at = excluded.checked_at,
    checked_by = excluded.checked_by,
    responsible_profile_id = excluded.responsible_profile_id,
    resolved_at = excluded.resolved_at
  returning id into v_authorization_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  select
    v_organization_id, v_user_id, 'teacher_course_meb_authorizations', v_authorization_id::text,
    'upsert', v_old_data, pg_catalog.to_jsonb(a)
  from public.teacher_course_meb_authorizations a
  where a.id = v_authorization_id;

  return v_authorization_id;
end;
$$;

revoke all on function public.set_teacher_course_meb_authorization(uuid, uuid, text, text, date, date, text, uuid) from public;
revoke all on function public.set_teacher_course_meb_authorization(uuid, uuid, text, text, date, date, text, uuid) from anon;
grant execute on function public.set_teacher_course_meb_authorization(uuid, uuid, text, text, date, date, text, uuid) to authenticated;

-- =========================================================
-- 4. set_enrollment_meb_registration — sorumlu kişi + resolved
-- =========================================================

drop function if exists public.set_enrollment_meb_registration(uuid, text, text, date, date, text, text);

create or replace function public.set_enrollment_meb_registration(
  p_enrollment_id uuid,
  p_status text,
  p_registration_number text,
  p_valid_from date,
  p_valid_until date,
  p_non_registration_reason text,
  p_note text,
  p_responsible_profile_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();

  v_registration_id uuid;
  v_student_id uuid;
  v_course_id uuid;
  v_old_data jsonb;
  v_old_status text;
  v_old_resolved_at timestamptz;
  v_resolved_at timestamptz;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.can_manage_finance() then
    raise exception 'Öğrenci MEB kaydını değiştirme yetkiniz bulunmuyor.';
  end if;

  if p_status not in ('registered', 'pending', 'not_registered', 'not_eligible', 'rejected', 'ended', 'unchecked') then
    raise exception 'Geçerli bir öğrenci MEB durumu seçilmelidir.';
  end if;

  if p_valid_until is not null and p_valid_from is not null and p_valid_until < p_valid_from then
    raise exception 'Geçerlilik bitiş tarihi başlangıç tarihinden önce olamaz.';
  end if;

  if p_responsible_profile_id is not null and not exists (
    select 1 from public.profiles pr
    where pr.id = p_responsible_profile_id
      and pr.organization_id = v_organization_id
  ) then
    raise exception 'Sorumlu kişi bulunamadı.';
  end if;

  select e.student_id, e.course_id
  into v_student_id, v_course_id
  from public.enrollments e
  where e.id = p_enrollment_id
    and e.organization_id = v_organization_id;

  if v_student_id is null then
    raise exception 'Öğrenci ders kaydı bulunamadı.';
  end if;

  select pg_catalog.to_jsonb(r)
  into v_old_data
  from public.enrollment_meb_registrations r
  where r.enrollment_id = p_enrollment_id;

  v_old_status := v_old_data->>'status';
  v_old_resolved_at := (v_old_data->>'resolved_at')::timestamptz;

  v_resolved_at := case
    when p_status = 'registered' and v_old_status is distinct from 'registered' then pg_catalog.now()
    when p_status = 'registered' then v_old_resolved_at
    else null
  end;

  insert into public.enrollment_meb_registrations (
    organization_id, enrollment_id, student_id, course_id, status,
    registration_number, valid_from, valid_until, non_registration_reason, note,
    checked_at, checked_by, responsible_profile_id, resolved_at
  )
  values (
    v_organization_id, p_enrollment_id, v_student_id, v_course_id, p_status,
    nullif(pg_catalog.btrim(coalesce(p_registration_number, '')), ''),
    p_valid_from, p_valid_until,
    nullif(pg_catalog.btrim(coalesce(p_non_registration_reason, '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_note, '')), ''),
    pg_catalog.now(), v_user_id, p_responsible_profile_id, v_resolved_at
  )
  on conflict (enrollment_id)
  do update set
    status = excluded.status,
    registration_number = excluded.registration_number,
    valid_from = excluded.valid_from,
    valid_until = excluded.valid_until,
    non_registration_reason = excluded.non_registration_reason,
    note = excluded.note,
    checked_at = excluded.checked_at,
    checked_by = excluded.checked_by,
    responsible_profile_id = excluded.responsible_profile_id,
    resolved_at = excluded.resolved_at
  returning id into v_registration_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  select
    v_organization_id, v_user_id, 'enrollment_meb_registrations', v_registration_id::text,
    'upsert', v_old_data, pg_catalog.to_jsonb(r)
  from public.enrollment_meb_registrations r
  where r.id = v_registration_id;

  return v_registration_id;
end;
$$;

revoke all on function public.set_enrollment_meb_registration(uuid, text, text, date, date, text, text, uuid) from public;
revoke all on function public.set_enrollment_meb_registration(uuid, text, text, date, date, text, text, uuid) from anon;
grant execute on function public.set_enrollment_meb_registration(uuid, text, text, date, date, text, text, uuid) to authenticated;

-- =========================================================
-- 5. get_meb_monthly_roster — öğrenci durumu (arşiv/ayrılış) da kontrol edilir
-- =========================================================

create or replace function public.get_meb_monthly_roster(
  p_month_start date
)
returns table (
  enrollment_id uuid,
  student_id uuid,
  student_full_name text,

  course_id uuid,
  course_name text,

  class_group_id uuid,
  class_group_name text,
  weekday integer,
  start_time time,

  teacher_profile_id uuid,
  teacher_full_name text,

  enrollment_status text,

  course_meb_status text,
  teacher_meb_status text,
  student_meb_status text,

  student_meb_valid_from date,
  student_meb_valid_until date,

  compliance_status text,
  include_in_meb_register boolean,
  compliance_reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_role public.app_role := public.current_app_role();

  v_month_start date := pg_catalog.date_trunc('month', p_month_start::timestamp)::date;
  v_month_end date := (pg_catalog.date_trunc('month', p_month_start::timestamp) + interval '1 month' - interval '1 day')::date;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if v_role not in ('admin'::public.app_role, 'finance'::public.app_role, 'teacher'::public.app_role) then
    raise exception 'MEB yoklama listesini görüntüleme yetkiniz bulunmuyor.';
  end if;

  return query
  with roster as (
    select
      e.id as enrollment_id,
      s.id as student_id,
      s.first_name || ' ' || s.last_name as student_full_name,

      c.id as course_id,
      c.name as course_name,

      cg.id as class_group_id,
      cg.name as class_group_name,
      cg.weekday::integer as weekday,
      cg.start_time,

      coalesce(e.teacher_profile_id, cg.teacher_profile_id) as teacher_profile_id,
      p.full_name as teacher_full_name,

      e.status::text as enrollment_status,

      c.meb_status as course_meb_status,
      coalesce(ta.status, 'unchecked') as teacher_meb_status,
      coalesce(emr.status, 'unchecked') as student_meb_status,

      emr.valid_from as student_meb_valid_from,
      emr.valid_until as student_meb_valid_until,

      s.status as student_status,

      (
        e.status = 'active'::public.enrollment_status
        and s.status = 'active'::public.record_status
        and e.starts_on <= v_month_end
        and (e.ends_on is null or e.ends_on >= v_month_start)
      ) as enrollment_active,

      (
        c.meb_status = 'approved'
        and (c.meb_valid_from is null or c.meb_valid_from <= v_month_end)
        and (c.meb_valid_until is null or c.meb_valid_until >= v_month_start)
      ) as course_ok,

      (
        coalesce(ta.status, 'unchecked') = 'approved'
        and (ta.valid_from is null or ta.valid_from <= v_month_end)
        and (ta.valid_until is null or ta.valid_until >= v_month_start)
      ) as teacher_ok,

      (
        coalesce(emr.status, 'unchecked') = 'registered'
        and (emr.valid_from is null or emr.valid_from <= v_month_end)
        and (emr.valid_until is null or emr.valid_until >= v_month_start)
      ) as student_ok

    from public.enrollments e
    inner join public.students s on s.id = e.student_id
    inner join public.courses c on c.id = e.course_id
    left join public.class_groups cg on cg.id = e.class_group_id
    left join public.profiles p on p.id = coalesce(e.teacher_profile_id, cg.teacher_profile_id)
    left join public.teacher_course_meb_authorizations ta
      on ta.organization_id = e.organization_id
      and ta.course_id = e.course_id
      and ta.teacher_profile_id = coalesce(e.teacher_profile_id, cg.teacher_profile_id)
    left join public.enrollment_meb_registrations emr on emr.enrollment_id = e.id

    where e.organization_id = v_organization_id
      and e.starts_on <= v_month_end
      and (e.ends_on is null or e.ends_on >= v_month_start)
      and (
        v_role in ('admin'::public.app_role, 'finance'::public.app_role)
        or coalesce(e.teacher_profile_id, cg.teacher_profile_id) = v_user_id
      )
  )

  select
    r.enrollment_id,
    r.student_id,
    r.student_full_name,

    r.course_id,
    r.course_name,

    r.class_group_id,
    r.class_group_name,
    r.weekday,
    r.start_time,

    r.teacher_profile_id,
    r.teacher_full_name,

    r.enrollment_status,

    r.course_meb_status,
    r.teacher_meb_status,
    r.student_meb_status,

    r.student_meb_valid_from,
    r.student_meb_valid_until,

    case
      when r.enrollment_active and r.course_ok and r.teacher_ok and r.student_ok
      then 'compliant'

      when
        r.course_meb_status in ('not_registered', 'expired')
        or r.teacher_profile_id is null
        or r.teacher_meb_status in ('not_registered', 'expired')
        or r.student_meb_status in ('not_registered', 'not_eligible', 'rejected', 'ended')
        or not r.enrollment_active
      then 'non_compliant'

      else 'pending'
    end as compliance_status,

    (r.enrollment_active and r.course_ok and r.teacher_ok and r.student_ok) as include_in_meb_register,

    pg_catalog.concat_ws(
      '; ',

      case
        when r.student_status <> 'active'::public.record_status
        then 'Öğrenci aktif değil (dondurulmuş/ayrılmış/arşivlenmiş)'
      end,

      case
        when r.student_status = 'active'::public.record_status and not r.enrollment_active
        then 'Kurum içi ders kaydı bu ay aktif değil'
      end,

      case
        when not r.course_ok
        then 'Dersin MEB kaydı uygun değil'
      end,

      case
        when r.teacher_profile_id is null
        then 'Derse öğretmen atanmamış'
      end,

      case
        when r.teacher_profile_id is not null and not r.teacher_ok
        then 'Öğretmenin bu ders için MEB çalışma izni uygun değil'
      end,

      case
        when not r.student_ok
        then 'Öğrencinin bu ders için MEB kaydı uygun değil'
      end
    ) as compliance_reason

  from roster r
  order by r.weekday, r.start_time, r.course_name, r.student_full_name;
end;
$$;

-- =========================================================
-- 6. get_meb_deficiencies — ay bağımsız, tek ekranda eksik/süre takibi
-- =========================================================

create or replace function public.get_meb_deficiencies()
returns table (
  entity_type text,
  entity_id uuid,
  display_label text,
  status text,
  valid_from date,
  valid_until date,
  reason text,
  responsible_profile_id uuid,
  responsible_name text,
  checked_at timestamptz,
  checked_by_name text,
  resolved_at timestamptz,
  is_deficient boolean,
  is_expiring_soon boolean,
  is_expired boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid := public.current_organization_id();
  v_today date := (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
begin
  if v_organization_id is null or not public.is_admin() then
    raise exception 'MEB eksik listesini görüntüleme yetkiniz bulunmuyor.';
  end if;

  return query
  select
    'course'::text,
    c.id,
    c.name,
    c.meb_status,
    c.meb_valid_from,
    c.meb_valid_until,
    c.meb_note,
    c.meb_responsible_profile_id,
    rp.full_name,
    c.meb_checked_at,
    cb.full_name,
    c.meb_resolved_at,
    (c.meb_status <> 'approved'),
    (c.meb_status = 'approved' and c.meb_valid_until is not null and c.meb_valid_until >= v_today and c.meb_valid_until <= v_today + 30),
    (c.meb_valid_until is not null and c.meb_valid_until < v_today)
  from public.courses c
  left join public.profiles rp on rp.id = c.meb_responsible_profile_id
  left join public.profiles cb on cb.id = c.meb_checked_by
  where c.organization_id = v_organization_id
    and c.is_active = true

  union all

  select
    'teacher_course'::text,
    a.id,
    coalesce(tp.full_name, 'Öğretmen') || ' — ' || coalesce(c.name, 'Ders'),
    a.status,
    a.valid_from,
    a.valid_until,
    a.note,
    a.responsible_profile_id,
    rp.full_name,
    a.checked_at,
    cb.full_name,
    a.resolved_at,
    (a.status <> 'approved'),
    (a.status = 'approved' and a.valid_until is not null and a.valid_until >= v_today and a.valid_until <= v_today + 30),
    (a.valid_until is not null and a.valid_until < v_today)
  from public.teacher_course_meb_authorizations a
  left join public.profiles tp on tp.id = a.teacher_profile_id
  left join public.courses c on c.id = a.course_id
  left join public.profiles rp on rp.id = a.responsible_profile_id
  left join public.profiles cb on cb.id = a.checked_by
  where a.organization_id = v_organization_id
    and exists (
      select 1 from public.class_groups cg
      where cg.organization_id = v_organization_id
        and cg.course_id = a.course_id
        and cg.teacher_profile_id = a.teacher_profile_id
    )

  union all

  select
    'enrollment'::text,
    r.id,
    coalesce(s.first_name || ' ' || s.last_name, 'Öğrenci') || ' — ' || coalesce(c.name, 'Ders'),
    r.status,
    r.valid_from,
    r.valid_until,
    coalesce(r.non_registration_reason, r.note),
    r.responsible_profile_id,
    rp.full_name,
    r.checked_at,
    cb.full_name,
    r.resolved_at,
    (r.status <> 'registered'),
    (r.status = 'registered' and r.valid_until is not null and r.valid_until >= v_today and r.valid_until <= v_today + 30),
    (r.valid_until is not null and r.valid_until < v_today)
  from public.enrollment_meb_registrations r
  inner join public.enrollments e on e.id = r.enrollment_id
  inner join public.students s on s.id = r.student_id
  left join public.courses c on c.id = r.course_id
  left join public.profiles rp on rp.id = r.responsible_profile_id
  left join public.profiles cb on cb.id = r.checked_by
  where r.organization_id = v_organization_id
    and e.status in ('active'::public.enrollment_status, 'frozen'::public.enrollment_status)
    and s.status = 'active'::public.record_status

  -- Sütun adları yerine sıra numarası kullanılıyor: UNION ALL'ın
  -- birleşik çıktısı adlandırmayı ilk SELECT'ten alır ve bu sütunlar
  -- (is_deficient vb.) orada takma ad almadığı için isimle sıralama
  -- "column does not exist" hatası verir.
  order by 13 desc, 15 desc, 14 desc, 6 nulls last;
end;
$$;

revoke all on function public.get_meb_deficiencies() from public;
revoke all on function public.get_meb_deficiencies() from anon;
grant execute on function public.get_meb_deficiencies() to authenticated;

notify pgrst, 'reload schema';
