-- admin/teacher rol sadeleştirmesinin pgTAP testleri: teacher'ın
-- finansal tablolara/sütunlara doğrudan erişemediğini,
-- get_teacher_enrollments() RPC'sinin yalnızca kendi kaydını
-- döndürdüğünü ve legacy 'finance' rolündeki bir profilin (varsayımsal
-- olarak veritabanında bulunsa bile) hiçbir ayrıcalık taşımadığını
-- doğrular.
--
-- Çalıştırma: `npx supabase start` sonrasında `npx supabase test db`.
-- Bu dosya tek bir transaction içinde çalışır ve sonunda rollback
-- edilir.

begin;

select plan(14);

-- ---------------------------------------------------------------
-- Fixture kurulumu (superuser olarak — RLS'i atlar).
-- ---------------------------------------------------------------

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
values ('a0000000-0000-0000-0000-000000000001', 'Test Kurumu');

insert into auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
values
  (
    'a0000000-0000-0000-0000-00000000a001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'admin@ornek.test', 'x', now(), now(), now(),
    '{"provider":"email","providers":["email"]}', '{}'
  ),
  (
    'a0000000-0000-0000-0000-00000000a002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'ogretmen-a@ornek.test', 'x', now(), now(), now(),
    '{"provider":"email","providers":["email"]}', '{}'
  ),
  (
    'a0000000-0000-0000-0000-00000000a003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'ogretmen-b@ornek.test', 'x', now(), now(), now(),
    '{"provider":"email","providers":["email"]}', '{}'
  ),
  (
    'a0000000-0000-0000-0000-00000000a004',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'eski-finans@ornek.test', 'x', now(), now(), now(),
    '{"provider":"email","providers":["email"]}', '{}'
  );

insert into public.profiles (id, organization_id, full_name, role, is_active)
values
  ('a0000000-0000-0000-0000-00000000a001', 'a0000000-0000-0000-0000-000000000001', 'Admin Kullanıcı', 'admin', true),
  ('a0000000-0000-0000-0000-00000000a002', 'a0000000-0000-0000-0000-000000000001', 'Öğretmen A', 'teacher', true),
  ('a0000000-0000-0000-0000-00000000a003', 'a0000000-0000-0000-0000-000000000001', 'Öğretmen B', 'teacher', true),
  -- Legacy profil: uygulama artık bu rolü asla üretmez; yalnızca
  -- geçmişten kalmış olabilecek bir satırı simüle etmek için
  -- doğrudan (superuser olarak) ekleniyor.
  ('a0000000-0000-0000-0000-00000000a004', 'a0000000-0000-0000-0000-000000000001', 'Eski Finans Kullanıcı', 'finance', true);

insert into public.courses (id, organization_id, name, course_type, default_monthly_fee)
values ('a0000000-0000-0000-0000-0000000c0001', 'a0000000-0000-0000-0000-000000000001', 'Piyano', 'individual', 1000);

insert into public.class_groups (id, organization_id, course_id, teacher_profile_id, name, weekday, start_time)
values (
  'a0000000-0000-0000-0000-0000000b0001',
  'a0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-0000000c0001',
  'a0000000-0000-0000-0000-00000000a002',
  'Piyano A Grubu', 1, '10:00'
);

insert into public.students (id, organization_id, first_name, last_name)
values ('a0000000-0000-0000-0000-0000000d0001', 'a0000000-0000-0000-0000-000000000001', 'Ali', 'Yılmaz');

insert into public.guardians (id, organization_id, full_name, phone, invoice_title, tax_or_identity_number)
values ('a0000000-0000-0000-0000-0000000f0001', 'a0000000-0000-0000-0000-000000000001', 'Veli Yılmaz', '5551234567', 'Yılmaz Ltd.', '11111111111');

insert into public.student_guardians (student_id, guardian_id, is_primary)
values ('a0000000-0000-0000-0000-0000000d0001', 'a0000000-0000-0000-0000-0000000f0001', true);

insert into public.enrollments (
  id, organization_id, student_id, course_id, class_group_id, teacher_profile_id,
  starts_on, status, list_monthly_fee, discount_type, discount_value, net_monthly_fee
)
values (
  'a0000000-0000-0000-0000-0000000e0001',
  'a0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-0000000d0001',
  'a0000000-0000-0000-0000-0000000c0001',
  'a0000000-0000-0000-0000-0000000b0001',
  'a0000000-0000-0000-0000-00000000a002',
  current_date, 'active', 1000, 'percent', 10, 900
);

-- ---------------------------------------------------------------
-- admin: tam erişim.
-- ---------------------------------------------------------------

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-0000-0000-00000000a001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from public.enrollments),
  1,
  'admin enrollments tablosunu doğrudan görebilir'
);

select is(
  (select count(*)::int from public.guardians),
  1,
  'admin guardians tablosunu doğrudan görebilir'
);

select ok(
  public.can_manage_finance(),
  'admin can_manage_finance() true döner'
);

reset role;

-- ---------------------------------------------------------------
-- Öğretmen A: kendi kaydının sahibi.
-- ---------------------------------------------------------------

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-0000-0000-00000000a002', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from public.enrollments),
  0,
  'teacher enrollments tablosuna doğrudan erişemez (ücret/indirim sütunları içerir)'
);

select is(
  (select count(*)::int from public.guardians),
  0,
  'teacher guardians tablosuna doğrudan erişemez'
);

select is(
  (select count(*)::int from public.get_teacher_enrollments()),
  1,
  'get_teacher_enrollments() öğretmen A için kendi kaydını döner'
);

select is(
  (select student_first_name from public.get_teacher_enrollments() limit 1),
  'Ali',
  'get_teacher_enrollments() öğrenci adını doğru döner'
);

select is(
  (select course_name from public.get_teacher_enrollments() limit 1),
  'Piyano',
  'get_teacher_enrollments() ders adını doğru döner'
);

-- 20260810150000, bu dosyadan sonra eklendi: teacher artık students
-- tablosuna kendi öğrencisi için bile doğrudan erişemez (T.C. no,
-- doğum tarihi, yönetici notu gibi sütunları taşıdığı için). Kendi
-- öğrencisinin adı/durumu yalnızca get_teacher_enrollments() RPC'si
-- üzerinden gelir (yukarıdaki testler). Ayrıntılı kapsam testleri
-- için bkz. role_data_minimization.test.sql.
select is(
  (select count(*)::int from public.students where id = 'a0000000-0000-0000-0000-0000000d0001'),
  0,
  'teacher kendi öğrencisi için bile students tablosuna doğrudan erişemez'
);

select ok(
  not public.can_manage_finance(),
  'teacher can_manage_finance() false döner'
);

reset role;

-- ---------------------------------------------------------------
-- Öğretmen B: bu kayıtların sahibi değil.
-- ---------------------------------------------------------------

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-0000-0000-00000000a003', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from public.get_teacher_enrollments()),
  0,
  'get_teacher_enrollments() başka öğretmenin kaydını döndürmez'
);

reset role;

-- ---------------------------------------------------------------
-- Legacy 'finance' profili: hiçbir ayrıcalığı kalmamalı, otomatik
-- yükseltme/düşürme yapılmamalı.
-- ---------------------------------------------------------------

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-0000-0000-00000000a004', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select ok(
  not public.can_manage_finance(),
  'legacy finance profili can_manage_finance() false döner'
);

select is(
  (select count(*)::int from public.students),
  0,
  'legacy finance profili students tablosunda hiçbir satır göremez'
);

select throws_ok(
  $$ select * from public.get_meb_monthly_roster(current_date) $$,
  'P0001',
  'MEB yoklama listesini görüntüleme yetkiniz bulunmuyor.',
  'legacy finance profili get_meb_monthly_roster() çağıramaz'
);

reset role;

select * from finish();

rollback;
