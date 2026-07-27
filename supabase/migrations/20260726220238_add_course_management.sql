-- Ders tanımlarını oluşturma, düzenleme ve aktiflik yönetimi.

-- Aynı kurumda aynı ders adı büyük/küçük harf farkıyla
-- tekrar oluşturulamasın.

create unique index if not exists
courses_org_name_ci_unique
on public.courses (
  organization_id,
  pg_catalog.lower(
    pg_catalog.btrim(name)
  )
);

-- =========================================================
-- 1. Ders oluşturma
-- =========================================================

create or replace function public.create_course(
  p_name text,
  p_code text,
  p_course_type text,
  p_default_duration_minutes integer,
  p_default_monthly_fee numeric
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

  v_course_id uuid;

  v_name text;
  v_code text;
  v_course_type public.course_type;
begin
  if v_user_id is null
     or v_organization_id is null then
    raise exception
      'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception
      'Ders tanımı oluşturma yetkiniz bulunmuyor.';
  end if;

  v_name :=
    pg_catalog.btrim(
      coalesce(p_name, '')
    );

  v_code :=
    pg_catalog.upper(
      pg_catalog.btrim(
        coalesce(p_code, '')
      )
    );

  if pg_catalog.char_length(v_name) < 2 then
    raise exception
      'Ders adı en az 2 karakter olmalıdır.';
  end if;

  if p_course_type not in (
    'individual',
    'group'
  ) then
    raise exception
      'Geçerli bir ders türü seçilmelidir.';
  end if;

  v_course_type :=
    p_course_type::public.course_type;

  if p_default_duration_minutes is null
     or p_default_duration_minutes < 15
     or p_default_duration_minutes > 480 then
    raise exception
      'Ders süresi 15 ile 480 dakika arasında olmalıdır.';
  end if;

  if p_default_monthly_fee is null
     or p_default_monthly_fee < 0 then
    raise exception
      'Aylık ücret sıfırdan küçük olamaz.';
  end if;

  insert into public.courses (
    organization_id,
    name,
    code,
    course_type,
    default_duration_minutes,
    default_monthly_fee,
    is_active
  )
  values (
    v_organization_id,
    v_name,
    nullif(v_code, ''),
    v_course_type,
    p_default_duration_minutes,
    p_default_monthly_fee,
    true
  )
  returning id into v_course_id;

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
    'courses',
    v_course_id::text,
    'create',
    null,
    pg_catalog.jsonb_build_object(
      'name', v_name,
      'code', nullif(v_code, ''),
      'course_type', v_course_type,
      'default_duration_minutes',
        p_default_duration_minutes,
      'default_monthly_fee',
        p_default_monthly_fee,
      'is_active', true
    )
  );

  return v_course_id;

exception
  when unique_violation then
    raise exception
      'Aynı ders adı veya ders koduyla daha önce bir kayıt oluşturulmuş.'
      using errcode = '23505';
end;
$$;

-- =========================================================
-- 2. Ders bilgilerini güncelleme
-- =========================================================

create or replace function public.update_course(
  p_course_id uuid,
  p_name text,
  p_code text,
  p_course_type text,
  p_default_duration_minutes integer,
  p_default_monthly_fee numeric
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
  v_code text;
  v_course_type public.course_type;

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
      'Ders tanımını düzenleme yetkiniz bulunmuyor.';
  end if;

  v_name :=
    pg_catalog.btrim(
      coalesce(p_name, '')
    );

  v_code :=
    pg_catalog.upper(
      pg_catalog.btrim(
        coalesce(p_code, '')
      )
    );

  if pg_catalog.char_length(v_name) < 2 then
    raise exception
      'Ders adı en az 2 karakter olmalıdır.';
  end if;

  if p_course_type not in (
    'individual',
    'group'
  ) then
    raise exception
      'Geçerli bir ders türü seçilmelidir.';
  end if;

  v_course_type :=
    p_course_type::public.course_type;

  if p_default_duration_minutes is null
     or p_default_duration_minutes < 15
     or p_default_duration_minutes > 480 then
    raise exception
      'Ders süresi 15 ile 480 dakika arasında olmalıdır.';
  end if;

  if p_default_monthly_fee is null
     or p_default_monthly_fee < 0 then
    raise exception
      'Aylık ücret sıfırdan küçük olamaz.';
  end if;

  select pg_catalog.jsonb_build_object(
    'name', c.name,
    'code', c.code,
    'course_type', c.course_type,
    'default_duration_minutes',
      c.default_duration_minutes,
    'default_monthly_fee',
      c.default_monthly_fee,
    'is_active', c.is_active
  )
  into v_old_data
  from public.courses c
  where c.id = p_course_id
    and c.organization_id =
      v_organization_id;

  if v_old_data is null then
    raise exception
      'Ders kaydı bulunamadı.';
  end if;

  update public.courses
  set
    name = v_name,
    code = nullif(v_code, ''),
    course_type = v_course_type,
    default_duration_minutes =
      p_default_duration_minutes,
    default_monthly_fee =
      p_default_monthly_fee
  where id = p_course_id
    and organization_id =
      v_organization_id;

  v_new_data :=
    pg_catalog.jsonb_build_object(
      'name', v_name,
      'code', nullif(v_code, ''),
      'course_type', v_course_type,
      'default_duration_minutes',
        p_default_duration_minutes,
      'default_monthly_fee',
        p_default_monthly_fee
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
    'courses',
    p_course_id::text,
    'update',
    v_old_data,
    v_new_data
  );

exception
  when unique_violation then
    raise exception
      'Aynı ders adı veya ders koduyla daha önce bir kayıt oluşturulmuş.'
      using errcode = '23505';
end;
$$;

-- =========================================================
-- 3. Dersi aktif veya pasif yapma
-- =========================================================

create or replace function public.set_course_active(
  p_course_id uuid,
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
      'Ders durumunu değiştirme yetkiniz bulunmuyor.';
  end if;

  select c.is_active
  into v_old_active
  from public.courses c
  where c.id = p_course_id
    and c.organization_id =
      v_organization_id;

  if v_old_active is null then
    raise exception
      'Ders kaydı bulunamadı.';
  end if;

  update public.courses
  set is_active =
    coalesce(p_is_active, false)
  where id = p_course_id
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
    'courses',
    p_course_id::text,
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
-- 4. Yetkiler
-- =========================================================

revoke insert, update, delete
on public.courses
from authenticated;

grant select
on public.courses
to authenticated;

revoke all
on function public.create_course(
  text,
  text,
  text,
  integer,
  numeric
)
from public;

revoke all
on function public.create_course(
  text,
  text,
  text,
  integer,
  numeric
)
from anon;

grant execute
on function public.create_course(
  text,
  text,
  text,
  integer,
  numeric
)
to authenticated;

revoke all
on function public.update_course(
  uuid,
  text,
  text,
  text,
  integer,
  numeric
)
from public;

revoke all
on function public.update_course(
  uuid,
  text,
  text,
  text,
  integer,
  numeric
)
from anon;

grant execute
on function public.update_course(
  uuid,
  text,
  text,
  text,
  integer,
  numeric
)
to authenticated;

revoke all
on function public.set_course_active(
  uuid,
  boolean
)
from public;

revoke all
on function public.set_course_active(
  uuid,
  boolean
)
from anon;

grant execute
on function public.set_course_active(
  uuid,
  boolean
)
to authenticated;

notify pgrst, 'reload schema';