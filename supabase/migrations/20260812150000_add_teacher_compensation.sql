-- Öğretmen hakediş (tazminat) modülü. teacher_work_logs
-- (20260725103000) şimdiye kadar hiç kullanılmıyordu — bu migration
-- onu gerçek ders oturumlarına/yoklamaya bağlayarak idempotent
-- hakediş üretimine, onay/ödeme iş akışına ve öğretmen bazlı
-- görünürlüğe kavuşturuyor.
--
-- Tasarım özeti:
--   1) teacher_compensation_rules: öğretmen başına, etkin tarih
--      aralıklı ücret kuralları. Dört model: per_lesson (sabit/ders),
--      per_minute (dakika başı), per_student (katılan öğrenci başı),
--      monthly_salary (sabit aylık). İptal/telafi için ayrı, düz
--      (formülsüz) geçersiz kılma tutarları.
--   2) generate_teacher_compensation(month): tamamlanmış VE
--      onaylanmış (yoklaması kilitlenmiş YA DA iptal edilmiş —
--      cancel_lesson_session() zaten kilitli bir oturumun iptaline
--      izin vermiyor, bu yüzden "iptal edilmiş" kendi başına bir
--      sonlanma durumudur) oturumlardan hakediş satırı üretir. Dört
--      senaryo AYRI ele alınır:
--        - normal: kuralın compensation_type'ına göre hesaplanır,
--        - institution_cancelled: kuralın düz cancellation_rate_amount'ı
--          (yapılandırılmamışsa 0 — ödenmez),
--        - teacher_absence: her zaman 0 (izlenebilirlik için satır
--          YİNE oluşturulur, ama tutar hiçbir zaman ödenmez),
--        - makeup (is_makeup = true): kuralın compensation_type'ı
--          AMA makeup_rate_amount (boşsa normal rate_amount'a düşer).
--      İdempotency: lesson_session_id üzerindeki tekil indeks (oturum
--      başına en fazla bir satır) + monthly_salary satırları için
--      (teacher_profile_id, period_start) üzerindeki ayrı tekil indeks.
--   3) Uygulanan kuralın STANTAJI (tür, tutar, senaryo) doğrudan
--      teacher_work_logs satırına yazılır — ekranlar bu satırları
--      HİÇBİR ZAMAN teacher_compensation_rules'a yeniden JOIN ederek
--      göstermez. Bu yüzden bir kural sonradan değiştirilse/kapatılsa
--      bile geçmiş üretilmiş/onaylanmış satırlar etkilenmez.
--   4) Onaylanmış (approved_at dolu) satırlar RPC dışından
--      değiştirilemez (authenticated'ın zaten insert/update/delete
--      izni yok). Düzeltme/ekleme her zaman YENİ bir satırla
--      (add_compensation_adjustment, direction ile işaretli) yapılır
--      — cash_movements/payments'taki AYNI "asla mutasyon yok"
--      felsefesi.
--   5) ÖNEMLİ GÜVENLİK DÜZELTMESİ: mevcut work_logs_insert/
--      work_logs_update RLS politikaları (initial_schema) öğretmenin
--      KENDİ satırını doğrudan REST üzerinden insert/update
--      edebilmesine izin veriyordu — yani bir öğretmen kendi
--      hakedişini uydurabilirdi. Bu politikalar burada kaldırılıyor;
--      artık yalnızca SELECT (kendi satırları + admin tüm kurum) ve
--      yalnızca bu dosyadaki RPC'ler üzerinden yazma var.

-- ---------------------------------------------------------------
-- 1) Ücret kuralları
-- ---------------------------------------------------------------

create type public.compensation_type as enum (
  'per_lesson', 'per_minute', 'per_student', 'monthly_salary'
);

create table public.teacher_compensation_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  teacher_profile_id uuid not null references public.profiles(id),
  compensation_type public.compensation_type not null,
  rate_amount numeric(12,2) not null check (rate_amount >= 0),
  cancellation_rate_amount numeric(12,2) check (cancellation_rate_amount >= 0),
  makeup_rate_amount numeric(12,2) check (makeup_rate_amount >= 0),
  effective_from date not null,
  effective_to date,
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

create index teacher_compensation_rules_teacher_idx
on public.teacher_compensation_rules (teacher_profile_id, effective_from);

alter table public.teacher_compensation_rules enable row level security;

create policy teacher_compensation_rules_select
on public.teacher_compensation_rules
for select
to authenticated
using (
  organization_id = public.current_organization_id()
  and (teacher_profile_id = auth.uid() or public.is_admin())
);

revoke insert, update, delete
on public.teacher_compensation_rules
from authenticated;

grant select
on public.teacher_compensation_rules
to authenticated;

create or replace function public.create_teacher_compensation_rule(
  p_teacher_profile_id uuid,
  p_compensation_type text,
  p_rate_amount numeric,
  p_effective_from date,
  p_effective_to date default null,
  p_cancellation_rate_amount numeric default null,
  p_makeup_rate_amount numeric default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_rule_id uuid;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Hakediş kuralı oluşturma yetkiniz bulunmuyor.';
  end if;

  if p_compensation_type not in ('per_lesson', 'per_minute', 'per_student', 'monthly_salary') then
    raise exception 'Geçerli bir ücret modeli seçilmelidir.';
  end if;

  if p_rate_amount is null or p_rate_amount < 0 then
    raise exception 'Geçerli bir tutar girilmelidir.';
  end if;

  if p_effective_from is null then
    raise exception 'Başlangıç tarihi seçilmelidir.';
  end if;

  if p_effective_to is not null and p_effective_to < p_effective_from then
    raise exception 'Bitiş tarihi başlangıç tarihinden önce olamaz.';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_teacher_profile_id
      and organization_id = v_organization_id
      and role = 'teacher'::public.app_role
  ) then
    raise exception 'Öğretmen hesabı bulunamadı.';
  end if;

  if exists (
    select 1 from public.teacher_compensation_rules r
    where r.teacher_profile_id = p_teacher_profile_id
      and r.organization_id = v_organization_id
      and r.effective_from <= coalesce(p_effective_to, 'infinity'::date)
      and coalesce(r.effective_to, 'infinity'::date) >= p_effective_from
  ) then
    raise exception 'Bu öğretmen için seçilen tarih aralığıyla çakışan bir kural zaten var.';
  end if;

  insert into public.teacher_compensation_rules (
    organization_id, teacher_profile_id, compensation_type, rate_amount,
    cancellation_rate_amount, makeup_rate_amount, effective_from, effective_to,
    note, created_by
  )
  values (
    v_organization_id, p_teacher_profile_id, p_compensation_type::public.compensation_type,
    p_rate_amount, p_cancellation_rate_amount, p_makeup_rate_amount,
    p_effective_from, p_effective_to,
    nullif(pg_catalog.btrim(coalesce(p_note, '')), ''), v_user_id
  )
  returning id into v_rule_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'teacher_compensation_rules', v_rule_id::text, 'create', null,
    pg_catalog.jsonb_build_object(
      'teacher_profile_id', p_teacher_profile_id,
      'compensation_type', p_compensation_type,
      'rate_amount', p_rate_amount,
      'effective_from', p_effective_from,
      'effective_to', p_effective_to
    )
  );

  return v_rule_id;
end;
$$;

revoke all on function
  public.create_teacher_compensation_rule(uuid, text, numeric, date, date, numeric, numeric, text)
from public, anon, authenticated;
grant execute on function
  public.create_teacher_compensation_rule(uuid, text, numeric, date, date, numeric, numeric, text)
to authenticated;

create or replace function public.end_teacher_compensation_rule(
  p_rule_id uuid,
  p_effective_to date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_rule record;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Hakediş kuralı düzenleme yetkiniz bulunmuyor.';
  end if;

  select * into v_rule
  from public.teacher_compensation_rules
  where id = p_rule_id and organization_id = v_organization_id
  for update;

  if not found then
    raise exception 'Hakediş kuralı bulunamadı.';
  end if;

  if p_effective_to is null or p_effective_to < v_rule.effective_from then
    raise exception 'Bitiş tarihi başlangıç tarihinden önce olamaz.';
  end if;

  update public.teacher_compensation_rules
  set effective_to = p_effective_to
  where id = p_rule_id and organization_id = v_organization_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'teacher_compensation_rules', p_rule_id::text, 'end_rule',
    pg_catalog.jsonb_build_object('effective_to', v_rule.effective_to),
    pg_catalog.jsonb_build_object('effective_to', p_effective_to)
  );
end;
$$;

revoke all on function
  public.end_teacher_compensation_rule(uuid, date)
from public, anon, authenticated;
grant execute on function
  public.end_teacher_compensation_rule(uuid, date)
to authenticated;

-- ---------------------------------------------------------------
-- 2) İptal senaryosunu ayırt etmek için lesson_sessions'a kolon.
-- cancel_lesson_session() kilitli (attendance_locked_at dolu) bir
-- oturumun iptaline zaten izin vermiyor — yani "iptal edilmiş" bir
-- oturum kendi başına sonlanmış/onaylanmış sayılır, ayrıca kilitlenmez.
-- ---------------------------------------------------------------

create type public.session_cancellation_kind as enum ('institution', 'teacher_absence');

alter table public.lesson_sessions
add column if not exists cancellation_kind public.session_cancellation_kind;

drop function if exists public.cancel_lesson_session(uuid, text);

create or replace function public.cancel_lesson_session(
  p_lesson_session_id uuid,
  p_reason text,
  p_cancellation_kind text default 'institution'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_class_group_id uuid;
  v_starts_at timestamptz;
  v_locked_at timestamptz;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_session_date date;
  v_roster record;
  v_attendance_id uuid;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Ders oturumu iptal etme yetkiniz bulunmuyor.';
  end if;

  if v_reason is null then
    raise exception 'İptal gerekçesi zorunludur.';
  end if;

  if p_cancellation_kind not in ('institution', 'teacher_absence') then
    raise exception 'Geçerli bir iptal türü seçilmelidir.';
  end if;

  select ls.class_group_id, ls.starts_at, ls.attendance_locked_at
  into v_class_group_id, v_starts_at, v_locked_at
  from public.lesson_sessions ls
  where ls.id = p_lesson_session_id
    and ls.organization_id = v_organization_id
    and ls.cancelled_at is null
  for update;

  if v_starts_at is null then
    raise exception 'Ders oturumu bulunamadı ya da zaten iptal edilmiş.';
  end if;

  if v_locked_at is not null then
    raise exception 'Yoklaması kilitli bir oturum iptal edilemez; önce kilidi açın.';
  end if;

  v_session_date := (v_starts_at at time zone 'Europe/Istanbul')::date;

  update public.lesson_sessions
  set cancelled_at = pg_catalog.now(),
      cancellation_reason = v_reason,
      cancellation_kind = p_cancellation_kind::public.session_cancellation_kind
  where id = p_lesson_session_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'lesson_sessions', p_lesson_session_id::text,
    'cancel_session', null,
    jsonb_build_object('cancellation_reason', v_reason, 'cancellation_kind', p_cancellation_kind)
  );

  if v_class_group_id is null then
    return;
  end if;

  for v_roster in
    select e.id as enrollment_id, e.student_id
    from public.enrollments e
    where e.class_group_id = v_class_group_id
      and e.organization_id = v_organization_id
      and e.status = 'active'::public.enrollment_status
      and e.starts_on <= v_session_date
      and (e.ends_on is null or e.ends_on >= v_session_date)
  loop
    insert into public.attendance as att (
      organization_id, lesson_session_id, enrollment_id, student_id,
      status, marked_by, marked_at, updated_at
    )
    values (
      v_organization_id, p_lesson_session_id, v_roster.enrollment_id, v_roster.student_id,
      'institution_cancelled'::public.attendance_status, v_user_id, pg_catalog.now(), pg_catalog.now()
    )
    on conflict (lesson_session_id, student_id) do update
    set status = excluded.status,
        marked_by = excluded.marked_by,
        marked_at = excluded.marked_at,
        updated_at = excluded.updated_at
    returning att.id into v_attendance_id;

    insert into public.audit_logs (
      organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
    )
    values (
      v_organization_id, v_user_id, 'attendance', v_attendance_id::text,
      'institution_cancelled', null, jsonb_build_object('status', 'institution_cancelled')
    );

    insert into public.makeup_credits (
      organization_id, student_id, enrollment_id, source_lesson_session_id,
      source_attendance_id, reason, status, created_by
    )
    values (
      v_organization_id, v_roster.student_id, v_roster.enrollment_id, p_lesson_session_id,
      v_attendance_id, 'institution_cancelled'::public.makeup_credit_reason,
      'open'::public.makeup_credit_status, v_user_id
    )
    on conflict (source_attendance_id) do nothing;
  end loop;
end;
$$;

revoke all on function
  public.cancel_lesson_session(uuid, text, text)
from public, anon;
grant execute on function
  public.cancel_lesson_session(uuid, text, text)
to authenticated;

-- ---------------------------------------------------------------
-- 3) teacher_work_logs — hakediş defteri. Nakit defterindeki AYNI
-- desen: pozitif tutar + ayrı direction (+1/-1), böylece düzeltme/
-- kesinti satırları negatif olmadan işaretlenebilir.
-- ---------------------------------------------------------------

alter table public.teacher_work_logs
alter column minutes_worked drop not null;

alter table public.teacher_work_logs
add column if not exists period_start date;

alter table public.teacher_work_logs
add column if not exists rule_id uuid references public.teacher_compensation_rules(id);

alter table public.teacher_work_logs
add column if not exists compensation_type public.compensation_type;

alter table public.teacher_work_logs
add column if not exists rate_snapshot numeric(12,2);

alter table public.teacher_work_logs
add column if not exists scenario text
  check (scenario in ('regular', 'institution_cancelled', 'teacher_absence', 'makeup', 'monthly_salary', 'adjustment'));

alter table public.teacher_work_logs
add column if not exists student_count integer;

alter table public.teacher_work_logs
add column if not exists direction smallint
  check (direction in (1, -1));

update public.teacher_work_logs set direction = 1 where direction is null;

alter table public.teacher_work_logs
alter column direction set not null;

alter table public.teacher_work_logs
add column if not exists source text
  check (source in ('session', 'monthly_salary', 'adjustment'));

update public.teacher_work_logs set source = 'session' where source is null;

alter table public.teacher_work_logs
alter column source set not null;

alter table public.teacher_work_logs
add column if not exists paid_at timestamptz;

alter table public.teacher_work_logs
add column if not exists paid_by uuid references public.profiles(id);

-- minutes_worked artık yalnızca gerçek oturumlar için > 0 zorunlu;
-- düzeltme/aylık maaş satırlarında anlamsız olduğundan 0/null olabilir.

alter table public.teacher_work_logs
drop constraint if exists teacher_work_logs_minutes_worked_check;

alter table public.teacher_work_logs
add constraint teacher_work_logs_minutes_worked_check
  check (minutes_worked is null or minutes_worked >= 0);

-- Aynı oturum için birden fazla hakediş satırı oluşamaz.
create unique index if not exists
teacher_work_logs_session_unique
on public.teacher_work_logs (lesson_session_id)
where lesson_session_id is not null and source = 'session';

-- Aynı öğretmen + dönem için birden fazla aylık maaş satırı oluşamaz.
create unique index if not exists
teacher_work_logs_salary_period_unique
on public.teacher_work_logs (teacher_profile_id, period_start)
where source = 'monthly_salary';

create index if not exists
teacher_work_logs_teacher_period_idx
on public.teacher_work_logs (teacher_profile_id, period_start);

-- GÜVENLİK DÜZELTMESİ: öğretmenin kendi hakediş satırını doğrudan
-- insert/update edebildiği eski politikalar kaldırılıyor — artık
-- yalnızca bu dosyadaki RPC'ler (security definer) yazabilir.

drop policy if exists work_logs_select on public.teacher_work_logs;
drop policy if exists work_logs_insert on public.teacher_work_logs;
drop policy if exists work_logs_update on public.teacher_work_logs;

create policy teacher_work_logs_select
on public.teacher_work_logs
for select
to authenticated
using (
  organization_id = public.current_organization_id()
  and (teacher_profile_id = auth.uid() or public.is_admin())
);

revoke insert, update, delete
on public.teacher_work_logs
from authenticated;

grant select
on public.teacher_work_logs
to authenticated;

-- ---------------------------------------------------------------
-- 4) Hakediş üretimi. Uygun oturumlar: iptal edilmiş (kendi başına
-- sonlanmış) YA DA yoklaması kilitlenmiş (onaylanmış). Dört senaryo
-- ayrı ele alınır; kural bulunamayan öğretmenler atlanır ve sayılır.
-- ---------------------------------------------------------------

create or replace function public.generate_teacher_compensation(
  p_month_start date
)
returns table (
  created_count integer,
  existing_count integer,
  skipped_no_rule_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_month_start date;
  v_month_end_exclusive date;
  v_session record;
  v_rule record;
  v_scenario text;
  v_rate numeric(12,2);
  v_minutes integer;
  v_student_count integer;
  v_amount numeric(12,2);
  v_created_count integer := 0;
  v_skipped_count integer := 0;
  v_expected_count integer := 0;
  v_inserted integer;
  v_teacher record;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Aylık hakediş oluşturma yetkiniz bulunmuyor.';
  end if;

  if p_month_start is null then
    raise exception 'Hakedişlerin oluşturulacağı ay seçilmelidir.';
  end if;

  v_month_start := pg_catalog.date_trunc('month', p_month_start::timestamp)::date;
  v_month_end_exclusive := (v_month_start + interval '1 month')::date;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_organization_id::text || ':compensation:' || v_month_start::text, 2026081402
    )
  );

  -- Oturum bazlı senaryolar (per_lesson/per_minute/per_student
  -- kurallarına sahip öğretmenler için).
  for v_session in
    select
      ls.id, ls.teacher_profile_id, ls.starts_at, ls.ends_at,
      ls.is_makeup, ls.cancelled_at, ls.cancellation_kind
    from public.lesson_sessions ls
    where ls.organization_id = v_organization_id
      and ls.teacher_profile_id is not null
      and ls.starts_at >= (v_month_start::timestamp at time zone 'Europe/Istanbul')
      and ls.starts_at < (v_month_end_exclusive::timestamp at time zone 'Europe/Istanbul')
      and (ls.cancelled_at is not null or ls.attendance_locked_at is not null)
  loop
    select * into v_rule
    from public.teacher_compensation_rules r
    where r.teacher_profile_id = v_session.teacher_profile_id
      and r.organization_id = v_organization_id
      and r.effective_from <= (v_session.starts_at at time zone 'Europe/Istanbul')::date
      and (r.effective_to is null or r.effective_to >= (v_session.starts_at at time zone 'Europe/Istanbul')::date)
    order by r.effective_from desc
    limit 1;

    if not found then
      v_skipped_count := v_skipped_count + 1;
      continue;
    end if;

    -- Aylık maaşlı öğretmenler için oturum bazlı satır üretilmez —
    -- tek bir aylık toplu satır aşağıda ayrıca üretilir; bu oturumlar
    -- "expected" (oturum bazlı üretilecek) sayısına dahil edilmez.
    if v_rule.compensation_type = 'monthly_salary'::public.compensation_type then
      continue;
    end if;

    v_expected_count := v_expected_count + 1;

    v_minutes := greatest(0, extract(epoch from (v_session.ends_at - v_session.starts_at))::integer / 60);
    v_student_count := (
      select count(*)::integer from public.attendance a
      where a.lesson_session_id = v_session.id and a.status = 'present'::public.attendance_status
    );

    if v_session.cancelled_at is not null and v_session.cancellation_kind = 'teacher_absence'::public.session_cancellation_kind then
      v_scenario := 'teacher_absence';
      v_rate := 0;
      v_amount := 0;
    elsif v_session.cancelled_at is not null then
      v_scenario := 'institution_cancelled';
      v_rate := coalesce(v_rule.cancellation_rate_amount, 0);
      v_amount := v_rate;
    elsif v_session.is_makeup then
      v_scenario := 'makeup';
      v_rate := coalesce(v_rule.makeup_rate_amount, v_rule.rate_amount);
      v_amount := case v_rule.compensation_type
        when 'per_lesson'::public.compensation_type then v_rate
        when 'per_minute'::public.compensation_type then v_rate * v_minutes
        when 'per_student'::public.compensation_type then v_rate * v_student_count
        else 0
      end;
    else
      v_scenario := 'regular';
      v_rate := v_rule.rate_amount;
      v_amount := case v_rule.compensation_type
        when 'per_lesson'::public.compensation_type then v_rate
        when 'per_minute'::public.compensation_type then v_rate * v_minutes
        when 'per_student'::public.compensation_type then v_rate * v_student_count
        else 0
      end;
    end if;

    insert into public.teacher_work_logs (
      organization_id, teacher_profile_id, lesson_session_id, work_date, period_start,
      minutes_worked, rule_id, compensation_type, rate_snapshot, scenario,
      student_count, unit_amount, total_amount, direction, source
    )
    values (
      v_organization_id, v_session.teacher_profile_id, v_session.id,
      (v_session.starts_at at time zone 'Europe/Istanbul')::date, v_month_start,
      nullif(v_minutes, 0), v_rule.id, v_rule.compensation_type, v_rate, v_scenario,
      v_student_count, v_rate, v_amount, 1, 'session'
    )
    on conflict (lesson_session_id) where lesson_session_id is not null and source = 'session'
    do nothing;

    get diagnostics v_inserted = row_count;

    if v_inserted > 0 then
      v_created_count := v_created_count + 1;
    end if;
  end loop;

  -- Aylık maaşlı öğretmenler: kurumdaki her aktif öğretmen için, o
  -- ayın herhangi bir gününde etkin bir monthly_salary kuralı varsa
  -- tek bir toplu satır.
  for v_teacher in
    select distinct p.id as teacher_profile_id
    from public.profiles p
    where p.organization_id = v_organization_id
      and p.role = 'teacher'::public.app_role
      and p.is_active = true
  loop
    select * into v_rule
    from public.teacher_compensation_rules r
    where r.teacher_profile_id = v_teacher.teacher_profile_id
      and r.organization_id = v_organization_id
      and r.compensation_type = 'monthly_salary'::public.compensation_type
      and r.effective_from < v_month_end_exclusive
      and (r.effective_to is null or r.effective_to >= v_month_start)
    order by r.effective_from desc
    limit 1;

    if not found then
      continue;
    end if;

    insert into public.teacher_work_logs (
      organization_id, teacher_profile_id, lesson_session_id, work_date, period_start,
      minutes_worked, rule_id, compensation_type, rate_snapshot, scenario,
      unit_amount, total_amount, direction, source
    )
    values (
      v_organization_id, v_teacher.teacher_profile_id, null, v_month_start, v_month_start,
      null, v_rule.id, v_rule.compensation_type, v_rule.rate_amount, 'monthly_salary',
      v_rule.rate_amount, v_rule.rate_amount, 1, 'monthly_salary'
    )
    on conflict (teacher_profile_id, period_start) where source = 'monthly_salary'
    do nothing;

    get diagnostics v_inserted = row_count;

    if v_inserted > 0 then
      v_created_count := v_created_count + 1;
    end if;
  end loop;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'teacher_work_logs', v_month_start::text, 'generate_month', null,
    pg_catalog.jsonb_build_object(
      'month_start', v_month_start,
      'created_count', v_created_count,
      'skipped_no_rule_count', v_skipped_count
    )
  );

  return query
  select v_created_count, greatest(v_expected_count - v_created_count - v_skipped_count, 0), v_skipped_count;
end;
$$;

revoke all on function public.generate_teacher_compensation(date)
from public, anon, authenticated;
grant execute on function public.generate_teacher_compensation(date)
to authenticated;

-- ---------------------------------------------------------------
-- 5) Onay / ödeme iş akışı ve manuel düzeltme.
-- ---------------------------------------------------------------

create or replace function public.approve_teacher_compensation(
  p_teacher_profile_id uuid,
  p_period_start date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_count integer;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Hakediş onaylama yetkiniz bulunmuyor.';
  end if;

  update public.teacher_work_logs
  set approved_at = pg_catalog.now(),
      approved_by = v_user_id
  where teacher_profile_id = p_teacher_profile_id
    and organization_id = v_organization_id
    and period_start = p_period_start
    and approved_at is null;

  get diagnostics v_count = row_count;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'teacher_work_logs',
    p_teacher_profile_id::text || ':' || p_period_start::text, 'approve', null,
    pg_catalog.jsonb_build_object('approved_count', v_count)
  );

  return v_count;
end;
$$;

revoke all on function
  public.approve_teacher_compensation(uuid, date)
from public, anon, authenticated;
grant execute on function
  public.approve_teacher_compensation(uuid, date)
to authenticated;

create or replace function public.mark_teacher_compensation_paid(
  p_teacher_profile_id uuid,
  p_period_start date,
  p_paid_at timestamptz default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_paid_at timestamptz := coalesce(p_paid_at, pg_catalog.now());
  v_count integer;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Hakediş ödemesi işaretleme yetkiniz bulunmuyor.';
  end if;

  update public.teacher_work_logs
  set paid_at = v_paid_at,
      paid_by = v_user_id
  where teacher_profile_id = p_teacher_profile_id
    and organization_id = v_organization_id
    and period_start = p_period_start
    and approved_at is not null
    and paid_at is null;

  get diagnostics v_count = row_count;

  if v_count = 0 then
    raise exception 'Ödenmiş işaretlenecek onaylı bir hakediş bulunamadı.';
  end if;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'teacher_work_logs',
    p_teacher_profile_id::text || ':' || p_period_start::text, 'mark_paid', null,
    pg_catalog.jsonb_build_object('paid_count', v_count, 'paid_at', v_paid_at)
  );

  return v_count;
end;
$$;

revoke all on function
  public.mark_teacher_compensation_paid(uuid, date, timestamptz)
from public, anon, authenticated;
grant execute on function
  public.mark_teacher_compensation_paid(uuid, date, timestamptz)
to authenticated;

create or replace function public.add_compensation_adjustment(
  p_teacher_profile_id uuid,
  p_period_start date,
  p_amount numeric,
  p_direction integer,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_note text := nullif(pg_catalog.btrim(coalesce(p_note, '')), '');
  v_log_id uuid;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Hakediş düzeltmesi ekleme yetkiniz bulunmuyor.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Geçerli bir tutar girilmelidir.';
  end if;

  if p_direction not in (1, -1) then
    raise exception 'Geçerli bir yön (ekleme/kesinti) seçilmelidir.';
  end if;

  if p_period_start is null then
    raise exception 'Dönem seçilmelidir.';
  end if;

  if v_note is null then
    raise exception 'Düzeltme için bir açıklama girilmelidir.';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_teacher_profile_id
      and organization_id = v_organization_id
      and role = 'teacher'::public.app_role
  ) then
    raise exception 'Öğretmen hesabı bulunamadı.';
  end if;

  insert into public.teacher_work_logs (
    organization_id, teacher_profile_id, lesson_session_id, work_date, period_start,
    minutes_worked, scenario, unit_amount, total_amount, direction, source, note
  )
  values (
    v_organization_id, p_teacher_profile_id, null,
    pg_catalog.date_trunc('month', p_period_start::timestamp)::date, p_period_start,
    null, 'adjustment', p_amount, p_amount, p_direction, 'adjustment', v_note
  )
  returning id into v_log_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'teacher_work_logs', v_log_id::text, 'add_adjustment', null,
    pg_catalog.jsonb_build_object(
      'teacher_profile_id', p_teacher_profile_id, 'period_start', p_period_start,
      'amount', p_amount, 'direction', p_direction, 'note', v_note
    )
  );

  return v_log_id;
end;
$$;

revoke all on function
  public.add_compensation_adjustment(uuid, date, numeric, integer, text)
from public, anon, authenticated;
grant execute on function
  public.add_compensation_adjustment(uuid, date, numeric, integer, text)
to authenticated;

notify pgrst, 'reload schema';
