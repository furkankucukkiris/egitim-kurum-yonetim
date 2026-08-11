-- Aylık ders oturumu ve tahakkuk üretimini, yöneticinin elle
-- tetiklemesine gerek kalmadan, kurum bazlı yapılandırılmış bir günde
-- otomatik çalıştırır. Zamanlama için Supabase/pg_cron seçildi (Vercel
-- Cron değil): iş mantığı zaten tamamen veritabanında (security definer
-- fonksiyonlar) yaşıyor, pg_cron doğrudan bu fonksiyonları çağırarak
-- HTTP/secret yönetimi gerektiren bir dış tetikleyiciye ihtiyaç
-- bırakmıyor ve uygulamanın hangi platformda barındırıldığından
-- bağımsız çalışıyor.
--
-- Tasarım özeti:
--   1) generate_monthly_lesson_sessions/generate_monthly_accruals RPC'lerinin
--      mevcut gövdesi, kurum kimliğini auth.uid() üzerinden DEĞİL, açık
--      parametre olarak alan _for_org fonksiyonlarına taşındı. Mevcut
--      RPC'ler artık ince birer sarmalayıcı: aynı imza, aynı hata
--      mesajları, aynı yetki kontrolü — mevcut /yoklama ve /odemeler
--      "elle oluştur" butonları hiç değişmeden acil durum yedeği olarak
--      çalışmaya devam eder.
--   2) run_monthly_automation_job() bu _for_org fonksiyonlarını, bir
--      automation_job_runs satırı içinde çağırır: başarı/başarısızlık
--      counts/error_summary olarak kaydedilir. plpgsql'de exception
--      bloğu bir savepoint'tir — hata durumunda _for_org içindeki KISMİ
--      insert'ler (ör. bazı oturumlar eklenip audit_logs satırından önce
--      patlarsa) tamamen geri alınır, yalnızca "running" satırı
--      "failed"e güncellenir; yarım kalan veri kalmaz.
--   3) run_daily_automation_sweep() pg_cron tarafından HER GÜN bir kez
--      çağrılır; her aktif kurum için o günün tarihi kurumun
--      sessions_generation_day/accruals_generation_day değerine
--      eşitse (kurum saat dilimine göre) ve o dönem için henüz
--      başarılı bir çalışma yoksa run_monthly_automation_job()'ı
--      tetikler. Böylece "hangi günde üretilecek" ayarı değiştiğinde
--      pg_cron'u yeniden zamanlamaya gerek kalmaz — sweep zaten her gün
--      çalışıp kontrol ediyor.
--   4) Servis rolü çağrıları (pg_cron ve admin panelindeki "yeniden
--      dene" butonu) organization_id'yi HER ZAMAN açık parametre olarak
--      alır ve run_monthly_automation_job() bu id'nin organizations
--      tablosunda var olduğunu doğrular — auth.uid()/current_organization_id()'a
--      güvenilmez çünkü pg_cron'un bağlı bir kullanıcı oturumu yoktur.

create extension if not exists pg_cron;

-- 1) Kurum bazlı otomasyon ayarları
-- (whatsapp_reminder_day ile aynı 1-28 deseni — kısa aylarda gün
-- kaymasını önlemek için 29-31 bilinçli olarak dışarıda bırakıldı.)

alter table public.organizations
add column if not exists monthly_automation_enabled boolean
  not null default true;

alter table public.organizations
add column if not exists sessions_generation_day smallint
  not null default 25
  check (sessions_generation_day between 1 and 28);

alter table public.organizations
add column if not exists accruals_generation_day smallint
  not null default 25
  check (accruals_generation_day between 1 and 28);

-- 2) İş türü / durumu enum'ları

do $$
begin
  create type public.automation_job_type
    as enum ('lesson_sessions', 'accruals');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.automation_job_status
    as enum ('running', 'succeeded', 'failed');
exception
  when duplicate_object then null;
end
$$;

-- 3) İş geçmişi tablosu — her ÇALIŞTIRMA DENEMESİ ayrı bir satır
-- (aynı dönem için başarılı bir yeniden deneme, önceki başarısız
-- denemeyi silmez/değiştirmez; tam denetim izi bu şekilde korunur).

create table if not exists public.automation_job_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id),
  job_type public.automation_job_type not null,
  period date not null,
  status public.automation_job_status
    not null default 'running',
  started_at timestamptz not null default pg_catalog.now(),
  finished_at timestamptz,
  counts jsonb,
  error_summary text,
  triggered_by text not null default 'schedule'
    check (triggered_by in ('schedule', 'manual_retry')),
  triggered_by_profile_id uuid
    references public.profiles(id),
  created_at timestamptz not null default pg_catalog.now()
);

create index if not exists
automation_job_runs_org_type_period_idx
on public.automation_job_runs (
  organization_id,
  job_type,
  period desc
);

-- Aynı kurum + iş türü + dönem için eşzamanlı iki "running" satırı
-- olamaz — run_monthly_automation_job() içindeki advisory lock ana
-- savunma, bu da veritabanı seviyesinde son savunma.

create unique index if not exists
automation_job_runs_running_unique
on public.automation_job_runs (
  organization_id,
  job_type,
  period
)
where status = 'running';

alter table public.automation_job_runs enable row level security;

drop policy if exists
automation_job_runs_select_org
on public.automation_job_runs;

create policy automation_job_runs_select_org
on public.automation_job_runs
for select
to authenticated
using (
  organization_id =
    public.current_organization_id()
  and public.is_admin()
);

revoke insert, update, delete
on public.automation_job_runs
from authenticated;

grant select
on public.automation_job_runs
to authenticated;

-- 4) generate_monthly_lesson_sessions'ın kurum-parametreli çekirdeği.
-- Mevcut RPC'nin gövdesiyle birebir aynı, yalnızca v_organization_id
-- auth.uid() yerine p_organization_id parametresinden geliyor ve
-- yetki kontrolü (is_admin) burada YOK — çağıran taraf sorumlu.

create or replace function
public._generate_monthly_lesson_sessions_for_org(
  p_organization_id uuid,
  p_month_start date,
  p_actor_profile_id uuid
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
  v_month_start date;
  v_month_end date;

  v_expected_count integer := 0;
  v_created_count integer := 0;
  v_skipped_group_count integer := 0;
  v_first_session_date date;
begin
  if p_organization_id is null then
    raise exception
      'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text
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
    p_organization_id
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
    p_organization_id
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
    p_organization_id
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
    p_organization_id
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
    p_organization_id,
    p_actor_profile_id,
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

revoke all on function
public._generate_monthly_lesson_sessions_for_org(uuid, date, uuid)
from public, anon, authenticated;

-- 5) generate_monthly_lesson_sessions artık ince bir sarmalayıcı:
-- aynı yetki kontrolü + hata mesajları, gövde _for_org'a taşındı.

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

  return query
  select *
  from public._generate_monthly_lesson_sessions_for_org(
    v_organization_id,
    p_month_start,
    v_user_id
  );
end;
$$;

revoke all on function
public.generate_monthly_lesson_sessions(date)
from public, anon;

grant execute
on function
public.generate_monthly_lesson_sessions(date)
to authenticated;

-- 6) generate_monthly_accruals'ın kurum-parametreli çekirdeği.

create or replace function
public._generate_monthly_accruals_for_org(
  p_organization_id uuid,
  p_month_start date,
  p_actor_profile_id uuid
)
returns table (
  created_count integer,
  existing_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month_start date;
  v_month_end date;
  v_expected_count integer := 0;
  v_created_count integer := 0;
begin
  if p_organization_id is null then
    raise exception
      'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if p_month_start is null then
    raise exception
      'Tahakkukların oluşturulacağı ay seçilmelidir.';
  end if;

  v_month_start :=
    pg_catalog.date_trunc('month', p_month_start::timestamp)::date;

  v_month_end :=
    (
      pg_catalog.date_trunc('month', p_month_start::timestamp)
      + interval '1 month'
      - interval '1 day'
    )::date;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':accrual:' || v_month_start::text,
      2026080812
    )
  );

  select count(*)::integer
  into v_expected_count
  from public.enrollments e
  where e.organization_id = p_organization_id
    and e.status = 'active'::public.enrollment_status
    and e.starts_on <= v_month_end
    and (e.ends_on is null or e.ends_on >= v_month_start);

  with inserted as (
    insert into public.accruals (
      organization_id,
      enrollment_id,
      student_id,
      period_start,
      due_date,
      description,
      gross_amount,
      discount_amount,
      net_amount,
      status
    )
    select
      e.organization_id,
      e.id,
      e.student_id,
      v_month_start,
      least(
        (v_month_start + ((e.due_day - 1) || ' days')::interval)::date,
        v_month_end
      ),
      public.tr_month_name(extract(month from v_month_start)::integer)
        || ' ' || extract(year from v_month_start)::text || ' aidatı',
      e.list_monthly_fee,
      e.list_monthly_fee - e.net_monthly_fee,
      e.net_monthly_fee,
      'open'::public.accrual_status
    from public.enrollments e
    where e.organization_id = p_organization_id
      and e.status = 'active'::public.enrollment_status
      and e.starts_on <= v_month_end
      and (e.ends_on is null or e.ends_on >= v_month_start)
    on conflict (enrollment_id, period_start) do nothing
    returning 1
  )
  select count(*)::integer into v_created_count from inserted;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id,
    action, old_data, new_data
  )
  values (
    p_organization_id, p_actor_profile_id, 'accruals', v_month_start::text,
    'generate_month', null,
    pg_catalog.jsonb_build_object(
      'month_start', v_month_start,
      'month_end', v_month_end,
      'created_count', v_created_count,
      'existing_count', greatest(v_expected_count - v_created_count, 0)
    )
  );

  return query
  select v_created_count, greatest(v_expected_count - v_created_count, 0);
end;
$$;

revoke all on function
public._generate_monthly_accruals_for_org(uuid, date, uuid)
from public, anon, authenticated;

-- 7) generate_monthly_accruals de aynı şekilde ince sarmalayıcı oldu.

create or replace function public.generate_monthly_accruals(
  p_month_start date
)
returns table (
  created_count integer,
  existing_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
begin
  if v_user_id is null or v_organization_id is null then
    raise exception
      'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.can_manage_finance() then
    raise exception
      'Aylık tahakkuk oluşturma yetkiniz bulunmuyor.';
  end if;

  return query
  select *
  from public._generate_monthly_accruals_for_org(
    v_organization_id,
    p_month_start,
    v_user_id
  );
end;
$$;

revoke all on function public.generate_monthly_accruals(date)
from public, anon;
grant execute on function public.generate_monthly_accruals(date)
to authenticated;

-- 8) Otomasyon iş çalıştırıcısı. pg_cron (zamanlanmış) ve admin
-- panelindeki "yeniden dene" butonu (service_role üzerinden) tarafından
-- çağrılır. organization_id her zaman açık parametre — çağıranın
-- oturumuna güvenilmez.

create or replace function public.run_monthly_automation_job(
  p_organization_id uuid,
  p_job_type public.automation_job_type,
  p_period date,
  p_triggered_by text default 'schedule',
  p_triggered_by_profile_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_run_id uuid;
  v_month_start date :=
    pg_catalog.date_trunc('month', p_period::timestamp)::date;
  v_lock_key bigint;
  v_sessions_result record;
  v_accruals_result record;
begin
  if p_organization_id is null
     or not exists (
       select 1 from public.organizations
       where id = p_organization_id
     )
  then
    raise exception 'Geçersiz kurum kimliği.';
  end if;

  if p_period is null then
    raise exception 'Dönem seçilmelidir.';
  end if;

  if p_triggered_by not in ('schedule', 'manual_retry') then
    raise exception 'Geçersiz tetikleme kaynağı.';
  end if;

  -- Yeniden deneme yalnızca ilgili kurumun aktif bir yöneticisi
  -- tarafından tetiklenebilir (schedule için profil id zaten null).
  if p_triggered_by_profile_id is not null
     and not exists (
       select 1 from public.profiles
       where id = p_triggered_by_profile_id
         and organization_id = p_organization_id
         and role = 'admin'::public.app_role
         and is_active = true
     )
  then
    raise exception
      'Otomasyon işini yeniden deneme yetkiniz bulunmuyor.';
  end if;

  v_lock_key := pg_catalog.hashtextextended(
    p_organization_id::text
    || ':automation:'
    || p_job_type::text
    || ':'
    || v_month_start::text,
    2026081200
  );

  perform pg_catalog.pg_advisory_xact_lock(v_lock_key);

  if exists (
    select 1 from public.automation_job_runs
    where organization_id = p_organization_id
      and job_type = p_job_type
      and period = v_month_start
      and status = 'running'
  ) then
    raise exception
      'Bu dönem için zaten çalışan bir otomasyon işi var.';
  end if;

  insert into public.automation_job_runs (
    organization_id, job_type, period, status,
    triggered_by, triggered_by_profile_id
  ) values (
    p_organization_id, p_job_type, v_month_start, 'running',
    p_triggered_by, p_triggered_by_profile_id
  )
  returning id into v_job_run_id;

  -- BEGIN/EXCEPTION plpgsql'de bir savepoint'tir: içeride oluşan bir
  -- hata, bu blokta (ve çağrılan _for_org fonksiyonu içinde) o ana
  -- kadar yapılmış TÜM insert/update'leri geri alır — yarım kalmış
  -- oturum/tahakkuk satırı kalmaz. Yalnızca job_runs satırının
  -- kendisi (blok dışında insert edildiği için) kalıcı olur ve hemen
  -- altında 'failed' olarak güncellenir.
  begin
    if p_job_type = 'lesson_sessions'::public.automation_job_type then
      select * into v_sessions_result
      from public._generate_monthly_lesson_sessions_for_org(
        p_organization_id, v_month_start, p_triggered_by_profile_id
      );

      update public.automation_job_runs
      set status = 'succeeded',
          finished_at = pg_catalog.now(),
          counts = pg_catalog.jsonb_build_object(
            'created_count', v_sessions_result.created_count,
            'existing_count', v_sessions_result.existing_count,
            'skipped_group_count', v_sessions_result.skipped_group_count
          )
      where id = v_job_run_id;

    elsif p_job_type = 'accruals'::public.automation_job_type then
      select * into v_accruals_result
      from public._generate_monthly_accruals_for_org(
        p_organization_id, v_month_start, p_triggered_by_profile_id
      );

      update public.automation_job_runs
      set status = 'succeeded',
          finished_at = pg_catalog.now(),
          counts = pg_catalog.jsonb_build_object(
            'created_count', v_accruals_result.created_count,
            'existing_count', v_accruals_result.existing_count
          )
      where id = v_job_run_id;
    end if;
  exception when others then
    update public.automation_job_runs
    set status = 'failed',
        finished_at = pg_catalog.now(),
        error_summary = pg_catalog."left"(sqlerrm, 500)
    where id = v_job_run_id;
  end;

  return v_job_run_id;
end;
$$;

revoke all on function
public.run_monthly_automation_job(
  uuid, public.automation_job_type, date, text, uuid
)
from public, anon, authenticated;

grant execute
on function
public.run_monthly_automation_job(
  uuid, public.automation_job_type, date, text, uuid
)
to service_role;

-- 9) Günlük tarayıcı. pg_cron tarafından her gün bir kez çağrılır;
-- her aktif kurum için o günün (kurum saat dilimindeki) tarihi
-- yapılandırılmış üretim gününe denk geliyorsa ve gelecek ay için
-- henüz başarılı bir çalıştırma yoksa işi tetikler. Üretim günü
-- değiştiğinde pg_cron'u yeniden zamanlamaya gerek yok — bu fonksiyon
-- zaten her gün kontrol ediyor.

create or replace function public.run_daily_automation_sweep()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org record;
  v_local_today date;
  v_next_month_start date;
begin
  for v_org in
    select
      id,
      timezone,
      sessions_generation_day,
      accruals_generation_day
    from public.organizations
    where monthly_automation_enabled = true
  loop
    v_local_today :=
      (
        pg_catalog.now()
        at time zone coalesce(v_org.timezone, 'Europe/Istanbul')
      )::date;

    v_next_month_start :=
      (
        pg_catalog.date_trunc('month', v_local_today::timestamp)
        + interval '1 month'
      )::date;

    if extract(day from v_local_today)::integer
         = v_org.sessions_generation_day
       and not exists (
         select 1 from public.automation_job_runs
         where organization_id = v_org.id
           and job_type = 'lesson_sessions'::public.automation_job_type
           and period = v_next_month_start
           and status = 'succeeded'
       )
    then
      perform public.run_monthly_automation_job(
        v_org.id,
        'lesson_sessions'::public.automation_job_type,
        v_next_month_start,
        'schedule',
        null
      );
    end if;

    if extract(day from v_local_today)::integer
         = v_org.accruals_generation_day
       and not exists (
         select 1 from public.automation_job_runs
         where organization_id = v_org.id
           and job_type = 'accruals'::public.automation_job_type
           and period = v_next_month_start
           and status = 'succeeded'
       )
    then
      perform public.run_monthly_automation_job(
        v_org.id,
        'accruals'::public.automation_job_type,
        v_next_month_start,
        'schedule',
        null
      );
    end if;
  end loop;
end;
$$;

revoke all on function public.run_daily_automation_sweep()
from public, anon, authenticated;

-- 10) pg_cron zamanlaması — her gün 01:00 UTC'de (~04:00 İstanbul)
-- bir kez çalışır. Migration tekrar çalıştırılabilir olsun diye önce
-- aynı isimdeki iş varsa kaldırılıyor.

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'monthly-generation-daily-sweep';

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
end
$$;

select cron.schedule(
  'monthly-generation-daily-sweep',
  '0 1 * * *',
  $$select public.run_daily_automation_sweep();$$
);

notify pgrst, 'reload schema';
