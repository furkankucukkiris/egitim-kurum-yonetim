-- Ders, öğretmen-ders ve öğrenci-ders bazında
-- MEB kayıt/uygunluk bilgilerinin takibi.

-- =========================================================
-- 1. Derslerin MEB bilgileri
-- =========================================================

alter table public.courses
  add column if not exists meb_status text
    not null default 'unchecked',
  add column if not exists meb_program_name text,
  add column if not exists meb_program_code text,
  add column if not exists meb_approval_number text,
  add column if not exists meb_valid_from date,
  add column if not exists meb_valid_until date,
  add column if not exists meb_note text;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'courses_meb_status_check'
  ) then
    alter table public.courses
      add constraint courses_meb_status_check
      check (
        meb_status in (
          'approved',
          'pending',
          'not_registered',
          'expired',
          'unchecked'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'courses_meb_dates_check'
  ) then
    alter table public.courses
      add constraint courses_meb_dates_check
      check (
        meb_valid_until is null
        or meb_valid_from is null
        or meb_valid_until >= meb_valid_from
      );
  end if;
end
$$;

-- =========================================================
-- 2. Öğretmenin belirli bir ders için MEB yetkisi
-- =========================================================

create table if not exists
public.teacher_course_meb_authorizations (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id)
    on delete cascade,

  teacher_profile_id uuid not null
    references public.profiles(id)
    on delete cascade,

  course_id uuid not null
    references public.courses(id)
    on delete cascade,

  status text not null default 'unchecked'
    check (
      status in (
        'approved',
        'pending',
        'not_registered',
        'expired',
        'unchecked'
      )
    ),

  document_number text,
  valid_from date,
  valid_until date,
  note text,

  checked_at timestamptz,
  checked_by uuid
    references public.profiles(id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (
    organization_id,
    teacher_profile_id,
    course_id
  ),

  check (
    valid_until is null
    or valid_from is null
    or valid_until >= valid_from
  )
);

create index if not exists
teacher_course_meb_authorizations_lookup_idx
on public.teacher_course_meb_authorizations (
  organization_id,
  teacher_profile_id,
  course_id,
  status
);

-- =========================================================
-- 3. Öğrencinin belirli bir ders kaydındaki MEB durumu
-- =========================================================

create table if not exists
public.enrollment_meb_registrations (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id)
    on delete cascade,

  enrollment_id uuid not null
    references public.enrollments(id)
    on delete cascade,

  student_id uuid not null
    references public.students(id)
    on delete cascade,

  course_id uuid not null
    references public.courses(id)
    on delete cascade,

  status text not null default 'unchecked'
    check (
      status in (
        'registered',
        'pending',
        'not_registered',
        'not_eligible',
        'rejected',
        'ended',
        'unchecked'
      )
    ),

  registration_number text,
  valid_from date,
  valid_until date,

  non_registration_reason text,
  note text,

  checked_at timestamptz,
  checked_by uuid
    references public.profiles(id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (enrollment_id),

  check (
    valid_until is null
    or valid_from is null
    or valid_until >= valid_from
  )
);

create index if not exists
enrollment_meb_registrations_lookup_idx
on public.enrollment_meb_registrations (
  organization_id,
  student_id,
  course_id,
  status
);

-- =========================================================
-- 4. updated_at triggerları
-- =========================================================

drop trigger if exists
teacher_course_meb_authorizations_set_updated_at
on public.teacher_course_meb_authorizations;

create trigger
teacher_course_meb_authorizations_set_updated_at
before update
on public.teacher_course_meb_authorizations
for each row
execute function public.set_updated_at();

drop trigger if exists
enrollment_meb_registrations_set_updated_at
on public.enrollment_meb_registrations;

create trigger
enrollment_meb_registrations_set_updated_at
before update
on public.enrollment_meb_registrations
for each row
execute function public.set_updated_at();

-- =========================================================
-- 5. Dersin MEB bilgisini güncelleme
-- =========================================================

create or replace function public.set_course_meb_info(
  p_course_id uuid,
  p_status text,
  p_program_name text,
  p_program_code text,
  p_approval_number text,
  p_valid_from date,
  p_valid_until date,
  p_note text
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
      'MEB ders bilgilerini değiştirme yetkiniz bulunmuyor.';
  end if;

  if p_status not in (
    'approved',
    'pending',
    'not_registered',
    'expired',
    'unchecked'
  ) then
    raise exception
      'Geçerli bir MEB ders durumu seçilmelidir.';
  end if;

  if p_valid_until is not null
     and p_valid_from is not null
     and p_valid_until < p_valid_from then
    raise exception
      'Geçerlilik bitiş tarihi başlangıç tarihinden önce olamaz.';
  end if;

  select pg_catalog.jsonb_build_object(
    'meb_status', c.meb_status,
    'meb_program_name', c.meb_program_name,
    'meb_program_code', c.meb_program_code,
    'meb_approval_number', c.meb_approval_number,
    'meb_valid_from', c.meb_valid_from,
    'meb_valid_until', c.meb_valid_until,
    'meb_note', c.meb_note
  )
  into v_old_data
  from public.courses c
  where c.id = p_course_id
    and c.organization_id = v_organization_id;

  if v_old_data is null then
    raise exception
      'Ders kaydı bulunamadı.';
  end if;

  update public.courses
  set
    meb_status = p_status,

    meb_program_name = nullif(
      pg_catalog.btrim(
        coalesce(p_program_name, '')
      ),
      ''
    ),

    meb_program_code = nullif(
      pg_catalog.btrim(
        coalesce(p_program_code, '')
      ),
      ''
    ),

    meb_approval_number = nullif(
      pg_catalog.btrim(
        coalesce(p_approval_number, '')
      ),
      ''
    ),

    meb_valid_from = p_valid_from,
    meb_valid_until = p_valid_until,

    meb_note = nullif(
      pg_catalog.btrim(
        coalesce(p_note, '')
      ),
      ''
    )
  where id = p_course_id
    and organization_id = v_organization_id;

  v_new_data :=
    pg_catalog.jsonb_build_object(
      'meb_status', p_status,
      'meb_program_name',
        nullif(
          pg_catalog.btrim(
            coalesce(p_program_name, '')
          ),
          ''
        ),
      'meb_program_code',
        nullif(
          pg_catalog.btrim(
            coalesce(p_program_code, '')
          ),
          ''
        ),
      'meb_approval_number',
        nullif(
          pg_catalog.btrim(
            coalesce(p_approval_number, '')
          ),
          ''
        ),
      'meb_valid_from', p_valid_from,
      'meb_valid_until', p_valid_until,
      'meb_note',
        nullif(
          pg_catalog.btrim(
            coalesce(p_note, '')
          ),
          ''
        )
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
    'set_meb_info',
    v_old_data,
    v_new_data
  );
end;
$$;

-- =========================================================
-- 6. Öğretmen-ders MEB yetkisini güncelleme
-- =========================================================

create or replace function
public.set_teacher_course_meb_authorization(
  p_teacher_profile_id uuid,
  p_course_id uuid,
  p_status text,
  p_document_number text,
  p_valid_from date,
  p_valid_until date,
  p_note text
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

  v_authorization_id uuid;
  v_old_data jsonb;
begin
  if v_user_id is null
     or v_organization_id is null then
    raise exception
      'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception
      'Öğretmen MEB yetkisini değiştirme yetkiniz bulunmuyor.';
  end if;

  if p_status not in (
    'approved',
    'pending',
    'not_registered',
    'expired',
    'unchecked'
  ) then
    raise exception
      'Geçerli bir öğretmen MEB durumu seçilmelidir.';
  end if;

  if p_valid_until is not null
     and p_valid_from is not null
     and p_valid_until < p_valid_from then
    raise exception
      'Geçerlilik bitiş tarihi başlangıç tarihinden önce olamaz.';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = p_teacher_profile_id
      and p.organization_id = v_organization_id
      and p.role in (
        'teacher'::public.app_role,
        'admin'::public.app_role
      )
  ) then
    raise exception
      'Öğretmen kaydı bulunamadı.';
  end if;

  if not exists (
    select 1
    from public.courses c
    where c.id = p_course_id
      and c.organization_id = v_organization_id
  ) then
    raise exception
      'Ders kaydı bulunamadı.';
  end if;

  select pg_catalog.to_jsonb(a)
  into v_old_data
  from public.teacher_course_meb_authorizations a
  where a.organization_id = v_organization_id
    and a.teacher_profile_id = p_teacher_profile_id
    and a.course_id = p_course_id;

  insert into public.teacher_course_meb_authorizations (
    organization_id,
    teacher_profile_id,
    course_id,
    status,
    document_number,
    valid_from,
    valid_until,
    note,
    checked_at,
    checked_by
  )
  values (
    v_organization_id,
    p_teacher_profile_id,
    p_course_id,
    p_status,

    nullif(
      pg_catalog.btrim(
        coalesce(p_document_number, '')
      ),
      ''
    ),

    p_valid_from,
    p_valid_until,

    nullif(
      pg_catalog.btrim(
        coalesce(p_note, '')
      ),
      ''
    ),

    pg_catalog.now(),
    v_user_id
  )
  on conflict (
    organization_id,
    teacher_profile_id,
    course_id
  )
  do update set
    status = excluded.status,
    document_number = excluded.document_number,
    valid_from = excluded.valid_from,
    valid_until = excluded.valid_until,
    note = excluded.note,
    checked_at = excluded.checked_at,
    checked_by = excluded.checked_by
  returning id into v_authorization_id;

  insert into public.audit_logs (
    organization_id,
    actor_profile_id,
    table_name,
    record_id,
    action,
    old_data,
    new_data
  )
  select
    v_organization_id,
    v_user_id,
    'teacher_course_meb_authorizations',
    v_authorization_id::text,
    'upsert',
    v_old_data,
    pg_catalog.to_jsonb(a)
  from public.teacher_course_meb_authorizations a
  where a.id = v_authorization_id;

  return v_authorization_id;
end;
$$;

-- =========================================================
-- 7. Öğrencinin ders bazlı MEB kaydını güncelleme
-- =========================================================

create or replace function
public.set_enrollment_meb_registration(
  p_enrollment_id uuid,
  p_status text,
  p_registration_number text,
  p_valid_from date,
  p_valid_until date,
  p_non_registration_reason text,
  p_note text
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

  v_registration_id uuid;
  v_student_id uuid;
  v_course_id uuid;
  v_old_data jsonb;
begin
  if v_user_id is null
     or v_organization_id is null then
    raise exception
      'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.can_manage_finance() then
    raise exception
      'Öğrenci MEB kaydını değiştirme yetkiniz bulunmuyor.';
  end if;

  if p_status not in (
    'registered',
    'pending',
    'not_registered',
    'not_eligible',
    'rejected',
    'ended',
    'unchecked'
  ) then
    raise exception
      'Geçerli bir öğrenci MEB durumu seçilmelidir.';
  end if;

  if p_valid_until is not null
     and p_valid_from is not null
     and p_valid_until < p_valid_from then
    raise exception
      'Geçerlilik bitiş tarihi başlangıç tarihinden önce olamaz.';
  end if;

  select
    e.student_id,
    e.course_id
  into
    v_student_id,
    v_course_id
  from public.enrollments e
  where e.id = p_enrollment_id
    and e.organization_id = v_organization_id;

  if v_student_id is null then
    raise exception
      'Öğrenci ders kaydı bulunamadı.';
  end if;

  select pg_catalog.to_jsonb(r)
  into v_old_data
  from public.enrollment_meb_registrations r
  where r.enrollment_id = p_enrollment_id;

  insert into public.enrollment_meb_registrations (
    organization_id,
    enrollment_id,
    student_id,
    course_id,
    status,
    registration_number,
    valid_from,
    valid_until,
    non_registration_reason,
    note,
    checked_at,
    checked_by
  )
  values (
    v_organization_id,
    p_enrollment_id,
    v_student_id,
    v_course_id,
    p_status,

    nullif(
      pg_catalog.btrim(
        coalesce(p_registration_number, '')
      ),
      ''
    ),

    p_valid_from,
    p_valid_until,

    nullif(
      pg_catalog.btrim(
        coalesce(p_non_registration_reason, '')
      ),
      ''
    ),

    nullif(
      pg_catalog.btrim(
        coalesce(p_note, '')
      ),
      ''
    ),

    pg_catalog.now(),
    v_user_id
  )
  on conflict (enrollment_id)
  do update set
    status = excluded.status,
    registration_number =
      excluded.registration_number,
    valid_from = excluded.valid_from,
    valid_until = excluded.valid_until,
    non_registration_reason =
      excluded.non_registration_reason,
    note = excluded.note,
    checked_at = excluded.checked_at,
    checked_by = excluded.checked_by
  returning id into v_registration_id;

  insert into public.audit_logs (
    organization_id,
    actor_profile_id,
    table_name,
    record_id,
    action,
    old_data,
    new_data
  )
  select
    v_organization_id,
    v_user_id,
    'enrollment_meb_registrations',
    v_registration_id::text,
    'upsert',
    v_old_data,
    pg_catalog.to_jsonb(r)
  from public.enrollment_meb_registrations r
  where r.id = v_registration_id;

  return v_registration_id;
end;
$$;

-- =========================================================
-- 8. Öğretmenin aylık MEB kontrol listesini döndürme
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

  v_organization_id uuid :=
    public.current_organization_id();

  v_role public.app_role :=
    public.current_app_role();

  v_month_start date :=
    pg_catalog.date_trunc(
      'month',
      p_month_start::timestamp
    )::date;

  v_month_end date :=
    (
      pg_catalog.date_trunc(
        'month',
        p_month_start::timestamp
      )
      + interval '1 month'
      - interval '1 day'
    )::date;
begin
  if v_user_id is null
     or v_organization_id is null then
    raise exception
      'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if v_role not in (
    'admin'::public.app_role,
    'finance'::public.app_role,
    'teacher'::public.app_role
  ) then
    raise exception
      'MEB yoklama listesini görüntüleme yetkiniz bulunmuyor.';
  end if;

  return query
  with roster as (
    select
      e.id as enrollment_id,
      s.id as student_id,

      s.first_name || ' ' ||
        s.last_name as student_full_name,

      c.id as course_id,
      c.name as course_name,

      cg.id as class_group_id,
      cg.name as class_group_name,
      cg.weekday::integer as weekday,
      cg.start_time,

      coalesce(
        e.teacher_profile_id,
        cg.teacher_profile_id
      ) as teacher_profile_id,

      p.full_name as teacher_full_name,

      e.status::text as enrollment_status,

      c.meb_status as course_meb_status,

      coalesce(
        ta.status,
        'unchecked'
      ) as teacher_meb_status,

      coalesce(
        emr.status,
        'unchecked'
      ) as student_meb_status,

      emr.valid_from
        as student_meb_valid_from,

      emr.valid_until
        as student_meb_valid_until,

      (
        e.status =
          'active'::public.enrollment_status
        and e.starts_on <= v_month_end
        and (
          e.ends_on is null
          or e.ends_on >= v_month_start
        )
      ) as enrollment_active,

      (
        c.meb_status = 'approved'
        and (
          c.meb_valid_from is null
          or c.meb_valid_from <= v_month_end
        )
        and (
          c.meb_valid_until is null
          or c.meb_valid_until >= v_month_start
        )
      ) as course_ok,

      (
        coalesce(
          ta.status,
          'unchecked'
        ) = 'approved'
        and (
          ta.valid_from is null
          or ta.valid_from <= v_month_end
        )
        and (
          ta.valid_until is null
          or ta.valid_until >= v_month_start
        )
      ) as teacher_ok,

      (
        coalesce(
          emr.status,
          'unchecked'
        ) = 'registered'
        and (
          emr.valid_from is null
          or emr.valid_from <= v_month_end
        )
        and (
          emr.valid_until is null
          or emr.valid_until >= v_month_start
        )
      ) as student_ok

    from public.enrollments e

    inner join public.students s
      on s.id = e.student_id

    inner join public.courses c
      on c.id = e.course_id

    left join public.class_groups cg
      on cg.id = e.class_group_id

    left join public.profiles p
      on p.id = coalesce(
        e.teacher_profile_id,
        cg.teacher_profile_id
      )

    left join
      public.teacher_course_meb_authorizations ta
      on ta.organization_id =
        e.organization_id
      and ta.course_id = e.course_id
      and ta.teacher_profile_id =
        coalesce(
          e.teacher_profile_id,
          cg.teacher_profile_id
        )

    left join
      public.enrollment_meb_registrations emr
      on emr.enrollment_id = e.id

    where e.organization_id =
      v_organization_id

      and e.starts_on <= v_month_end

      and (
        e.ends_on is null
        or e.ends_on >= v_month_start
      )

      and (
        v_role in (
          'admin'::public.app_role,
          'finance'::public.app_role
        )
        or coalesce(
          e.teacher_profile_id,
          cg.teacher_profile_id
        ) = v_user_id
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
      when
        r.enrollment_active
        and r.course_ok
        and r.teacher_ok
        and r.student_ok
      then 'compliant'

      when
        r.course_meb_status in (
          'not_registered',
          'expired'
        )
        or r.teacher_profile_id is null
        or r.teacher_meb_status in (
          'not_registered',
          'expired'
        )
        or r.student_meb_status in (
          'not_registered',
          'not_eligible',
          'rejected',
          'ended'
        )
        or not r.enrollment_active
      then 'non_compliant'

      else 'pending'
    end as compliance_status,

    (
      r.enrollment_active
      and r.course_ok
      and r.teacher_ok
      and r.student_ok
    ) as include_in_meb_register,

    pg_catalog.concat_ws(
      '; ',

      case
        when not r.enrollment_active
        then
          'Kurum içi ders kaydı bu ay aktif değil'
      end,

      case
        when not r.course_ok
        then
          'Dersin MEB kaydı uygun değil'
      end,

      case
        when r.teacher_profile_id is null
        then
          'Derse öğretmen atanmamış'
      end,

      case
        when r.teacher_profile_id is not null
             and not r.teacher_ok
        then
          'Öğretmenin bu ders için MEB çalışma izni uygun değil'
      end,

      case
        when not r.student_ok
        then
          'Öğrencinin bu ders için MEB kaydı uygun değil'
      end
    ) as compliance_reason

  from roster r

  order by
    r.weekday,
    r.start_time,
    r.course_name,
    r.student_full_name;
end;
$$;

-- =========================================================
-- 9. RLS
-- =========================================================

alter table
public.teacher_course_meb_authorizations
enable row level security;

alter table
public.enrollment_meb_registrations
enable row level security;

drop policy if exists
teacher_course_meb_authorizations_select
on public.teacher_course_meb_authorizations;

create policy
teacher_course_meb_authorizations_select
on public.teacher_course_meb_authorizations
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
    or teacher_profile_id = auth.uid()
  )
);

drop policy if exists
teacher_course_meb_authorizations_admin_manage
on public.teacher_course_meb_authorizations;

create policy
teacher_course_meb_authorizations_admin_manage
on public.teacher_course_meb_authorizations
for all
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
enrollment_meb_registrations_select
on public.enrollment_meb_registrations;

create policy
enrollment_meb_registrations_select
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
    or exists (
      select 1
      from public.enrollments e
      left join public.class_groups cg
        on cg.id = e.class_group_id
      where e.id = enrollment_id
        and coalesce(
          e.teacher_profile_id,
          cg.teacher_profile_id
        ) = auth.uid()
    )
  )
);

drop policy if exists
enrollment_meb_registrations_manage
on public.enrollment_meb_registrations;

create policy
enrollment_meb_registrations_manage
on public.enrollment_meb_registrations
for all
to authenticated
using (
  organization_id =
    public.current_organization_id()
  and public.can_manage_finance()
)
with check (
  organization_id =
    public.current_organization_id()
  and public.can_manage_finance()
);

-- =========================================================
-- 10. Yetkiler
-- =========================================================

grant select
on public.teacher_course_meb_authorizations
to authenticated;

grant select
on public.enrollment_meb_registrations
to authenticated;

revoke insert, update, delete
on public.teacher_course_meb_authorizations
from authenticated;

revoke insert, update, delete
on public.enrollment_meb_registrations
from authenticated;

revoke all
on function public.set_course_meb_info(
  uuid,
  text,
  text,
  text,
  text,
  date,
  date,
  text
)
from public, anon;

grant execute
on function public.set_course_meb_info(
  uuid,
  text,
  text,
  text,
  text,
  date,
  date,
  text
)
to authenticated;

revoke all
on function
public.set_teacher_course_meb_authorization(
  uuid,
  uuid,
  text,
  text,
  date,
  date,
  text
)
from public, anon;

grant execute
on function
public.set_teacher_course_meb_authorization(
  uuid,
  uuid,
  text,
  text,
  date,
  date,
  text
)
to authenticated;

revoke all
on function
public.set_enrollment_meb_registration(
  uuid,
  text,
  text,
  date,
  date,
  text,
  text
)
from public, anon;

grant execute
on function
public.set_enrollment_meb_registration(
  uuid,
  text,
  text,
  date,
  date,
  text,
  text
)
to authenticated;

revoke all
on function public.get_meb_monthly_roster(date)
from public, anon;

grant execute
on function public.get_meb_monthly_roster(date)
to authenticated;

notify pgrst, 'reload schema';