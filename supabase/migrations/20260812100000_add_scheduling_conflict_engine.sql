-- Sınıf/seans çakışma ve kapasite doğrulamasını tek, merkezi bir
-- motorda toplar; program oluşturma/güncelleme, öğrenci kaydı ve
-- telafi planlaması AYNI fonksiyonları çağırır.
--
-- Önceden var olan boşluklar:
--   * create_class_group/update_class_group hiçbir öğretmen/derslik
--     çakışma kontrolü yapmıyordu — aynı öğretmen ya da aynı derslik
--     aynı gün/saate iki kez atanabiliyordu.
--   * create_enrollment_with_meb_registration yalnızca AYNI dersten
--     ikinci bir açık kayıt engelliyordu (unique index); öğrencinin
--     FARKLI bir dersteki programıyla saat çakışması hiç kontrol
--     edilmiyordu.
--   * schedule_makeup()'ın "yeni tek seferlik oturum" yolunda, seçilen
--     öğretmenin var olup olmadığı/aktif olup olmadığı hiç
--     kontrol edilmiyordu; mevcut bir gruba misafir eklerken de
--     kontenjan sayımı class_groups satırı KİLİTLENMEDEN yapılıyordu
--     (eşzamanlı iki telafi ekleme kontenjanı aşabilirdi).
--   * has_scheduling_conflict/student_has_scheduling_conflict yalnızca
--     boolean dönüyordu — kullanıcıya HANGİ öğretmen/derslik/öğrenci
--     ile çakıştığını söyleyen bir mesaj yoktu.
--   * Tarih tutarlılığı (bitiş < başlangıç) yalnızca RPC içinde
--     kontrol ediliyordu, tablo düzeyinde bir CHECK kısıtı yoktu.
--   * MEB çalışma izni olmayan bir öğretmenin MEB onaylı bir derse
--     atanmasını engelleyen/uyaran hiçbir mekanizma yoktu.
--
-- Tasarım kararları:
--   * Şablon (class_groups) düzeyindeki çakışma, gerçek oturumlardan
--     (lesson_sessions) AYRI hesaplanır — bir seans oluşturulduğu anda
--     henüz hiçbir lesson_sessions satırı üretilmemiş olabilir (aylık
--     üretim ayrı bir süreçtir, generate_monthly_lesson_sessions).
--     Bu yüzden class_schedule_overlaps() gün+saat+tarih aralığını
--     matematiksel olarak karşılaştırır; lesson_sessions'a hiç
--     bakmaz.
--   * Oturum (lesson_sessions) düzeyindeki çakışma (reschedule/telafi)
--     zaten var olan has_scheduling_conflict/student_has_scheduling_
--     conflict fonksiyonlarının aynı mantığını korur; ÜZERİNE, ismi/
--     tarihi içeren bir metin döndüren describe_* eşdeğerleri
--     eklenir. Eski boolean fonksiyonlar bozulmadan bırakıldı
--     (geriye dönük uyumluluk).
--   * Saat çakışması KATI (<), tarih aralığı çakışması KAPSAYICI (<=)
--     karşılaştırılır: "10:00-11:00" ile "11:00-12:00" ÇAKIŞMAZ (bir
--     ders tam diğerinin bittiği anda başlayabilir — kurumun
--     politikası buna izin verir), ama geçerlilik tarihleri aynı güne
--     denk gelen iki program o gün için gerçekten çakışır.
--   * MEB çalışma izni: organizations.meb_permit_enforcement ('warn'
--     | 'block') kurum politikasını belirler. 'block' ise atama
--     tamamen reddedilir. 'warn' ise atama BAŞARILI olur ama
--     audit_logs'a 'meb_permit_warning' aksiyonuyla bir satır
--     yazılır; arayüz AYNI check_teacher_meb_permit() fonksiyonunu
--     ayrıca çağırarak kullanıcıya uyarı gösterir — tek bir doğrulama
--     kaynağı, iki farklı sunum (zorunlu hata / bilgilendirme
--     uyarısı).
--   * Reddedilen (block) girişimler AYNI transaction içinde
--     audit_logs'a yazılamaz (exception ile birlikte rollback olur —
--     Postgres'te otonom transaction yoktur, dblink gibi eklentiler
--     bilinçli olarak kullanılmadı). Bunun yerine
--     log_rejected_scheduling_attempt() adında AYRI, ince bir RPC
--     eklendi; arayüz katmanı birincil RPC hata döndürdüğünde bunu
--     AYRI bir istek olarak çağırır — bu çağrı kendi transaction'ında
--     commit olur, birincil işlemin rollback'inden etkilenmez.
--   * Grup derslerine telafi misafiri eklerken (schedule_makeup, mevcut
--     oturum yolu) artık class_groups satırı `for update of cg` ile
--     kilitleniyor — create_enrollment_with_meb_registration'daki
--     kapasite kilitleme deseniyle birebir aynı, eşzamanlı iki telafi
--     eklemesi kontenjanı aşamaz.

-- =========================================================
-- 1. Kurum politikası + tablo düzeyinde tarih tutarlılığı.
-- =========================================================

alter table public.organizations
  add column if not exists meb_permit_enforcement text
    not null default 'warn'
    check (meb_permit_enforcement in ('warn', 'block'));

alter table public.class_groups
  add constraint class_groups_dates_check
  check (starts_on is null or ends_on is null or ends_on >= starts_on);

alter table public.enrollments
  add constraint enrollments_dates_check
  check (ends_on is null or ends_on >= starts_on);

-- =========================================================
-- 2. Türkçe gün adı.
-- =========================================================

create or replace function public.tr_weekday_name(p_weekday smallint)
returns text
language sql
immutable
set search_path = ''
as $$
  select (array[
    'Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi','Pazar'
  ])[p_weekday];
$$;

revoke all on function public.tr_weekday_name(smallint) from public, anon;
grant execute on function public.tr_weekday_name(smallint) to authenticated;

-- =========================================================
-- 3. Şablon (class_groups) düzeyinde çakışma matematiği.
--    Saat: dakika cinsinden tamsayı aralığı (gece yarısını geçen
--    kaydırma riskini önler — time + interval sarmalanabilir).
--    Tarih: kapsayıcı aralık kesişimi, açık uçlar 'infinity' kabul
--    edilir.
-- =========================================================

create or replace function public.class_schedule_overlaps(
  p_weekday_a smallint, p_start_a time, p_duration_a integer,
  p_starts_on_a date, p_ends_on_a date,
  p_weekday_b smallint, p_start_b time, p_duration_b integer,
  p_starts_on_b date, p_ends_on_b date
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    p_weekday_a = p_weekday_b
    and (extract(epoch from p_start_a) / 60)::integer
        < (extract(epoch from p_start_b) / 60)::integer + p_duration_b
    and (extract(epoch from p_start_b) / 60)::integer
        < (extract(epoch from p_start_a) / 60)::integer + p_duration_a
    and p_starts_on_a <= coalesce(p_ends_on_b, 'infinity'::date)
    and p_starts_on_b <= coalesce(p_ends_on_a, 'infinity'::date)
$$;

revoke all on function public.class_schedule_overlaps(smallint, time, integer, date, date, smallint, time, integer, date, date) from public, anon;
grant execute on function public.class_schedule_overlaps(smallint, time, integer, date, date, smallint, time, integer, date, date) to authenticated;

-- =========================================================
-- 4. find_class_group_conflict(): create_class_group/update_class_group
--    tarafından çağrılır. Aynı öğretmen ya da aynı derslik adıyla,
--    örtüşen gün/saat ve tarih aralığında BAŞKA bir aktif seans
--    varsa, o seansı adlandıran bir mesaj döner; yoksa null.
-- =========================================================

create or replace function public.find_class_group_conflict(
  p_organization_id uuid,
  p_teacher_profile_id uuid,
  p_room_name text,
  p_weekday smallint,
  p_start_time time,
  p_duration_minutes integer,
  p_starts_on date,
  p_ends_on date,
  p_exclude_group_id uuid default null
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_teacher_conflict record;
  v_room_conflict record;
begin
  if p_teacher_profile_id is not null then
    select cg.name, c.name as course_name, p.full_name as teacher_name
    into v_teacher_conflict
    from public.class_groups cg
    inner join public.courses c on c.id = cg.course_id
    left join public.profiles p on p.id = cg.teacher_profile_id
    where cg.organization_id = p_organization_id
      and cg.is_active = true
      and cg.teacher_profile_id = p_teacher_profile_id
      and (p_exclude_group_id is null or cg.id <> p_exclude_group_id)
      and public.class_schedule_overlaps(
        cg.weekday, cg.start_time, cg.duration_minutes, cg.starts_on, cg.ends_on,
        p_weekday, p_start_time, p_duration_minutes, p_starts_on, p_ends_on
      )
    limit 1;

    if v_teacher_conflict.name is not null then
      return pg_catalog.format(
        'Öğretmen %s, %s günü %s saatinde ''%s — %s'' seansıyla çakışıyor.',
        v_teacher_conflict.teacher_name,
        public.tr_weekday_name(p_weekday),
        pg_catalog.to_char(p_start_time, 'HH24:MI'),
        v_teacher_conflict.course_name,
        v_teacher_conflict.name
      );
    end if;
  end if;

  if p_room_name is not null and pg_catalog.btrim(p_room_name) <> '' then
    select cg.name, c.name as course_name
    into v_room_conflict
    from public.class_groups cg
    inner join public.courses c on c.id = cg.course_id
    where cg.organization_id = p_organization_id
      and cg.is_active = true
      and cg.room_name is not null
      and pg_catalog.lower(pg_catalog.btrim(cg.room_name)) = pg_catalog.lower(pg_catalog.btrim(p_room_name))
      and (p_exclude_group_id is null or cg.id <> p_exclude_group_id)
      and public.class_schedule_overlaps(
        cg.weekday, cg.start_time, cg.duration_minutes, cg.starts_on, cg.ends_on,
        p_weekday, p_start_time, p_duration_minutes, p_starts_on, p_ends_on
      )
    limit 1;

    if v_room_conflict.name is not null then
      return pg_catalog.format(
        '''%s'' derslik, %s günü %s saatinde ''%s — %s'' seansıyla çakışıyor.',
        p_room_name,
        public.tr_weekday_name(p_weekday),
        pg_catalog.to_char(p_start_time, 'HH24:MI'),
        v_room_conflict.course_name,
        v_room_conflict.name
      );
    end if;
  end if;

  return null;
end;
$$;

revoke all on function public.find_class_group_conflict(uuid, uuid, text, smallint, time, integer, date, date, uuid) from public, anon;
grant execute on function public.find_class_group_conflict(uuid, uuid, text, smallint, time, integer, date, date, uuid) to authenticated;

-- =========================================================
-- 5. find_student_enrollment_conflict(): create_enrollment_with_meb_
--    registration tarafından çağrılır. Hedef seansın gün/saat/tarih
--    aralığı, öğrencinin BAŞKA bir aktif/dondurulmuş kaydındaki
--    seansla örtüşüyorsa, onu adlandıran bir mesaj döner.
-- =========================================================

create or replace function public.find_student_enrollment_conflict(
  p_organization_id uuid,
  p_student_id uuid,
  p_class_group_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_target record;
  v_conflict record;
begin
  select cg.weekday, cg.start_time, cg.duration_minutes, cg.starts_on, cg.ends_on
  into v_target
  from public.class_groups cg
  where cg.id = p_class_group_id
    and cg.organization_id = p_organization_id;

  if v_target.weekday is null then
    return null;
  end if;

  select cg.name as group_name, c.name as course_name
  into v_conflict
  from public.enrollments e
  inner join public.class_groups cg on cg.id = e.class_group_id
  inner join public.courses c on c.id = cg.course_id
  where e.organization_id = p_organization_id
    and e.student_id = p_student_id
    and e.class_group_id <> p_class_group_id
    and e.status in ('active'::public.enrollment_status, 'frozen'::public.enrollment_status)
    and public.class_schedule_overlaps(
      cg.weekday, cg.start_time, cg.duration_minutes, cg.starts_on, cg.ends_on,
      v_target.weekday, v_target.start_time, v_target.duration_minutes, v_target.starts_on, v_target.ends_on
    )
  limit 1;

  if v_conflict.group_name is not null then
    return pg_catalog.format(
      'Öğrencinin ''%s — %s'' seansıyla programı çakışıyor (aynı gün ve saat).',
      v_conflict.course_name,
      v_conflict.group_name
    );
  end if;

  return null;
end;
$$;

revoke all on function public.find_student_enrollment_conflict(uuid, uuid, uuid) from public, anon;
grant execute on function public.find_student_enrollment_conflict(uuid, uuid, uuid) to authenticated;

-- =========================================================
-- 6. describe_session_scheduling_conflict() / describe_student_session_
--    conflict(): has_scheduling_conflict / student_has_scheduling_
--    conflict (20260811100000) ile AYNI eşleşme mantığını kullanan,
--    ama çakışan oturumu adlandıran metin döndüren eşdeğerleri.
--    reschedule_lesson_session ve schedule_makeup tarafından
--    kullanılır. Eski boolean fonksiyonlar değiştirilmedi.
-- =========================================================

create or replace function public.describe_session_scheduling_conflict(
  p_organization_id uuid,
  p_teacher_profile_id uuid,
  p_room_name text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_exclude_session_id uuid default null
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_teacher_conflict record;
  v_room_conflict record;
begin
  if p_teacher_profile_id is not null then
    select ls.starts_at, ls.ends_at, c.name as course_name,
           coalesce(cg.name, 'Telafi oturumu') as group_name, p.full_name as teacher_name
    into v_teacher_conflict
    from public.lesson_sessions ls
    inner join public.courses c on c.id = ls.course_id
    left join public.class_groups cg on cg.id = ls.class_group_id
    left join public.profiles p on p.id = ls.teacher_profile_id
    where ls.organization_id = p_organization_id
      and ls.cancelled_at is null
      and ls.teacher_profile_id = p_teacher_profile_id
      and (p_exclude_session_id is null or ls.id <> p_exclude_session_id)
      and ls.starts_at < p_ends_at
      and ls.ends_at > p_starts_at
    limit 1;

    if v_teacher_conflict.course_name is not null then
      return pg_catalog.format(
        'Öğretmen %s, %s tarihinde %s–%s saatleri arasında ''%s — %s'' oturumuyla çakışıyor.',
        v_teacher_conflict.teacher_name,
        pg_catalog.to_char(v_teacher_conflict.starts_at at time zone 'Europe/Istanbul', 'DD.MM.YYYY'),
        pg_catalog.to_char(v_teacher_conflict.starts_at at time zone 'Europe/Istanbul', 'HH24:MI'),
        pg_catalog.to_char(v_teacher_conflict.ends_at at time zone 'Europe/Istanbul', 'HH24:MI'),
        v_teacher_conflict.course_name,
        v_teacher_conflict.group_name
      );
    end if;
  end if;

  if p_room_name is not null and pg_catalog.btrim(p_room_name) <> '' then
    select ls.starts_at, ls.ends_at, c.name as course_name,
           coalesce(cg.name, 'Telafi oturumu') as group_name
    into v_room_conflict
    from public.lesson_sessions ls
    inner join public.courses c on c.id = ls.course_id
    left join public.class_groups cg on cg.id = ls.class_group_id
    where ls.organization_id = p_organization_id
      and ls.cancelled_at is null
      and ls.room_name is not null
      and pg_catalog.lower(pg_catalog.btrim(ls.room_name)) = pg_catalog.lower(pg_catalog.btrim(p_room_name))
      and (p_exclude_session_id is null or ls.id <> p_exclude_session_id)
      and ls.starts_at < p_ends_at
      and ls.ends_at > p_starts_at
    limit 1;

    if v_room_conflict.course_name is not null then
      return pg_catalog.format(
        '''%s'' derslik, %s tarihinde %s–%s saatleri arasında ''%s — %s'' oturumuyla çakışıyor.',
        p_room_name,
        pg_catalog.to_char(v_room_conflict.starts_at at time zone 'Europe/Istanbul', 'DD.MM.YYYY'),
        pg_catalog.to_char(v_room_conflict.starts_at at time zone 'Europe/Istanbul', 'HH24:MI'),
        pg_catalog.to_char(v_room_conflict.ends_at at time zone 'Europe/Istanbul', 'HH24:MI'),
        v_room_conflict.course_name,
        v_room_conflict.group_name
      );
    end if;
  end if;

  return null;
end;
$$;

revoke all on function public.describe_session_scheduling_conflict(uuid, uuid, text, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.describe_session_scheduling_conflict(uuid, uuid, text, timestamptz, timestamptz, uuid) to authenticated;

create or replace function public.describe_student_session_conflict(
  p_organization_id uuid,
  p_student_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_exclude_session_id uuid default null
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_conflict record;
  v_student_name text;
begin
  select s.first_name || ' ' || s.last_name into v_student_name
  from public.students s
  where s.id = p_student_id and s.organization_id = p_organization_id;

  select ls.starts_at, ls.ends_at, c.name as course_name,
         coalesce(cg.name, 'Telafi oturumu') as group_name
  into v_conflict
  from public.lesson_sessions ls
  inner join public.enrollments e
    on e.class_group_id = ls.class_group_id
    and e.organization_id = ls.organization_id
    and e.status = 'active'::public.enrollment_status
    and e.starts_on <= (ls.starts_at at time zone 'Europe/Istanbul')::date
    and (e.ends_on is null or e.ends_on >= (ls.starts_at at time zone 'Europe/Istanbul')::date)
  inner join public.courses c on c.id = ls.course_id
  left join public.class_groups cg on cg.id = ls.class_group_id
  where ls.organization_id = p_organization_id
    and e.student_id = p_student_id
    and ls.cancelled_at is null
    and (p_exclude_session_id is null or ls.id <> p_exclude_session_id)
    and ls.starts_at < p_ends_at
    and ls.ends_at > p_starts_at
  limit 1;

  if v_conflict.course_name is null then
    select ls.starts_at, ls.ends_at, c.name as course_name,
           coalesce(cg.name, 'Telafi oturumu') as group_name
    into v_conflict
    from public.makeup_credits mc
    inner join public.lesson_sessions ls on ls.id = mc.used_lesson_session_id
    inner join public.courses c on c.id = ls.course_id
    left join public.class_groups cg on cg.id = ls.class_group_id
    where mc.organization_id = p_organization_id
      and mc.student_id = p_student_id
      and mc.status = 'used'::public.makeup_credit_status
      and ls.cancelled_at is null
      and (p_exclude_session_id is null or ls.id <> p_exclude_session_id)
      and ls.starts_at < p_ends_at
      and ls.ends_at > p_starts_at
    limit 1;
  end if;

  if v_conflict.course_name is not null then
    return pg_catalog.format(
      'Öğrenci %s, %s tarihinde %s–%s saatleri arasında ''%s — %s'' programına kayıtlı; çakışma var.',
      coalesce(v_student_name, 'seçilen öğrenci'),
      pg_catalog.to_char(v_conflict.starts_at at time zone 'Europe/Istanbul', 'DD.MM.YYYY'),
      pg_catalog.to_char(v_conflict.starts_at at time zone 'Europe/Istanbul', 'HH24:MI'),
      pg_catalog.to_char(v_conflict.ends_at at time zone 'Europe/Istanbul', 'HH24:MI'),
      v_conflict.course_name,
      v_conflict.group_name
    );
  end if;

  return null;
end;
$$;

revoke all on function public.describe_student_session_conflict(uuid, uuid, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.describe_student_session_conflict(uuid, uuid, timestamptz, timestamptz, uuid) to authenticated;

-- =========================================================
-- 7. MEB çalışma izni: politika + kontrol.
-- =========================================================

create or replace function public.meb_permit_policy_is_blocking(
  p_organization_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select o.meb_permit_enforcement = 'block'
      from public.organizations o
      where o.id = coalesce(p_organization_id, public.current_organization_id())
    ),
    false
  );
$$;

revoke all on function public.meb_permit_policy_is_blocking(uuid) from public, anon;
grant execute on function public.meb_permit_policy_is_blocking(uuid) to authenticated;

create or replace function public.check_teacher_meb_permit(
  p_teacher_profile_id uuid,
  p_course_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid := public.current_organization_id();
  v_course_meb_status text;
  v_course_name text;
  v_teacher_name text;
  v_auth record;
  v_today date := (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
begin
  if v_organization_id is null or p_teacher_profile_id is null or p_course_id is null then
    return null;
  end if;

  if not public.is_admin() then
    raise exception 'Bu kontrolü yapma yetkiniz bulunmuyor.';
  end if;

  select c.meb_status, c.name into v_course_meb_status, v_course_name
  from public.courses c
  where c.id = p_course_id and c.organization_id = v_organization_id;

  if v_course_meb_status is distinct from 'approved' then
    return null;
  end if;

  select p.full_name into v_teacher_name
  from public.profiles p
  where p.id = p_teacher_profile_id and p.organization_id = v_organization_id;

  if v_teacher_name is null then
    return null;
  end if;

  select ta.status, ta.valid_from, ta.valid_until into v_auth
  from public.teacher_course_meb_authorizations ta
  where ta.organization_id = v_organization_id
    and ta.teacher_profile_id = p_teacher_profile_id
    and ta.course_id = p_course_id;

  if v_auth.status = 'approved'
     and (v_auth.valid_from is null or v_auth.valid_from <= v_today)
     and (v_auth.valid_until is null or v_auth.valid_until >= v_today) then
    return null;
  end if;

  return pg_catalog.format(
    'Öğretmen %s, ''%s'' dersi için geçerli bir MEB çalışma izni bulunmuyor.',
    v_teacher_name,
    v_course_name
  );
end;
$$;

revoke all on function public.check_teacher_meb_permit(uuid, uuid) from public, anon;
grant execute on function public.check_teacher_meb_permit(uuid, uuid) to authenticated;

-- =========================================================
-- 8. log_rejected_scheduling_attempt(): reddedilen (block) girişimler
--    için, arayüzün birincil RPC hatasından SONRA ayrı bir istek
--    olarak çağırdığı ince kayıt fonksiyonu (bkz. dosya başındaki not).
-- =========================================================

create or replace function public.log_rejected_scheduling_attempt(
  p_table_name text,
  p_action text,
  p_reason text,
  p_payload jsonb default null
)
returns void
language plpgsql
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

  if not public.is_admin() then
    raise exception 'Bu işlemi kaydetme yetkiniz bulunmuyor.';
  end if;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id,
    coalesce(nullif(pg_catalog.btrim(p_table_name), ''), 'unknown'),
    null,
    coalesce(nullif(pg_catalog.btrim(p_action), ''), 'rejected'),
    null,
    pg_catalog.jsonb_build_object('reason', p_reason, 'payload', p_payload)
  );
end;
$$;

revoke all on function public.log_rejected_scheduling_attempt(text, text, text, jsonb) from public, anon;
grant execute on function public.log_rejected_scheduling_attempt(text, text, text, jsonb) to authenticated;

-- =========================================================
-- 9. create_class_group / update_class_group: çakışma + MEB
--    kontrolleri eklendi (20260726223622'deki orijinal davranış
--    korunarak).
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
  v_organization_id uuid := public.current_organization_id();
  v_group_id uuid;
  v_name text;
  v_room_name text;
  v_course_type public.course_type;
  v_course_is_active boolean;
  v_capacity integer;
  v_conflict text;
  v_meb_issue text;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Ders programı oluşturma yetkiniz bulunmuyor.';
  end if;

  v_name := pg_catalog.btrim(coalesce(p_name, ''));
  v_room_name := pg_catalog.btrim(coalesce(p_room_name, ''));

  if pg_catalog.char_length(v_name) < 2 then
    raise exception 'Seans adı en az 2 karakter olmalıdır.';
  end if;

  select c.course_type, c.is_active
  into v_course_type, v_course_is_active
  from public.courses c
  where c.id = p_course_id and c.organization_id = v_organization_id;

  if v_course_type is null then
    raise exception 'Ders kaydı bulunamadı.';
  end if;

  if not v_course_is_active then
    raise exception 'Pasif bir ders için yeni seans oluşturulamaz.';
  end if;

  if p_teacher_profile_id is not null
     and not exists (
       select 1 from public.profiles p
       where p.id = p_teacher_profile_id
         and p.organization_id = v_organization_id
         and p.is_active = true
         and p.role in ('teacher'::public.app_role, 'admin'::public.app_role)
     ) then
    raise exception 'Seçilen öğretmen bulunamadı veya aktif değil.';
  end if;

  if p_weekday is null or p_weekday < 1 or p_weekday > 7 then
    raise exception 'Geçerli bir ders günü seçilmelidir.';
  end if;

  if p_start_time is null then
    raise exception 'Ders başlangıç saati zorunludur.';
  end if;

  if p_duration_minutes is null or p_duration_minutes < 15 or p_duration_minutes > 480 then
    raise exception 'Ders süresi 15 ile 480 dakika arasında olmalıdır.';
  end if;

  if p_starts_on is null then
    raise exception 'Program başlangıç tarihi zorunludur.';
  end if;

  if p_ends_on is not null and p_ends_on < p_starts_on then
    raise exception 'Program bitiş tarihi başlangıç tarihinden önce olamaz.';
  end if;

  -- Merkezi çakışma motoru: aynı öğretmen ya da aynı derslik, örtüşen
  -- gün/saat ve tarih aralığında BAŞKA bir aktif seansta olamaz.
  v_conflict := public.find_class_group_conflict(
    v_organization_id, p_teacher_profile_id, nullif(v_room_name, ''),
    p_weekday::smallint, p_start_time, p_duration_minutes, p_starts_on, p_ends_on, null
  );

  if v_conflict is not null then
    raise exception '%', v_conflict;
  end if;

  -- MEB çalışma izni: kurum politikasına göre engelle ya da uyar.
  v_meb_issue := public.check_teacher_meb_permit(p_teacher_profile_id, p_course_id);

  if v_meb_issue is not null and public.meb_permit_policy_is_blocking(v_organization_id) then
    raise exception '%', v_meb_issue;
  end if;

  if v_course_type = 'individual'::public.course_type then
    v_capacity := 1;
  else
    if p_capacity is null or p_capacity < 1 or p_capacity > 100 then
      raise exception 'Grup kapasitesi 1 ile 100 arasında olmalıdır.';
    end if;

    v_capacity := p_capacity;
  end if;

  insert into public.class_groups (
    organization_id, course_id, teacher_profile_id, name, room_name, capacity,
    weekday, start_time, duration_minutes, starts_on, ends_on, is_active
  )
  values (
    v_organization_id, p_course_id, p_teacher_profile_id, v_name, nullif(v_room_name, ''),
    v_capacity, p_weekday, p_start_time, p_duration_minutes, p_starts_on, p_ends_on, true
  )
  returning id into v_group_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'class_groups', v_group_id::text, 'create', null,
    pg_catalog.jsonb_build_object(
      'course_id', p_course_id, 'teacher_profile_id', p_teacher_profile_id, 'name', v_name,
      'room_name', nullif(v_room_name, ''), 'capacity', v_capacity, 'weekday', p_weekday,
      'start_time', p_start_time, 'duration_minutes', p_duration_minutes,
      'starts_on', p_starts_on, 'ends_on', p_ends_on, 'is_active', true
    )
  );

  if v_meb_issue is not null then
    insert into public.audit_logs (
      organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
    )
    values (
      v_organization_id, v_user_id, 'class_groups', v_group_id::text, 'meb_permit_warning',
      null, pg_catalog.jsonb_build_object('warning', v_meb_issue)
    );
  end if;

  return v_group_id;

exception
  when unique_violation then
    raise exception 'Bu ders için aynı isimde bir seans zaten bulunuyor.'
      using errcode = '23505';
end;
$$;

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
  v_organization_id uuid := public.current_organization_id();
  v_name text;
  v_room_name text;
  v_course_type public.course_type;
  v_course_id uuid;
  v_capacity integer;
  v_old_data jsonb;
  v_new_data jsonb;
  v_conflict text;
  v_meb_issue text;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Ders programını düzenleme yetkiniz bulunmuyor.';
  end if;

  v_name := pg_catalog.btrim(coalesce(p_name, ''));
  v_room_name := pg_catalog.btrim(coalesce(p_room_name, ''));

  select
    c.course_type,
    cg.course_id,
    pg_catalog.jsonb_build_object(
      'name', cg.name, 'teacher_profile_id', cg.teacher_profile_id, 'room_name', cg.room_name,
      'capacity', cg.capacity, 'weekday', cg.weekday, 'start_time', cg.start_time,
      'duration_minutes', cg.duration_minutes, 'starts_on', cg.starts_on, 'ends_on', cg.ends_on,
      'is_active', cg.is_active
    )
  into v_course_type, v_course_id, v_old_data
  from public.class_groups cg
  inner join public.courses c on c.id = cg.course_id
  where cg.id = p_group_id and cg.organization_id = v_organization_id;

  if v_old_data is null then
    raise exception 'Ders seansı bulunamadı.';
  end if;

  if pg_catalog.char_length(v_name) < 2 then
    raise exception 'Seans adı en az 2 karakter olmalıdır.';
  end if;

  if p_teacher_profile_id is not null
     and not exists (
       select 1 from public.profiles p
       where p.id = p_teacher_profile_id
         and p.organization_id = v_organization_id
         and p.is_active = true
         and p.role in ('teacher'::public.app_role, 'admin'::public.app_role)
     ) then
    raise exception 'Seçilen öğretmen bulunamadı veya aktif değil.';
  end if;

  if p_weekday is null or p_weekday < 1 or p_weekday > 7 then
    raise exception 'Geçerli bir ders günü seçilmelidir.';
  end if;

  if p_start_time is null then
    raise exception 'Ders başlangıç saati zorunludur.';
  end if;

  if p_duration_minutes is null or p_duration_minutes < 15 or p_duration_minutes > 480 then
    raise exception 'Ders süresi 15 ile 480 dakika arasında olmalıdır.';
  end if;

  if p_starts_on is null then
    raise exception 'Program başlangıç tarihi zorunludur.';
  end if;

  if p_ends_on is not null and p_ends_on < p_starts_on then
    raise exception 'Program bitiş tarihi başlangıç tarihinden önce olamaz.';
  end if;

  v_conflict := public.find_class_group_conflict(
    v_organization_id, p_teacher_profile_id, nullif(v_room_name, ''),
    p_weekday::smallint, p_start_time, p_duration_minutes, p_starts_on, p_ends_on, p_group_id
  );

  if v_conflict is not null then
    raise exception '%', v_conflict;
  end if;

  v_meb_issue := public.check_teacher_meb_permit(p_teacher_profile_id, v_course_id);

  if v_meb_issue is not null and public.meb_permit_policy_is_blocking(v_organization_id) then
    raise exception '%', v_meb_issue;
  end if;

  if v_course_type = 'individual'::public.course_type then
    v_capacity := 1;
  else
    if p_capacity is null or p_capacity < 1 or p_capacity > 100 then
      raise exception 'Grup kapasitesi 1 ile 100 arasında olmalıdır.';
    end if;

    v_capacity := p_capacity;
  end if;

  if v_capacity < (
    select pg_catalog.count(*)
    from public.enrollments e
    where e.class_group_id = p_group_id
      and e.status in ('active'::public.enrollment_status, 'frozen'::public.enrollment_status)
  ) then
    raise exception 'Kapasite mevcut öğrenci sayısından daha düşük olamaz.';
  end if;

  update public.class_groups
  set
    teacher_profile_id = p_teacher_profile_id,
    name = v_name,
    room_name = nullif(v_room_name, ''),
    capacity = v_capacity,
    weekday = p_weekday,
    start_time = p_start_time,
    duration_minutes = p_duration_minutes,
    starts_on = p_starts_on,
    ends_on = p_ends_on
  where id = p_group_id and organization_id = v_organization_id;

  v_new_data := pg_catalog.jsonb_build_object(
    'name', v_name, 'teacher_profile_id', p_teacher_profile_id, 'room_name', nullif(v_room_name, ''),
    'capacity', v_capacity, 'weekday', p_weekday, 'start_time', p_start_time,
    'duration_minutes', p_duration_minutes, 'starts_on', p_starts_on, 'ends_on', p_ends_on
  );

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'class_groups', p_group_id::text, 'update', v_old_data, v_new_data
  );

  if v_meb_issue is not null then
    insert into public.audit_logs (
      organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
    )
    values (
      v_organization_id, v_user_id, 'class_groups', p_group_id::text, 'meb_permit_warning',
      null, pg_catalog.jsonb_build_object('warning', v_meb_issue)
    );
  end if;

exception
  when unique_violation then
    raise exception 'Bu ders için aynı isimde bir seans zaten bulunuyor.'
      using errcode = '23505';
end;
$$;

-- =========================================================
-- 10. create_enrollment_with_meb_registration: öğrenci-programı
--     çakışma kontrolü eklendi (20260726233027 + 20260811130000'deki
--     orijinal davranış korunarak — kapasite kilitleme AYNEN kalır).
-- =========================================================

create or replace function
public.create_enrollment_with_meb_registration(
  p_student_id uuid,
  p_course_id uuid,
  p_class_group_id uuid,

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

  v_student_status public.record_status;

  v_group_course_id uuid;
  v_group_teacher_id uuid;
  v_group_capacity integer;
  v_group_is_active boolean;
  v_group_starts_on date;
  v_group_ends_on date;

  v_course_is_active boolean;

  v_current_student_count bigint;

  v_enrollment_id uuid;
  v_meb_registration_id uuid;

  v_discount_type text;
  v_discount_value numeric(12,2);
  v_net_monthly_fee numeric(12,2);

  v_notes text;

  v_meb_registration_number text;
  v_meb_non_registration_reason text;
  v_meb_note text;

  v_meb_valid_from date;
  v_conflict text;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.can_manage_finance() then
    raise exception 'Öğrenciyi derse kaydetme yetkiniz bulunmuyor.';
  end if;

  select s.status into v_student_status
  from public.students s
  where s.id = p_student_id and s.organization_id = v_organization_id;

  if v_student_status is null then
    raise exception 'Öğrenci kaydı bulunamadı.';
  end if;

  if v_student_status <> 'active'::public.record_status then
    raise exception 'Yalnızca aktif öğrenciler yeni bir derse kaydedilebilir.';
  end if;

  if p_class_group_id is null then
    raise exception 'Ders seansı seçilmelidir.';
  end if;

  -- Seans satırı kilitlenir. Aynı anda iki kayıt yapılırsa
  -- kontenjanın aşılması engellenir.
  select
    cg.course_id, cg.teacher_profile_id, cg.capacity, cg.is_active,
    cg.starts_on, cg.ends_on, c.is_active
  into
    v_group_course_id, v_group_teacher_id, v_group_capacity, v_group_is_active,
    v_group_starts_on, v_group_ends_on, v_course_is_active
  from public.class_groups cg
  inner join public.courses c on c.id = cg.course_id
  where cg.id = p_class_group_id and cg.organization_id = v_organization_id
  for update of cg;

  if v_group_course_id is null then
    raise exception 'Ders seansı bulunamadı.';
  end if;

  if v_group_course_id <> p_course_id then
    raise exception 'Seçilen seans bu derse ait değil.';
  end if;

  if not v_course_is_active then
    raise exception 'Pasif bir derse öğrenci kaydedilemez.';
  end if;

  if not v_group_is_active then
    raise exception 'Pasif bir ders seansına öğrenci kaydedilemez.';
  end if;

  if p_starts_on is null then
    raise exception 'Ders kayıt başlangıç tarihi zorunludur.';
  end if;

  if p_ends_on is not null and p_ends_on < p_starts_on then
    raise exception 'Bitiş tarihi başlangıç tarihinden önce olamaz.';
  end if;

  if v_group_starts_on is not null and p_starts_on < v_group_starts_on then
    raise exception 'Öğrenci kayıt tarihi seansın başlangıç tarihinden önce olamaz.';
  end if;

  if v_group_ends_on is not null and p_starts_on > v_group_ends_on then
    raise exception 'Öğrenci kayıt tarihi seansın bitiş tarihinden sonra olamaz.';
  end if;

  if v_group_ends_on is not null and p_ends_on is not null and p_ends_on > v_group_ends_on then
    raise exception 'Öğrenci bitiş tarihi seansın bitiş tarihinden sonra olamaz.';
  end if;

  if exists (
    select 1 from public.enrollments e
    where e.organization_id = v_organization_id
      and e.student_id = p_student_id
      and e.course_id = p_course_id
      and e.status in ('active'::public.enrollment_status, 'frozen'::public.enrollment_status)
  ) then
    raise exception 'Öğrencinin bu derste zaten aktif veya dondurulmuş bir kaydı bulunuyor.';
  end if;

  -- Merkezi çakışma motoru: öğrencinin BAŞKA bir dersteki programıyla
  -- saat çakışması.
  v_conflict := public.find_student_enrollment_conflict(
    v_organization_id, p_student_id, p_class_group_id
  );

  if v_conflict is not null then
    raise exception '%', v_conflict;
  end if;

  select count(*) into v_current_student_count
  from public.enrollments e
  where e.organization_id = v_organization_id
    and e.class_group_id = p_class_group_id
    and e.status in ('active'::public.enrollment_status, 'frozen'::public.enrollment_status);

  if v_group_capacity is null then
    raise exception 'Seans kapasitesi tanımlanmamış.';
  end if;

  if v_current_student_count >= v_group_capacity then
    raise exception 'Seçilen ders seansında boş kontenjan bulunmuyor.';
  end if;

  if p_list_monthly_fee is null or p_list_monthly_fee < 0 then
    raise exception 'Liste ücreti sıfırdan küçük olamaz.';
  end if;

  v_discount_type := coalesce(nullif(pg_catalog.btrim(coalesce(p_discount_type, '')), ''), 'none');

  if v_discount_type not in ('none', 'percent', 'fixed') then
    raise exception 'Geçerli bir indirim türü seçilmelidir.';
  end if;

  v_discount_value := coalesce(p_discount_value, 0);

  if v_discount_value < 0 then
    raise exception 'İndirim değeri sıfırdan küçük olamaz.';
  end if;

  if v_discount_type = 'none' then
    v_discount_value := 0;
    v_net_monthly_fee := round(p_list_monthly_fee, 2);
  elsif v_discount_type = 'percent' then
    if v_discount_value > 100 then
      raise exception 'Yüzde indirim 100 değerinden büyük olamaz.';
    end if;

    v_net_monthly_fee := round(p_list_monthly_fee - (p_list_monthly_fee * v_discount_value / 100), 2);
  else
    if v_discount_value > p_list_monthly_fee then
      raise exception 'Sabit indirim liste ücretinden büyük olamaz.';
    end if;

    v_net_monthly_fee := round(p_list_monthly_fee - v_discount_value, 2);
  end if;

  if p_due_day is null or p_due_day < 1 or p_due_day > 28 then
    raise exception 'Ödeme günü 1 ile 28 arasında olmalıdır.';
  end if;

  if p_meb_status not in (
    'registered', 'pending', 'not_registered', 'not_eligible', 'rejected', 'ended', 'unchecked'
  ) then
    raise exception 'Geçerli bir öğrenci MEB durumu seçilmelidir.';
  end if;

  if p_meb_valid_until is not null and p_meb_valid_from is not null and p_meb_valid_until < p_meb_valid_from then
    raise exception 'MEB geçerlilik bitiş tarihi başlangıç tarihinden önce olamaz.';
  end if;

  v_meb_non_registration_reason := nullif(pg_catalog.btrim(coalesce(p_meb_non_registration_reason, '')), '');

  if p_meb_status in ('not_registered', 'not_eligible', 'rejected')
     and (v_meb_non_registration_reason is null or pg_catalog.char_length(v_meb_non_registration_reason) < 3) then
    raise exception 'MEB kayıt eksikliği için açıklama girilmelidir.';
  end if;

  v_notes := nullif(pg_catalog.btrim(coalesce(p_notes, '')), '');
  v_meb_registration_number := nullif(pg_catalog.btrim(coalesce(p_meb_registration_number, '')), '');
  v_meb_note := nullif(pg_catalog.btrim(coalesce(p_meb_note, '')), '');

  v_meb_valid_from := case
    when p_meb_status = 'registered' then coalesce(p_meb_valid_from, p_starts_on)
    else p_meb_valid_from
  end;

  insert into public.enrollments (
    organization_id, student_id, course_id, class_group_id, teacher_profile_id,
    starts_on, ends_on, status,
    list_monthly_fee, discount_type, discount_value, net_monthly_fee, due_day, notes
  )
  values (
    v_organization_id, p_student_id, p_course_id, p_class_group_id, v_group_teacher_id,
    p_starts_on, p_ends_on, 'active'::public.enrollment_status,
    round(p_list_monthly_fee, 2), v_discount_type, round(v_discount_value, 2), v_net_monthly_fee,
    p_due_day, v_notes
  )
  returning id into v_enrollment_id;

  insert into public.enrollment_meb_registrations (
    organization_id, enrollment_id, student_id, course_id,
    status, registration_number, valid_from, valid_until,
    non_registration_reason, note,
    checked_at, checked_by
  )
  values (
    v_organization_id, v_enrollment_id, p_student_id, p_course_id,
    p_meb_status, v_meb_registration_number, v_meb_valid_from, p_meb_valid_until,
    v_meb_non_registration_reason, v_meb_note,
    pg_catalog.now(), v_user_id
  )
  returning id into v_meb_registration_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'enrollments', v_enrollment_id::text, 'create', null,
    pg_catalog.jsonb_build_object(
      'student_id', p_student_id, 'course_id', p_course_id, 'class_group_id', p_class_group_id,
      'teacher_profile_id', v_group_teacher_id, 'starts_on', p_starts_on, 'ends_on', p_ends_on,
      'status', 'active', 'list_monthly_fee', p_list_monthly_fee, 'discount_type', v_discount_type,
      'discount_value', v_discount_value, 'net_monthly_fee', v_net_monthly_fee, 'due_day', p_due_day
    )
  );

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'enrollment_meb_registrations', v_meb_registration_id::text, 'create', null,
    pg_catalog.jsonb_build_object(
      'enrollment_id', v_enrollment_id, 'status', p_meb_status,
      'registration_number', v_meb_registration_number, 'valid_from', v_meb_valid_from,
      'valid_until', p_meb_valid_until, 'non_registration_reason', v_meb_non_registration_reason
    )
  );

  return v_enrollment_id;

exception
  when unique_violation then
    raise exception 'Öğrencinin bu derste zaten açık bir kaydı bulunuyor.'
      using errcode = '23505';
end;
$$;

-- =========================================================
-- 11. reschedule_lesson_session: çakışma mesajları isim/tarih içerir
--     hale getirildi; ayrıca yeni saatte grubun kayıtlı
--     öğrencilerinden biriyle çakışma varsa da reddedilir (20260811100000'
--     deki orijinal davranış — yalnızca öğretmen/derslik kontrolü —
--     genişletildi).
-- =========================================================

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
  v_class_group_id uuid;
  v_locked_at timestamptz;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_conflict text;
  v_student record;
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

  select ls.starts_at, ls.ends_at, ls.teacher_profile_id, ls.room_name, ls.class_group_id, ls.attendance_locked_at
  into v_old_starts_at, v_old_ends_at, v_teacher_profile_id, v_room_name, v_class_group_id, v_locked_at
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

  v_conflict := public.describe_session_scheduling_conflict(
    v_organization_id, v_teacher_profile_id, v_room_name, p_new_starts_at, p_new_ends_at, p_lesson_session_id
  );

  if v_conflict is not null then
    raise exception '%', v_conflict;
  end if;

  if v_class_group_id is not null then
    for v_student in
      select e.student_id
      from public.enrollments e
      where e.class_group_id = v_class_group_id
        and e.organization_id = v_organization_id
        and e.status = 'active'::public.enrollment_status
        and e.starts_on <= (v_old_starts_at at time zone 'Europe/Istanbul')::date
        and (e.ends_on is null or e.ends_on >= (v_old_starts_at at time zone 'Europe/Istanbul')::date)
    loop
      v_conflict := public.describe_student_session_conflict(
        v_organization_id, v_student.student_id, p_new_starts_at, p_new_ends_at, p_lesson_session_id
      );

      if v_conflict is not null then
        raise exception '%', v_conflict;
      end if;
    end loop;
  end if;

  update public.lesson_sessions
  set starts_at = p_new_starts_at, ends_at = p_new_ends_at, updated_at = pg_catalog.now()
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

-- =========================================================
-- 12. schedule_makeup: mevcut gruba misafir eklerken kontenjan
--     satırı KİLİTLENİR (eşzamanlı iki telafi eklemesi kontenjanı
--     aşamaz); yeni tek seferlik oturumda öğretmen aktiflik + MEB
--     kontrolü eklendi; tüm çakışma mesajları isim/tarih içerir
--     (20260811100000'deki orijinal davranış korunarak).
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
  v_conflict text;
  v_meb_issue text;
  v_group_capacity integer;
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
  where mc.id = p_credit_id and mc.organization_id = v_organization_id
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
    -- Mevcut uygun bir gruba geçici ekleme. class_groups satırı
    -- kilitlenir: eşzamanlı iki telafi ekleme çağrısı burada sıraya
    -- girer (create_enrollment_with_meb_registration'daki kapasite
    -- kilitleme deseniyle birebir aynı).
    select ls.id, ls.class_group_id, ls.course_id, ls.starts_at, ls.ends_at, ls.cancelled_at
    into v_target_session
    from public.lesson_sessions ls
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

    v_conflict := public.describe_student_session_conflict(
      v_organization_id, v_credit.student_id, v_target_session.starts_at, v_target_session.ends_at, null
    );

    if v_conflict is not null then
      raise exception '%', v_conflict;
    end if;

    if v_target_session.class_group_id is not null then
      select cg.capacity into v_group_capacity
      from public.class_groups cg
      where cg.id = v_target_session.class_group_id
      for update of cg;

      if v_group_capacity is not null then
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

        if v_roster_count + v_guest_count >= v_group_capacity then
          raise exception 'Hedef grup kontenjanı dolu.';
        end if;
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

    if not exists (
      select 1 from public.profiles p
      where p.id = p_new_teacher_profile_id
        and p.organization_id = v_organization_id
        and p.is_active = true
        and p.role in ('teacher'::public.app_role, 'admin'::public.app_role)
    ) then
      raise exception 'Seçilen öğretmen bulunamadı veya aktif değil.';
    end if;

    v_conflict := public.describe_session_scheduling_conflict(
      v_organization_id, p_new_teacher_profile_id, p_new_room_name, p_new_starts_at, p_new_ends_at, null
    );

    if v_conflict is not null then
      raise exception '%', v_conflict;
    end if;

    v_conflict := public.describe_student_session_conflict(
      v_organization_id, v_credit.student_id, p_new_starts_at, p_new_ends_at, null
    );

    if v_conflict is not null then
      raise exception '%', v_conflict;
    end if;

    v_meb_issue := public.check_teacher_meb_permit(p_new_teacher_profile_id, v_course_id);

    if v_meb_issue is not null and public.meb_permit_policy_is_blocking(v_organization_id) then
      raise exception '%', v_meb_issue;
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

    if v_meb_issue is not null then
      insert into public.audit_logs (
        organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
      )
      values (
        v_organization_id, v_user_id, 'lesson_sessions', v_new_session_id::text, 'meb_permit_warning',
        null, pg_catalog.jsonb_build_object('warning', v_meb_issue)
      );
    end if;

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

-- =========================================================
-- 13. Yetkiler (create or replace ile değişen imzalar aynı kaldığı
--     için mevcut grantlar geçerliliğini korur; yine de netlik için
--     yeniden beyan ediliyor).
-- =========================================================

revoke all on function public.create_class_group(text, uuid, uuid, text, integer, integer, time without time zone, integer, date, date) from public, anon;
grant execute on function public.create_class_group(text, uuid, uuid, text, integer, integer, time without time zone, integer, date, date) to authenticated;

revoke all on function public.update_class_group(uuid, text, uuid, text, integer, integer, time without time zone, integer, date, date) from public, anon;
grant execute on function public.update_class_group(uuid, text, uuid, text, integer, integer, time without time zone, integer, date, date) to authenticated;

revoke all on function public.create_enrollment_with_meb_registration(uuid, uuid, uuid, date, date, numeric, text, numeric, integer, text, text, text, date, date, text, text) from public, anon;
grant execute on function public.create_enrollment_with_meb_registration(uuid, uuid, uuid, date, date, numeric, text, numeric, integer, text, text, text, date, date, text, text) to authenticated;

revoke all on function public.reschedule_lesson_session(uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.reschedule_lesson_session(uuid, timestamptz, timestamptz, text) to authenticated;

revoke all on function public.schedule_makeup(uuid, uuid, uuid, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.schedule_makeup(uuid, uuid, uuid, text, timestamptz, timestamptz) to authenticated;

notify pgrst, 'reload schema';
