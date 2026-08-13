-- Dashboard finans özeti pgTAP testleri (20260811110000).
--
-- Kurgu (Nisan 2026 = "bu ay", Mart 2026 = "önceki dönem"):
--   * 20 öğrenci course1'e Mart 2026'da kaydolmuş (tetikleyici her
--     biri için otomatik Mart tahakkuku oluşturur), Nisan tahakkuku
--     elle ekleniyor.
--   * Öğrenci 1 (Ali): Mart borcunu Nisan'da tamamen öder — Mart
--     artık devretmemeli, ödeme Nisan nakit akışında görünmeli ama
--     Nisan tahsilatına sayılmamalı (geçmiş ay borcunun bu ay
--     ödenmesi testi).
--   * Öğrenci 2 (Ayşe): yalnızca kendi Nisan borcunu Nisan'da öder.
--   * Öğrenci 3 (Mehmet): Mart+Nisan borcunun toplamından 500 TL
--     fazla öder — fazlalık avans olmalı, tahsilata sayılmamalı.
--   * Öğrenci 4: Nisan borcunu öder ama ödeme iade edilir
--     (is_refunded) — nakit akışı ve avans toplamından düşmeli.
--   * Öğrenci 5-20 (16 kişi): hem Mart hem Nisan borcu tamamen açık.
--   * Ayrı bir öğrencinin Nisan tahakkuku 'cancelled' — hiçbir
--     toplama dahil olmamalı.
--   * Bir "left" (ayrılmış) öğrenci aktif öğrenci sayısına girmemeli.
--
-- Çalıştırma: `npx supabase start` sonrasında `npx supabase test db`.
-- Bu dosya tek bir transaction içinde çalışır ve sonunda rollback
-- edilir.

begin;

select plan(16);

-- ---------------------------------------------------------------
-- Fixture kurulumu (superuser olarak).
-- ---------------------------------------------------------------

delete from public.payment_allocations;
delete from public.payments;
delete from public.accruals;
delete from public.attendance;
delete from public.lesson_sessions;
delete from public.enrollments;
delete from public.class_groups;
delete from public.courses;
delete from public.students;
delete from public.profiles;
delete from public.organizations;

insert into public.organizations (id, name)
values ('f0000000-0000-0000-0000-000000000001', 'Test Kurumu');

insert into auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
values
  ('f0000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@ornek.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('f0000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ogretmen@ornek.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

insert into public.profiles (id, organization_id, full_name, role, is_active)
values
  ('f0000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-000000000001', 'Admin', 'admin', true),
  ('f0000000-0000-0000-0000-0000000000a2', 'f0000000-0000-0000-0000-000000000001', 'Öğretmen', 'teacher', true);

insert into public.courses (id, organization_id, name, course_type, default_monthly_fee)
values ('f0000000-0000-0000-0000-0000000c0001', 'f0000000-0000-0000-0000-000000000001', 'Resim', 'group', 1000);

insert into public.class_groups (id, organization_id, course_id, teacher_profile_id, name, weekday, start_time, capacity)
values ('f0000000-0000-0000-0000-0000000b0001', 'f0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-0000000c0001', 'f0000000-0000-0000-0000-0000000000a2', 'Resim A Grubu', 1, '10:00', 30);

-- 20 öğrenci: student 1-4 özel senaryolar, 5-20 tamamen açık.
insert into public.students (id, organization_id, first_name, last_name)
select
  ('f0000000-0000-0000-0000-00000000d' || lpad(n::text, 3, '0'))::uuid,
  'f0000000-0000-0000-0000-000000000001',
  'Öğrenci', n::text
from generate_series(1, 20) as n;

-- Hepsi Mart 2026'da kaydolmuş — tetikleyici (create_initial_accrual_
-- for_enrollment) her biri için otomatik olarak Mart tahakkuku açar.
insert into public.enrollments (
  id, organization_id, student_id, course_id, class_group_id, teacher_profile_id,
  starts_on, status, list_monthly_fee, net_monthly_fee
)
select
  ('f0000000-0000-0000-0000-00000000e' || lpad(n::text, 3, '0'))::uuid,
  'f0000000-0000-0000-0000-000000000001',
  ('f0000000-0000-0000-0000-00000000d' || lpad(n::text, 3, '0'))::uuid,
  'f0000000-0000-0000-0000-0000000c0001',
  'f0000000-0000-0000-0000-0000000b0001',
  'f0000000-0000-0000-0000-0000000000a2',
  date '2026-03-01', 'active', 1000, 1000
from generate_series(1, 20) as n;

-- Nisan 2026 tahakkukları (elle — generate_monthly_accruals yerine
-- doğrudan, test kurgusunu tam kontrol etmek için).
insert into public.accruals (
  id, organization_id, enrollment_id, student_id, period_start, due_date,
  description, gross_amount, net_amount, status
)
select
  ('f0000000-0000-0000-0000-00000001a' || lpad(n::text, 3, '0'))::uuid,
  'f0000000-0000-0000-0000-000000000001',
  ('f0000000-0000-0000-0000-00000000e' || lpad(n::text, 3, '0'))::uuid,
  ('f0000000-0000-0000-0000-00000000d' || lpad(n::text, 3, '0'))::uuid,
  date '2026-04-01', date '2026-04-05', 'Nisan 2026 aidatı', 1000, 1000, 'open'
from generate_series(1, 20) as n;

-- Ayrı: Nisan tahakkuku iptal edilmiş bir öğrenci — hiçbir toplama
-- dahil olmamalı.
insert into public.students (id, organization_id, first_name, last_name)
values ('f0000000-0000-0000-0000-00000000d900', 'f0000000-0000-0000-0000-000000000001', 'İptal', 'Testi');

insert into public.enrollments (id, organization_id, student_id, course_id, class_group_id, teacher_profile_id, starts_on, status, list_monthly_fee, net_monthly_fee)
values ('f0000000-0000-0000-0000-00000000e900', 'f0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000d900', 'f0000000-0000-0000-0000-0000000c0001', 'f0000000-0000-0000-0000-0000000b0001', 'f0000000-0000-0000-0000-0000000000a2', date '2026-04-01', 'active', 1000, 1000);

update public.accruals
set status = 'cancelled'
where enrollment_id = 'f0000000-0000-0000-0000-00000000e900'
  and period_start = date '2026-04-01';

-- Ayrılmış (left) bir öğrenci — aktif öğrenci sayısına girmemeli.
insert into public.students (id, organization_id, first_name, last_name, status)
values ('f0000000-0000-0000-0000-00000000d901', 'f0000000-0000-0000-0000-000000000001', 'Ayrılan', 'Öğrenci', 'left');

-- ---------------------------------------------------------------
-- Öğrenci 1 (Ali): Mart borcunu Nisan'da tam kapatır.
-- ---------------------------------------------------------------

insert into public.payments (id, organization_id, student_id, received_at, amount, method, is_refunded)
values ('f0000000-0000-0000-0000-00000002a001', 'f0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000d001', (date '2026-04-05' + time '10:00') at time zone 'Europe/Istanbul', 1000, 'cash', false);

insert into public.payment_allocations (organization_id, payment_id, accrual_id, amount)
select 'f0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000002a001', a.id, 1000
from public.accruals a
where a.enrollment_id = 'f0000000-0000-0000-0000-00000000e001' and a.period_start = date '2026-03-01';

update public.accruals set allocated_amount = 1000, status = 'paid'
where enrollment_id = 'f0000000-0000-0000-0000-00000000e001' and period_start = date '2026-03-01';

-- ---------------------------------------------------------------
-- Öğrenci 2 (Ayşe): yalnızca Nisan'ın kendi borcunu Nisan'da öder.
-- ---------------------------------------------------------------

insert into public.payments (id, organization_id, student_id, received_at, amount, method, is_refunded)
values ('f0000000-0000-0000-0000-00000002a002', 'f0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000d002', (date '2026-04-10' + time '10:00') at time zone 'Europe/Istanbul', 1000, 'cash', false);

insert into public.payment_allocations (organization_id, payment_id, accrual_id, amount)
select 'f0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000002a002', a.id, 1000
from public.accruals a
where a.enrollment_id = 'f0000000-0000-0000-0000-00000000e002' and a.period_start = date '2026-04-01';

update public.accruals set allocated_amount = 1000, status = 'paid'
where enrollment_id = 'f0000000-0000-0000-0000-00000000e002' and period_start = date '2026-04-01';

-- ---------------------------------------------------------------
-- Öğrenci 3 (Mehmet): Mart+Nisan'ı kapatır, 500 TL fazla öder (avans).
-- ---------------------------------------------------------------

insert into public.payments (id, organization_id, student_id, received_at, amount, method, is_refunded)
values ('f0000000-0000-0000-0000-00000002a003', 'f0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000d003', (date '2026-04-15' + time '10:00') at time zone 'Europe/Istanbul', 2500, 'cash', false);

insert into public.payment_allocations (organization_id, payment_id, accrual_id, amount)
select 'f0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000002a003', a.id, 1000
from public.accruals a
where a.enrollment_id = 'f0000000-0000-0000-0000-00000000e003' and a.period_start in (date '2026-03-01', date '2026-04-01');

update public.accruals set allocated_amount = 1000, status = 'paid'
where enrollment_id = 'f0000000-0000-0000-0000-00000000e003' and period_start in (date '2026-03-01', date '2026-04-01');

-- ---------------------------------------------------------------
-- Öğrenci 4: Nisan borcunu öder, ödeme iade edilir.
-- ---------------------------------------------------------------

insert into public.payments (id, organization_id, student_id, received_at, amount, method, is_refunded)
values ('f0000000-0000-0000-0000-00000002a004', 'f0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000d004', (date '2026-04-08' + time '10:00') at time zone 'Europe/Istanbul', 1000, 'cash', true);

insert into public.payment_allocations (organization_id, payment_id, accrual_id, amount)
select 'f0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000002a004', a.id, 1000
from public.accruals a
where a.enrollment_id = 'f0000000-0000-0000-0000-00000000e004' and a.period_start = date '2026-04-01';

update public.accruals set allocated_amount = 1000, status = 'paid'
where enrollment_id = 'f0000000-0000-0000-0000-00000000e004' and period_start = date '2026-04-01';

-- ---------------------------------------------------------------
-- Bugünkü ders oturumları: biri aktif, biri iptal.
-- ---------------------------------------------------------------

insert into public.lesson_sessions (id, organization_id, class_group_id, course_id, teacher_profile_id, starts_at, ends_at)
values (
  'f0000000-0000-0000-0000-00000003a001', 'f0000000-0000-0000-0000-000000000001',
  'f0000000-0000-0000-0000-0000000b0001', 'f0000000-0000-0000-0000-0000000c0001', 'f0000000-0000-0000-0000-0000000000a2',
  pg_catalog.now(), pg_catalog.now() + interval '1 hour'
);

insert into public.lesson_sessions (id, organization_id, class_group_id, course_id, teacher_profile_id, starts_at, ends_at, cancelled_at, cancellation_reason)
values (
  'f0000000-0000-0000-0000-00000003a002', 'f0000000-0000-0000-0000-000000000001',
  'f0000000-0000-0000-0000-0000000b0001', 'f0000000-0000-0000-0000-0000000c0001', 'f0000000-0000-0000-0000-0000000000a2',
  pg_catalog.now() + interval '2 hour', pg_catalog.now() + interval '3 hour',
  pg_catalog.now(), 'Test iptali'
);

-- ---------------------------------------------------------------
-- Doğrulama: admin olarak get_dashboard_financial_summary('2026-04-01').
-- ---------------------------------------------------------------

select set_config('request.jwt.claims', json_build_object('sub', 'f0000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

select has_function('public', 'get_dashboard_financial_summary', array['date'], 'get_dashboard_financial_summary(date) tanımlı');
select has_function('public', 'get_dashboard_course_performance', array['date'], 'get_dashboard_course_performance(date) tanımlı');

select is(
  (select active_student_count from public.get_dashboard_financial_summary('2026-04-01')),
  21,
  'aktif öğrenci sayısı 21 (ayrılan öğrenci hariç)'
);

select is(
  (select prior_period_carryover_count from public.get_dashboard_financial_summary('2026-04-01')),
  18,
  'devreden borç dönem sayısı: 20 öğrenciden Mart borcu açık olan 18''i (1 ve 3 kapatıldı)'
);

select is(
  (select prior_period_carryover from public.get_dashboard_financial_summary('2026-04-01')),
  18000::numeric,
  'devreden borç tutarı 18.000 TL — aynı derste 18 borçlu öğrenci ayrı ayrı sayılıyor (course_id+period_start çakışması yok)'
);

select is(
  (select monthly_accrued from public.get_dashboard_financial_summary('2026-04-01')),
  20000::numeric,
  'bu ay tahakkuk eden 20.000 TL (iptal edilen tahakkuk hariç)'
);

select is(
  (select monthly_collected from public.get_dashboard_financial_summary('2026-04-01')),
  3000::numeric,
  'bu ayın tahakkuklarından tahsil edilen yalnızca Nisan''a tahsis edilen tutar (Mart''a giden ödemeler hariç)'
);

select is(
  (select monthly_cash_received from public.get_dashboard_financial_summary('2026-04-01')),
  4500::numeric,
  'bu ay kasaya giren nakit — iade edilen ödeme hariç, hangi döneme tahsis edildiğinden bağımsız'
);

select is(
  (select total_open_receivable from public.get_dashboard_financial_summary('2026-04-01')),
  35000::numeric,
  'toplam açık alacak (devreden + bu ayın kendi bakiyesi) 35.000 TL'
);

select is(
  (select total_open_receivable_count from public.get_dashboard_financial_summary('2026-04-01')),
  35,
  'toplam açık alacak dönem sayısı 35'
);

select is(
  (select student_advance_balance from public.get_dashboard_financial_summary('2026-04-01')),
  500::numeric,
  'öğrenci avans/bakiyesi 500 TL — fazla ödeme açık alacak tahsilatına karışmıyor'
);

select is(
  (select today_active_session_count from public.get_dashboard_financial_summary('2026-04-01')),
  1,
  'bugünkü aktif ders sayısı iptal edileni saymıyor'
);

select is(
  (select today_total_session_count from public.get_dashboard_financial_summary('2026-04-01')),
  2,
  'bugünkü toplam oturum sayısı iptali de içeriyor'
);

select is(
  (select month_net from public.get_dashboard_course_performance('2026-04-01') where course_id = 'f0000000-0000-0000-0000-0000000c0001'),
  20000::numeric,
  'ders performansı: Resim dersinin Nisan tahakkuku 20.000 TL'
);

select is(
  (select month_collected from public.get_dashboard_course_performance('2026-04-01') where course_id = 'f0000000-0000-0000-0000-0000000c0001'),
  3000::numeric,
  'ders performansı: Resim dersinin Nisan tahsilatı 3.000 TL'
);

reset role;

-- ---------------------------------------------------------------
-- Teacher bu özeti göremez.
-- ---------------------------------------------------------------

select set_config('request.jwt.claims', json_build_object('sub', 'f0000000-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  $$ select * from public.get_dashboard_financial_summary('2026-04-01') $$,
  'P0001',
  'Bu özeti görüntüleme yetkiniz bulunmuyor.',
  'teacher dashboard finans özetini göremez'
);

reset role;

select * from finish();

rollback;
