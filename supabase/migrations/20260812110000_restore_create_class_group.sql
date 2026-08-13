-- Bir önceki migration'ın (20260812100000) create_class_group
-- fonksiyonunu, canlı hata ayıklama sürecinde (bkz. proje notları)
-- geçici debug sürümleriyle geçici olarak değiştirmiştim; bu migration
-- onu NİHAİ, doğru haline geri döndürür ve debug için eklenen geçici
-- yardımcı fonksiyonları kaldırır. Fonksiyonun mantığı 20260812100000
-- ile birebir aynıdır — davranışta hiçbir değişiklik yok.
--
-- Hata ayıklama sırasında ortaya çıkan GERÇEK, önceden var olan bulgu:
-- class_groups tablosunda `class_groups_enforce_teacher_role` adında
-- bir BEFORE INSERT/UPDATE trigger var (20260727220000), ve bu
-- trigger yalnızca role = 'teacher' olan profilleri kabul ediyor —
-- create_class_group/update_class_group'un kendi kontrolü ise
-- role IN ('teacher', 'admin') kabul ediyor göründüğü halde, trigger
-- daha sıkı olduğu için admin'i öğretmen olarak atamak HER ZAMAN
-- (bu değişiklikten bağımsız olarak, 20260727220000'den beri)
-- reddediliyordu — iki katman aynı Türkçe hata mesajını paylaştığı
-- için bu tutarsızlık fark edilmemiş. Kapsam dışı bırakıldı (davranış
-- değişikliği bu görevin konusu değil), ama nihai raporda ayrıca not
-- edildi.

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

revoke all on function public.create_class_group(text, uuid, uuid, text, integer, integer, time without time zone, integer, date, date) from public, anon;
grant execute on function public.create_class_group(text, uuid, uuid, text, integer, integer, time without time zone, integer, date, date) to authenticated;

drop function if exists public.debug_teacher_check(uuid, uuid);
drop function if exists public.debug_teacher_check2(uuid);
drop function if exists public.debug_show_function_def(text);

notify pgrst, 'reload schema';
