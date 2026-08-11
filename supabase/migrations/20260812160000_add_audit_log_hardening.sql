-- Denetim kaydı (audit_logs) sertleştirmesi ve kapsam incelemesi.
--
-- Bu migration, mevcut TÜM audit_logs yazan fonksiyonların (75 çağrı,
-- 19 migration dosyası) tek tek gözden geçirilmesinin sonucudur.
-- Sonuç: T.C. kimlik no, şifre/geçici şifre, token veya service_role
-- anahtarının hiçbir audit_logs satırına şu ana kadar YAZILMADIĞI
-- doğrulandı (jsonb_build_object çağrılarının tamamı açık alan
-- listesi kullanıyor — genel bir to_jsonb(old)/to_jsonb(new) trigger
-- deseni hiçbir yerde yok). Buna rağmen dört şey düzeltiliyor:
--
--   1) audit_logs üzerinde authenticated'a insert/update/delete
--      izni HİÇBİR ZAMAN verilmemişti ve RLS zaten yalnızca bir
--      SELECT politikası içeriyordu — Postgres RLS'de bir komut için
--      politika yoksa o komut o rol için zaten örtük olarak
--      reddedilir, yani bu tablo baştan beri korunuyordu. Ama bu
--      örtük garantiye güvenmek yerine, bu depodaki DİĞER TÜM
--      finansal/hassas tablolarla (cash_movements, expenses,
--      teacher_work_logs) aynı açık `revoke` ifadesi buraya da
--      ekleniyor — hem tutarlılık hem de "bunu doğrulayabilirsin"
--      netliği için.
--   2) İki fonksiyon (`set_teacher_course_meb_authorization`,
--      `set_enrollment_meb_registration`) bu depodaki TEK yerdi:
--      denetim satırını `pg_catalog.to_jsonb(a)` ile SATIRIN
--      TAMAMINDAN üretiyordu — bugün bu tablolarda hassas bir sütun
--      yok, ama bu desen, ileride bu tablolara eklenecek herhangi
--      bir sütunun (ör. bir not alanına yapıştırılmış kimlik no)
--      hiçbir kod değişikliği olmadan sessizce audit_logs'a
--      sızmasına izin verirdi. Bu depodaki HER ŞEYİN kullandığı açık
--      alan listesi desenine (`jsonb_build_object`) çevrildi.
--   3) `log_rejected_scheduling_attempt(p_payload jsonb)` istemciden
--      gelen SERBEST bir jsonb'yi olduğu gibi saklıyordu — bugünkü 5
--      çağrı noktası yalnızca form alanları gönderiyor ama fonksiyon
--      kendisi hiçbir alan kısıtı uygulamıyordu. Artık yalnızca
--      bilinen-güvenli anahtarlar tutuluyor, geri kalanı sunucu
--      tarafında süzülüyor.
--   4) İki GERÇEK kapsam boşluğu kapatıldı:
--      a) `create_student_with_guardian()` — bir öğrenci/velinin
--         T.C. kimlik numarasının sisteme GİRDİĞİ an — hiç
--         denetlenmiyordu (yalnızca sonraki güncellemeler
--         denetleniyordu). Şimdi denetleniyor — kimlik numaraları
--         YİNE loglanmıyor, yalnızca ad/soyad/veli adı/telefon gibi
--         kimlik-dışı alanlar.
--      b) `organizations` tablosu (kurum adı, iletişim, WhatsApp
--         şablonu, otomasyon ayarları) hiç denetlenmiyordu — admin
--         bu tabloyu doğrudan REST üzerinden güncelleyebiliyor
--         (mevcut 4 ayrı server action), tek bir RPC kapısı yok. Bu
--         yüzden RPC içine kod eklemek yerine bir AFTER UPDATE
--         trigger eklendi — mevcut hiçbir server action'a dokunmadan
--         çalışır. Trigger yalnızca İZLENEN alanlardan biri
--         değiştiğinde tetiklenir (`next_receipt_number` her ödemede
--         artan dahili bir sayaçtır — bu alan ayrı tutulmazsa trigger
--         her ödemede yanlışlıkla "kurum ayarları değişti" satırı
--         üretirdi).

revoke insert, update, delete
on public.audit_logs
from authenticated;

-- ---------------------------------------------------------------
-- 1) MEB fonksiyonları: to_jsonb(satır) yerine açık alan listesi.
-- ---------------------------------------------------------------

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
  v_organization_id uuid := public.current_organization_id();
  v_authorization_id uuid;
  v_old_data jsonb;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Öğretmen MEB yetkisini değiştirme yetkiniz bulunmuyor.';
  end if;

  if p_status not in ('approved', 'pending', 'not_registered', 'expired', 'unchecked') then
    raise exception 'Geçerli bir öğretmen MEB durumu seçilmelidir.';
  end if;

  if p_valid_until is not null and p_valid_from is not null and p_valid_until < p_valid_from then
    raise exception 'Geçerlilik bitiş tarihi başlangıç tarihinden önce olamaz.';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = p_teacher_profile_id
      and p.organization_id = v_organization_id
      and p.role in ('teacher'::public.app_role, 'admin'::public.app_role)
  ) then
    raise exception 'Öğretmen kaydı bulunamadı.';
  end if;

  if not exists (
    select 1 from public.courses c
    where c.id = p_course_id and c.organization_id = v_organization_id
  ) then
    raise exception 'Ders kaydı bulunamadı.';
  end if;

  select pg_catalog.jsonb_build_object(
    'status', a.status,
    'document_number', a.document_number,
    'valid_from', a.valid_from,
    'valid_until', a.valid_until,
    'note', a.note,
    'checked_at', a.checked_at,
    'checked_by', a.checked_by
  )
  into v_old_data
  from public.teacher_course_meb_authorizations a
  where a.organization_id = v_organization_id
    and a.teacher_profile_id = p_teacher_profile_id
    and a.course_id = p_course_id;

  insert into public.teacher_course_meb_authorizations (
    organization_id, teacher_profile_id, course_id, status, document_number,
    valid_from, valid_until, note, checked_at, checked_by
  )
  values (
    v_organization_id, p_teacher_profile_id, p_course_id, p_status,
    nullif(pg_catalog.btrim(coalesce(p_document_number, '')), ''),
    p_valid_from, p_valid_until,
    nullif(pg_catalog.btrim(coalesce(p_note, '')), ''),
    pg_catalog.now(), v_user_id
  )
  on conflict (organization_id, teacher_profile_id, course_id)
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
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  select
    v_organization_id, v_user_id, 'teacher_course_meb_authorizations', v_authorization_id::text,
    'upsert', v_old_data,
    pg_catalog.jsonb_build_object(
      'status', a.status,
      'document_number', a.document_number,
      'valid_from', a.valid_from,
      'valid_until', a.valid_until,
      'note', a.note,
      'checked_at', a.checked_at,
      'checked_by', a.checked_by
    )
  from public.teacher_course_meb_authorizations a
  where a.id = v_authorization_id;

  return v_authorization_id;
end;
$$;

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
  v_organization_id uuid := public.current_organization_id();
  v_registration_id uuid;
  v_student_id uuid;
  v_course_id uuid;
  v_old_data jsonb;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.can_manage_finance() then
    raise exception 'Öğrenci MEB kaydını değiştirme yetkiniz bulunmuyor.';
  end if;

  if p_status not in (
    'registered', 'pending', 'not_registered', 'not_eligible', 'rejected', 'ended', 'unchecked'
  ) then
    raise exception 'Geçerli bir öğrenci MEB durumu seçilmelidir.';
  end if;

  if p_valid_until is not null and p_valid_from is not null and p_valid_until < p_valid_from then
    raise exception 'Geçerlilik bitiş tarihi başlangıç tarihinden önce olamaz.';
  end if;

  select e.student_id, e.course_id
  into v_student_id, v_course_id
  from public.enrollments e
  where e.id = p_enrollment_id and e.organization_id = v_organization_id;

  if v_student_id is null then
    raise exception 'Öğrenci ders kaydı bulunamadı.';
  end if;

  select pg_catalog.jsonb_build_object(
    'status', r.status,
    'registration_number', r.registration_number,
    'valid_from', r.valid_from,
    'valid_until', r.valid_until,
    'non_registration_reason', r.non_registration_reason,
    'note', r.note,
    'checked_at', r.checked_at,
    'checked_by', r.checked_by
  )
  into v_old_data
  from public.enrollment_meb_registrations r
  where r.enrollment_id = p_enrollment_id;

  insert into public.enrollment_meb_registrations (
    organization_id, enrollment_id, student_id, course_id, status, registration_number,
    valid_from, valid_until, non_registration_reason, note, checked_at, checked_by
  )
  values (
    v_organization_id, p_enrollment_id, v_student_id, v_course_id, p_status,
    nullif(pg_catalog.btrim(coalesce(p_registration_number, '')), ''),
    p_valid_from, p_valid_until,
    nullif(pg_catalog.btrim(coalesce(p_non_registration_reason, '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_note, '')), ''),
    pg_catalog.now(), v_user_id
  )
  on conflict (enrollment_id)
  do update set
    status = excluded.status,
    registration_number = excluded.registration_number,
    valid_from = excluded.valid_from,
    valid_until = excluded.valid_until,
    non_registration_reason = excluded.non_registration_reason,
    note = excluded.note,
    checked_at = excluded.checked_at,
    checked_by = excluded.checked_by
  returning id into v_registration_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  select
    v_organization_id, v_user_id, 'enrollment_meb_registrations', v_registration_id::text,
    'upsert', v_old_data,
    pg_catalog.jsonb_build_object(
      'status', r.status,
      'registration_number', r.registration_number,
      'valid_from', r.valid_from,
      'valid_until', r.valid_until,
      'non_registration_reason', r.non_registration_reason,
      'note', r.note,
      'checked_at', r.checked_at,
      'checked_by', r.checked_by
    )
  from public.enrollment_meb_registrations r
  where r.id = v_registration_id;

  return v_registration_id;
end;
$$;

-- ---------------------------------------------------------------
-- 2) log_rejected_scheduling_attempt: istemciden gelen payload artık
-- sunucu tarafında bilinen-güvenli anahtar listesiyle süzülüyor.
-- ---------------------------------------------------------------

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
  v_safe_payload jsonb;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Bu işlemi kaydetme yetkiniz bulunmuyor.';
  end if;

  if p_payload is not null then
    select pg_catalog.jsonb_object_agg(entry.key, entry.value)
    into v_safe_payload
    from pg_catalog.jsonb_each(p_payload) as entry(key, value)
    where entry.key = any(array[
      'name', 'courseId', 'teacherProfileId', 'roomName', 'capacity', 'weekday',
      'startTime', 'durationMinutes', 'startsOn', 'endsOn',
      'studentId', 'classGroupId', 'lessonSessionId', 'newStartsAt', 'newEndsAt',
      'creditId', 'targetLessonSessionId'
    ]);
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
    pg_catalog.jsonb_build_object('reason', p_reason, 'payload', v_safe_payload)
  );
end;
$$;

-- ---------------------------------------------------------------
-- 3) Kapsam boşluğu: öğrenci/veli ilk kaydı hiç denetlenmiyordu.
-- T.C. kimlik numaraları burada da YİNE loglanmıyor.
-- ---------------------------------------------------------------

create or replace function public.create_student_with_guardian(
  p_student_identity_number text,
  p_student_first_name text,
  p_student_last_name text,
  p_guardian_identity_number text,
  p_guardian_full_name text,
  p_guardian_phone text,
  p_birth_date date default null,
  p_registration_date date default null,
  p_student_notes text default null,
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
  v_organization_id uuid;
  v_today date := (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
  v_student_id uuid;
  v_guardian_id uuid;
  v_student_identity_number text;
  v_guardian_identity_number text;
  v_student_first_name text;
  v_student_last_name text;
  v_guardian_full_name text;
  v_guardian_phone text;
  v_guardian_secondary_phone text;
  v_guardian_email text;
  v_student_notes text;
  v_relationship text;
  v_guardian_is_new boolean;
begin
  v_organization_id := public.current_organization_id();

  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.can_manage_finance() then
    raise exception 'Öğrenci kaydı oluşturma yetkiniz bulunmuyor.';
  end if;

  v_student_identity_number :=
    pg_catalog.regexp_replace(coalesce(p_student_identity_number, ''), '[^0-9]', '', 'g');

  v_guardian_identity_number :=
    pg_catalog.regexp_replace(coalesce(p_guardian_identity_number, ''), '[^0-9]', '', 'g');

  v_student_first_name := pg_catalog.btrim(coalesce(p_student_first_name, ''));
  v_student_last_name := pg_catalog.btrim(coalesce(p_student_last_name, ''));
  v_guardian_full_name := pg_catalog.btrim(coalesce(p_guardian_full_name, ''));
  v_guardian_phone := pg_catalog.btrim(coalesce(p_guardian_phone, ''));
  v_guardian_secondary_phone := pg_catalog.btrim(coalesce(p_guardian_secondary_phone, ''));
  v_guardian_email := pg_catalog.lower(pg_catalog.btrim(coalesce(p_guardian_email, '')));
  v_student_notes := pg_catalog.btrim(coalesce(p_student_notes, ''));
  v_relationship := pg_catalog.btrim(coalesce(p_relationship, 'Veli'));

  if not public.is_valid_tckn(v_student_identity_number) then
    raise exception 'Öğrencinin T.C. kimlik numarası geçerli değil.';
  end if;

  if not public.is_valid_tckn(v_guardian_identity_number) then
    raise exception 'Velinin T.C. kimlik numarası geçerli değil.';
  end if;

  if v_student_identity_number = v_guardian_identity_number then
    raise exception 'Öğrenci ve veli T.C. kimlik numaraları aynı olamaz.';
  end if;

  if pg_catalog.char_length(v_student_first_name) < 2 then
    raise exception 'Öğrenci adı en az 2 karakter olmalıdır.';
  end if;

  if pg_catalog.char_length(v_student_last_name) < 2 then
    raise exception 'Öğrenci soyadı en az 2 karakter olmalıdır.';
  end if;

  if pg_catalog.char_length(v_guardian_full_name) < 2 then
    raise exception 'Veli adı en az 2 karakter olmalıdır.';
  end if;

  if pg_catalog.char_length(
    pg_catalog.regexp_replace(v_guardian_phone, '[^0-9]', '', 'g')
  ) < 10 then
    raise exception 'Geçerli bir veli telefon numarası girilmelidir.';
  end if;

  if p_birth_date is not null and p_birth_date > v_today then
    raise exception 'Doğum tarihi gelecekte olamaz.';
  end if;

  if p_registration_date is not null and p_registration_date > v_today then
    raise exception 'Kayıt tarihi gelecekte olamaz.';
  end if;

  if exists (
    select 1 from public.students
    where organization_id = v_organization_id
      and identity_number = v_student_identity_number
  ) then
    raise exception 'Bu T.C. kimlik numarasıyla kayıtlı bir öğrenci zaten var.';
  end if;

  v_guardian_is_new := not exists (
    select 1 from public.guardians
    where organization_id = v_organization_id
      and identity_number = v_guardian_identity_number
  );

  insert into public.guardians as existing_guardian (
    organization_id, identity_number, full_name, phone, secondary_phone, email
  )
  values (
    v_organization_id, v_guardian_identity_number, v_guardian_full_name, v_guardian_phone,
    nullif(v_guardian_secondary_phone, ''), nullif(v_guardian_email, '')
  )
  on conflict (organization_id, identity_number)
  do update set
    full_name = excluded.full_name,
    phone = excluded.phone,
    secondary_phone = coalesce(nullif(excluded.secondary_phone, ''), existing_guardian.secondary_phone),
    email = coalesce(nullif(excluded.email, ''), existing_guardian.email),
    updated_at = pg_catalog.now()
  returning id into v_guardian_id;

  insert into public.students (
    organization_id, identity_number, first_name, last_name, birth_date,
    registration_date, status, notes, created_by
  )
  values (
    v_organization_id, v_student_identity_number, v_student_first_name, v_student_last_name,
    p_birth_date, coalesce(p_registration_date, v_today),
    'active'::public.record_status, nullif(v_student_notes, ''), v_user_id
  )
  returning id into v_student_id;

  insert into public.student_guardians (
    student_id, guardian_id, relationship, is_primary, may_receive_financial_messages
  )
  values (
    v_student_id, v_guardian_id, coalesce(nullif(v_relationship, ''), 'Veli'), true, true
  );

  -- T.C. kimlik numaraları BİLEREK dışarıda bırakılıyor — yalnızca
  -- kimlik-dışı, çakışma/değişiklik takibi için anlamlı alanlar.
  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'students', v_student_id::text, 'create', null,
    pg_catalog.jsonb_build_object(
      'first_name', v_student_first_name,
      'last_name', v_student_last_name,
      'birth_date', p_birth_date,
      'registration_date', coalesce(p_registration_date, v_today),
      'guardian_id', v_guardian_id,
      'guardian_full_name', v_guardian_full_name,
      'guardian_is_new', v_guardian_is_new,
      'relationship', coalesce(nullif(v_relationship, ''), 'Veli')
    )
  );

  return v_student_id;
end;
$$;

revoke all
on function public.create_student_with_guardian(
  text, text, text, text, text, text, date, date, text, text, text, text
)
from public, anon;

grant execute
on function public.create_student_with_guardian(
  text, text, text, text, text, text, date, date, text, text, text, text
)
to authenticated;

-- ---------------------------------------------------------------
-- 4) Kapsam boşluğu: organizations tablosu hiç denetlenmiyordu.
-- Tek bir RPC kapısı olmadığından (4 ayrı server action doğrudan
-- update ediyor), mevcut hiçbir kodu değiştirmeyen bir trigger
-- kullanılıyor. next_receipt_number (her ödemede artan dahili sayaç)
-- BİLİNÇLİ olarak izlenen alan listesinin dışında — yoksa her ödeme
-- yanlışlıkla bir "kurum ayarları değişti" satırı üretirdi.
-- ---------------------------------------------------------------

create or replace function public.audit_organizations_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    new.id, auth.uid(), 'organizations', new.id::text, 'update',
    pg_catalog.jsonb_build_object(
      'name', old.name,
      'legal_name', old.legal_name,
      'tax_number', old.tax_number,
      'phone', old.phone,
      'email', old.email,
      'timezone', old.timezone,
      'logo_path', old.logo_path,
      'whatsapp_reminder_day', old.whatsapp_reminder_day,
      'whatsapp_reminder_template', old.whatsapp_reminder_template,
      'monthly_automation_enabled', old.monthly_automation_enabled,
      'sessions_generation_day', old.sessions_generation_day,
      'accruals_generation_day', old.accruals_generation_day
    ),
    pg_catalog.jsonb_build_object(
      'name', new.name,
      'legal_name', new.legal_name,
      'tax_number', new.tax_number,
      'phone', new.phone,
      'email', new.email,
      'timezone', new.timezone,
      'logo_path', new.logo_path,
      'whatsapp_reminder_day', new.whatsapp_reminder_day,
      'whatsapp_reminder_template', new.whatsapp_reminder_template,
      'monthly_automation_enabled', new.monthly_automation_enabled,
      'sessions_generation_day', new.sessions_generation_day,
      'accruals_generation_day', new.accruals_generation_day
    )
  );

  return new;
end;
$$;

drop trigger if exists organizations_audit_update on public.organizations;

create trigger organizations_audit_update
after update on public.organizations
for each row
when (
  old.name is distinct from new.name
  or old.legal_name is distinct from new.legal_name
  or old.tax_number is distinct from new.tax_number
  or old.phone is distinct from new.phone
  or old.email is distinct from new.email
  or old.timezone is distinct from new.timezone
  or old.logo_path is distinct from new.logo_path
  or old.whatsapp_reminder_day is distinct from new.whatsapp_reminder_day
  or old.whatsapp_reminder_template is distinct from new.whatsapp_reminder_template
  or old.monthly_automation_enabled is distinct from new.monthly_automation_enabled
  or old.sessions_generation_day is distinct from new.sessions_generation_day
  or old.accruals_generation_day is distinct from new.accruals_generation_day
)
execute function public.audit_organizations_update();

notify pgrst, 'reload schema';
