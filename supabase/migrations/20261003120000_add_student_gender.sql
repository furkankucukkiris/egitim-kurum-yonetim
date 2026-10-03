-- Öğrenci cinsiyeti: kayıt formunda sorulur, öğrenci listesinde satır
-- rengi ve ileride istatistik/raporlama için kullanılır. Eski kayıtlar
-- için boş kalabilir (null = belirtilmedi).

alter table public.students
  add column if not exists gender text;

alter table public.students
  drop constraint if exists students_gender_check;

alter table public.students
  add constraint students_gender_check
  check (gender is null or gender in ('female', 'male'));

create or replace function public.set_student_gender(
  p_student_id uuid,
  p_gender text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_gender text := nullif(pg_catalog.btrim(coalesce(p_gender, '')), '');
  v_old_gender text;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception
      'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.can_manage_finance() then
    raise exception
      'Öğrenci bilgisi güncelleme yetkiniz bulunmuyor.';
  end if;

  if v_gender is not null and v_gender not in ('female', 'male') then
    raise exception 'Geçerli bir cinsiyet seçin.';
  end if;

  select s.gender
  into v_old_gender
  from public.students s
  where s.id = p_student_id
    and s.organization_id = v_organization_id
  for update;

  if not found then
    raise exception 'Öğrenci kaydı bulunamadı.';
  end if;

  if v_old_gender is not distinct from v_gender then
    return;
  end if;

  update public.students
  set gender = v_gender,
      updated_at = pg_catalog.now()
  where id = p_student_id
    and organization_id = v_organization_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id,
    action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'students', p_student_id::text,
    'set_gender',
    pg_catalog.jsonb_build_object('gender', v_old_gender),
    pg_catalog.jsonb_build_object('gender', v_gender)
  );
end;
$$;

revoke all on function public.set_student_gender(uuid, text) from public;
revoke all on function public.set_student_gender(uuid, text) from anon;
grant execute on function public.set_student_gender(uuid, text) to authenticated;

notify pgrst, 'reload schema';
