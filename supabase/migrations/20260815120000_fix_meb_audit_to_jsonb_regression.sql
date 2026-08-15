-- 20260814130000, MEB eksiklik takibini eklerken
-- set_teacher_course_meb_authorization() ve set_enrollment_meb_registration()
-- fonksiyonlarını (responsible_profile_id/resolved_at eklemek için) yeniden
-- tanımlarken, 20260812160000'in kasıtlı olarak kaldırdığı
-- pg_catalog.to_jsonb(satır) deseni yanlışlıkla geri geldi — audit_logs
-- satırları artık yine SATIRIN TAMAMINI (id, organization_id, course_id,
-- teacher_profile_id, created_at, updated_at dahil) içeriyor. Bu, ileride
-- bu tablolara eklenecek hassas bir sütunun kod değişikliği olmadan
-- audit_logs'a sızmasına izin verir — tam olarak 20260812160000'in
-- önlemeye çalıştığı senaryo. İki fonksiyon, açık alan listesine
-- (yeni responsible_profile_id/resolved_at alanları dahil) geri
-- döndürülüyor; geri kalan iş mantığı (durum/resolved_at hesaplama,
-- yetki kontrolleri, on conflict upsert) değişmiyor.

create or replace function
public.set_teacher_course_meb_authorization(
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

  select pg_catalog.jsonb_build_object(
    'status', a.status,
    'document_number', a.document_number,
    'valid_from', a.valid_from,
    'valid_until', a.valid_until,
    'note', a.note,
    'checked_at', a.checked_at,
    'checked_by', a.checked_by,
    'responsible_profile_id', a.responsible_profile_id,
    'resolved_at', a.resolved_at
  )
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
    'upsert', v_old_data,
    pg_catalog.jsonb_build_object(
      'status', a.status,
      'document_number', a.document_number,
      'valid_from', a.valid_from,
      'valid_until', a.valid_until,
      'note', a.note,
      'checked_at', a.checked_at,
      'checked_by', a.checked_by,
      'responsible_profile_id', a.responsible_profile_id,
      'resolved_at', a.resolved_at
    )
  from public.teacher_course_meb_authorizations a
  where a.id = v_authorization_id;

  return v_authorization_id;
end;
$$;

revoke all on function public.set_teacher_course_meb_authorization(uuid, uuid, text, text, date, date, text, uuid) from public;
revoke all on function public.set_teacher_course_meb_authorization(uuid, uuid, text, text, date, date, text, uuid) from anon;
grant execute on function public.set_teacher_course_meb_authorization(uuid, uuid, text, text, date, date, text, uuid) to authenticated;

create or replace function
public.set_enrollment_meb_registration(
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

  select pg_catalog.jsonb_build_object(
    'status', r.status,
    'registration_number', r.registration_number,
    'valid_from', r.valid_from,
    'valid_until', r.valid_until,
    'non_registration_reason', r.non_registration_reason,
    'note', r.note,
    'checked_at', r.checked_at,
    'checked_by', r.checked_by,
    'responsible_profile_id', r.responsible_profile_id,
    'resolved_at', r.resolved_at
  )
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
    'upsert', v_old_data,
    pg_catalog.jsonb_build_object(
      'status', r.status,
      'registration_number', r.registration_number,
      'valid_from', r.valid_from,
      'valid_until', r.valid_until,
      'non_registration_reason', r.non_registration_reason,
      'note', r.note,
      'checked_at', r.checked_at,
      'checked_by', r.checked_by,
      'responsible_profile_id', r.responsible_profile_id,
      'resolved_at', r.resolved_at
    )
  from public.enrollment_meb_registrations r
  where r.id = v_registration_id;

  return v_registration_id;
end;
$$;

revoke all on function public.set_enrollment_meb_registration(uuid, text, text, date, date, text, text, uuid) from public;
revoke all on function public.set_enrollment_meb_registration(uuid, text, text, date, date, text, text, uuid) from anon;
grant execute on function public.set_enrollment_meb_registration(uuid, text, text, date, date, text, text, uuid) to authenticated;

notify pgrst, 'reload schema';
