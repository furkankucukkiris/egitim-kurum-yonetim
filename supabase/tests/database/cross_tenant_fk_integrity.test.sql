-- Çapraz kurum (cross-tenant) referans bütünlüğü testleri
-- (20260814200000_add_cross_tenant_fk_integrity.sql).
--
-- Daha önce her foreign key tek sütunluydu (ör. payments.student_id ->
-- students(id)): bir kaydın organization_id'si A olsa bile, student_id'si
-- B kurumuna ait bir öğrenciyi gösterebiliyordu -- Postgres yalnızca
-- referans verilen satırın var olduğunu doğruluyordu, aynı kuruma ait
-- olduğunu değil. Bu dosya composite FK'lerin (ve organization_id
-- sütunu olmayan iki junction tablo için trigger'ların) bu senaryoyu
-- gerçekten engellediğini doğrular -- RLS'in WITH CHECK'i yalnızca satırın
-- kendi organization_id'sinin çağıranın kurumuyla eşleştiğini kontrol
-- eder, referans verilen yabancı id'nin kurumunu kontrol etmez, o yüzden
-- bu testler admin rolüyle (RLS'i geçerek) çalışır -- asıl savunma FK
-- katmanının kendisidir.
--
-- Çalıştırma: `npx supabase start` sonrasında `npx supabase test db`.

begin;

select plan(6);

delete from public.student_guardians;
delete from public.enrollments;
delete from public.payments;
delete from public.guardians;
delete from public.class_groups;
delete from public.courses;
delete from public.students;
delete from public.profiles;
delete from public.organizations;

insert into public.organizations (id, name)
values
  ('c0000001-0000-0000-0000-000000000001', 'Org 1'),
  ('c0000002-0000-0000-0000-000000000001', 'Org 2');

insert into auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
values
  ('c0000001-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin1@ornek.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

insert into public.profiles (id, organization_id, full_name, role, is_active)
values
  ('c0000001-0000-0000-0000-0000000000a1', 'c0000001-0000-0000-0000-000000000001', 'Admin 1', 'admin', true);

insert into public.courses (id, organization_id, name, course_type, default_monthly_fee)
values
  ('c0000001-0000-0000-0000-0000000c0001', 'c0000001-0000-0000-0000-000000000001', 'Org1 Ders', 'individual', 1000),
  ('c0000002-0000-0000-0000-0000000c0001', 'c0000002-0000-0000-0000-000000000001', 'Org2 Ders', 'individual', 1000);

insert into public.students (id, organization_id, first_name, last_name, identity_number)
values
  ('c0000001-0000-0000-0000-0000000d0001', 'c0000001-0000-0000-0000-000000000001', 'Org1', 'Ogrenci', '11111111110'),
  ('c0000002-0000-0000-0000-0000000d0001', 'c0000002-0000-0000-0000-000000000001', 'Org2', 'Ogrenci', '22222222220');

insert into public.guardians (id, organization_id, full_name, phone, invoice_title, tax_or_identity_number)
values
  ('c0000002-0000-0000-0000-0000000f0001', 'c0000002-0000-0000-0000-000000000001', 'Org2 Veli', '5552220000', 'Org2 Ltd.', '44444444440');

-- ---------------------------------------------------------------
-- admin1 (org1) olarak devam et. RLS WITH CHECK yalnızca
-- organization_id = current_organization_id() olduğunu doğrular; asıl
-- test edilen katman composite FK'ler.
-- ---------------------------------------------------------------

select set_config('request.jwt.claims', json_build_object('sub', 'c0000001-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
-- Bu dosya RLS'i degil, veritabaninin composite FK/trigger butunlugunu
-- sinar. RPC-only tablolara authenticated DML acmamak icin fixture
-- yazmalari migration sahibi rolde birakilir.

-- 1) enrollments: org1 kaydı, org2'nin dersine referans -- engellenmeli.
select throws_ok(
  $$
    insert into public.enrollments (
      organization_id, student_id, course_id, starts_on,
      list_monthly_fee, net_monthly_fee
    ) values (
      'c0000001-0000-0000-0000-000000000001',
      'c0000001-0000-0000-0000-0000000d0001',
      'c0000002-0000-0000-0000-0000000c0001',
      current_date, 1000, 1000
    )
  $$,
  '23503',
  'insert or update on table "enrollments" violates foreign key constraint "enrollments_course_id_fkey"',
  'başka bir organizasyonun dersine kayıt oluşturulamaz (composite FK)'
);

-- 2) enrollments: org1 kaydı, org2'nin öğrencisine referans -- engellenmeli.
select throws_ok(
  $$
    insert into public.enrollments (
      organization_id, student_id, course_id, starts_on,
      list_monthly_fee, net_monthly_fee
    ) values (
      'c0000001-0000-0000-0000-000000000001',
      'c0000002-0000-0000-0000-0000000d0001',
      'c0000001-0000-0000-0000-0000000c0001',
      current_date, 1000, 1000
    )
  $$,
  '23503',
  'insert or update on table "enrollments" violates foreign key constraint "enrollments_student_id_fkey"',
  'başka bir organizasyonun öğrencisine kayıt oluşturulamaz (composite FK)'
);

-- 3) payments: org1 kaydı, org2'nin öğrencisine ödeme -- engellenmeli.
select throws_ok(
  $$
    insert into public.payments (
      organization_id, student_id, amount, method
    ) values (
      'c0000001-0000-0000-0000-000000000001',
      'c0000002-0000-0000-0000-0000000d0001',
      500, 'cash'
    )
  $$,
  '23503',
  'insert or update on table "payments" violates foreign key constraint "payments_student_id_fkey"',
  'başka bir organizasyonun öğrencisine ödeme kaydedilemez (composite FK)'
);

-- 4) student_guardians: org1'in öğrencisi, org2'nin velisi -- engellenmeli
--    (bu tabloda organization_id yok, trigger ile korunuyor).
select throws_ok(
  $$
    insert into public.student_guardians (student_id, guardian_id, is_primary)
    values ('c0000001-0000-0000-0000-0000000d0001', 'c0000002-0000-0000-0000-0000000f0001', true)
  $$,
  'P0001',
  'Öğrenci ve veli farklı kurumlara ait olamaz',
  'öğrenci ve veli farklı kurumlara aitse eşleme oluşturulamaz (trigger)'
);

-- 5) Pozitif kontrol: aynı kurumun dersine kayıt normal şekilde çalışır.
select lives_ok(
  $$
    insert into public.enrollments (
      organization_id, student_id, course_id, starts_on,
      list_monthly_fee, net_monthly_fee
    ) values (
      'c0000001-0000-0000-0000-000000000001',
      'c0000001-0000-0000-0000-0000000d0001',
      'c0000001-0000-0000-0000-0000000c0001',
      current_date, 1000, 1000
    )
  $$,
  'aynı kurumun öğrencisi ve dersiyle kayıt normal şekilde oluşturulabilir'
);

-- 6) Pozitif kontrol: aynı kurumun öğrenci-veli eşlemesi normal çalışır.
insert into public.guardians (id, organization_id, full_name, phone, invoice_title, tax_or_identity_number)
values ('c0000001-0000-0000-0000-0000000f0001', 'c0000001-0000-0000-0000-000000000001', 'Org1 Veli', '5551110000', 'Org1 Ltd.', '33333333330');

select lives_ok(
  $$
    insert into public.student_guardians (student_id, guardian_id, is_primary)
    values ('c0000001-0000-0000-0000-0000000d0001', 'c0000001-0000-0000-0000-0000000f0001', true)
  $$,
  'aynı kurumun öğrenci-veli eşlemesi normal şekilde oluşturulabilir'
);

reset role;

select * from finish();

rollback;
