-- Haftalık ders programlarından gerçek aylık ders oturumları üretir.
-- Aynı program, tarih ve saat için mükerrer normal oturum oluşmaz.

create unique index if not exists
lesson_sessions_regular_group_start_unique
on public.lesson_sessions (
  organization_id,
  class_group_id,
  starts_at
)
where
  class_group_id is not null
  and is_makeup = false;

create or replace function
public.generate_monthly_lesson_sessions(
  p_month_start date
)
returns table (
  created_count integer,
  existing_count integer,
  skipped_group_count integer,
  first_session_date date
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();

  v_organization_id uuid :=
    public.current_organization_id();

  v_month_start date;
  v_month_end date;

  v_expected_count integer := 0;
  v_created_count integer := 0;
  v_skipped_group_count integer := 0;
  v_first_session_date date;
begin
  if v_user_id is null
     or v_organization_id is null then
    raise exception
      'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception
      'Aylık ders oturumu oluşturma yetkiniz bulunmuyor.';
  end if;

  if p_month_start is null then
    raise exception
      'Oturumların oluşturulacağı ay seçilmelidir.';
  end if;

  v_month_start :=
    pg_catalog.date_trunc(
      'month',
      p_month_start::timestamp
    )::date;

  v_month_end :=
    (
      pg_catalog.date_trunc(
        'month',
        p_month_start::timestamp
      )
      + interval '1 month'
      - interval '1 day'
    )::date;

  /*
   * Aynı kurum ve ay için eş zamanlı iki üretim işlemi
   * çalıştırılmasın. Benzersiz indeks ayrıca son savunmadır.
   */
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_organization_id::text
      || ':'
      || v_month_start::text,
      2026072723
    )
  );

  select count(*)::integer
  into v_skipped_group_count
  from public.class_groups cg
  inner join public.courses c
    on c.id = cg.course_id
    and c.organization_id =
      cg.organization_id
  left join public.profiles teacher
    on teacher.id =
      cg.teacher_profile_id
    and teacher.organization_id =
      cg.organization_id
    and teacher.role =
      'teacher'::public.app_role
    and teacher.is_active = true
  where cg.organization_id =
    v_organization_id
    and cg.is_active = true
    and c.is_active = true
    and cg.starts_on is not null
    and cg.starts_on <= v_month_end
    and (
      cg.ends_on is null
      or cg.ends_on >= v_month_start
    )
    and teacher.id is null;

  select count(*)::integer
  into v_expected_count
  from public.class_groups cg
  inner join public.courses c
    on c.id = cg.course_id
    and c.organization_id =
      cg.organization_id
    and c.is_active = true
  inner join public.profiles teacher
    on teacher.id =
      cg.teacher_profile_id
    and teacher.organization_id =
      cg.organization_id
    and teacher.role =
      'teacher'::public.app_role
    and teacher.is_active = true
  cross join lateral pg_catalog.generate_series(
    v_month_start::timestamp,
    v_month_end::timestamp,
    interval '1 day'
  ) as generated(day_value)
  where cg.organization_id =
    v_organization_id
    and cg.is_active = true
    and cg.starts_on is not null
    and cg.weekday is not null
    and cg.start_time is not null
    and generated.day_value::date >=
      cg.starts_on
    and (
      cg.ends_on is null
      or generated.day_value::date <=
        cg.ends_on
    )
    and extract(
      isodow
      from generated.day_value
    )::integer = cg.weekday;

  insert into public.lesson_sessions (
    organization_id,
    class_group_id,
    course_id,
    teacher_profile_id,
    starts_at,
    ends_at,
    room_name,
    is_makeup
  )
  select
    cg.organization_id,
    cg.id,
    cg.course_id,
    cg.teacher_profile_id,

    (
      (
        generated.day_value::date
        + cg.start_time
      )
      at time zone
        coalesce(
          organization.timezone,
          'Europe/Istanbul'
        )
    ) as starts_at,

    (
      (
        generated.day_value::date
        + cg.start_time
      )
      at time zone
        coalesce(
          organization.timezone,
          'Europe/Istanbul'
        )
    )
    + (
      cg.duration_minutes
      * interval '1 minute'
    ) as ends_at,

    cg.room_name,
    false

  from public.class_groups cg

  inner join public.organizations organization
    on organization.id =
      cg.organization_id

  inner join public.courses c
    on c.id = cg.course_id
    and c.organization_id =
      cg.organization_id
    and c.is_active = true

  inner join public.profiles teacher
    on teacher.id =
      cg.teacher_profile_id
    and teacher.organization_id =
      cg.organization_id
    and teacher.role =
      'teacher'::public.app_role
    and teacher.is_active = true

  cross join lateral pg_catalog.generate_series(
    v_month_start::timestamp,
    v_month_end::timestamp,
    interval '1 day'
  ) as generated(day_value)

  where cg.organization_id =
    v_organization_id
    and cg.is_active = true
    and cg.starts_on is not null
    and cg.weekday is not null
    and cg.start_time is not null
    and generated.day_value::date >=
      cg.starts_on
    and (
      cg.ends_on is null
      or generated.day_value::date <=
        cg.ends_on
    )
    and extract(
      isodow
      from generated.day_value
    )::integer = cg.weekday

  on conflict (
    organization_id,
    class_group_id,
    starts_at
  )
  where
    class_group_id is not null
    and is_makeup = false
  do nothing;

  get diagnostics
    v_created_count = row_count;

  select min(
    (
      ls.starts_at
      at time zone
        coalesce(
          organization.timezone,
          'Europe/Istanbul'
        )
    )::date
  )
  into v_first_session_date
  from public.lesson_sessions ls
  inner join public.organizations organization
    on organization.id =
      ls.organization_id
  where ls.organization_id =
    v_organization_id
    and ls.starts_at >=
      (
        v_month_start::timestamp
        at time zone
          coalesce(
            organization.timezone,
            'Europe/Istanbul'
          )
      )
    and ls.starts_at <
      (
        (
          v_month_end
          + 1
        )::timestamp
        at time zone
          coalesce(
            organization.timezone,
            'Europe/Istanbul'
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
    'lesson_sessions',
    v_month_start::text,
    'generate_month',
    null,
    pg_catalog.jsonb_build_object(
      'month_start', v_month_start,
      'month_end', v_month_end,
      'created_count',
        v_created_count,
      'existing_count',
        greatest(
          v_expected_count
          - v_created_count,
          0
        ),
      'skipped_group_count',
        v_skipped_group_count
    )
  );

  return query
  select
    v_created_count,
    greatest(
      v_expected_count
      - v_created_count,
      0
    ),
    v_skipped_group_count,
    v_first_session_date;
end;
$$;

drop policy if exists
sessions_select_org
on public.lesson_sessions;

drop policy if exists
sessions_select_scoped
on public.lesson_sessions;

create policy sessions_select_scoped
on public.lesson_sessions
for select
to authenticated
using (
  organization_id =
    public.current_organization_id()
  and (
    public.is_admin()
    or (
      public.current_app_role() =
        'teacher'::public.app_role
      and teacher_profile_id =
        auth.uid()
    )
  )
);

revoke insert, update, delete
on public.lesson_sessions
from authenticated;

grant select
on public.lesson_sessions
to authenticated;

revoke all
on function
public.generate_monthly_lesson_sessions(date)
from public, anon;

grant execute
on function
public.generate_monthly_lesson_sessions(date)
to authenticated;

notify pgrst, 'reload schema';
