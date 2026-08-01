-- Gerçek öğretmen hesapları, ilk girişte parola değiştirme zorunluluğu
-- ve öğretmenlerin yalnızca kendi program/öğrencilerine erişmesi.

-- =========================================================
-- 1. Profil hesabı alanları
-- =========================================================

alter table public.profiles
  add column if not exists email text,
  add column if not exists must_change_password boolean
    not null default false;

create unique index if not exists
profiles_email_ci_unique
on public.profiles (
  pg_catalog.lower(
    pg_catalog.btrim(email)
  )
)
where email is not null;

-- =========================================================
-- 2. Öğretmen hesabı yönetim fonksiyonları
-- =========================================================

create or replace function public.create_teacher_profile(
  p_user_id uuid,
  p_email text,
  p_full_name text,
  p_phone text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();

  v_organization_id uuid :=
    public.current_organization_id();

  v_email text :=
    pg_catalog.lower(
      pg_catalog.btrim(
        coalesce(p_email, '')
      )
    );

  v_full_name text :=
    pg_catalog.btrim(
      coalesce(p_full_name, '')
    );

  v_phone text :=
    pg_catalog.btrim(
      coalesce(p_phone, '')
    );
begin
  if v_actor_id is null
     or v_organization_id is null then
    raise exception
      'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception
      'Öğretmen hesabı oluşturma yetkiniz bulunmuyor.';
  end if;

  if p_user_id is null then
    raise exception
      'Öğretmen kullanıcı kimliği bulunamadı.';
  end if;

  if pg_catalog.char_length(v_full_name) < 2 then
    raise exception
      'Öğretmen adı en az 2 karakter olmalıdır.';
  end if;

  if v_email = ''
     or v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception
      'Geçerli bir e-posta adresi girilmelidir.';
  end if;

  insert into public.profiles (
    id,
    organization_id,
    full_name,
    role,
    phone,
    email,
    is_active,
    must_change_password
  )
  values (
    p_user_id,
    v_organization_id,
    v_full_name,
    'teacher'::public.app_role,
    nullif(v_phone, ''),
    v_email,
    true,
    true
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
    v_actor_id,
    'profiles',
    p_user_id::text,
    'create_teacher',
    null,
    pg_catalog.jsonb_build_object(
      'full_name', v_full_name,
      'email', v_email,
      'phone', nullif(v_phone, ''),
      'role', 'teacher',
      'is_active', true,
      'must_change_password', true
    )
  );

  return p_user_id;

exception
  when unique_violation then
    raise exception
      'Bu e-posta adresiyle daha önce bir hesap oluşturulmuş.'
      using errcode = '23505';
end;
$$;

create or replace function public.set_teacher_active(
  p_teacher_profile_id uuid,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();

  v_organization_id uuid :=
    public.current_organization_id();

  v_old_active boolean;
begin
  if v_actor_id is null
     or v_organization_id is null then
    raise exception
      'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception
      'Öğretmen hesabı durumunu değiştirme yetkiniz bulunmuyor.';
  end if;

  select p.is_active
  into v_old_active
  from public.profiles p
  where p.id = p_teacher_profile_id
    and p.organization_id = v_organization_id
    and p.role = 'teacher'::public.app_role;

  if v_old_active is null then
    raise exception
      'Öğretmen hesabı bulunamadı.';
  end if;

  update public.profiles
  set is_active = coalesce(p_is_active, false)
  where id = p_teacher_profile_id
    and organization_id = v_organization_id
    and role = 'teacher'::public.app_role;

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
    v_actor_id,
    'profiles',
    p_teacher_profile_id::text,
    'set_teacher_active',
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

create or replace function
public.set_teacher_requires_password_change(
  p_teacher_profile_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();

  v_organization_id uuid :=
    public.current_organization_id();
begin
  if v_actor_id is null
     or v_organization_id is null then
    raise exception
      'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception
      'Öğretmen parolasını yenileme yetkiniz bulunmuyor.';
  end if;

  update public.profiles
  set must_change_password = true
  where id = p_teacher_profile_id
    and organization_id = v_organization_id
    and role = 'teacher'::public.app_role;

  if not found then
    raise exception
      'Öğretmen hesabı bulunamadı.';
  end if;

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
    v_actor_id,
    'profiles',
    p_teacher_profile_id::text,
    'require_password_change',
    null,
    pg_catalog.jsonb_build_object(
      'must_change_password', true
    )
  );
end;
$$;

create or replace function
public.complete_required_password_change()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();

  v_organization_id uuid :=
    public.current_organization_id();
begin
  if v_user_id is null
     or v_organization_id is null then
    raise exception
      'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  update public.profiles
  set must_change_password = false
  where id = v_user_id
    and organization_id = v_organization_id;

  if not found then
    raise exception
      'Kullanıcı profili bulunamadı.';
  end if;

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
    'profiles',
    v_user_id::text,
    'complete_password_change',
    pg_catalog.jsonb_build_object(
      'must_change_password', true
    ),
    pg_catalog.jsonb_build_object(
      'must_change_password', false
    )
  );
end;
$$;

-- =========================================================
-- 3. Öğretmen kapsamı yardımcı fonksiyonları
-- =========================================================

create or replace function public.teacher_owns_enrollment(
  p_enrollment_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.enrollments e
    left join public.class_groups cg
      on cg.id = e.class_group_id
    where e.id = p_enrollment_id
      and e.organization_id =
        public.current_organization_id()
      and coalesce(
        e.teacher_profile_id,
        cg.teacher_profile_id
      ) = auth.uid()
  )
$$;

create or replace function public.teacher_has_student(
  p_student_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.enrollments e
    left join public.class_groups cg
      on cg.id = e.class_group_id
    where e.student_id = p_student_id
      and e.organization_id =
        public.current_organization_id()
      and e.status in (
        'active'::public.enrollment_status,
        'frozen'::public.enrollment_status
      )
      and coalesce(
        e.teacher_profile_id,
        cg.teacher_profile_id
      ) = auth.uid()
  )
$$;

create or replace function public.teacher_has_guardian(
  p_guardian_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.student_guardians sg
    where sg.guardian_id = p_guardian_id
      and public.teacher_has_student(
        sg.student_id
      )
  )
$$;

create or replace function public.teacher_owns_session(
  p_lesson_session_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.lesson_sessions ls
    left join public.class_groups cg
      on cg.id = ls.class_group_id
    where ls.id = p_lesson_session_id
      and ls.organization_id =
        public.current_organization_id()
      and coalesce(
        ls.teacher_profile_id,
        cg.teacher_profile_id
      ) = auth.uid()
  )
$$;

-- =========================================================
-- 4. Profil ve öğretmen kapsamlı RLS politikaları
-- =========================================================

drop policy if exists
profiles_select_same_org
on public.profiles;

create policy profiles_select_scoped
on public.profiles
for select
to authenticated
using (
  organization_id =
    public.current_organization_id()
  and (
    public.current_app_role() in (
      'admin'::public.app_role,
      'finance'::public.app_role
    )
    or id = auth.uid()
  )
);

drop policy if exists
profiles_update_self_or_admin
on public.profiles;

create policy profiles_admin_update
on public.profiles
for update
to authenticated
using (
  organization_id =
    public.current_organization_id()
  and public.is_admin()
)
with check (
  organization_id =
    public.current_organization_id()
  and public.is_admin()
);

drop policy if exists
students_select_org
on public.students;

create policy students_select_scoped
on public.students
for select
to authenticated
using (
  organization_id =
    public.current_organization_id()
  and (
    public.current_app_role() <>
      'teacher'::public.app_role
    or public.teacher_has_student(id)
  )
);

drop policy if exists
guardians_select_org
on public.guardians;

create policy guardians_select_scoped
on public.guardians
for select
to authenticated
using (
  organization_id =
    public.current_organization_id()
  and (
    public.current_app_role() <>
      'teacher'::public.app_role
    or public.teacher_has_guardian(id)
  )
);

drop policy if exists
student_guardians_select_org
on public.student_guardians;

create policy student_guardians_select_scoped
on public.student_guardians
for select
to authenticated
using (
  public.current_app_role() <>
    'teacher'::public.app_role
  or public.teacher_has_student(student_id)
);

drop policy if exists
groups_select_org
on public.class_groups;

create policy groups_select_scoped
on public.class_groups
for select
to authenticated
using (
  organization_id =
    public.current_organization_id()
  and (
    public.current_app_role() <>
      'teacher'::public.app_role
    or teacher_profile_id = auth.uid()
  )
);

drop policy if exists
enrollments_select_org
on public.enrollments;

create policy enrollments_select_scoped
on public.enrollments
for select
to authenticated
using (
  organization_id =
    public.current_organization_id()
  and (
    public.current_app_role() <>
      'teacher'::public.app_role
    or public.teacher_owns_enrollment(id)
  )
);

drop policy if exists
sessions_select_org
on public.lesson_sessions;

create policy sessions_select_scoped
on public.lesson_sessions
for select
to authenticated
using (
  organization_id =
    public.current_organization_id()
  and (
    public.current_app_role() <>
      'teacher'::public.app_role
    or public.teacher_owns_session(id)
  )
);

drop policy if exists
attendance_select_org
on public.attendance;

create policy attendance_select_scoped
on public.attendance
for select
to authenticated
using (
  organization_id =
    public.current_organization_id()
  and (
    public.current_app_role() <>
      'teacher'::public.app_role
    or public.teacher_owns_session(
      lesson_session_id
    )
  )
);

drop policy if exists
attendance_manage
on public.attendance;

create policy attendance_insert_scoped
on public.attendance
for insert
to authenticated
with check (
  organization_id =
    public.current_organization_id()
  and (
    public.is_admin()
    or (
      public.current_app_role() =
        'teacher'::public.app_role
      and public.teacher_owns_session(
        lesson_session_id
      )
    )
  )
);

create policy attendance_update_scoped
on public.attendance
for update
to authenticated
using (
  organization_id =
    public.current_organization_id()
  and (
    public.is_admin()
    or (
      public.current_app_role() =
        'teacher'::public.app_role
      and public.teacher_owns_session(
        lesson_session_id
      )
    )
  )
)
with check (
  organization_id =
    public.current_organization_id()
  and (
    public.is_admin()
    or (
      public.current_app_role() =
        'teacher'::public.app_role
      and public.teacher_owns_session(
        lesson_session_id
      )
    )
  )
);

drop policy if exists
enrollment_meb_registrations_select
on public.enrollment_meb_registrations;

create policy enrollment_meb_registrations_select
on public.enrollment_meb_registrations
for select
to authenticated
using (
  organization_id =
    public.current_organization_id()
  and (
    public.current_app_role() in (
      'admin'::public.app_role,
      'finance'::public.app_role
    )
    or public.teacher_owns_enrollment(
      enrollment_id
    )
  )
);

-- Profiller doğrudan yazılmaz. Tüm değişiklikler yetkili
-- security definer fonksiyonlarından geçer.
revoke insert, update, delete
on public.profiles
from authenticated;

grant select
on public.profiles
to authenticated;

-- =========================================================
-- 5. Fonksiyon izinleri
-- =========================================================

revoke all
on function public.create_teacher_profile(
  uuid,
  text,
  text,
  text
)
from public, anon;

grant execute
on function public.create_teacher_profile(
  uuid,
  text,
  text,
  text
)
to authenticated;

revoke all
on function public.set_teacher_active(
  uuid,
  boolean
)
from public, anon;

grant execute
on function public.set_teacher_active(
  uuid,
  boolean
)
to authenticated;

revoke all
on function
public.set_teacher_requires_password_change(uuid)
from public, anon;

grant execute
on function
public.set_teacher_requires_password_change(uuid)
to authenticated;

revoke all
on function public.complete_required_password_change()
from public, anon;

grant execute
on function public.complete_required_password_change()
to authenticated;

revoke all
on function public.teacher_owns_enrollment(uuid)
from public, anon;

grant execute
on function public.teacher_owns_enrollment(uuid)
to authenticated;

revoke all
on function public.teacher_has_student(uuid)
from public, anon;

grant execute
on function public.teacher_has_student(uuid)
to authenticated;

revoke all
on function public.teacher_has_guardian(uuid)
from public, anon;

grant execute
on function public.teacher_has_guardian(uuid)
to authenticated;

revoke all
on function public.teacher_owns_session(uuid)
from public, anon;

grant execute
on function public.teacher_owns_session(uuid)
to authenticated;

notify pgrst, 'reload schema';
