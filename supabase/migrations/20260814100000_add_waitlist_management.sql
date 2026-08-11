-- Bekleme listesi ve boş kontenjan yönetimi.
--
-- Tasarım özeti:
--   1) waitlist_entries, dolu bir class_group için "sırada bekleyen"
--      kaydı tutar — mevcut bir öğrenci İYA DA aday öğrenci (prospects,
--      20260813100000) için, ikisinden TAM OLARAK biri
--      (check (num_nonnulls(student_id, prospect_id) = 1)).
--   2) Bekleme kaydı ASLA enrollments satırı yaratmaz — yalnızca
--      enroll_from_waitlist() yaratır, o da mevcut
--      create_enrollment_with_meb_registration()'ı (20260812100000)
--      ÇAĞIRIR, kendi kaydı yazmaz. Tahakkuk üretimi %100 enrollments
--      üzerinden ve yoklama enrollment_id NOT NULL gerektirdiğinden,
--      bekleme listesi hiçbir koşulda tahakkuk/oturum/yoklama
--      üretemez — bu modülün hiçbir fonksiyonu o tablolara yazmaz.
--   3) "Kontenjan işlem İÇİNDE yeniden doğrulanmalı" kuralı,
--      create_enrollment_with_meb_registration()'ın ZATEN yaptığı
--      `for update of cg` kilidi + canlı active+frozen sayımı
--      yeniden kullanılarak karşılanıyor — enroll_from_waitlist bunu
--      TEKRAR yazmaz, yalnızca çağırır.
--   4) "Adminin görmesi" (bildirim), event/trigger değil SORGU
--      tabanlı: get_waitlist_opportunities() her çağrıldığında
--      class_groups.capacity ile canlı active+frozen sayısını
--      karşılaştırır — bir öğrenci gruptan ayrıldığında (archive_student,
--      20260726001601, veya ileride eklenecek her ne olursa) hiçbir
--      ekstra kod olmadan otomatik yansır.
--   5) Aynı kişi + aynı class_group için birden fazla AKTİF
--      (waiting/offered) kayıt: RPC seviyesinde dostane hata + iki
--      parçalı unique index (öğrenci/aday için ayrı) — WhatsApp
--      modülündeki rıza tetikleyicisiyle aynı iki katmanlı desen.

-- ---------------------------------------------------------------
-- 1) Enum
-- ---------------------------------------------------------------

create type public.waitlist_status as enum (
  'waiting',
  'offered',
  'accepted',
  'declined',
  'expired',
  'cancelled'
);

-- ---------------------------------------------------------------
-- 2) waitlist_entries
-- ---------------------------------------------------------------

create table public.waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id),
  class_group_id uuid not null references public.class_groups(id),
  course_id uuid not null references public.courses(id),
  student_id uuid references public.students(id),
  prospect_id uuid references public.prospects(id),
  check (pg_catalog.num_nonnulls(student_id, prospect_id) = 1),
  priority integer not null default 0,
  application_date date not null default (pg_catalog.now() at time zone 'Europe/Istanbul')::date,
  preferred_weekdays smallint[] not null default '{}',
  preferred_time_start time,
  preferred_time_end time,
  status public.waitlist_status not null default 'waiting',
  notes text,
  offered_at timestamptz,
  offer_expires_at timestamptz,
  responded_at timestamptz,
  decline_reason text,
  converted_enrollment_id uuid references public.enrollments(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create index waitlist_entries_org_status_idx
on public.waitlist_entries (organization_id, status, priority);

create index waitlist_entries_class_group_idx
on public.waitlist_entries (class_group_id, status);

create unique index waitlist_entries_active_student_unique
on public.waitlist_entries (class_group_id, student_id)
where status in ('waiting', 'offered') and student_id is not null;

create unique index waitlist_entries_active_prospect_unique
on public.waitlist_entries (class_group_id, prospect_id)
where status in ('waiting', 'offered') and prospect_id is not null;

create trigger waitlist_entries_set_updated_at
before update on public.waitlist_entries
for each row execute function public.set_updated_at();

alter table public.waitlist_entries enable row level security;

create policy waitlist_entries_select_admin
on public.waitlist_entries
for select
to authenticated
using (
  organization_id = public.current_organization_id()
  and public.is_admin()
);

revoke insert, update, delete on public.waitlist_entries from authenticated;
grant select on public.waitlist_entries to authenticated;

-- ---------------------------------------------------------------
-- 3) CRUD RPC'leri.
-- ---------------------------------------------------------------

create or replace function public.add_waitlist_entry(
  p_class_group_id uuid,
  p_student_id uuid,
  p_prospect_id uuid,
  p_priority integer default 0,
  p_application_date date default null,
  p_preferred_weekdays smallint[] default '{}',
  p_preferred_time_start time default null,
  p_preferred_time_end time default null,
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
  v_course_id uuid;
  v_application_date date :=
    coalesce(p_application_date, (pg_catalog.now() at time zone 'Europe/Istanbul')::date);
  v_notes text := nullif(pg_catalog.btrim(coalesce(p_notes, '')), '');
  v_entry_id uuid;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Bekleme listesine ekleme yetkiniz bulunmuyor.';
  end if;

  if pg_catalog.num_nonnulls(p_student_id, p_prospect_id) <> 1 then
    raise exception 'Bir öğrenci veya bir aday öğrenci seçilmelidir (ikisi birden değil).';
  end if;

  select cg.course_id into v_course_id
  from public.class_groups cg
  where cg.id = p_class_group_id and cg.organization_id = v_organization_id;

  if v_course_id is null then
    raise exception 'Ders seansı bulunamadı.';
  end if;

  if p_student_id is not null and not exists (
    select 1 from public.students s
    where s.id = p_student_id and s.organization_id = v_organization_id
  ) then
    raise exception 'Öğrenci kaydı bulunamadı.';
  end if;

  if p_prospect_id is not null and not exists (
    select 1 from public.prospects p
    where p.id = p_prospect_id and p.organization_id = v_organization_id
  ) then
    raise exception 'Aday öğrenci kaydı bulunamadı.';
  end if;

  if exists (
    select 1 from public.waitlist_entries w
    where w.class_group_id = p_class_group_id
      and w.status in ('waiting'::public.waitlist_status, 'offered'::public.waitlist_status)
      and (
        (p_student_id is not null and w.student_id = p_student_id)
        or (p_prospect_id is not null and w.prospect_id = p_prospect_id)
      )
  ) then
    raise exception 'Bu kişinin bu ders seansı için zaten aktif bir bekleme kaydı var.';
  end if;

  insert into public.waitlist_entries (
    organization_id, class_group_id, course_id, student_id, prospect_id,
    priority, application_date, preferred_weekdays, preferred_time_start,
    preferred_time_end, notes, created_by
  )
  values (
    v_organization_id, p_class_group_id, v_course_id, p_student_id, p_prospect_id,
    coalesce(p_priority, 0), v_application_date, coalesce(p_preferred_weekdays, '{}'),
    p_preferred_time_start, p_preferred_time_end, v_notes, v_user_id
  )
  returning id into v_entry_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'waitlist_entries', v_entry_id::text, 'create', null,
    pg_catalog.jsonb_build_object(
      'class_group_id', p_class_group_id, 'student_id', p_student_id,
      'prospect_id', p_prospect_id, 'priority', coalesce(p_priority, 0),
      'application_date', v_application_date, 'status', 'waiting'
    )
  );

  return v_entry_id;
end;
$$;

revoke all on function
  public.add_waitlist_entry(uuid, uuid, uuid, integer, date, smallint[], time, time, text)
from public, anon;
grant execute on function
  public.add_waitlist_entry(uuid, uuid, uuid, integer, date, smallint[], time, time, text)
to authenticated;

create or replace function public.update_waitlist_entry(
  p_waitlist_entry_id uuid,
  p_priority integer,
  p_application_date date,
  p_preferred_weekdays smallint[],
  p_preferred_time_start time,
  p_preferred_time_end time,
  p_notes text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_notes text := nullif(pg_catalog.btrim(coalesce(p_notes, '')), '');
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Bekleme kaydını düzenleme yetkiniz bulunmuyor.';
  end if;

  if not exists (
    select 1 from public.waitlist_entries
    where id = p_waitlist_entry_id and organization_id = v_organization_id
  ) then
    raise exception 'Bekleme kaydı bulunamadı.';
  end if;

  update public.waitlist_entries
  set priority = coalesce(p_priority, 0),
      application_date =
        coalesce(p_application_date, (pg_catalog.now() at time zone 'Europe/Istanbul')::date),
      preferred_weekdays = coalesce(p_preferred_weekdays, '{}'),
      preferred_time_start = p_preferred_time_start,
      preferred_time_end = p_preferred_time_end,
      notes = v_notes,
      updated_at = pg_catalog.now()
  where id = p_waitlist_entry_id and organization_id = v_organization_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'waitlist_entries', p_waitlist_entry_id::text, 'update', null,
    pg_catalog.jsonb_build_object(
      'priority', coalesce(p_priority, 0), 'application_date', p_application_date
    )
  );
end;
$$;

revoke all on function
  public.update_waitlist_entry(uuid, integer, date, smallint[], time, time, text)
from public, anon;
grant execute on function
  public.update_waitlist_entry(uuid, integer, date, smallint[], time, time, text)
to authenticated;

create or replace function public.cancel_waitlist_entry(
  p_waitlist_entry_id uuid,
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
  v_status public.waitlist_status;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Bekleme kaydını iptal etme yetkiniz bulunmuyor.';
  end if;

  select status into v_status
  from public.waitlist_entries
  where id = p_waitlist_entry_id and organization_id = v_organization_id
  for update;

  if not found then
    raise exception 'Bekleme kaydı bulunamadı.';
  end if;

  if v_status not in ('waiting'::public.waitlist_status, 'offered'::public.waitlist_status) then
    raise exception 'Bu durumdaki bir bekleme kaydı iptal edilemez.';
  end if;

  update public.waitlist_entries
  set status = 'cancelled'::public.waitlist_status,
      decline_reason = v_reason,
      updated_at = pg_catalog.now()
  where id = p_waitlist_entry_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'waitlist_entries', p_waitlist_entry_id::text, 'cancel',
    pg_catalog.jsonb_build_object('status', v_status),
    pg_catalog.jsonb_build_object('status', 'cancelled', 'reason', v_reason)
  );
end;
$$;

revoke all on function public.cancel_waitlist_entry(uuid, text) from public, anon;
grant execute on function public.cancel_waitlist_entry(uuid, text) to authenticated;

-- ---------------------------------------------------------------
-- 4) Teklif / yanıt / kayıt.
-- ---------------------------------------------------------------

create or replace function public.offer_waitlist_seat(
  p_waitlist_entry_id uuid,
  p_offer_expires_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_status public.waitlist_status;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Teklif verme yetkiniz bulunmuyor.';
  end if;

  select status into v_status
  from public.waitlist_entries
  where id = p_waitlist_entry_id and organization_id = v_organization_id
  for update;

  if not found then
    raise exception 'Bekleme kaydı bulunamadı.';
  end if;

  if v_status <> 'waiting'::public.waitlist_status then
    raise exception 'Yalnızca sırada bekleyen kayıtlara teklif verilebilir.';
  end if;

  update public.waitlist_entries
  set status = 'offered'::public.waitlist_status,
      offered_at = pg_catalog.now(),
      offer_expires_at = coalesce(p_offer_expires_at, pg_catalog.now() + interval '3 days'),
      updated_at = pg_catalog.now()
  where id = p_waitlist_entry_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'waitlist_entries', p_waitlist_entry_id::text, 'offer',
    pg_catalog.jsonb_build_object('status', v_status),
    pg_catalog.jsonb_build_object('status', 'offered')
  );
end;
$$;

revoke all on function public.offer_waitlist_seat(uuid, timestamptz) from public, anon;
grant execute on function public.offer_waitlist_seat(uuid, timestamptz) to authenticated;

create or replace function public.resolve_waitlist_offer(
  p_waitlist_entry_id uuid,
  p_resolution text,
  p_decline_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_status public.waitlist_status;
  v_decline_reason text := nullif(pg_catalog.btrim(coalesce(p_decline_reason, '')), '');
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Teklif yanıtını kaydetme yetkiniz bulunmuyor.';
  end if;

  if p_resolution not in ('accepted', 'declined', 'expired') then
    raise exception 'Geçerli bir yanıt seçilmelidir.';
  end if;

  if p_resolution = 'declined' and v_decline_reason is null then
    raise exception 'Reddetme nedeni belirtilmelidir.';
  end if;

  select status into v_status
  from public.waitlist_entries
  where id = p_waitlist_entry_id and organization_id = v_organization_id
  for update;

  if not found then
    raise exception 'Bekleme kaydı bulunamadı.';
  end if;

  if v_status <> 'offered'::public.waitlist_status then
    raise exception 'Yalnızca teklif verilmiş kayıtlar için yanıt kaydedilebilir.';
  end if;

  update public.waitlist_entries
  set status = p_resolution::public.waitlist_status,
      decline_reason = case when p_resolution = 'declined' then v_decline_reason else null end,
      responded_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where id = p_waitlist_entry_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'waitlist_entries', p_waitlist_entry_id::text, 'resolve_offer',
    pg_catalog.jsonb_build_object('status', v_status),
    pg_catalog.jsonb_build_object('status', p_resolution, 'decline_reason', v_decline_reason)
  );
end;
$$;

revoke all on function public.resolve_waitlist_offer(uuid, text, text) from public, anon;
grant execute on function public.resolve_waitlist_offer(uuid, text, text) to authenticated;

create or replace function public.enroll_from_waitlist(
  p_waitlist_entry_id uuid,
  p_starts_on date,
  p_ends_on date,
  p_list_monthly_fee numeric,
  p_discount_type text,
  p_discount_value numeric,
  p_due_day integer,
  p_notes text,
  p_meb_status text,
  p_meb_registration_number text,
  p_meb_valid_from date,
  p_meb_valid_until date,
  p_meb_non_registration_reason text,
  p_meb_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_entry record;
  v_enrollment_id uuid;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Bekleme listesinden kayıt oluşturma yetkiniz bulunmuyor.';
  end if;

  select * into v_entry
  from public.waitlist_entries
  where id = p_waitlist_entry_id and organization_id = v_organization_id
  for update;

  if not found then
    raise exception 'Bekleme kaydı bulunamadı.';
  end if;

  if v_entry.converted_enrollment_id is not null then
    raise exception 'Bu bekleme kaydından zaten bir kayıt oluşturulmuş.';
  end if;

  if v_entry.status <> 'accepted'::public.waitlist_status then
    raise exception 'Yalnızca kabul edilmiş bekleme kayıtları derse kaydedilebilir.';
  end if;

  if v_entry.student_id is null then
    raise exception 'Aday öğrenci önce bir öğrenciye dönüştürülmelidir.';
  end if;

  -- Kapasite, çakışma ve mükerrer kayıt kontrolleri
  -- create_enrollment_with_meb_registration() İÇİNDE, aynı transaction'da
  -- (for update of cg kilidiyle) yeniden yapılır — burada tekrarlanmaz.
  v_enrollment_id := public.create_enrollment_with_meb_registration(
    v_entry.student_id,
    v_entry.course_id,
    v_entry.class_group_id,
    p_starts_on,
    p_ends_on,
    p_list_monthly_fee,
    p_discount_type,
    p_discount_value,
    p_due_day,
    p_notes,
    p_meb_status,
    p_meb_registration_number,
    p_meb_valid_from,
    p_meb_valid_until,
    p_meb_non_registration_reason,
    p_meb_note
  );

  update public.waitlist_entries
  set converted_enrollment_id = v_enrollment_id,
      updated_at = pg_catalog.now()
  where id = p_waitlist_entry_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'waitlist_entries', p_waitlist_entry_id::text, 'enroll', null,
    pg_catalog.jsonb_build_object('converted_enrollment_id', v_enrollment_id)
  );

  return v_enrollment_id;
end;
$$;

revoke all on function public.enroll_from_waitlist(
  uuid, date, date, numeric, text, numeric, integer, text, text, text, date, date, text, text
) from public, anon;
grant execute on function public.enroll_from_waitlist(
  uuid, date, date, numeric, text, numeric, integer, text, text, text, date, date, text, text
) to authenticated;

-- ---------------------------------------------------------------
-- 5) Boş kontenjan görünürlüğü — "adminin görmesi" bu SORGU.
-- ---------------------------------------------------------------

create or replace function public.get_waitlist_opportunities()
returns table (
  class_group_id uuid,
  class_group_name text,
  course_id uuid,
  course_name text,
  capacity integer,
  active_count integer,
  available_seats integer,
  waiting_count integer
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
    cg.id,
    cg.name,
    cg.course_id,
    c.name,
    cg.capacity,
    coalesce(active.active_count, 0)::integer,
    (cg.capacity - coalesce(active.active_count, 0))::integer,
    coalesce(waiting.waiting_count, 0)::integer
  from public.class_groups cg
  inner join public.courses c on c.id = cg.course_id
  inner join (
    select w.class_group_id, count(*) as waiting_count
    from public.waitlist_entries w
    where w.organization_id = v_organization_id
      and w.status = 'waiting'::public.waitlist_status
    group by w.class_group_id
  ) waiting on waiting.class_group_id = cg.id
  left join (
    select e.class_group_id, count(*) as active_count
    from public.enrollments e
    where e.organization_id = v_organization_id
      and e.status in ('active'::public.enrollment_status, 'frozen'::public.enrollment_status)
    group by e.class_group_id
  ) active on active.class_group_id = cg.id
  where cg.organization_id = v_organization_id
  order by (cg.capacity - coalesce(active.active_count, 0)) desc, waiting.waiting_count desc;
end;
$$;

revoke all on function public.get_waitlist_opportunities() from public, anon;
grant execute on function public.get_waitlist_opportunities() to authenticated;

notify pgrst, 'reload schema';
