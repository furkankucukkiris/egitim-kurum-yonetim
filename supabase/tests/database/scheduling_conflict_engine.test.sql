-- Zamanlama çakışması / kapasite doğrulama motoru pgTAP testleri
-- (20260812100000, 20260812110000).
--
-- Kapsam: öğretmen/derslik çakışması (class_groups şablon düzeyi),
-- sınır durumu (bitişik saatler çakışmaz, kesişmeyen tarih aralıkları
-- yanlışlıkla reddedilmez), öğrenci program çakışması, grup/birebir
-- kapasite (kilit tabanlı eşzamanlılık kanıtı), pasif öğretmen
-- reddi, tarih tutarlılığı (RPC + tablo CHECK kısıtı), MEB izin
-- politikası (uyar/engelle), kurum izolasyonu, yetkilendirme ve
-- audit_logs kaydı.
--
-- Çalıştırma: `npx supabase start` sonrasında `npx supabase test db`.
-- Bu dosya tek bir transaction içinde çalışır ve sonunda rollback
-- edilir.

begin;

select plan(56);

-- ---------------------------------------------------------------
-- Fixture kurulumu (superuser olarak). İki kurum: c3...001 (ana
-- test kurumu), c3...002 (izolasyon testi için ikinci kurum).
-- ---------------------------------------------------------------

delete from public.payment_allocations;
delete from public.payments;
delete from public.enrollment_meb_registrations;
delete from public.teacher_course_meb_authorizations;
delete from public.accruals;
delete from public.enrollments;
delete from public.attendance;
delete from public.lesson_sessions;
delete from public.class_groups;
delete from public.courses;
delete from public.students;
delete from public.audit_logs;
delete from public.profiles;
delete from public.organizations;

insert into public.organizations (id, name)
values
  ('c3000000-0000-0000-0000-000000000001', 'Test Kurumu 1'),
  ('c3000000-0000-0000-0000-000000000002', 'Test Kurumu 2');

insert into auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
values
  ('c3000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin1@ornek.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('c3000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'teacher1@ornek.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('c3000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'teacher-inactive@ornek.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('c3000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin2@ornek.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('c3000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'teacher2org@ornek.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

insert into public.profiles (id, organization_id, full_name, role, is_active)
values
  ('c3000000-0000-0000-0000-0000000000a1', 'c3000000-0000-0000-0000-000000000001', 'Admin 1', 'admin', true),
  ('c3000000-0000-0000-0000-0000000000a2', 'c3000000-0000-0000-0000-000000000001', 'Öğretmen Bir', 'teacher', true),
  ('c3000000-0000-0000-0000-0000000000a4', 'c3000000-0000-0000-0000-000000000001', 'Pasif Öğretmen', 'teacher', false),
  ('c3000000-0000-0000-0000-0000000000b1', 'c3000000-0000-0000-0000-000000000002', 'Admin 2', 'admin', true),
  ('c3000000-0000-0000-0000-0000000000b2', 'c3000000-0000-0000-0000-000000000002', 'Öğretmen İki', 'teacher', true);

insert into public.courses (id, organization_id, name, course_type, default_duration_minutes, default_monthly_fee)
values
  ('c3000000-0000-0000-0000-0000000c0001', 'c3000000-0000-0000-0000-000000000001', 'Resim', 'group', 60, 1000),
  ('c3000000-0000-0000-0000-0000000c0002', 'c3000000-0000-0000-0000-000000000001', 'Piyano Özel', 'individual', 45, 1200),
  ('c3000000-0000-0000-0000-0000000c0003', 'c3000000-0000-0000-0000-000000000001', 'MEB Dersi', 'group', 60, 1000),
  ('c3000000-0000-0000-0000-0000000c0004', 'c3000000-0000-0000-0000-000000000002', 'Org2 Dersi', 'group', 60, 1000);

update public.courses set meb_status = 'approved'
where id = 'c3000000-0000-0000-0000-0000000c0003';

insert into public.students (id, organization_id, first_name, last_name, status)
values
  ('c3000000-0000-0000-0000-0000000d0001', 'c3000000-0000-0000-0000-000000000001', 'Öğrenci', 'Bir', 'active'),
  ('c3000000-0000-0000-0000-0000000d0002', 'c3000000-0000-0000-0000-000000000001', 'Öğrenci', 'Iki', 'active'),
  ('c3000000-0000-0000-0000-0000000d0003', 'c3000000-0000-0000-0000-000000000001', 'Öğrenci', 'Uc', 'active'),
  ('c3000000-0000-0000-0000-0000000d0004', 'c3000000-0000-0000-0000-000000000001', 'Öğrenci', 'Dort', 'active');

-- ---------------------------------------------------------------
-- Admin 1 olarak doğrulama.
-- ---------------------------------------------------------------

select set_config('request.jwt.claims', json_build_object('sub', 'c3000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

select has_function('public', 'class_schedule_overlaps', 'class_schedule_overlaps tanımlı');
select has_function('public', 'find_class_group_conflict', 'find_class_group_conflict tanımlı');
select has_function('public', 'find_student_enrollment_conflict', 'find_student_enrollment_conflict tanımlı');
select has_function('public', 'check_teacher_meb_permit', 'check_teacher_meb_permit tanımlı');
select has_function('public', 'describe_session_scheduling_conflict', 'describe_session_scheduling_conflict tanımlı');
select has_function('public', 'describe_student_session_conflict', 'describe_student_session_conflict tanımlı');
select has_function('public', 'log_rejected_scheduling_attempt', 'log_rejected_scheduling_attempt tanımlı');

-- --- class_schedule_overlaps() birim testleri ---

select ok(
  public.class_schedule_overlaps(3, '10:00', 60, '2026-01-01', null, 3, '10:30', 60, '2026-01-01', null),
  '10:00-11:00 ile 10:30-11:30 çakışır'
);

select ok(
  not public.class_schedule_overlaps(3, '10:00', 60, '2026-01-01', null, 3, '11:00', 60, '2026-01-01', null),
  '10:00-11:00 ile 11:00-12:00 bitişik saatler çakışmaz'
);

select ok(
  not public.class_schedule_overlaps(3, '10:00', 60, '2026-01-01', '2026-06-30', 3, '10:00', 60, '2026-09-01', null),
  'aynı gün/saat ama kesişmeyen tarih aralıkları çakışmaz'
);

select ok(
  not public.class_schedule_overlaps(3, '10:00', 60, '2026-01-01', null, 4, '10:00', 60, '2026-01-01', null),
  'farklı haftanın günleri çakışmaz'
);

-- --- create_class_group: temel senaryo ---

select lives_ok(
  $$ select public.create_class_group('Grup A', 'c3000000-0000-0000-0000-0000000c0001', 'c3000000-0000-0000-0000-0000000000a2', 'ODA-1', 2, 3, '10:00', 60, '2026-09-01', null) $$,
  'Grup A oluşturulur (Öğretmen Bir, ODA-1, Çrş 10:00-11:00)'
);

select throws_like(
  $$ select public.create_class_group('Grup B', 'c3000000-0000-0000-0000-0000000c0001', 'c3000000-0000-0000-0000-0000000000a2', 'ODA-2', 2, 3, '10:30', 60, '2026-09-01', null) $$,
  '%Öğretmen%çakışıyor%',
  'aynı öğretmenin çakışan saatte ikinci grubu reddedilir, mesaj öğretmeni adlandırır'
);

select throws_like(
  $$ select public.create_class_group('Grup C', 'c3000000-0000-0000-0000-0000000c0001', null, 'ODA-1', 2, 3, '10:45', 30, '2026-09-01', null) $$,
  '%ODA-1%çakışıyor%',
  'aynı derslik çakışan saatte ikinci grup için reddedilir, mesaj dersliği adlandırır'
);

select lives_ok(
  $$ select public.create_class_group('Grup D', 'c3000000-0000-0000-0000-0000000c0001', 'c3000000-0000-0000-0000-0000000000a2', 'ODA-1', 2, 3, '11:00', 60, '2026-09-01', null) $$,
  'Grup D (11:00-12:00) Grup A''nın (10:00-11:00) tam bitişinde başladığı için izin verilir'
);

select throws_like(
  $$ select public.create_class_group('Grup E', 'c3000000-0000-0000-0000-0000000c0001', 'c3000000-0000-0000-0000-0000000000a2', 'ODA-3', 2, 3, '10:00', 60, '2026-09-15', null) $$,
  '%çakışıyor%',
  'Grup A''nın bitiş tarihi olmadığı için (açık uçlu), Eylül 15''te başlayan aynı saatteki grup da çakışır'
);

update public.class_groups set ends_on = '2026-09-10'
where organization_id = 'c3000000-0000-0000-0000-000000000001' and name = 'Grup A';

select lives_ok(
  $$ select public.create_class_group('Grup F', 'c3000000-0000-0000-0000-0000000c0001', 'c3000000-0000-0000-0000-0000000000a2', 'ODA-4', 2, 3, '10:00', 60, '2026-09-15', null) $$,
  'Grup A''nın bitiş tarihi (10 Eylül) girildikten sonra, 15 Eylül''den başlayan aynı saatteki grup artık çakışmaz'
);

select throws_ok(
  $$ select public.create_class_group('Grup G', 'c3000000-0000-0000-0000-0000000c0001', 'c3000000-0000-0000-0000-0000000000a4', null, 2, 5, '09:00', 60, '2026-09-01', null) $$,
  'P0001', 'Seçilen öğretmen bulunamadı veya aktif değil.',
  'pasif öğretmen yeni bir seansa atanamaz'
);

select throws_ok(
  $$ select public.create_class_group('Grup H', 'c3000000-0000-0000-0000-0000000c0001', null, null, 2, 5, '09:00', 60, '2026-09-01', '2026-08-01') $$,
  'P0001', 'Program bitiş tarihi başlangıç tarihinden önce olamaz.',
  'bitiş tarihi başlangıçtan önce olan seans reddedilir (RPC düzeyi)'
);

-- --- update_class_group: aynı çakışma motoru ---

select lives_ok(
  $$ select public.create_class_group('Grup I', 'c3000000-0000-0000-0000-0000000c0001', null, null, 2, 1, '09:00', 60, '2026-09-01', null) $$,
  'Grup I oluşturulur (Pazartesi 09:00, öğretmensiz)'
);

select throws_like(
  $$
    select public.update_class_group(
      (select id from public.class_groups where organization_id = 'c3000000-0000-0000-0000-000000000001' and name = 'Grup I'),
      'Grup I', 'c3000000-0000-0000-0000-0000000000a2', 'ODA-1', 2, 3, '10:00', 60, '2026-09-01', '2026-09-10'
    )
  $$,
  '%çakışıyor%',
  'update_class_group, Grup I''yı Grup A ile çakışan saate taşımaya çalışınca reddedilir'
);

select lives_ok(
  $$
    select public.update_class_group(
      (select id from public.class_groups where organization_id = 'c3000000-0000-0000-0000-000000000001' and name = 'Grup I'),
      'Grup I', null, null, 2, 1, '09:30', 60, '2026-09-01', null
    )
  $$,
  'Grup I kendi (çakışmayan) yeni saatine güncellenebilir'
);

select lives_ok(
  $$
    select public.update_class_group(
      (select id from public.class_groups where organization_id = 'c3000000-0000-0000-0000-000000000001' and name = 'Grup A'),
      'Grup A', 'c3000000-0000-0000-0000-0000000000a2', 'ODA-1', 2, 3, '10:00', 60, '2026-09-01', '2026-09-10'
    )
  $$,
  'Grup A, kendi DEĞİŞMEYEN saatine/dersliğine güncellenebilir — kendisiyle çakışma olarak sayılmaz (öz-hariç tutma)'
);

-- --- Tablo düzeyinde tarih tutarlılığı (RPC''yi bypass ederek doğrudan insert) ---

-- Bu iki test, RLS/grant''ları bypass edip DOĞRUDAN tablo düzeyindeki
-- CHECK kısıtını sınamak için superuser olarak çalışır (authenticated
-- rolünün zaten class_groups/enrollments'a insert izni yok — o yetki
-- reddi, CHECK kısıtına hiç ulaşmadan farklı bir hata verir).
reset role;

select throws_ok(
  $$
    insert into public.class_groups (organization_id, course_id, name, weekday, start_time, duration_minutes, starts_on, ends_on)
    values ('c3000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-0000000c0001', 'Bypass Grup', 2, '09:00', 60, '2026-09-10', '2026-09-01')
  $$,
  '23514',
  'class_groups_dates_check kısıtı, RPC''yi bypass eden doğrudan insert''i de reddeder'
);

select throws_ok(
  $$
    insert into public.enrollments (organization_id, student_id, course_id, starts_on, ends_on, list_monthly_fee, net_monthly_fee)
    values ('c3000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-0000000d0001', 'c3000000-0000-0000-0000-0000000c0001', '2026-09-10', '2026-09-01', 1000, 1000)
  $$,
  '23514',
  'enrollments_dates_check kısıtı, RPC''yi bypass eden doğrudan insert''i de reddeder'
);

reset role;

-- ---------------------------------------------------------------
-- Öğrenci program çakışması + kapasite (grup ve birebir).
-- ---------------------------------------------------------------

select set_config('request.jwt.claims', json_build_object('sub', 'c3000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

-- İki farklı derste, aynı gün/saat aralığında çakışan iki grup.
select lives_ok(
  $$ select public.create_class_group('Piyano Grup', 'c3000000-0000-0000-0000-0000000c0002', 'c3000000-0000-0000-0000-0000000000a2', null, null, 2, '14:00', 45, '2026-09-01', null) $$,
  'Piyano (birebir) grubu oluşturulur (Salı 14:00)'
);

select lives_ok(
  $$ select public.create_class_group('MEB Grup', 'c3000000-0000-0000-0000-0000000c0003', null, null, 2, 2, '14:15', 45, '2026-09-01', null) $$,
  'MEB Dersi grubu oluşturulur (Salı 14:15 — Piyano ile çakışan saat)'
);

select lives_ok(
  $$
    select public.create_enrollment_with_meb_registration(
      'c3000000-0000-0000-0000-0000000d0001', 'c3000000-0000-0000-0000-0000000c0002',
      (select id from public.class_groups where organization_id = 'c3000000-0000-0000-0000-000000000001' and name = 'Piyano Grup'),
      '2026-09-01', null, 1000, 'none', 0, 5, null,
      'unchecked', null, null, null, null, null
    )
  $$,
  'Öğrenci 1, Piyano''ya kaydedilir'
);

select throws_like(
  $$
    select public.create_enrollment_with_meb_registration(
      'c3000000-0000-0000-0000-0000000d0001', 'c3000000-0000-0000-0000-0000000c0003',
      (select id from public.class_groups where organization_id = 'c3000000-0000-0000-0000-000000000001' and name = 'MEB Grup'),
      '2026-09-01', null, 1000, 'none', 0, 5, null,
      'unchecked', null, null, null, null, null
    )
  $$,
  '%çakışıyor%',
  'aynı öğrencinin FARKLI bir derste çakışan saatte ikinci kaydı reddedilir (program çakışması)'
);

select lives_ok(
  $$
    select public.create_enrollment_with_meb_registration(
      'c3000000-0000-0000-0000-0000000d0002', 'c3000000-0000-0000-0000-0000000c0003',
      (select id from public.class_groups where organization_id = 'c3000000-0000-0000-0000-000000000001' and name = 'MEB Grup'),
      '2026-09-01', null, 1000, 'none', 0, 5, null,
      'unchecked', null, null, null, null, null
    )
  $$,
  'farklı bir öğrenci (Öğrenci 2), çakışan saatte olsa da kendi ilk kaydı olduğu için MEB Grubuna kaydedilebilir'
);

-- Grup kapasitesi: Grup A''nın kapasitesi 2. Öğrenci 3 ve 4 kaydedilir, 3. kayıt reddedilir.
select lives_ok(
  $$
    select public.create_enrollment_with_meb_registration(
      'c3000000-0000-0000-0000-0000000d0001', 'c3000000-0000-0000-0000-0000000c0001',
      (select id from public.class_groups where organization_id = 'c3000000-0000-0000-0000-000000000001' and name = 'Grup A'),
      '2026-09-01', null, 1000, 'none', 0, 5, null,
      'unchecked', null, null, null, null, null
    )
  $$,
  'Öğrenci 1, Grup A''ya (kapasite 2) kaydedilir — 1/2'
);

select lives_ok(
  $$
    select public.create_enrollment_with_meb_registration(
      'c3000000-0000-0000-0000-0000000d0002', 'c3000000-0000-0000-0000-0000000c0001',
      (select id from public.class_groups where organization_id = 'c3000000-0000-0000-0000-000000000001' and name = 'Grup A'),
      '2026-09-01', null, 1000, 'none', 0, 5, null,
      'unchecked', null, null, null, null, null
    )
  $$,
  'Öğrenci 2, Grup A''ya kaydedilir — 2/2 (kontenjan dolar)'
);

select throws_ok(
  $$
    select public.create_enrollment_with_meb_registration(
      'c3000000-0000-0000-0000-0000000d0003', 'c3000000-0000-0000-0000-0000000c0001',
      (select id from public.class_groups where organization_id = 'c3000000-0000-0000-0000-000000000001' and name = 'Grup A'),
      '2026-09-01', null, 1000, 'none', 0, 5, null,
      'unchecked', null, null, null, null, null
    )
  $$,
  'P0001', 'Seçilen ders seansında boş kontenjan bulunmuyor.',
  'Öğrenci 3, dolu Grup A''ya kaydedilemez — kapasite doğru uygulanıyor'
);

-- Eşzamanlılık kanıtı: class_groups satırı FOR UPDATE ile kilitlendiği için
-- ardışık iki çağrı, gerçek bir eşzamanlı yarışın kullanacağı AYNI kilit
-- yolunu kullanır (bu dosyada gerçek paralel transaction başlatılamaz —
-- ardışık çağrı aynı korumayı sınar, bkz. payment_refunds_and_advances
-- testindeki aynı yaklaşım).
select is(
  (
    select count(*)::integer from public.enrollments e
    where e.class_group_id = (select id from public.class_groups where organization_id = 'c3000000-0000-0000-0000-000000000001' and name = 'Grup A')
      and e.status = 'active'::public.enrollment_status
  ),
  2,
  'Grup A''da tam olarak 2 aktif kayıt var — kapasite aşılmadı'
);

-- Birebir ders: yalnızca 1 kalıcı aktif öğrenci.
select lives_ok(
  $$
    select public.create_class_group('Birebir Grup', 'c3000000-0000-0000-0000-0000000c0002', null, null, 4, 4, '16:00', 45, '2026-09-01', null)
  $$,
  'İkinci bir birebir Piyano seansı oluşturulur (kapasite otomatik 1)'
);

select is(
  (select capacity from public.class_groups where organization_id = 'c3000000-0000-0000-0000-000000000001' and name = 'Birebir Grup'),
  1,
  'Birebir ders seansının kapasitesi otomatik olarak 1''dir'
);

select lives_ok(
  $$
    select public.create_enrollment_with_meb_registration(
      'c3000000-0000-0000-0000-0000000d0003', 'c3000000-0000-0000-0000-0000000c0002',
      (select id from public.class_groups where organization_id = 'c3000000-0000-0000-0000-000000000001' and name = 'Birebir Grup'),
      '2026-09-01', null, 1000, 'none', 0, 5, null,
      'unchecked', null, null, null, null, null
    )
  $$,
  'Öğrenci 3, birebir seansa kaydedilir (1/1)'
);

select throws_ok(
  $$
    select public.create_enrollment_with_meb_registration(
      'c3000000-0000-0000-0000-0000000d0004', 'c3000000-0000-0000-0000-0000000c0002',
      (select id from public.class_groups where organization_id = 'c3000000-0000-0000-0000-000000000001' and name = 'Birebir Grup'),
      '2026-09-01', null, 1000, 'none', 0, 5, null,
      'unchecked', null, null, null, null, null
    )
  $$,
  'P0001', 'Seçilen ders seansında boş kontenjan bulunmuyor.',
  'Öğrenci 4, dolu birebir seansa (1 kalıcı aktif öğrenci sınırı) kaydedilemez'
);

reset role;

-- ---------------------------------------------------------------
-- MEB çalışma izni: uyar / engelle politikası.
-- ---------------------------------------------------------------

select set_config('request.jwt.claims', json_build_object('sub', 'c3000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(
  (select o.meb_permit_enforcement from public.organizations o where o.id = 'c3000000-0000-0000-0000-000000000001'),
  'warn',
  'kurumun varsayılan MEB izin politikası ''warn'''
);

select is(
  public.check_teacher_meb_permit('c3000000-0000-0000-0000-0000000000a2', 'c3000000-0000-0000-0000-0000000c0003'),
  'Öğretmen Öğretmen Bir, ''MEB Dersi'' dersi için geçerli bir MEB çalışma izni bulunmuyor.',
  'check_teacher_meb_permit, MEB onaylı derste yetkisiz öğretmen için uyarı metni döner'
);

select lives_ok(
  $$ select public.create_class_group('MEB Uyari Grup', 'c3000000-0000-0000-0000-0000000c0003', 'c3000000-0000-0000-0000-0000000000a2', null, 2, 6, '09:00', 60, '2026-09-01', null) $$,
  '''warn'' politikasında, MEB izni olmayan öğretmen ataması ENGELLENMEZ (sadece uyarılır)'
);

select is(
  (
    select count(*)::integer from public.audit_logs
    where organization_id = 'c3000000-0000-0000-0000-000000000001'
      and table_name = 'class_groups'
      and action = 'meb_permit_warning'
  ),
  1,
  '''warn'' politikasında MEB uyarısı audit_logs''a kaydedilir'
);

update public.organizations set meb_permit_enforcement = 'block'
where id = 'c3000000-0000-0000-0000-000000000001';

select throws_like(
  $$ select public.create_class_group('MEB Engel Grup', 'c3000000-0000-0000-0000-0000000c0003', 'c3000000-0000-0000-0000-0000000000a2', null, 2, 7, '09:00', 60, '2026-09-01', null) $$,
  '%MEB çalışma izni bulunmuyor%',
  '''block'' politikasında, MEB izni olmayan öğretmen ataması TAMAMEN reddedilir'
);

select lives_ok(
  $$
    select public.set_teacher_course_meb_authorization(
      'c3000000-0000-0000-0000-0000000000a2', 'c3000000-0000-0000-0000-0000000c0003',
      'approved', 'BELGE-1', '2020-01-01', null, null
    )
  $$,
  'Öğretmen Bir''e MEB Dersi için geçerli, süresiz onaylı izin verilir'
);

select lives_ok(
  $$ select public.create_class_group('MEB Izinli Grup', 'c3000000-0000-0000-0000-0000000c0003', 'c3000000-0000-0000-0000-0000000000a2', null, 2, 7, '10:00', 60, '2026-09-01', null) $$,
  '''block'' politikasında bile, geçerli MEB izni olan öğretmen ataması başarılı olur'
);

select is(
  public.check_teacher_meb_permit('c3000000-0000-0000-0000-0000000000a2', 'c3000000-0000-0000-0000-0000000c0003'),
  null,
  'check_teacher_meb_permit, artık geçerli izinli öğretmen için null döner'
);

update public.organizations set meb_permit_enforcement = 'warn'
where id = 'c3000000-0000-0000-0000-000000000001';

reset role;

-- ---------------------------------------------------------------
-- Kurum izolasyonu: org2''nin aynı isimli dersliği/saatı org1''i
-- etkilemez ve tersi.
-- ---------------------------------------------------------------

select set_config('request.jwt.claims', json_build_object('sub', 'c3000000-0000-0000-0000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;

select lives_ok(
  $$ select public.create_class_group('Org2 Grup', 'c3000000-0000-0000-0000-0000000c0004', 'c3000000-0000-0000-0000-0000000000b2', 'ODA-1', 2, 3, '10:00', 60, '2026-09-01', null) $$,
  'Org2, org1''deki ile AYNI derslik adı (ODA-1) ve AYNI gün/saatte (Çrş 10:00) kendi seansını sorunsuz oluşturabilir — kurum izolasyonu'
);

select is(
  (select count(*)::integer from public.class_groups where organization_id = 'c3000000-0000-0000-0000-000000000002'),
  1,
  'org2''nin yalnızca kendi seansı görünür'
);

reset role;

-- ---------------------------------------------------------------
-- Yetkilendirme: teacher rolü bu RPC''leri çağıramaz.
-- ---------------------------------------------------------------

select set_config('request.jwt.claims', json_build_object('sub', 'c3000000-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  $$ select public.create_class_group('Yetkisiz Grup', 'c3000000-0000-0000-0000-0000000c0001', null, null, 2, 1, '08:00', 60, '2026-09-01', null) $$,
  'P0001', 'Ders programı oluşturma yetkiniz bulunmuyor.',
  'teacher rolü create_class_group çağıramaz'
);

select throws_ok(
  $$
    select public.create_enrollment_with_meb_registration(
      'c3000000-0000-0000-0000-0000000d0001', 'c3000000-0000-0000-0000-0000000c0001',
      (select id from public.class_groups where organization_id = 'c3000000-0000-0000-0000-000000000001' and name = 'Grup A'),
      '2026-09-01', null, 1000, 'none', 0, 5, null,
      'unchecked', null, null, null, null, null
    )
  $$,
  'P0001', 'Öğrenciyi derse kaydetme yetkiniz bulunmuyor.',
  'teacher rolü create_enrollment_with_meb_registration çağıramaz'
);

select throws_ok(
  $$ select public.log_rejected_scheduling_attempt('class_groups', 'reject', 'test', null) $$,
  'P0001', 'Bu işlemi kaydetme yetkiniz bulunmuyor.',
  'teacher rolü log_rejected_scheduling_attempt çağıramaz'
);

select throws_ok(
  $$ select public.check_teacher_meb_permit('c3000000-0000-0000-0000-0000000000a2', 'c3000000-0000-0000-0000-0000000c0003') $$,
  'P0001', 'Bu kontrolü yapma yetkiniz bulunmuyor.',
  'teacher rolü check_teacher_meb_permit çağıramaz'
);

reset role;

-- ---------------------------------------------------------------
-- Audit logging: reddedilen girişimler için ayrı, ince RPC.
-- ---------------------------------------------------------------

select set_config('request.jwt.claims', json_build_object('sub', 'c3000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

select lives_ok(
  $$ select public.log_rejected_scheduling_attempt('class_groups', 'schedule_conflict_rejected', 'Öğretmen çakışması', '{"weekday": 3}'::jsonb) $$,
  'admin, reddedilen bir zamanlama girişimini kaydedebilir'
);

select is(
  (
    select count(*)::integer from public.audit_logs
    where organization_id = 'c3000000-0000-0000-0000-000000000001'
      and table_name = 'class_groups'
      and action = 'schedule_conflict_rejected'
  ),
  1,
  'reddedilen girişim audit_logs''a doğru şekilde yazıldı'
);

-- ---------------------------------------------------------------
-- Oturum (lesson_sessions) düzeyinde çakışma açıklamaları
-- (reschedule/telafi tarafından kullanılır).
-- ---------------------------------------------------------------

insert into public.lesson_sessions (id, organization_id, class_group_id, course_id, teacher_profile_id, starts_at, ends_at, room_name)
values (
  'c3000000-0000-0000-0000-0000000e0001', 'c3000000-0000-0000-0000-000000000001',
  (select id from public.class_groups where organization_id = 'c3000000-0000-0000-0000-000000000001' and name = 'Grup A'),
  'c3000000-0000-0000-0000-0000000c0001', 'c3000000-0000-0000-0000-0000000000a2',
  '2026-09-02 10:00:00+03', '2026-09-02 11:00:00+03', 'ODA-1'
);

select is(
  public.describe_session_scheduling_conflict(
    'c3000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-0000000000a2', null,
    '2026-09-02 10:30:00+03'::timestamptz, '2026-09-02 11:30:00+03'::timestamptz, null
  ),
  'Öğretmen Öğretmen Bir, 02.09.2026 tarihinde 10:00–11:00 saatleri arasında ''Resim — Grup A'' oturumuyla çakışıyor.',
  'describe_session_scheduling_conflict, çakışan oturumu öğretmen adıyla adlandırır'
);

select is(
  public.describe_session_scheduling_conflict(
    'c3000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-0000000000a2', null,
    '2026-09-02 11:00:00+03'::timestamptz, '2026-09-02 12:00:00+03'::timestamptz, null
  ),
  null,
  'describe_session_scheduling_conflict, bitişik saatte null döner (çakışma yok)'
);

reset role;

select * from finish();

rollback;
