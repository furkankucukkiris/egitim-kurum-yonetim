-- Önceki hâlde get_meb_deficiencies() teacher_course satırlarını
-- `teacher_course_meb_authorizations` tablosundan okuyordu — hiç
-- kontrol edilmemiş (satırı bile oluşturulmamış) öğretmen-ders
-- çiftleri listede hiç görünmüyordu. Oysa bunlar en eksik durumdaki
-- kayıtlar. Kaynağı `class_groups`'taki gerçek öğretmen-ders
-- çiftlerine çevirip authorizations'ı LEFT JOIN ile bağlıyoruz.
-- Ayrıca anchor linkleme için teacher_profile_id/course_id ekleniyor
-- (authorization satırı yokken entity_id null olabildiğinden /meb
-- sayfasındaki forma composite anahtarla gitmek gerekiyor).

drop function if exists public.get_meb_deficiencies();

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
  is_expired boolean,
  student_id uuid,
  teacher_profile_id uuid,
  course_id uuid
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
    (c.meb_valid_until is not null and c.meb_valid_until < v_today),
    null::uuid,
    null::uuid,
    c.id
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
    coalesce(a.status, 'unchecked'),
    a.valid_from,
    a.valid_until,
    a.note,
    a.responsible_profile_id,
    rp.full_name,
    a.checked_at,
    cb.full_name,
    a.resolved_at,
    (coalesce(a.status, 'unchecked') <> 'approved'),
    (a.status = 'approved' and a.valid_until is not null and a.valid_until >= v_today and a.valid_until <= v_today + 30),
    (a.valid_until is not null and a.valid_until < v_today),
    null::uuid,
    pairs.teacher_profile_id,
    pairs.course_id
  from (
    select distinct cg.teacher_profile_id, cg.course_id
    from public.class_groups cg
    where cg.organization_id = v_organization_id
      and cg.teacher_profile_id is not null
  ) pairs
  left join public.teacher_course_meb_authorizations a
    on a.organization_id = v_organization_id
    and a.teacher_profile_id = pairs.teacher_profile_id
    and a.course_id = pairs.course_id
  left join public.profiles tp on tp.id = pairs.teacher_profile_id
  left join public.courses c on c.id = pairs.course_id
  left join public.profiles rp on rp.id = a.responsible_profile_id
  left join public.profiles cb on cb.id = a.checked_by

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
    (r.valid_until is not null and r.valid_until < v_today),
    r.student_id,
    null::uuid,
    r.course_id
  from public.enrollment_meb_registrations r
  inner join public.enrollments e on e.id = r.enrollment_id
  inner join public.students s on s.id = r.student_id
  left join public.courses c on c.id = r.course_id
  left join public.profiles rp on rp.id = r.responsible_profile_id
  left join public.profiles cb on cb.id = r.checked_by
  where r.organization_id = v_organization_id
    and e.status in ('active'::public.enrollment_status, 'frozen'::public.enrollment_status)
    and s.status = 'active'::public.record_status

  order by 13 desc, 15 desc, 14 desc, 6 nulls last;
end;
$$;

revoke all on function public.get_meb_deficiencies() from public;
revoke all on function public.get_meb_deficiencies() from anon;
grant execute on function public.get_meb_deficiencies() to authenticated;

notify pgrst, 'reload schema';
