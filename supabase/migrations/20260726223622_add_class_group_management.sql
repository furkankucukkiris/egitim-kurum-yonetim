-- Haftalık ders grupları ve birebir ders saatlerini yönetir.

-- Aynı ders içinde aynı seans adı tekrar oluşturulamaz.
create unique index if not exists
class_groups_org_course_name_ci_unique
on public.class_groups (
  organization_id,
  course_id,
  pg_catalog.lower(
    pg_catalog.btrim(name)
  )
);

-- =========================================================
-- 1. Ders grubu/seansı oluşturma
-- =========================================================

create or replace function public.create_class_group(
  p_name text,
  p_course_id uuid,
  p_teacher_profile_id uuid,
  p_room_name text,
  p_capacity integer,
  p_weekday integer,
  p_start_time time,
  p_duration_minutes integer,
  p_starts_on date,
  p_ends_on date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();

  v_organization_id uuid :=
    public.current_organization_id();

  v_group_id uuid;

  v_name text;
  v_room_name text;

  v_course_type public.course_type;
  v_course_is_active boolean;

  v_capacity integer;
begin
  if v_user_id is null
     or v_organization_id is null then
    raise exception
      'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception
      'Ders programı oluşturma yetkiniz bulunmuyor.';
  end if;

  v_name :=
    pg_catalog.btrim(
      coalesce(p_name, '')
    );

  v_room_name :=
    pg_catalog.btrim(
      coalesce(p_room_name, '')
    );

  if pg_catalog.char_length(v_name) < 2 then
    raise exception
      'Seans adı en az 2 karakter olmalıdır.';
  end if;

  select
    c.course_type,
    c.is_active
  into
    v_course_type,
    v_course_is_active
  from public.courses c
  where c.id = p_course_id
    and c.organization_id =
      v_organization_id;

  if v_course_type is null then
    raise exception
      'Ders kaydı bulunamadı.';
  end if;

  if not v_course_is_active then
    raise exception
      'Pasif bir ders için yeni seans oluşturulamaz.';
  end if;

  if p_teacher_profile_id is not null
     and not exists (
       select 1
       from public.profiles p
       where p.id = p_teacher_profile_id
         and p.organization_id =
           v_organization_id
         and p.is_active = true
         and p.role in (
           'teacher'::public.app_role,
           'admin'::public.app_role
         )
     ) then
    raise exception
      'Seçilen öğretmen bulunamadı veya aktif değil.';
  end if;

  if p_weekday is null
     or p_weekday < 1
     or p_weekday > 7 then
    raise exception
      'Geçerli bir ders günü seçilmelidir.';
  end if;

  if p_start_time is null then
    raise exception
      'Ders başlangıç saati zorunludur.';
  end if;

  if p_duration_minutes is null
     or p_duration_minutes < 15
     or p_duration_minutes > 480 then
    raise exception
      'Ders süresi 15 ile 480 dakika arasında olmalıdır.';
  end if;

  if p_starts_on is null then
    raise exception
      'Program başlangıç tarihi zorunludur.';
  end if;

  if p_ends_on is not null
     and p_ends_on < p_starts_on then
    raise exception
      'Program bitiş tarihi başlangıç tarihinden önce olamaz.';
  end if;

  /*
   * Birebir ders seanslarının kapasitesi her zaman 1'dir.
   * Grup derslerinde girilen kapasite kullanılır.
   */

  if v_course_type =
     'individual'::public.course_type then
    v_capacity := 1;
  else
    if p_capacity is null
       or p_capacity < 1
       or p_capacity > 100 then
      raise exception
        'Grup kapasitesi 1 ile 100 arasında olmalıdır.';
    end if;

    v_capacity := p_capacity;
  end if;

  insert into public.class_groups (
    organization_id,
    course_id,
    teacher_profile_id,
    name,
    room_name,
    capacity,
    weekday,
    start_time,
    duration_minutes,
    starts_on,
    ends_on,
    is_active
  )
  values (
    v_organization_id,
    p_course_id,
    p_teacher_profile_id,
    v_name,
    nullif(v_room_name, ''),
    v_capacity,
    p_weekday,
    p_start_time,
    p_duration_minutes,
    p_starts_on,
    p_ends_on,
    true
  )
  returning id into v_group_id;

  insert into public.audit_logs (
    organization_id,
    actor_profile_id,
    table_name,
    record_id,
    action,
    old_data,
    new_data
  )
  values (
    v_organization_id,
    v_user_id,
    'class_groups',
    v_group_id::text,
    'create',
    null,
    pg_catalog.jsonb_build_object(
      'course_id', p_course_id,
      'teacher_profile_id',
        p_teacher_profile_id,
      'name', v_name,
      'room_name',
        nullif(v_room_name, ''),
      'capacity', v_capacity,
      'weekday', p_weekday,
      'start_time', p_start_time,
      'duration_minutes',
        p_duration_minutes,
      'starts_on', p_starts_on,
      'ends_on', p_ends_on,
      'is_active', true
    )
  );

  return v_group_id;

exception
  when unique_violation then
    raise exception
      'Bu ders için aynı isimde bir seans zaten bulunuyor.'
      using errcode = '23505';
end;
$$;

-- =========================================================
-- 2. Ders grubu/seansı güncelleme
-- =========================================================

create or replace function public.update_class_group(
  p_group_id uuid,
  p_name text,
  p_teacher_profile_id uuid,
  p_room_name text,
  p_capacity integer,
  p_weekday integer,
  p_start_time time,
  p_duration_minutes integer,
  p_starts_on date,
  p_ends_on date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();

  v_organization_id uuid :=
    public.current_organization_id();

  v_name text;
  v_room_name text;

  v_course_type public.course_type;

  v_capacity integer;

  v_old_data jsonb;
  v_new_data jsonb;
begin
  if v_user_id is null
     or v_organization_id is null then
    raise exception
      'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception
      'Ders programını düzenleme yetkiniz bulunmuyor.';
  end if;

  v_name :=
    pg_catalog.btrim(
      coalesce(p_name, '')
    );

  v_room_name :=
    pg_catalog.btrim(
      coalesce(p_room_name, '')
    );

  select
    c.course_type,
    pg_catalog.jsonb_build_object(
      'name', cg.name,
      'teacher_profile_id',
        cg.teacher_profile_id,
      'room_name', cg.room_name,
      'capacity', cg.capacity,
      'weekday', cg.weekday,
      'start_time', cg.start_time,
      'duration_minutes',
        cg.duration_minutes,
      'starts_on', cg.starts_on,
      'ends_on', cg.ends_on,
      'is_active', cg.is_active
    )
  into
    v_course_type,
    v_old_data
  from public.class_groups cg
  inner join public.courses c
    on c.id = cg.course_id
  where cg.id = p_group_id
    and cg.organization_id =
      v_organization_id;

  if v_old_data is null then
    raise exception
      'Ders seansı bulunamadı.';
  end if;

  if pg_catalog.char_length(v_name) < 2 then
    raise exception
      'Seans adı en az 2 karakter olmalıdır.';
  end if;

  if p_teacher_profile_id is not null
     and not exists (
       select 1
       from public.profiles p
       where p.id = p_teacher_profile_id
         and p.organization_id =
           v_organization_id
         and p.is_active = true
         and p.role in (
           'teacher'::public.app_role,
           'admin'::public.app_role
         )
     ) then
    raise exception
      'Seçilen öğretmen bulunamadı veya aktif değil.';
  end if;

  if p_weekday is null
     or p_weekday < 1
     or p_weekday > 7 then
    raise exception
      'Geçerli bir ders günü seçilmelidir.';
  end if;

  if p_start_time is null then
    raise exception
      'Ders başlangıç saati zorunludur.';
  end if;

  if p_duration_minutes is null
     or p_duration_minutes < 15
     or p_duration_minutes > 480 then
    raise exception
      'Ders süresi 15 ile 480 dakika arasında olmalıdır.';
  end if;

  if p_starts_on is null then
    raise exception
      'Program başlangıç tarihi zorunludur.';
  end if;

  if p_ends_on is not null
     and p_ends_on < p_starts_on then
    raise exception
      'Program bitiş tarihi başlangıç tarihinden önce olamaz.';
  end if;

  if v_course_type =
     'individual'::public.course_type then
    v_capacity := 1;
  else
    if p_capacity is null
       or p_capacity < 1
       or p_capacity > 100 then
      raise exception
        'Grup kapasitesi 1 ile 100 arasında olmalıdır.';
    end if;

    v_capacity := p_capacity;
  end if;

  /*
   * Yeni kapasite, hâlihazırdaki aktif öğrenci
   * sayısından daha düşük olamaz.
   */

  if v_capacity < (
    select pg_catalog.count(*)
    from public.enrollments e
    where e.class_group_id = p_group_id
      and e.status in (
        'active'::public.enrollment_status,
        'frozen'::public.enrollment_status
      )
  ) then
    raise exception
      'Kapasite mevcut öğrenci sayısından daha düşük olamaz.';
  end if;

  update public.class_groups
  set
    teacher_profile_id =
      p_teacher_profile_id,
    name = v_name,
    room_name =
      nullif(v_room_name, ''),
    capacity = v_capacity,
    weekday = p_weekday,
    start_time = p_start_time,
    duration_minutes =
      p_duration_minutes,
    starts_on = p_starts_on,
    ends_on = p_ends_on
  where id = p_group_id
    and organization_id =
      v_organization_id;

  v_new_data :=
    pg_catalog.jsonb_build_object(
      'name', v_name,
      'teacher_profile_id',
        p_teacher_profile_id,
      'room_name',
        nullif(v_room_name, ''),
      'capacity', v_capacity,
      'weekday', p_weekday,
      'start_time', p_start_time,
      'duration_minutes',
        p_duration_minutes,
      'starts_on', p_starts_on,
      'ends_on', p_ends_on
    );

  insert into public.audit_logs (
    organization_id,
    actor_profile_id,
    table_name,
    record_id,
    action,
    old_data,
    new_data
  )
  values (
    v_organization_id,
    v_user_id,
    'class_groups',
    p_group_id::text,
    'update',
    v_old_data,
    v_new_data
  );

exception
  when unique_violation then
    raise exception
      'Bu ders için aynı isimde bir seans zaten bulunuyor.'
      using errcode = '23505';
end;
$$;

-- =========================================================
-- 3. Seansı aktif veya pasif yapma
-- =========================================================

create or replace function public.set_class_group_active(
  p_group_id uuid,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();

  v_organization_id uuid :=
    public.current_organization_id();

  v_old_active boolean;
begin
  if v_user_id is null
     or v_organization_id is null then
    raise exception
      'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception
      'Ders programı durumunu değiştirme yetkiniz bulunmuyor.';
  end if;

  select cg.is_active
  into v_old_active
  from public.class_groups cg
  where cg.id = p_group_id
    and cg.organization_id =
      v_organization_id;

  if v_old_active is null then
    raise exception
      'Ders seansı bulunamadı.';
  end if;

  update public.class_groups
  set is_active =
    coalesce(p_is_active, false)
  where id = p_group_id
    and organization_id =
      v_organization_id;

  insert into public.audit_logs (
    organization_id,
    actor_profile_id,
    table_name,
    record_id,
    action,
    old_data,
    new_data
  )
  values (
    v_organization_id,
    v_user_id,
    'class_groups',
    p_group_id::text,
    'set_active',
    pg_catalog.jsonb_build_object(
      'is_active', v_old_active
    ),
    pg_catalog.jsonb_build_object(
      'is_active',
      coalesce(p_is_active, false)
    )
  );
end;
$$;

-- =========================================================
-- 4. Tablo ve fonksiyon izinleri
-- =========================================================

revoke insert, update, delete
on public.class_groups
from authenticated;

grant select
on public.class_groups
to authenticated;

revoke all
on function public.create_class_group(
  text,
  uuid,
  uuid,
  text,
  integer,
  integer,
  time without time zone,
  integer,
  date,
  date
)
from public;

revoke all
on function public.create_class_group(
  text,
  uuid,
  uuid,
  text,
  integer,
  integer,
  time without time zone,
  integer,
  date,
  date
)
from anon;

grant execute
on function public.create_class_group(
  text,
  uuid,
  uuid,
  text,
  integer,
  integer,
  time without time zone,
  integer,
  date,
  date
)
to authenticated;

revoke all
on function public.update_class_group(
  uuid,
  text,
  uuid,
  text,
  integer,
  integer,
  time without time zone,
  integer,
  date,
  date
)
from public;

revoke all
on function public.update_class_group(
  uuid,
  text,
  uuid,
  text,
  integer,
  integer,
  time without time zone,
  integer,
  date,
  date
)
from anon;

grant execute
on function public.update_class_group(
  uuid,
  text,
  uuid,
  text,
  integer,
  integer,
  time without time zone,
  integer,
  date,
  date
)
to authenticated;

revoke all
on function public.set_class_group_active(
  uuid,
  boolean
)
from public;

revoke all
on function public.set_class_group_active(
  uuid,
  boolean
)
from anon;

grant execute
on function public.set_class_group_active(
  uuid,
  boolean
)
to authenticated;

notify pgrst, 'reload schema';