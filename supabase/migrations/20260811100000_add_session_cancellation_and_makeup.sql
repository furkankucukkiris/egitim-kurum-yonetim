-- Ders iptali, yeniden planlama ve telafi hakkı yönetimi.
--
-- Kısa teknik özet (ayrıca README bölüm 11'de):
--   * cancel_lesson_session(): admin bir oturumu iptal eder; o
--     oturumun tarihinde aktif kayıtlı her öğrenci için attendance
--     satırını 'institution_cancelled' yapar ve KAYNAĞI o attendance
--     satırına bağlı ('institution_cancelled' nedenli) bir
--     makeup_credits satırı açar.
--   * mark_attendance() (yeniden tanımlandı): bir öğrenci
--     'makeup_due' olarak işaretlenirse, kaynağı o attendance satırına
--     bağlı ('student_absence' nedenli) bir makeup_credits satırı
--     açar. Böylece kurum kaynaklı iptal ile öğrenci kaynaklı
--     devamsızlık, credits.reason ile ayrılır; her iki durumda da
--     credits.source_attendance_id sayesinde geriye dönük izlenebilir.
--   * schedule_makeup(): bir açık telafi hakkını ya mevcut uygun bir
--     grup oturumuna geçici misafir olarak ekler (grup dersleri), ya
--     da öğretmen/derslik/öğrenci çakışması kontrol edilerek yeni,
--     tek seferlik bir telafi oturumu (is_makeup=true) oluşturur
--     (birebir dersler ve grup dersinde tekil telafi). Her iki yolda
--     da hak 'used' olur ve iki kez kullanılamaz (status='open'
--     şartıyla satır kilitlenip güncellenir).
--   * get_attendance_roster() (yeniden tanımlandı): normal kayıtlı
--     öğrencilere ek olarak, o oturuma misafir olarak eklenmiş telafi
--     öğrencilerini de is_makeup_guest=true etiketiyle döner —
--     arayüz bunları görsel olarak ayırabilir.
--   * Finans tabloları (accruals/payments/...) bu migration'da hiç
--     değiştirilmiyor: iptal/telafi otomatik tahakkuk bozmaz; gerekli
--     finansal düzeltme admin tarafından mevcut ödeme/tahakkuk
--     ekranlarından elle yapılır.

-- =========================================================
-- 1. Enum'lar.
-- =========================================================

create type public.makeup_credit_reason as enum ('institution_cancelled', 'student_absence');
create type public.makeup_credit_status as enum ('open', 'used', 'cancelled', 'expired');
create type public.session_change_request_type as enum ('cancel', 'reschedule');
create type public.session_change_request_status as enum ('pending', 'approved', 'rejected');

-- =========================================================
-- 2. Tablolar.
-- =========================================================

create table public.makeup_credits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  student_id uuid not null references public.students(id),
  enrollment_id uuid not null references public.enrollments(id),
  -- Bu hakkın hangi asıl oturumdan/devamsızlıktan doğduğu — geriye
  -- dönük izlenebilirlik için ikisi de zorunlu ve tekil.
  source_lesson_session_id uuid not null references public.lesson_sessions(id),
  source_attendance_id uuid not null references public.attendance(id),
  reason public.makeup_credit_reason not null,
  status public.makeup_credit_status not null default 'open',
  expires_at date,
  used_lesson_session_id uuid references public.lesson_sessions(id),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id),
  cancellation_reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_attendance_id)
);

create index makeup_credits_org_status_idx on public.makeup_credits (organization_id, status);
create index makeup_credits_student_idx on public.makeup_credits (student_id);

create table public.session_change_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lesson_session_id uuid not null references public.lesson_sessions(id),
  requested_by uuid not null references public.profiles(id),
  request_type public.session_change_request_type not null,
  reason text not null,
  proposed_starts_at timestamptz,
  proposed_ends_at timestamptz,
  status public.session_change_request_status not null default 'pending',
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);

create index session_change_requests_org_status_idx on public.session_change_requests (organization_id, status);

-- =========================================================
-- 3. RLS: hiçbir authenticated kullanıcı bu tablolara doğrudan
--    insert/update/delete yapamaz — tüm yazmalar aşağıdaki RPC'lerden
--    geçer (bu depoda profiles/lesson_sessions/attendance için de
--    kullanılan desen).
-- =========================================================

alter table public.makeup_credits enable row level security;
alter table public.session_change_requests enable row level security;

create policy makeup_credits_select
on public.makeup_credits
for select
to authenticated
using (
  organization_id = public.current_organization_id()
  and (
    public.is_admin()
    or exists (
      select 1
      from public.enrollments e
      left join public.class_groups cg on cg.id = e.class_group_id
      where e.id = makeup_credits.enrollment_id
        and coalesce(e.teacher_profile_id, cg.teacher_profile_id) = auth.uid()
    )
  )
);

create policy session_change_requests_select
on public.session_change_requests
for select
to authenticated
using (
  organization_id = public.current_organization_id()
  and (
    public.is_admin()
    or requested_by = auth.uid()
    or public.teacher_owns_session(lesson_session_id)
  )
);

revoke insert, update, delete on public.makeup_credits from authenticated;
revoke insert, update, delete on public.session_change_requests from authenticated;

-- =========================================================
-- 4. Çakışma kontrolü yardımcı fonksiyonları.
-- =========================================================

create or replace function public.has_scheduling_conflict(
  p_organization_id uuid,
  p_teacher_profile_id uuid,
  p_room_name text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_exclude_session_id uuid default null
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
    where ls.organization_id = p_organization_id
      and ls.cancelled_at is null
      and (p_exclude_session_id is null or ls.id <> p_exclude_session_id)
      and ls.starts_at < p_ends_at
      and ls.ends_at > p_starts_at
      and (
        (p_teacher_profile_id is not null and ls.teacher_profile_id = p_teacher_profile_id)
        or (p_room_name is not null and ls.room_name = p_room_name)
      )
  )
$$;

revoke all on function public.has_scheduling_conflict(uuid, uuid, text, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.has_scheduling_conflict(uuid, uuid, text, timestamptz, timestamptz, uuid) to authenticated;

create or replace function public.student_has_scheduling_conflict(
  p_organization_id uuid,
  p_student_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_exclude_session_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    -- Öğrencinin normal kayıtlı olduğu, o tarihte aktif bir programın
    -- oturumuyla çakışma.
    select 1
    from public.lesson_sessions ls
    inner join public.enrollments e
      on e.class_group_id = ls.class_group_id
      and e.organization_id = ls.organization_id
      and e.status = 'active'::public.enrollment_status
      and e.starts_on <= (ls.starts_at at time zone 'Europe/Istanbul')::date
      and (e.ends_on is null or e.ends_on >= (ls.starts_at at time zone 'Europe/Istanbul')::date)
    where ls.organization_id = p_organization_id
      and e.student_id = p_student_id
      and ls.cancelled_at is null
      and (p_exclude_session_id is null or ls.id <> p_exclude_session_id)
      and ls.starts_at < p_ends_at
      and ls.ends_at > p_starts_at
  )
  or exists (
    -- Öğrencinin başka bir telafi için zaten misafir olarak eklendiği
    -- bir oturumla çakışma.
    select 1
    from public.makeup_credits mc
    inner join public.lesson_sessions ls on ls.id = mc.used_lesson_session_id
    where mc.organization_id = p_organization_id
      and mc.student_id = p_student_id
      and mc.status = 'used'::public.makeup_credit_status
      and ls.cancelled_at is null
      and (p_exclude_session_id is null or ls.id <> p_exclude_session_id)
      and ls.starts_at < p_ends_at
      and ls.ends_at > p_starts_at
  )
$$;

revoke all on function public.student_has_scheduling_conflict(uuid, uuid, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.student_has_scheduling_conflict(uuid, uuid, timestamptz, timestamptz, uuid) to authenticated;

-- =========================================================
-- 5. cancel_lesson_session / reschedule_lesson_session: yalnızca
--    admin doğrudan çağırabilir (teacher, request_session_change()
--    üzerinden talep açar).
-- =========================================================

create or replace function public.cancel_lesson_session(
  p_lesson_session_id uuid,
  p_reason text
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
      cancellation_reason = v_reason
  where id = p_lesson_session_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'lesson_sessions', p_lesson_session_id::text,
    'cancel_session', null, jsonb_build_object('cancellation_reason', v_reason)
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

revoke all on function public.cancel_lesson_session(uuid, text) from public, anon;
grant execute on function public.cancel_lesson_session(uuid, text) to authenticated;

create or replace function public.reschedule_lesson_session(
  p_lesson_session_id uuid,
  p_new_starts_at timestamptz,
  p_new_ends_at timestamptz,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_old_starts_at timestamptz;
  v_old_ends_at timestamptz;
  v_teacher_profile_id uuid;
  v_room_name text;
  v_locked_at timestamptz;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Ders oturumu yeniden planlama yetkiniz bulunmuyor.';
  end if;

  if v_reason is null then
    raise exception 'Yeniden planlama gerekçesi zorunludur.';
  end if;

  if p_new_starts_at is null or p_new_ends_at is null or p_new_ends_at <= p_new_starts_at then
    raise exception 'Geçerli bir başlangıç/bitiş saati girilmelidir.';
  end if;

  select ls.starts_at, ls.ends_at, ls.teacher_profile_id, ls.room_name, ls.attendance_locked_at
  into v_old_starts_at, v_old_ends_at, v_teacher_profile_id, v_room_name, v_locked_at
  from public.lesson_sessions ls
  where ls.id = p_lesson_session_id
    and ls.organization_id = v_organization_id
    and ls.cancelled_at is null
  for update;

  if v_old_starts_at is null then
    raise exception 'Ders oturumu bulunamadı ya da iptal edilmiş.';
  end if;

  if v_locked_at is not null then
    raise exception 'Yoklaması kilitli bir oturum yeniden planlanamaz; önce kilidi açın.';
  end if;

  if public.has_scheduling_conflict(
    v_organization_id, v_teacher_profile_id, v_room_name, p_new_starts_at, p_new_ends_at, p_lesson_session_id
  ) then
    raise exception 'Seçilen yeni saatte öğretmen veya derslik uygun değil.';
  end if;

  update public.lesson_sessions
  set starts_at = p_new_starts_at,
      ends_at = p_new_ends_at,
      updated_at = pg_catalog.now()
  where id = p_lesson_session_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'lesson_sessions', p_lesson_session_id::text,
    'reschedule_session',
    jsonb_build_object('starts_at', v_old_starts_at, 'ends_at', v_old_ends_at),
    jsonb_build_object('starts_at', p_new_starts_at, 'ends_at', p_new_ends_at, 'reason', v_reason)
  );
end;
$$;

revoke all on function public.reschedule_lesson_session(uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.reschedule_lesson_session(uuid, timestamptz, timestamptz, text) to authenticated;

-- =========================================================
-- 6. Teacher talebi / admin onayı.
-- =========================================================

create or replace function public.request_session_change(
  p_lesson_session_id uuid,
  p_request_type text,
  p_reason text,
  p_proposed_starts_at timestamptz default null,
  p_proposed_ends_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_request_id uuid;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not (
    public.is_admin()
    or (
      public.current_app_role() = 'teacher'::public.app_role
      and public.teacher_owns_session(p_lesson_session_id)
    )
  ) then
    raise exception 'Bu oturum için değişiklik talebi oluşturma yetkiniz bulunmuyor.';
  end if;

  if p_request_type not in ('cancel', 'reschedule') then
    raise exception 'Geçersiz talep türü.';
  end if;

  if v_reason is null then
    raise exception 'Talep gerekçesi zorunludur.';
  end if;

  if p_request_type = 'reschedule' and (p_proposed_starts_at is null or p_proposed_ends_at is null) then
    raise exception 'Yeniden planlama talebi için önerilen tarih/saat zorunludur.';
  end if;

  if not exists (
    select 1 from public.lesson_sessions ls
    where ls.id = p_lesson_session_id
      and ls.organization_id = v_organization_id
      and ls.cancelled_at is null
  ) then
    raise exception 'Ders oturumu bulunamadı ya da zaten iptal edilmiş.';
  end if;

  insert into public.session_change_requests (
    organization_id, lesson_session_id, requested_by, request_type,
    reason, proposed_starts_at, proposed_ends_at
  )
  values (
    v_organization_id, p_lesson_session_id, v_user_id, p_request_type::public.session_change_request_type,
    v_reason, p_proposed_starts_at, p_proposed_ends_at
  )
  returning id into v_request_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'session_change_requests', v_request_id::text,
    'request_' || p_request_type, null,
    jsonb_build_object(
      'reason', v_reason,
      'proposed_starts_at', p_proposed_starts_at,
      'proposed_ends_at', p_proposed_ends_at
    )
  );

  return v_request_id;
end;
$$;

revoke all on function public.request_session_change(uuid, text, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.request_session_change(uuid, text, text, timestamptz, timestamptz) to authenticated;

create or replace function public.review_session_change_request(
  p_request_id uuid,
  p_approve boolean,
  p_review_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_request record;
  v_review_note text := nullif(pg_catalog.btrim(coalesce(p_review_note, '')), '');
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Değişiklik talebini onaylama/reddetme yetkiniz bulunmuyor.';
  end if;

  select scr.id, scr.lesson_session_id, scr.request_type, scr.proposed_starts_at, scr.proposed_ends_at
  into v_request
  from public.session_change_requests scr
  where scr.id = p_request_id
    and scr.organization_id = v_organization_id
    and scr.status = 'pending'::public.session_change_request_status
  for update;

  if v_request.id is null then
    raise exception 'Bekleyen talep bulunamadı.';
  end if;

  update public.session_change_requests
  set status = case when p_approve then 'approved' else 'rejected' end::public.session_change_request_status,
      reviewed_by = v_user_id,
      reviewed_at = pg_catalog.now(),
      review_note = v_review_note
  where id = p_request_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'session_change_requests', p_request_id::text,
    case when p_approve then 'approve_request' else 'reject_request' end,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object(
      'status', case when p_approve then 'approved' else 'rejected' end,
      'review_note', v_review_note
    )
  );

  if not p_approve then
    return;
  end if;

  if v_request.request_type = 'cancel'::public.session_change_request_type then
    perform public.cancel_lesson_session(
      v_request.lesson_session_id,
      coalesce(v_review_note, 'Öğretmen talebiyle onaylandı.')
    );
  else
    perform public.reschedule_lesson_session(
      v_request.lesson_session_id, v_request.proposed_starts_at, v_request.proposed_ends_at,
      coalesce(v_review_note, 'Öğretmen talebiyle onaylandı.')
    );
  end if;
end;
$$;

revoke all on function public.review_session_change_request(uuid, boolean, text) from public, anon;
grant execute on function public.review_session_change_request(uuid, boolean, text) to authenticated;

-- =========================================================
-- 7. Telafi planlama / iptal / süre dolumu.
-- =========================================================

create or replace function public.schedule_makeup(
  p_credit_id uuid,
  p_target_lesson_session_id uuid default null,
  p_new_teacher_profile_id uuid default null,
  p_new_room_name text default null,
  p_new_starts_at timestamptz default null,
  p_new_ends_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_credit record;
  v_course_id uuid;
  v_target_session record;
  v_new_session_id uuid;
  v_roster_count integer;
  v_guest_count integer;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Telafi planlama yetkiniz bulunmuyor.';
  end if;

  select mc.id, mc.student_id, mc.enrollment_id, mc.status
  into v_credit
  from public.makeup_credits mc
  where mc.id = p_credit_id
    and mc.organization_id = v_organization_id
  for update;

  if v_credit.id is null then
    raise exception 'Telafi hakkı bulunamadı.';
  end if;

  if v_credit.status <> 'open'::public.makeup_credit_status then
    raise exception 'Bu telafi hakkı zaten kullanılmış veya iptal edilmiş.';
  end if;

  select e.course_id into v_course_id
  from public.enrollments e
  where e.id = v_credit.enrollment_id;

  if p_target_lesson_session_id is not null then
    -- Mevcut uygun bir gruba geçici ekleme.
    select ls.id, ls.class_group_id, ls.course_id, ls.starts_at, ls.ends_at, ls.cancelled_at, cg.capacity
    into v_target_session
    from public.lesson_sessions ls
    left join public.class_groups cg on cg.id = ls.class_group_id
    where ls.id = p_target_lesson_session_id
      and ls.organization_id = v_organization_id;

    if v_target_session.id is null then
      raise exception 'Hedef ders oturumu bulunamadı.';
    end if;

    if v_target_session.cancelled_at is not null then
      raise exception 'İptal edilmiş bir oturuma telafi eklenemez.';
    end if;

    if v_target_session.course_id <> v_course_id then
      raise exception 'Telafi yalnızca aynı ders için planlanabilir.';
    end if;

    if public.student_has_scheduling_conflict(
      v_organization_id, v_credit.student_id, v_target_session.starts_at, v_target_session.ends_at, null
    ) then
      raise exception 'Öğrencinin bu saatte başka bir programı var.';
    end if;

    if v_target_session.capacity is not null then
      select count(*) into v_roster_count
      from public.enrollments e
      where e.class_group_id = v_target_session.class_group_id
        and e.organization_id = v_organization_id
        and e.status = 'active'::public.enrollment_status
        and e.starts_on <= (v_target_session.starts_at at time zone 'Europe/Istanbul')::date
        and (
          e.ends_on is null
          or e.ends_on >= (v_target_session.starts_at at time zone 'Europe/Istanbul')::date
        );

      select count(*) into v_guest_count
      from public.makeup_credits mc
      where mc.used_lesson_session_id = p_target_lesson_session_id
        and mc.status = 'used'::public.makeup_credit_status;

      if v_roster_count + v_guest_count >= v_target_session.capacity then
        raise exception 'Hedef grup kontenjanı dolu.';
      end if;
    end if;

    update public.makeup_credits
    set status = 'used'::public.makeup_credit_status,
        used_lesson_session_id = p_target_lesson_session_id,
        updated_at = pg_catalog.now()
    where id = p_credit_id;

    v_new_session_id := p_target_lesson_session_id;
  else
    -- Yeni, tek seferlik telafi oturumu (birebir ders ya da grup
    -- dersinde tekil öğrenci telafisi).
    if p_new_teacher_profile_id is null or p_new_starts_at is null or p_new_ends_at is null then
      raise exception 'Yeni telafi oturumu için öğretmen ve saat bilgisi zorunludur.';
    end if;

    if p_new_ends_at <= p_new_starts_at then
      raise exception 'Bitiş saati başlangıçtan sonra olmalıdır.';
    end if;

    if public.has_scheduling_conflict(
      v_organization_id, p_new_teacher_profile_id, p_new_room_name, p_new_starts_at, p_new_ends_at, null
    ) then
      raise exception 'Seçilen saatte öğretmen veya derslik uygun değil.';
    end if;

    if public.student_has_scheduling_conflict(
      v_organization_id, v_credit.student_id, p_new_starts_at, p_new_ends_at, null
    ) then
      raise exception 'Öğrencinin bu saatte başka bir programı var.';
    end if;

    insert into public.lesson_sessions (
      organization_id, class_group_id, course_id, teacher_profile_id,
      starts_at, ends_at, room_name, is_makeup
    )
    values (
      v_organization_id, null, v_course_id, p_new_teacher_profile_id,
      p_new_starts_at, p_new_ends_at, p_new_room_name, true
    )
    returning id into v_new_session_id;

    update public.makeup_credits
    set status = 'used'::public.makeup_credit_status,
        used_lesson_session_id = v_new_session_id,
        updated_at = pg_catalog.now()
    where id = p_credit_id;
  end if;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'makeup_credits', p_credit_id::text,
    'schedule_makeup',
    jsonb_build_object('status', 'open'),
    jsonb_build_object('status', 'used', 'used_lesson_session_id', v_new_session_id)
  );

  return v_new_session_id;
end;
$$;

revoke all on function public.schedule_makeup(uuid, uuid, uuid, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.schedule_makeup(uuid, uuid, uuid, text, timestamptz, timestamptz) to authenticated;

create or replace function public.cancel_makeup_credit(
  p_credit_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Telafi hakkını iptal etme yetkiniz bulunmuyor.';
  end if;

  if v_reason is null then
    raise exception 'İptal gerekçesi zorunludur.';
  end if;

  update public.makeup_credits
  set status = 'cancelled'::public.makeup_credit_status,
      cancelled_at = pg_catalog.now(),
      cancelled_by = v_user_id,
      cancellation_reason = v_reason,
      updated_at = pg_catalog.now()
  where id = p_credit_id
    and organization_id = v_organization_id
    and status = 'open'::public.makeup_credit_status;

  if not found then
    raise exception 'Telafi hakkı bulunamadı ya da zaten kullanılmış/iptal edilmiş.';
  end if;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'makeup_credits', p_credit_id::text,
    'cancel_credit',
    jsonb_build_object('status', 'open'),
    jsonb_build_object('status', 'cancelled', 'reason', v_reason)
  );
end;
$$;

revoke all on function public.cancel_makeup_credit(uuid, text) from public, anon;
grant execute on function public.cancel_makeup_credit(uuid, text) to authenticated;

create or replace function public.expire_stale_makeup_credits()
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
    raise exception 'Telafi haklarını süre dolumu ile kapatma yetkiniz bulunmuyor.';
  end if;

  update public.makeup_credits
  set status = 'expired'::public.makeup_credit_status,
      updated_at = pg_catalog.now()
  where organization_id = v_organization_id
    and status = 'open'::public.makeup_credit_status
    and expires_at is not null
    and expires_at < (pg_catalog.now() at time zone 'Europe/Istanbul')::date;

  get diagnostics v_count = row_count;

  if v_count > 0 then
    insert into public.audit_logs (
      organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
    )
    values (
      v_organization_id, v_user_id, 'makeup_credits', null,
      'expire_credits_batch', null, jsonb_build_object('expired_count', v_count)
    );
  end if;

  return v_count;
end;
$$;

revoke all on function public.expire_stale_makeup_credits() from public, anon;
grant execute on function public.expire_stale_makeup_credits() to authenticated;

-- =========================================================
-- 8. Admin listeleri: bekleyen telafi hakları / bekleyen değişiklik
--    talepleri.
-- =========================================================

create or replace function public.get_pending_makeup_credits(
  p_limit integer default 50
)
returns table (
  credit_id uuid,
  student_id uuid,
  student_full_name text,
  course_id uuid,
  course_name text,
  reason public.makeup_credit_reason,
  source_lesson_session_id uuid,
  source_starts_at timestamptz,
  expires_at date,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid := public.current_organization_id();
begin
  if v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Bu listeyi görüntüleme yetkiniz bulunmuyor.';
  end if;

  return query
  select
    mc.id,
    s.id,
    s.first_name || ' ' || s.last_name,
    e.course_id,
    c.name,
    mc.reason,
    mc.source_lesson_session_id,
    ls.starts_at,
    mc.expires_at,
    mc.created_at
  from public.makeup_credits mc
  inner join public.students s on s.id = mc.student_id
  inner join public.enrollments e on e.id = mc.enrollment_id
  inner join public.courses c on c.id = e.course_id
  inner join public.lesson_sessions ls on ls.id = mc.source_lesson_session_id
  where mc.organization_id = v_organization_id
    and mc.status = 'open'::public.makeup_credit_status
  order by mc.created_at desc
  limit greatest(coalesce(p_limit, 50), 1);
end;
$$;

revoke all on function public.get_pending_makeup_credits(integer) from public, anon;
grant execute on function public.get_pending_makeup_credits(integer) to authenticated;

create or replace function public.get_pending_session_change_requests()
returns table (
  request_id uuid,
  lesson_session_id uuid,
  request_type public.session_change_request_type,
  reason text,
  proposed_starts_at timestamptz,
  proposed_ends_at timestamptz,
  requested_by_name text,
  session_starts_at timestamptz,
  course_name text,
  class_group_name text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid := public.current_organization_id();
begin
  if v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Bu listeyi görüntüleme yetkiniz bulunmuyor.';
  end if;

  return query
  select
    scr.id,
    scr.lesson_session_id,
    scr.request_type,
    scr.reason,
    scr.proposed_starts_at,
    scr.proposed_ends_at,
    p.full_name,
    ls.starts_at,
    c.name,
    cg.name,
    scr.created_at
  from public.session_change_requests scr
  inner join public.lesson_sessions ls on ls.id = scr.lesson_session_id
  inner join public.courses c on c.id = ls.course_id
  left join public.class_groups cg on cg.id = ls.class_group_id
  inner join public.profiles p on p.id = scr.requested_by
  where scr.organization_id = v_organization_id
    and scr.status = 'pending'::public.session_change_request_status
  order by scr.created_at asc;
end;
$$;

revoke all on function public.get_pending_session_change_requests() from public, anon;
grant execute on function public.get_pending_session_change_requests() to authenticated;

-- =========================================================
-- 9. get_attendance_roster: dönüş tipi değiştiği (is_makeup_guest
--    eklendi) için create or replace kullanılamıyor — önce
--    düşürülüyor. Normal kayıtlı öğrencilere ek olarak, bu oturuma
--    telafi misafiri olarak eklenmiş öğrenciler de is_makeup_guest =
--    true ile dönüyor.
-- =========================================================

drop function if exists public.get_attendance_roster(uuid[]);

create function public.get_attendance_roster(
  p_lesson_session_ids uuid[]
)
returns table (
  lesson_session_id uuid,
  enrollment_id uuid,
  student_id uuid,
  student_first_name text,
  student_last_name text,
  attendance_id uuid,
  status public.attendance_status,
  note text,
  notified_at timestamptz,
  is_makeup_guest boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  return query
  select
    ls.id, e.id, s.id, s.first_name, s.last_name, a.id, a.status, a.note, a.notified_at,
    false
  from public.lesson_sessions ls
  inner join public.enrollments e
    on e.class_group_id = ls.class_group_id
    and e.organization_id = ls.organization_id
    and e.status = 'active'::public.enrollment_status
    and e.starts_on <= (ls.starts_at at time zone 'Europe/Istanbul')::date
    and (
      e.ends_on is null
      or e.ends_on >= (ls.starts_at at time zone 'Europe/Istanbul')::date
    )
  inner join public.students s on s.id = e.student_id
  left join public.attendance a on a.lesson_session_id = ls.id and a.student_id = s.id
  where ls.id = any(p_lesson_session_ids)
    and ls.organization_id = v_organization_id
    and (
      public.is_admin()
      or (
        public.current_app_role() = 'teacher'::public.app_role
        and public.teacher_owns_session(ls.id)
      )
    )

  union all

  select
    ls.id, mc.enrollment_id, s.id, s.first_name, s.last_name, a.id, a.status, a.note, a.notified_at,
    true
  from public.makeup_credits mc
  inner join public.lesson_sessions ls on ls.id = mc.used_lesson_session_id
  inner join public.students s on s.id = mc.student_id
  left join public.attendance a on a.lesson_session_id = ls.id and a.student_id = s.id
  where ls.id = any(p_lesson_session_ids)
    and mc.organization_id = v_organization_id
    and mc.status = 'used'::public.makeup_credit_status
    and (
      public.is_admin()
      or (
        public.current_app_role() = 'teacher'::public.app_role
        and public.teacher_owns_session(ls.id)
      )
    )

  order by 5, 4;
end;
$$;

revoke all on function public.get_attendance_roster(uuid[]) from public, anon;
grant execute on function public.get_attendance_roster(uuid[]) to authenticated;

-- =========================================================
-- 10. mark_attendance: roster geçerliliği artık normal aktif kayıt
--     YA DA bu oturuma 'used' bir telafi misafirliği kabul ediyor.
--     Bir öğrenci 'makeup_due' olarak işaretlenirse, kaynağı bu
--     attendance satırına bağlı yeni bir açık telafi hakkı oluşur.
-- =========================================================

create or replace function public.mark_attendance(
  p_lesson_session_id uuid,
  p_entries jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_role public.app_role := public.current_app_role();
  v_session_id uuid;
  v_class_group_id uuid;
  v_starts_at timestamptz;
  v_cancelled_at timestamptz;
  v_locked_at timestamptz;
  v_session_date date;
  v_entry jsonb;
  v_student_id uuid;
  v_status text;
  v_note text;
  v_notify boolean;
  v_enrollment_id uuid;
  v_old_status public.attendance_status;
  v_old_note text;
  v_attendance_id uuid;
  v_entry_count integer := 0;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  select ls.id, ls.class_group_id, ls.starts_at,
         ls.cancelled_at, ls.attendance_locked_at
  into v_session_id, v_class_group_id, v_starts_at,
       v_cancelled_at, v_locked_at
  from public.lesson_sessions ls
  where ls.id = p_lesson_session_id
    and ls.organization_id = v_organization_id;

  if v_session_id is null then
    raise exception 'Ders oturumu bulunamadı.';
  end if;

  if not (
    public.is_admin()
    or (
      v_role = 'teacher'::public.app_role
      and public.teacher_owns_session(v_session_id)
    )
  ) then
    raise exception 'Bu oturum için yoklama girme yetkiniz bulunmuyor.';
  end if;

  if v_locked_at is not null then
    raise exception 'Bu oturumun yoklaması kilitli; değişiklik için yönetici kilidi açmalıdır.';
  end if;

  if v_cancelled_at is not null then
    raise exception 'İptal edilmiş bir oturum için yoklama girilemez.';
  end if;

  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception 'Geçersiz yoklama verisi.';
  end if;

  v_session_date := (v_starts_at at time zone 'Europe/Istanbul')::date;

  for v_entry in select * from jsonb_array_elements(p_entries)
  loop
    v_entry_count := v_entry_count + 1;

    v_student_id := nullif(v_entry->>'student_id', '')::uuid;
    v_status := v_entry->>'status';
    v_note := nullif(pg_catalog.btrim(coalesce(v_entry->>'note', '')), '');
    v_notify := coalesce((v_entry->>'notify_guardian')::boolean, false);

    if v_student_id is null then
      raise exception 'Öğrenci kimliği eksik.';
    end if;

    if v_status is null or v_status not in (
      'present', 'absent', 'excused',
      'makeup_due', 'makeup_completed', 'institution_cancelled'
    ) then
      raise exception 'Geçersiz yoklama durumu: %', coalesce(v_status, 'null');
    end if;

    select e.id
    into v_enrollment_id
    from public.enrollments e
    where e.student_id = v_student_id
      and e.class_group_id = v_class_group_id
      and e.organization_id = v_organization_id
      and e.status = 'active'::public.enrollment_status
      and e.starts_on <= v_session_date
      and (e.ends_on is null or e.ends_on >= v_session_date)
    limit 1;

    if v_enrollment_id is null then
      -- Normal kayıtlı değilse, bu oturuma telafi misafiri olarak
      -- eklenmiş olabilir.
      select mc.enrollment_id
      into v_enrollment_id
      from public.makeup_credits mc
      where mc.used_lesson_session_id = p_lesson_session_id
        and mc.student_id = v_student_id
        and mc.status = 'used'::public.makeup_credit_status
      limit 1;
    end if;

    if v_enrollment_id is null then
      raise exception 'Öğrenci bu oturum tarihinde bu programa kayıtlı değil.';
    end if;

    select a.status, a.note
    into v_old_status, v_old_note
    from public.attendance a
    where a.lesson_session_id = p_lesson_session_id
      and a.student_id = v_student_id;

    insert into public.attendance as att (
      organization_id, lesson_session_id, enrollment_id, student_id,
      status, note, notified_at, marked_by, marked_at, updated_at
    )
    values (
      v_organization_id, p_lesson_session_id, v_enrollment_id, v_student_id,
      v_status::public.attendance_status, v_note,
      case when v_notify then pg_catalog.now() else null end,
      v_user_id, pg_catalog.now(), pg_catalog.now()
    )
    on conflict (lesson_session_id, student_id) do update
    set
      enrollment_id = excluded.enrollment_id,
      status = excluded.status,
      note = excluded.note,
      notified_at = case
        when v_notify then coalesce(att.notified_at, excluded.notified_at)
        else att.notified_at
      end,
      marked_by = excluded.marked_by,
      marked_at = excluded.marked_at,
      updated_at = excluded.updated_at
    returning att.id into v_attendance_id;

    if v_old_status is null
       or v_old_status is distinct from v_status::public.attendance_status
       or v_old_note is distinct from v_note then
      insert into public.audit_logs (
        organization_id, actor_profile_id, table_name, record_id,
        action, old_data, new_data
      )
      values (
        v_organization_id, v_user_id, 'attendance', v_attendance_id::text,
        'mark_attendance',
        case
          when v_old_status is null then null
          else jsonb_build_object('status', v_old_status, 'note', v_old_note)
        end,
        jsonb_build_object('status', v_status, 'note', v_note)
      );
    end if;

    if v_status = 'makeup_due' then
      insert into public.makeup_credits (
        organization_id, student_id, enrollment_id, source_lesson_session_id,
        source_attendance_id, reason, status, created_by
      )
      values (
        v_organization_id, v_student_id, v_enrollment_id, p_lesson_session_id,
        v_attendance_id, 'student_absence'::public.makeup_credit_reason,
        'open'::public.makeup_credit_status, v_user_id
      )
      on conflict (source_attendance_id) do nothing;
    end if;
  end loop;

  if v_entry_count = 0 then
    raise exception 'En az bir öğrenci için yoklama girilmelidir.';
  end if;
end;
$$;

revoke all on function public.mark_attendance(uuid, jsonb) from public, anon;
grant execute on function public.mark_attendance(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
