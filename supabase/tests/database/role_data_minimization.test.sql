-- KVKK / least-privilege testleri (20260810150000):
--   * Teacher, students/guardians/student_guardians tablolarına
--     doğrudan erişemez (T.C. no, veli finans bilgisi dahil).
--   * Kurumlar arası veri sızıntısı yoktur — admin dahil, hiç kimse
--     başka bir organizasyonun öğrenci/veli/foto verisini göremez.
--     (Bu dosya ayrıca student_guardians_select_scoped politikasının
--     eski, organizasyon kapsamı eksik halinin düzeltildiğini de
--     doğrular.)
--   * Öğretmen, başka bir öğretmenin/ilgisiz bir öğrencinin kaydını
--     get_teacher_enrollments() üzerinden de göremez.
--
-- Çalıştırma: `npx supabase start` sonrasında `npx supabase test db`.
-- Bu dosya tek bir transaction içinde çalışır ve sonunda rollback
-- edilir.

begin;

select plan(16);

-- ---------------------------------------------------------------
-- Fixture kurulumu (superuser olarak — RLS'i atlar): iki ayrı
-- organizasyon, her birinde bir admin; org1'de iki öğretmen (biri
-- öğrenciye atanmış, diğeri ilgisiz).
-- ---------------------------------------------------------------

-- storage.objects dogrudan silmeyi koruyan Storage API tetikleyicisine
-- takilmamak icin burada DELETE yapilmaz. Test transaction'i zaten sonunda
-- rollback edilir ve yerel test veritabani temiz baslar.
delete from public.attendance;
delete from public.enrollments;
delete from public.student_guardians;
delete from public.guardians;
delete from public.class_groups;
delete from public.courses;
delete from public.students;
delete from public.profiles;
delete from public.organizations;

insert into public.organizations (id, name)
values
  ('b0000001-0000-0000-0000-000000000001', 'Org 1'),
  ('b0000002-0000-0000-0000-000000000001', 'Org 2');

insert into auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
values
  ('b0000001-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin1@ornek.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('b0000001-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ogretmen1@ornek.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('b0000001-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ogretmen2@ornek.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('b0000002-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin2@ornek.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

insert into public.profiles (id, organization_id, full_name, role, is_active)
values
  ('b0000001-0000-0000-0000-0000000000a1', 'b0000001-0000-0000-0000-000000000001', 'Admin 1', 'admin', true),
  ('b0000001-0000-0000-0000-0000000000a2', 'b0000001-0000-0000-0000-000000000001', 'Öğretmen 1', 'teacher', true),
  ('b0000001-0000-0000-0000-0000000000a3', 'b0000001-0000-0000-0000-000000000001', 'Öğretmen 2 (ilgisiz)', 'teacher', true),
  ('b0000002-0000-0000-0000-0000000000a1', 'b0000002-0000-0000-0000-000000000001', 'Admin 2', 'admin', true);

insert into public.courses (id, organization_id, name, course_type, default_monthly_fee)
values ('b0000001-0000-0000-0000-0000000c0001', 'b0000001-0000-0000-0000-000000000001', 'Piyano', 'individual', 1000);

insert into public.class_groups (id, organization_id, course_id, teacher_profile_id, name, weekday, start_time)
values (
  'b0000001-0000-0000-0000-0000000b0001',
  'b0000001-0000-0000-0000-000000000001',
  'b0000001-0000-0000-0000-0000000c0001',
  'b0000001-0000-0000-0000-0000000000a2',
  'Piyano A Grubu', 1, '10:00'
);

insert into public.students (id, organization_id, first_name, last_name, identity_number)
values
  ('b0000001-0000-0000-0000-0000000d0001', 'b0000001-0000-0000-0000-000000000001', 'Ali', 'Yılmaz', '11111111110'),
  ('b0000002-0000-0000-0000-0000000d0001', 'b0000002-0000-0000-0000-000000000001', 'Veli', 'Demir', '22222222220');

insert into public.guardians (id, organization_id, full_name, phone, invoice_title, tax_or_identity_number)
values
  ('b0000001-0000-0000-0000-0000000f0001', 'b0000001-0000-0000-0000-000000000001', 'Veli Yılmaz', '5551110000', 'Yılmaz Ltd.', '33333333330'),
  ('b0000002-0000-0000-0000-0000000f0001', 'b0000002-0000-0000-0000-000000000001', 'Veli Demir', '5552220000', 'Demir Ltd.', '44444444440');

insert into public.student_guardians (student_id, guardian_id, is_primary)
values
  ('b0000001-0000-0000-0000-0000000d0001', 'b0000001-0000-0000-0000-0000000f0001', true),
  ('b0000002-0000-0000-0000-0000000d0001', 'b0000002-0000-0000-0000-0000000f0001', true);

insert into public.enrollments (
  id, organization_id, student_id, course_id, class_group_id, teacher_profile_id,
  starts_on, status, list_monthly_fee, discount_type, discount_value, net_monthly_fee
)
values (
  'b0000001-0000-0000-0000-0000000e0001',
  'b0000001-0000-0000-0000-000000000001',
  'b0000001-0000-0000-0000-0000000d0001',
  'b0000001-0000-0000-0000-0000000c0001',
  'b0000001-0000-0000-0000-0000000b0001',
  'b0000001-0000-0000-0000-0000000000a2',
  current_date, 'active', 1000, 'percent', 10, 900
);

insert into storage.objects (id, bucket_id, name, owner)
values (
  gen_random_uuid(),
  'student-photos',
  'b0000001-0000-0000-0000-000000000001/ali-yilmaz.jpg',
  'b0000001-0000-0000-0000-0000000000a1'
);

-- ---------------------------------------------------------------
-- admin1 (org1): yalnızca kendi organizasyonunu görür.
-- ---------------------------------------------------------------

select set_config('request.jwt.claims', json_build_object('sub', 'b0000001-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((select count(*)::int from public.students), 1, 'admin1 yalnızca kendi organizasyonundaki öğrenciyi görür');
select is((select count(*)::int from public.guardians), 1, 'admin1 yalnızca kendi organizasyonundaki veliyi görür');
select is((select count(*)::int from public.student_guardians), 1, 'admin1 yalnızca kendi organizasyonunun öğrenci-veli eşlemesini görür (kurumlar arası sızıntı yok)');
select is((select count(*)::int from storage.objects where bucket_id = 'student-photos'), 1, 'admin1 kendi organizasyonunun öğrenci fotoğrafı nesnesini görür');

reset role;

-- ---------------------------------------------------------------
-- admin2 (org2): org1'in hiçbir verisini göremez.
-- ---------------------------------------------------------------

select set_config('request.jwt.claims', json_build_object('sub', 'b0000002-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((select count(*)::int from public.students), 1, 'admin2 yalnızca kendi organizasyonundaki öğrenciyi görür (org1 sızmaz)');
select is((select count(*)::int from public.student_guardians), 1, 'admin2 yalnızca kendi organizasyonunun öğrenci-veli eşlemesini görür (org1 sızmaz)');
select is((select count(*)::int from storage.objects where bucket_id = 'student-photos'), 0, 'admin2 org1''in öğrenci fotoğrafı nesnesini göremez (klasör kapsamı)');

reset role;

-- ---------------------------------------------------------------
-- Öğretmen 1 (org1, öğrenciye atanmış): tabloya doğrudan erişemez.
-- ---------------------------------------------------------------

select set_config('request.jwt.claims', json_build_object('sub', 'b0000001-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((select count(*)::int from public.students), 0, 'teacher students tablosuna doğrudan erişemez');
select is((select count(*)::int from public.guardians), 0, 'teacher guardians tablosuna doğrudan erişemez');
select is((select count(*)::int from public.student_guardians), 0, 'teacher student_guardians tablosuna doğrudan erişemez');
select is((select count(*)::int from public.students where identity_number is not null), 0, 'teacher T.C. kimlik numarasını doğrudan sorguyla alamaz');
select is((select count(*)::int from public.guardians where tax_or_identity_number is not null), 0, 'teacher veli finans/T.C. bilgisini doğrudan sorguyla alamaz');
select is((select count(*)::int from storage.objects where bucket_id = 'student-photos'), 0, 'teacher öğrenci fotoğrafı nesnesine doğrudan erişemez');

select is(
  (select count(*)::int from public.get_teacher_enrollments()),
  1,
  'teacher kendi yoklama listesindeki kaydı get_teacher_enrollments() ile görür'
);

select is(
  (select student_first_name from public.get_teacher_enrollments() limit 1),
  'Ali',
  'teacher kendi yoklama listesindeki öğrenci adını görebilir'
);

reset role;

-- ---------------------------------------------------------------
-- Öğretmen 2 (aynı organizasyon, ilgisiz/atanmamış öğretmen): hiçbir
-- kayıt görmez.
-- ---------------------------------------------------------------

select set_config('request.jwt.claims', json_build_object('sub', 'b0000001-0000-0000-0000-0000000000a3', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(
  (select count(*)::int from public.get_teacher_enrollments()),
  0,
  'aynı kurumdaki ilgisiz/başka öğretmen, öğretmen 1''in öğrencisini göremez'
);

reset role;

select * from finish();

rollback;
