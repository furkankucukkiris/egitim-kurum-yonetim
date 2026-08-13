-- Aday Öğrenci ve Deneme Dersi CRM'i.
--
-- Tasarım özeti:
--   1) prospects, öğrenci/veli kaydı YARATMADAN önceki "aday" aşamasını
--      tutar. T.C. kimlik no gerektirmez (bir aday henüz bunu vermemiş
--      olabilir) — yalnızca ad/veli adı/telefon zorunlu.
--   2) Deneme dersi, class_group_id=null, is_trial=true, prospect_id
--      dolu bir lesson_sessions satırıdır — public.schedule_makeup()'ın
--      tek seferlik telafi oturumu eklerken kullandığı AYNI kalıp
--      (20260811100000_add_session_cancellation_and_makeup.sql:716),
--      yalnızca is_makeup yerine is_trial. lesson_sessions'ta
--      enrollment_id sütunu YOK (öğrenci bazlı bağlantı yalnızca
--      attendance'ta, o da enrollment_id NOT NULL) ve tahakkuk üretimi
--      (%100 public.enrollments üzerinden, generate_monthly_accruals)
--      lesson_sessions'a hiç bakmıyor — yani bir deneme dersi hiçbir
--      koşulda tahakkuk/yoklama satırı üretemez, ekstra bir engelleme
--      gerekmiyor.
--   3) prospects/prospect_course_interests: cash_movements/outbound_messages
--      ile AYNI tam kilit deseni — authenticated'a hiç yazma izni yok,
--      SELECT yalnızca is_admin(). Öğretmenler için ayrı bir RLS dalı
--      YOK; kendi deneme derslerinin asgari bilgisini (yalnızca aday
--      öğrenci adı) yalnızca get_teacher_trial_lessons() üzerinden
--      görürler — get_attendance_roster()'ın (20260810160000) izlediği
--      "tam kilit + asgari alan döndüren RPC" deseniyle aynı.
--   4) convert_prospect_to_student(): aynı ad/veli/telefon bilgisini
--      TEKRAR yazdırmamak için mevcut create_student_with_guardian()'ı
--      (20260812160000) prospects satırındaki değerlerle doğrudan
--      çağırır — yalnızca T.C. kimlik no'ları (bir adayın olamayacağı
--      TEK bilgi) formda istenir. prospects.converted_student_id bir
--      kez set edildikten sonra ikinci dönüştürme denemesini engeller
--      (mükerrer kayıt güvenliği).

-- ---------------------------------------------------------------
-- 1) Enum'lar
-- ---------------------------------------------------------------

create type public.prospect_status as enum (
  'new',
  'follow_up_required',
  'appointment_scheduled',
  'trial_attended',
  'enrolled',
  'declined'
);

create type public.lead_source_type as enum (
  'referral',
  'social_media',
  'website',
  'walk_in',
  'phone_call',
  'advertisement',
  'other'
);

-- ---------------------------------------------------------------
-- 2) prospects / prospect_course_interests
-- ---------------------------------------------------------------

create table public.prospects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id),
  student_first_name text not null,
  student_last_name text not null,
  guardian_name text not null,
  phone text not null,
  lead_source public.lead_source_type not null default 'other',
  initial_contact_date date not null
    default (pg_catalog.now() at time zone 'Europe/Istanbul')::date,
  assigned_profile_id uuid references public.profiles(id),
  status public.prospect_status not null default 'new',
  decline_reason text,
  next_follow_up_date date,
  notes text,
  trial_lesson_id uuid references public.lesson_sessions(id),
  converted_student_id uuid references public.students(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create index prospects_org_status_idx
on public.prospects (organization_id, status, next_follow_up_date);

create index prospects_org_follow_up_idx
on public.prospects (organization_id, next_follow_up_date)
where next_follow_up_date is not null;

create table public.prospect_course_interests (
  prospect_id uuid not null
    references public.prospects(id) on delete cascade,
  course_id uuid not null references public.courses(id),
  primary key (prospect_id, course_id)
);

create trigger prospects_set_updated_at
before update on public.prospects
for each row execute function public.set_updated_at();

alter table public.prospects enable row level security;
alter table public.prospect_course_interests enable row level security;

create policy prospects_select_admin
on public.prospects
for select
to authenticated
using (
  organization_id = public.current_organization_id()
  and public.is_admin()
);

revoke insert, update, delete on public.prospects from authenticated;
grant select on public.prospects to authenticated;

create policy prospect_course_interests_select_admin
on public.prospect_course_interests
for select
to authenticated
using (
  public.is_admin()
  and exists (
    select 1 from public.prospects p
    where p.id = prospect_course_interests.prospect_id
      and p.organization_id = public.current_organization_id()
  )
);

revoke insert, update, delete on public.prospect_course_interests from authenticated;
grant select on public.prospect_course_interests to authenticated;

-- ---------------------------------------------------------------
-- 3) lesson_sessions: deneme dersi sütunları (prospects'ten SONRA,
-- FK bunu gerektiriyor).
-- ---------------------------------------------------------------

alter table public.lesson_sessions
add column if not exists is_trial boolean not null default false;

alter table public.lesson_sessions
add column if not exists prospect_id uuid references public.prospects(id);

alter table public.lesson_sessions
add constraint lesson_sessions_trial_not_makeup_check
check (not (is_trial and is_makeup));

create index lesson_sessions_prospect_idx
on public.lesson_sessions (prospect_id)
where prospect_id is not null;

-- ---------------------------------------------------------------
-- 4) CRUD RPC'leri.
-- ---------------------------------------------------------------

create or replace function public.create_prospect(
  p_student_first_name text,
  p_student_last_name text,
  p_guardian_name text,
  p_phone text,
  p_lead_source text,
  p_initial_contact_date date default null,
  p_assigned_profile_id uuid default null,
  p_course_ids uuid[] default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_student_first_name text := pg_catalog.btrim(coalesce(p_student_first_name, ''));
  v_student_last_name text := pg_catalog.btrim(coalesce(p_student_last_name, ''));
  v_guardian_name text := pg_catalog.btrim(coalesce(p_guardian_name, ''));
  v_phone text := pg_catalog.btrim(coalesce(p_phone, ''));
  v_notes text := nullif(pg_catalog.btrim(coalesce(p_notes, '')), '');
  v_initial_contact_date date :=
    coalesce(p_initial_contact_date, (pg_catalog.now() at time zone 'Europe/Istanbul')::date);
  v_course_ids uuid[];
  v_matched_course_count integer;
  v_prospect_id uuid;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Aday öğrenci oluşturma yetkiniz bulunmuyor.';
  end if;

  if pg_catalog.char_length(v_student_first_name) < 2 then
    raise exception 'Öğrenci adı en az 2 karakter olmalıdır.';
  end if;

  if pg_catalog.char_length(v_student_last_name) < 2 then
    raise exception 'Öğrenci soyadı en az 2 karakter olmalıdır.';
  end if;

  if pg_catalog.char_length(v_guardian_name) < 2 then
    raise exception 'Veli adı en az 2 karakter olmalıdır.';
  end if;

  if pg_catalog.char_length(pg_catalog.regexp_replace(v_phone, '[^0-9]', '', 'g')) < 10 then
    raise exception 'Geçerli bir telefon numarası girilmelidir.';
  end if;

  if p_lead_source not in
    ('referral', 'social_media', 'website', 'walk_in', 'phone_call', 'advertisement', 'other') then
    raise exception 'Geçerli bir kaynak seçilmelidir.';
  end if;

  if p_assigned_profile_id is not null and not exists (
    select 1 from public.profiles pr
    where pr.id = p_assigned_profile_id and pr.organization_id = v_organization_id
  ) then
    raise exception 'Atanan personel bulunamadı.';
  end if;

  if p_course_ids is not null then
    v_course_ids := array(select distinct c from pg_catalog.unnest(p_course_ids) as c);
  end if;

  if v_course_ids is not null and cardinality(v_course_ids) > 0 then
    select count(*) into v_matched_course_count
    from public.courses c
    where c.id = any(v_course_ids) and c.organization_id = v_organization_id;

    if v_matched_course_count <> cardinality(v_course_ids) then
      raise exception 'Seçilen derslerden biri bulunamadı.';
    end if;
  end if;

  insert into public.prospects (
    organization_id, student_first_name, student_last_name, guardian_name, phone,
    lead_source, initial_contact_date, assigned_profile_id, notes, created_by
  )
  values (
    v_organization_id, v_student_first_name, v_student_last_name, v_guardian_name, v_phone,
    p_lead_source::public.lead_source_type, v_initial_contact_date, p_assigned_profile_id,
    v_notes, v_user_id
  )
  returning id into v_prospect_id;

  if v_course_ids is not null and cardinality(v_course_ids) > 0 then
    insert into public.prospect_course_interests (prospect_id, course_id)
    select v_prospect_id, cid from pg_catalog.unnest(v_course_ids) as cid;
  end if;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'prospects', v_prospect_id::text, 'create', null,
    pg_catalog.jsonb_build_object(
      'student_first_name', v_student_first_name,
      'student_last_name', v_student_last_name,
      'guardian_name', v_guardian_name,
      'lead_source', p_lead_source,
      'status', 'new'
    )
  );

  return v_prospect_id;
end;
$$;

revoke all on function
  public.create_prospect(text, text, text, text, text, date, uuid, uuid[], text)
from public, anon;
grant execute on function
  public.create_prospect(text, text, text, text, text, date, uuid, uuid[], text)
to authenticated;

create or replace function public.update_prospect(
  p_prospect_id uuid,
  p_student_first_name text,
  p_student_last_name text,
  p_guardian_name text,
  p_phone text,
  p_lead_source text,
  p_assigned_profile_id uuid default null,
  p_course_ids uuid[] default null,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_student_first_name text := pg_catalog.btrim(coalesce(p_student_first_name, ''));
  v_student_last_name text := pg_catalog.btrim(coalesce(p_student_last_name, ''));
  v_guardian_name text := pg_catalog.btrim(coalesce(p_guardian_name, ''));
  v_phone text := pg_catalog.btrim(coalesce(p_phone, ''));
  v_notes text := nullif(pg_catalog.btrim(coalesce(p_notes, '')), '');
  v_course_ids uuid[];
  v_matched_course_count integer;
  v_old_data jsonb;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Aday öğrenci düzenleme yetkiniz bulunmuyor.';
  end if;

  if pg_catalog.char_length(v_student_first_name) < 2 then
    raise exception 'Öğrenci adı en az 2 karakter olmalıdır.';
  end if;

  if pg_catalog.char_length(v_student_last_name) < 2 then
    raise exception 'Öğrenci soyadı en az 2 karakter olmalıdır.';
  end if;

  if pg_catalog.char_length(v_guardian_name) < 2 then
    raise exception 'Veli adı en az 2 karakter olmalıdır.';
  end if;

  if pg_catalog.char_length(pg_catalog.regexp_replace(v_phone, '[^0-9]', '', 'g')) < 10 then
    raise exception 'Geçerli bir telefon numarası girilmelidir.';
  end if;

  if p_lead_source not in
    ('referral', 'social_media', 'website', 'walk_in', 'phone_call', 'advertisement', 'other') then
    raise exception 'Geçerli bir kaynak seçilmelidir.';
  end if;

  select pg_catalog.jsonb_build_object(
    'student_first_name', student_first_name,
    'student_last_name', student_last_name,
    'guardian_name', guardian_name,
    'lead_source', lead_source
  )
  into v_old_data
  from public.prospects
  where id = p_prospect_id and organization_id = v_organization_id;

  if v_old_data is null then
    raise exception 'Aday öğrenci kaydı bulunamadı.';
  end if;

  if p_assigned_profile_id is not null and not exists (
    select 1 from public.profiles pr
    where pr.id = p_assigned_profile_id and pr.organization_id = v_organization_id
  ) then
    raise exception 'Atanan personel bulunamadı.';
  end if;

  if p_course_ids is not null then
    v_course_ids := array(select distinct c from pg_catalog.unnest(p_course_ids) as c);
  end if;

  if v_course_ids is not null and cardinality(v_course_ids) > 0 then
    select count(*) into v_matched_course_count
    from public.courses c
    where c.id = any(v_course_ids) and c.organization_id = v_organization_id;

    if v_matched_course_count <> cardinality(v_course_ids) then
      raise exception 'Seçilen derslerden biri bulunamadı.';
    end if;
  end if;

  update public.prospects
  set student_first_name = v_student_first_name,
      student_last_name = v_student_last_name,
      guardian_name = v_guardian_name,
      phone = v_phone,
      lead_source = p_lead_source::public.lead_source_type,
      assigned_profile_id = p_assigned_profile_id,
      notes = v_notes,
      updated_at = pg_catalog.now()
  where id = p_prospect_id and organization_id = v_organization_id;

  delete from public.prospect_course_interests where prospect_id = p_prospect_id;

  if v_course_ids is not null and cardinality(v_course_ids) > 0 then
    insert into public.prospect_course_interests (prospect_id, course_id)
    select p_prospect_id, cid from pg_catalog.unnest(v_course_ids) as cid;
  end if;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'prospects', p_prospect_id::text, 'update', v_old_data,
    pg_catalog.jsonb_build_object(
      'student_first_name', v_student_first_name,
      'student_last_name', v_student_last_name,
      'guardian_name', v_guardian_name,
      'lead_source', p_lead_source
    )
  );
end;
$$;

revoke all on function
  public.update_prospect(uuid, text, text, text, text, text, uuid, uuid[], text)
from public, anon;
grant execute on function
  public.update_prospect(uuid, text, text, text, text, text, uuid, uuid[], text)
to authenticated;

create or replace function public.update_prospect_status(
  p_prospect_id uuid,
  p_status text,
  p_decline_reason text default null,
  p_next_follow_up_date date default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_prospect record;
  v_decline_reason text := nullif(pg_catalog.btrim(coalesce(p_decline_reason, '')), '');
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Aday öğrenci durumunu değiştirme yetkiniz bulunmuyor.';
  end if;

  if p_status not in
    ('new', 'follow_up_required', 'appointment_scheduled', 'trial_attended', 'declined') then
    raise exception 'Geçerli bir durum seçilmelidir.';
  end if;

  if p_status = 'declined' and v_decline_reason is null then
    raise exception 'Reddetme nedeni belirtilmelidir.';
  end if;

  select * into v_prospect
  from public.prospects
  where id = p_prospect_id and organization_id = v_organization_id
  for update;

  if not found then
    raise exception 'Aday öğrenci kaydı bulunamadı.';
  end if;

  if v_prospect.converted_student_id is not null then
    raise exception 'Bu aday zaten bir öğrenciye dönüştürülmüş.';
  end if;

  update public.prospects
  set status = p_status::public.prospect_status,
      decline_reason = case when p_status = 'declined' then v_decline_reason else null end,
      next_follow_up_date = p_next_follow_up_date,
      updated_at = pg_catalog.now()
  where id = p_prospect_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'prospects', p_prospect_id::text, 'update_status',
    pg_catalog.jsonb_build_object('status', v_prospect.status),
    pg_catalog.jsonb_build_object(
      'status', p_status, 'decline_reason', v_decline_reason,
      'next_follow_up_date', p_next_follow_up_date
    )
  );
end;
$$;

revoke all on function
  public.update_prospect_status(uuid, text, text, date)
from public, anon;
grant execute on function
  public.update_prospect_status(uuid, text, text, date)
to authenticated;

-- ---------------------------------------------------------------
-- 5) Deneme dersi planlama / iptal. Çakışma kontrolü için mevcut
-- describe_session_scheduling_conflict()'i (20260812100000) yeniden
-- kullanır — öğretmen/derslik çakışmasını TÜM lesson_sessions'a karşı
-- kontrol ettiğinden, deneme-vs-normal ve deneme-vs-deneme çakışmaları
-- ekstra kod olmadan yakalanır.
-- ---------------------------------------------------------------

create or replace function public.schedule_prospect_trial_lesson(
  p_prospect_id uuid,
  p_course_id uuid,
  p_teacher_profile_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_room_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_prospect record;
  v_conflict text;
  v_old_session_id uuid;
  v_new_session_id uuid;
  v_room_name text := nullif(pg_catalog.btrim(coalesce(p_room_name, '')), '');
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Deneme dersi planlama yetkiniz bulunmuyor.';
  end if;

  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'Bitiş saati başlangıçtan sonra olmalıdır.';
  end if;

  select * into v_prospect
  from public.prospects
  where id = p_prospect_id and organization_id = v_organization_id
  for update;

  if not found then
    raise exception 'Aday öğrenci kaydı bulunamadı.';
  end if;

  if v_prospect.converted_student_id is not null then
    raise exception 'Bu aday zaten bir öğrenciye dönüştürülmüş.';
  end if;

  if not exists (
    select 1 from public.courses c
    where c.id = p_course_id and c.organization_id = v_organization_id
  ) then
    raise exception 'Ders bulunamadı.';
  end if;

  if p_teacher_profile_id is not null and not exists (
    select 1 from public.profiles pr
    where pr.id = p_teacher_profile_id
      and pr.organization_id = v_organization_id
      and pr.role in ('admin'::public.app_role, 'teacher'::public.app_role)
  ) then
    raise exception 'Öğretmen bulunamadı.';
  end if;

  -- Zaten iptal edilmemiş bir deneme dersi varsa, bu çağrı bir yeniden
  -- planlama sayılır: eskisi önce iptal edilir.
  if v_prospect.trial_lesson_id is not null then
    select ls.id into v_old_session_id
    from public.lesson_sessions ls
    where ls.id = v_prospect.trial_lesson_id and ls.cancelled_at is null;

    if v_old_session_id is not null then
      update public.lesson_sessions
      set cancelled_at = pg_catalog.now(), cancellation_reason = 'Yeniden planlandı'
      where id = v_old_session_id;
    end if;
  end if;

  v_conflict := public.describe_session_scheduling_conflict(
    v_organization_id, p_teacher_profile_id, v_room_name, p_starts_at, p_ends_at, null
  );

  if v_conflict is not null then
    raise exception '%', v_conflict;
  end if;

  insert into public.lesson_sessions (
    organization_id, class_group_id, course_id, teacher_profile_id,
    starts_at, ends_at, room_name, is_trial, prospect_id
  )
  values (
    v_organization_id, null, p_course_id, p_teacher_profile_id,
    p_starts_at, p_ends_at, v_room_name, true, p_prospect_id
  )
  returning id into v_new_session_id;

  update public.prospects
  set trial_lesson_id = v_new_session_id,
      status = case
        when status in
          ('new'::public.prospect_status, 'follow_up_required'::public.prospect_status)
        then 'appointment_scheduled'::public.prospect_status
        else status
      end,
      updated_at = pg_catalog.now()
  where id = p_prospect_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'lesson_sessions', v_new_session_id::text, 'schedule_trial', null,
    pg_catalog.jsonb_build_object(
      'prospect_id', p_prospect_id, 'course_id', p_course_id,
      'teacher_profile_id', p_teacher_profile_id,
      'starts_at', p_starts_at, 'ends_at', p_ends_at
    )
  );

  return v_new_session_id;
end;
$$;

revoke all on function
  public.schedule_prospect_trial_lesson(uuid, uuid, uuid, timestamptz, timestamptz, text)
from public, anon;
grant execute on function
  public.schedule_prospect_trial_lesson(uuid, uuid, uuid, timestamptz, timestamptz, text)
to authenticated;

create or replace function public.cancel_prospect_trial_lesson(
  p_prospect_id uuid,
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
  v_prospect record;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Deneme dersi iptal etme yetkiniz bulunmuyor.';
  end if;

  if v_reason is null then
    raise exception 'İptal için bir açıklama girilmelidir.';
  end if;

  select * into v_prospect
  from public.prospects
  where id = p_prospect_id and organization_id = v_organization_id
  for update;

  if not found then
    raise exception 'Aday öğrenci kaydı bulunamadı.';
  end if;

  if v_prospect.trial_lesson_id is null then
    raise exception 'Bu aday için planlanmış bir deneme dersi yok.';
  end if;

  update public.lesson_sessions
  set cancelled_at = pg_catalog.now(), cancellation_reason = v_reason
  where id = v_prospect.trial_lesson_id and cancelled_at is null;

  update public.prospects
  set trial_lesson_id = null, updated_at = pg_catalog.now()
  where id = p_prospect_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'lesson_sessions', v_prospect.trial_lesson_id::text,
    'cancel_trial', null, pg_catalog.jsonb_build_object('reason', v_reason)
  );
end;
$$;

revoke all on function
  public.cancel_prospect_trial_lesson(uuid, text)
from public, anon;
grant execute on function
  public.cancel_prospect_trial_lesson(uuid, text)
to authenticated;

-- ---------------------------------------------------------------
-- 6) Dönüştürme — mevcut create_student_with_guardian()'ı prospects
-- satırındaki değerlerle çağırır, aynı bilgiyi tekrar istemez.
-- ---------------------------------------------------------------

create or replace function public.convert_prospect_to_student(
  p_prospect_id uuid,
  p_student_identity_number text,
  p_guardian_identity_number text,
  p_birth_date date default null,
  p_registration_date date default null,
  p_guardian_secondary_phone text default null,
  p_guardian_email text default null,
  p_relationship text default 'Veli'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_prospect record;
  v_student_id uuid;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Aday öğrenciyi öğrenciye dönüştürme yetkiniz bulunmuyor.';
  end if;

  select * into v_prospect
  from public.prospects
  where id = p_prospect_id and organization_id = v_organization_id
  for update;

  if not found then
    raise exception 'Aday öğrenci kaydı bulunamadı.';
  end if;

  if v_prospect.converted_student_id is not null then
    raise exception 'Bu aday zaten bir öğrenciye dönüştürülmüş.';
  end if;

  if v_prospect.status = 'declined'::public.prospect_status then
    raise exception 'Reddedilmiş bir aday öğrenci, öğrenciye dönüştürülemez.';
  end if;

  v_student_id := public.create_student_with_guardian(
    p_student_identity_number,
    v_prospect.student_first_name,
    v_prospect.student_last_name,
    p_guardian_identity_number,
    v_prospect.guardian_name,
    v_prospect.phone,
    p_birth_date,
    p_registration_date,
    v_prospect.notes,
    p_guardian_secondary_phone,
    p_guardian_email,
    p_relationship
  );

  update public.prospects
  set converted_student_id = v_student_id,
      status = 'enrolled'::public.prospect_status,
      updated_at = pg_catalog.now()
  where id = p_prospect_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'prospects', p_prospect_id::text, 'convert', null,
    pg_catalog.jsonb_build_object('converted_student_id', v_student_id)
  );

  return v_student_id;
end;
$$;

revoke all on function
  public.convert_prospect_to_student(uuid, text, text, date, date, text, text, text)
from public, anon;
grant execute on function
  public.convert_prospect_to_student(uuid, text, text, date, date, text, text, text)
to authenticated;

-- ---------------------------------------------------------------
-- 7) Öğretmenin kendi deneme derslerini görmesi — get_attendance_roster
-- ile aynı "asgari alan" deseni: yalnızca aday öğrenci adı, telefon/veli/
-- kaynak/not YOK.
-- ---------------------------------------------------------------

create or replace function public.get_teacher_trial_lessons(
  p_from date,
  p_to date
)
returns table (
  lesson_session_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  room_name text,
  course_name text,
  prospect_student_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_is_admin boolean;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Geçerli bir tarih aralığı seçilmelidir.';
  end if;

  v_is_admin := public.is_admin();

  return query
  select
    ls.id, ls.starts_at, ls.ends_at, ls.room_name, c.name,
    pr.student_first_name || ' ' || pr.student_last_name
  from public.lesson_sessions ls
  inner join public.courses c on c.id = ls.course_id
  inner join public.prospects pr on pr.id = ls.prospect_id
  where ls.organization_id = v_organization_id
    and ls.is_trial = true
    and ls.cancelled_at is null
    and ls.starts_at >= (p_from::timestamp at time zone 'Europe/Istanbul')
    and ls.starts_at < ((p_to + 1)::timestamp at time zone 'Europe/Istanbul')
    and (v_is_admin or ls.teacher_profile_id = v_user_id)
  order by ls.starts_at asc;
end;
$$;

revoke all on function public.get_teacher_trial_lessons(date, date) from public, anon;
grant execute on function public.get_teacher_trial_lessons(date, date) to authenticated;

-- ---------------------------------------------------------------
-- 8) Raporlar: dönüşüm oranı, kaynak performansı, ders bazlı talep.
-- ---------------------------------------------------------------

create or replace function public.get_prospect_conversion_report(
  p_start_date date,
  p_end_date date
)
returns table (
  total_prospects integer,
  new_count integer,
  follow_up_count integer,
  appointment_count integer,
  trial_attended_count integer,
  enrolled_count integer,
  declined_count integer,
  conversion_rate numeric
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
    raise exception 'Bu raporu görüntüleme yetkiniz bulunmuyor.';
  end if;

  if p_start_date is null or p_end_date is null or p_start_date > p_end_date then
    raise exception 'Geçerli bir tarih aralığı seçilmelidir.';
  end if;

  if p_end_date - p_start_date > 730 then
    raise exception 'Tarih aralığı en fazla 2 yıl olabilir.';
  end if;

  return query
  select
    count(*)::integer,
    count(*) filter (where status = 'new'::public.prospect_status)::integer,
    count(*) filter (where status = 'follow_up_required'::public.prospect_status)::integer,
    count(*) filter (where status = 'appointment_scheduled'::public.prospect_status)::integer,
    count(*) filter (where status = 'trial_attended'::public.prospect_status)::integer,
    count(*) filter (where status = 'enrolled'::public.prospect_status)::integer,
    count(*) filter (where status = 'declined'::public.prospect_status)::integer,
    case when count(*) > 0
      then pg_catalog.round(
        count(*) filter (where status = 'enrolled'::public.prospect_status)::numeric
          / count(*)::numeric * 100,
        1
      )
      else 0
    end
  from public.prospects
  where organization_id = v_organization_id
    and initial_contact_date >= p_start_date
    and initial_contact_date <= p_end_date;
end;
$$;

revoke all on function public.get_prospect_conversion_report(date, date) from public, anon;
grant execute on function public.get_prospect_conversion_report(date, date) to authenticated;

create or replace function public.get_prospect_lead_source_report(
  p_start_date date,
  p_end_date date
)
returns table (
  lead_source public.lead_source_type,
  prospect_count integer,
  enrolled_count integer,
  conversion_rate numeric
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
    raise exception 'Bu raporu görüntüleme yetkiniz bulunmuyor.';
  end if;

  if p_start_date is null or p_end_date is null or p_start_date > p_end_date then
    raise exception 'Geçerli bir tarih aralığı seçilmelidir.';
  end if;

  if p_end_date - p_start_date > 730 then
    raise exception 'Tarih aralığı en fazla 2 yıl olabilir.';
  end if;

  return query
  select
    p.lead_source,
    count(*)::integer,
    count(*) filter (where p.status = 'enrolled'::public.prospect_status)::integer,
    case when count(*) > 0
      then pg_catalog.round(
        count(*) filter (where p.status = 'enrolled'::public.prospect_status)::numeric
          / count(*)::numeric * 100,
        1
      )
      else 0
    end
  from public.prospects p
  where p.organization_id = v_organization_id
    and p.initial_contact_date >= p_start_date
    and p.initial_contact_date <= p_end_date
  group by p.lead_source
  order by count(*) desc;
end;
$$;

revoke all on function public.get_prospect_lead_source_report(date, date) from public, anon;
grant execute on function public.get_prospect_lead_source_report(date, date) to authenticated;

create or replace function public.get_prospect_course_demand_report(
  p_start_date date,
  p_end_date date
)
returns table (
  course_id uuid,
  course_name text,
  interested_count integer,
  enrolled_count integer
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
    raise exception 'Bu raporu görüntüleme yetkiniz bulunmuyor.';
  end if;

  if p_start_date is null or p_end_date is null or p_start_date > p_end_date then
    raise exception 'Geçerli bir tarih aralığı seçilmelidir.';
  end if;

  if p_end_date - p_start_date > 730 then
    raise exception 'Tarih aralığı en fazla 2 yıl olabilir.';
  end if;

  return query
  select
    c.id, c.name,
    count(pci.prospect_id)::integer,
    count(pci.prospect_id) filter (where p.status = 'enrolled'::public.prospect_status)::integer
  from public.courses c
  inner join public.prospect_course_interests pci on pci.course_id = c.id
  inner join public.prospects p on p.id = pci.prospect_id
  where c.organization_id = v_organization_id
    and p.organization_id = v_organization_id
    and p.initial_contact_date >= p_start_date
    and p.initial_contact_date <= p_end_date
  group by c.id, c.name
  order by count(pci.prospect_id) desc;
end;
$$;

revoke all on function public.get_prospect_course_demand_report(date, date) from public, anon;
grant execute on function public.get_prospect_course_demand_report(date, date) to authenticated;

-- ---------------------------------------------------------------
-- 9) get_dashboard_financial_summary() yaması — bugünün oturum
-- sayıları artık deneme derslerini SAYMIYOR (bu göstergeler tahakkuk/
-- tahsilat rakamlarının yanında "ücretli ders faaliyeti" anlamına
-- geliyor). İmza (p_month_start date) değişmedi, create or replace
-- yeterli.
-- ---------------------------------------------------------------

create or replace function public.get_dashboard_financial_summary(
  p_month_start date default null
)
returns table (
  active_student_count integer,
  monthly_accrued numeric,
  monthly_collected numeric,
  monthly_cash_received numeric,
  prior_period_carryover numeric,
  prior_period_carryover_count integer,
  total_open_receivable numeric,
  total_open_receivable_count integer,
  student_advance_balance numeric,
  today_active_session_count integer,
  today_total_session_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid := public.current_organization_id();
  v_month_start date;
  v_next_month_start date;
  v_today date;
  v_tomorrow date;
begin
  if v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Bu özeti görüntüleme yetkiniz bulunmuyor.';
  end if;

  v_today := (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
  v_tomorrow := v_today + 1;

  v_month_start := pg_catalog.date_trunc(
    'month',
    coalesce(p_month_start, v_today)::timestamp
  )::date;
  v_next_month_start := (v_month_start + interval '1 month')::date;

  return query
  select
    (
      select count(*)::integer
      from public.students s
      where s.organization_id = v_organization_id
        and s.status = 'active'::public.record_status
    ),
    (
      select coalesce(sum(a.net_amount), 0)
      from public.accruals a
      where a.organization_id = v_organization_id
        and a.period_start = v_month_start
        and a.status not in ('cancelled'::public.accrual_status, 'refunded'::public.accrual_status)
    ),
    (
      select coalesce(sum(a.allocated_amount), 0)
      from public.accruals a
      where a.organization_id = v_organization_id
        and a.period_start = v_month_start
        and a.status not in ('cancelled'::public.accrual_status, 'refunded'::public.accrual_status)
    ),
    (
      select coalesce(sum(p.amount), 0)
      from public.payments p
      where p.organization_id = v_organization_id
        and p.is_refunded = false
        and p.received_at >= (v_month_start::timestamp at time zone 'Europe/Istanbul')
        and p.received_at < (v_next_month_start::timestamp at time zone 'Europe/Istanbul')
    ),
    (
      select coalesce(sum(a.net_amount - a.allocated_amount), 0)
      from public.accruals a
      where a.organization_id = v_organization_id
        and a.period_start < v_month_start
        and a.status not in ('cancelled'::public.accrual_status, 'refunded'::public.accrual_status)
        and (a.net_amount - a.allocated_amount) > 0.01
    ),
    (
      select count(*)::integer
      from public.accruals a
      where a.organization_id = v_organization_id
        and a.period_start < v_month_start
        and a.status not in ('cancelled'::public.accrual_status, 'refunded'::public.accrual_status)
        and (a.net_amount - a.allocated_amount) > 0.01
    ),
    (
      select coalesce(sum(a.net_amount - a.allocated_amount), 0)
      from public.accruals a
      where a.organization_id = v_organization_id
        and a.period_start <= v_month_start
        and a.status not in ('cancelled'::public.accrual_status, 'refunded'::public.accrual_status)
        and (a.net_amount - a.allocated_amount) > 0.01
    ),
    (
      select count(*)::integer
      from public.accruals a
      where a.organization_id = v_organization_id
        and a.period_start <= v_month_start
        and a.status not in ('cancelled'::public.accrual_status, 'refunded'::public.accrual_status)
        and (a.net_amount - a.allocated_amount) > 0.01
    ),
    (
      select coalesce(sum(greatest(p.amount - coalesce(alloc.allocated_total, 0), 0)), 0)
      from public.payments p
      left join (
        select pa.payment_id, sum(pa.amount) as allocated_total
        from public.payment_allocations pa
        group by pa.payment_id
      ) alloc on alloc.payment_id = p.id
      where p.organization_id = v_organization_id
        and p.is_refunded = false
    ),
    (
      select count(*)::integer
      from public.lesson_sessions ls
      where ls.organization_id = v_organization_id
        and ls.starts_at >= (v_today::timestamp at time zone 'Europe/Istanbul')
        and ls.starts_at < (v_tomorrow::timestamp at time zone 'Europe/Istanbul')
        and ls.cancelled_at is null
        and ls.is_trial = false
    ),
    (
      select count(*)::integer
      from public.lesson_sessions ls
      where ls.organization_id = v_organization_id
        and ls.starts_at >= (v_today::timestamp at time zone 'Europe/Istanbul')
        and ls.starts_at < (v_tomorrow::timestamp at time zone 'Europe/Istanbul')
        and ls.is_trial = false
    );
end;
$$;

revoke all on function public.get_dashboard_financial_summary(date) from public, anon;
grant execute on function public.get_dashboard_financial_summary(date) to authenticated;

notify pgrst, 'reload schema';
