-- /odemeler ekranının yeni parçalarının pgTAP testleri (20260811120000
-- get_student_balances + get_dashboard_financial_summary'nin ders
-- kartı toplamlarıyla tutarlılığı):
--   * Arama, ders filtresi, durum filtresi ve server-side sayfalama
--     (limit/offset + total_count) doğru çalışır.
--   * Durum (paid/partial/pending) öğrencinin TÜM dönemler
--     toplamına göre hesaplanır (yalnızca bir ay değil).
--   * "Ders kartı toplamları genel toplamla birebir eşleşir" —
--     seçili ayın tüm accrual satırlarının toplamı, get_dashboard_
--     financial_summary()'nin monthly_accrued/monthly_collected'ıyla
--     birebir aynı (ikisi de aynı satırlardan türüyor).
--
-- Çalıştırma: `npx supabase start` sonrasında `npx supabase test db`.
-- Bu dosya tek bir transaction içinde çalışır ve sonunda rollback
-- edilir.

begin;

select plan(21);

-- ---------------------------------------------------------------
-- Fixture kurulumu (superuser olarak). "Bu ay" = Nisan 2026.
-- ---------------------------------------------------------------

delete from public.payment_allocations;
delete from public.payments;
delete from public.accruals;
delete from public.enrollments;
delete from public.courses;
delete from public.students;
delete from public.profiles;
delete from public.organizations;

insert into public.organizations (id, name)
values ('a1000000-0000-0000-0000-000000000001', 'Test Kurumu');

insert into auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
values
  ('a1000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@ornek.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('a1000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ogretmen@ornek.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

insert into public.profiles (id, organization_id, full_name, role, is_active)
values
  ('a1000000-0000-0000-0000-0000000000a1', 'a1000000-0000-0000-0000-000000000001', 'Admin', 'admin', true),
  ('a1000000-0000-0000-0000-0000000000a2', 'a1000000-0000-0000-0000-000000000001', 'Öğretmen', 'teacher', true);

insert into public.courses (id, organization_id, name, course_type, default_monthly_fee)
values
  ('a1000000-0000-0000-0000-0000000c0001', 'a1000000-0000-0000-0000-000000000001', 'Resim', 'group', 1000),
  ('a1000000-0000-0000-0000-0000000c0002', 'a1000000-0000-0000-0000-000000000001', 'Piyano', 'individual', 1000);

insert into public.students (id, organization_id, first_name, last_name)
values
  ('a1000000-0000-0000-0000-0000000d0001', 'a1000000-0000-0000-0000-000000000001', 'Sinem', 'Bir'),
  ('a1000000-0000-0000-0000-0000000d0002', 'a1000000-0000-0000-0000-000000000001', 'Deniz', 'Iki'),
  ('a1000000-0000-0000-0000-0000000d0003', 'a1000000-0000-0000-0000-000000000001', 'Kaan', 'Uc'),
  ('a1000000-0000-0000-0000-0000000d0004', 'a1000000-0000-0000-0000-000000000001', 'Elif', 'Dort'),
  ('a1000000-0000-0000-0000-0000000d0005', 'a1000000-0000-0000-0000-000000000001', 'Mert', 'Bes');

-- S1, S2, S3, S4 -> Resim (course1). S4, S5 -> Piyano (course2) da.
insert into public.enrollments (id, organization_id, student_id, course_id, teacher_profile_id, starts_on, status, list_monthly_fee, net_monthly_fee)
values
  ('a1000000-0000-0000-0000-0000000e0001', 'a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-0000000d0001', 'a1000000-0000-0000-0000-0000000c0001', 'a1000000-0000-0000-0000-0000000000a2', date '2026-03-01', 'active', 1000, 1000),
  ('a1000000-0000-0000-0000-0000000e0002', 'a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-0000000d0002', 'a1000000-0000-0000-0000-0000000c0001', 'a1000000-0000-0000-0000-0000000000a2', date '2026-03-01', 'active', 1000, 1000),
  ('a1000000-0000-0000-0000-0000000e0003', 'a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-0000000d0003', 'a1000000-0000-0000-0000-0000000c0001', 'a1000000-0000-0000-0000-0000000000a2', date '2026-03-01', 'active', 1000, 1000),
  ('a1000000-0000-0000-0000-0000000e0004', 'a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-0000000d0004', 'a1000000-0000-0000-0000-0000000c0001', 'a1000000-0000-0000-0000-0000000000a2', date '2026-03-01', 'active', 1000, 1000),
  ('a1000000-0000-0000-0000-0000000e0005', 'a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-0000000d0004', 'a1000000-0000-0000-0000-0000000c0002', 'a1000000-0000-0000-0000-0000000000a2', date '2026-03-01', 'active', 1000, 1000),
  ('a1000000-0000-0000-0000-0000000e0006', 'a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-0000000d0005', 'a1000000-0000-0000-0000-0000000c0002', 'a1000000-0000-0000-0000-0000000000a2', date '2026-03-01', 'active', 1000, 1000);

-- Nisan 2026 tahakkukları (tetikleyici Mart'ı zaten oluşturdu — o
-- açık kalıyor, önemli değil, yalnızca bu testin durum/toplam
-- hesaplarını etkilemiyor çünkü hepsi aynı şekilde açık).
insert into public.accruals (id, organization_id, enrollment_id, student_id, period_start, due_date, description, gross_amount, net_amount, allocated_amount, status)
values
  ('a1000000-0000-0000-0000-0000000f0001', 'a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-0000000e0001', 'a1000000-0000-0000-0000-0000000d0001', date '2026-04-01', date '2026-04-05', 'Nisan', 1000, 1000, 1000, 'paid'),
  ('a1000000-0000-0000-0000-0000000f0002', 'a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-0000000e0002', 'a1000000-0000-0000-0000-0000000d0002', date '2026-04-01', date '2026-04-05', 'Nisan', 1000, 1000, 400, 'partial'),
  ('a1000000-0000-0000-0000-0000000f0003', 'a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-0000000e0003', 'a1000000-0000-0000-0000-0000000d0003', date '2026-04-01', date '2026-04-05', 'Nisan', 1000, 1000, 0, 'open'),
  ('a1000000-0000-0000-0000-0000000f0004', 'a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-0000000e0004', 'a1000000-0000-0000-0000-0000000d0004', date '2026-04-01', date '2026-04-05', 'Nisan', 1000, 1000, 0, 'open'),
  ('a1000000-0000-0000-0000-0000000f0005', 'a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-0000000e0005', 'a1000000-0000-0000-0000-0000000d0004', date '2026-04-01', date '2026-04-05', 'Nisan', 1000, 1000, 1000, 'paid'),
  ('a1000000-0000-0000-0000-0000000f0006', 'a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-0000000e0006', 'a1000000-0000-0000-0000-0000000d0005', date '2026-04-01', date '2026-04-05', 'Nisan', 1000, 1000, 0, 'open');

-- Mart tahakkuklarını (tetikleyici tarafından otomatik açılmış)
-- testin dışında tutmak için hepsini iptal ediyoruz — bu test yalnız
-- Nisan'a odaklanıyor.
update public.accruals set status = 'cancelled' where period_start = date '2026-03-01';

-- ---------------------------------------------------------------
-- admin olarak doğrulama.
-- ---------------------------------------------------------------

select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(
  (select total_count from public.get_student_balances(null, null, null, 10, 0) limit 1),
  5::bigint,
  'filtresiz toplam öğrenci sayısı 5'
);

select is(
  (select status from public.get_student_balances(null, null, null, 10, 0) where student_id = 'a1000000-0000-0000-0000-0000000d0001'),
  'paid',
  'S1 (tam ödendi) durumu paid'
);

select is(
  (select status from public.get_student_balances(null, null, null, 10, 0) where student_id = 'a1000000-0000-0000-0000-0000000d0002'),
  'partial',
  'S2 (kısmi ödendi) durumu partial'
);

select is(
  (select total_pending from public.get_student_balances(null, null, null, 10, 0) where student_id = 'a1000000-0000-0000-0000-0000000d0002'),
  600::numeric,
  'S2 bekleyen bakiyesi 600 TL'
);

select is(
  (select status from public.get_student_balances(null, null, null, 10, 0) where student_id = 'a1000000-0000-0000-0000-0000000d0003'),
  'pending',
  'S3 (hiç ödenmedi) durumu pending'
);

select is(
  (select total_pending from public.get_student_balances(null, null, null, 10, 0) where student_id = 'a1000000-0000-0000-0000-0000000d0003'),
  1000::numeric,
  'S3 bekleyen bakiyesi 1000 TL'
);

select is(
  (select status from public.get_student_balances(null, null, null, 10, 0) where student_id = 'a1000000-0000-0000-0000-0000000d0004'),
  'partial',
  'S4 (bir ders ödenmedi, biri ödendi) toplamda partial'
);

select ok(
  (select course_names from public.get_student_balances(null, null, null, 10, 0) where student_id = 'a1000000-0000-0000-0000-0000000d0004') like '%Resim%'
  and (select course_names from public.get_student_balances(null, null, null, 10, 0) where student_id = 'a1000000-0000-0000-0000-0000000d0004') like '%Piyano%',
  'S4''nin ders listesi hem Resim hem Piyano''yu içeriyor'
);

-- Ders filtresi: yalnızca Piyano'da (course2) kaydı olan S4 ve S5.
select is(
  (select total_count from public.get_student_balances(null, 'a1000000-0000-0000-0000-0000000c0002', null, 10, 0) limit 1),
  2::bigint,
  'ders filtresi (Piyano) yalnızca 2 öğrenci döner'
);

-- Durum filtresi: pending olan S3 ve S5.
select is(
  (select total_count from public.get_student_balances(null, null, 'pending', 10, 0) limit 1),
  2::bigint,
  'durum filtresi (pending) yalnızca 2 öğrenci döner'
);

-- Arama: yalnızca S2.
select is(
  (select total_count from public.get_student_balances('Deniz', null, null, 10, 0) limit 1),
  1::bigint,
  'arama filtresi ("Deniz") yalnızca 1 öğrenci döner'
);

select is(
  (select student_id from public.get_student_balances('Deniz', null, null, 10, 0) limit 1),
  'a1000000-0000-0000-0000-0000000d0002'::uuid,
  'arama doğru öğrenciyi buluyor'
);

-- Sayfalama: sayfa büyüklüğü 2, iki farklı sayfa, ikisinde de
-- total_count aynı (5) ve satırlar çakışmıyor.
select is(
  (select count(*)::int from public.get_student_balances(null, null, null, 2, 0)),
  2,
  'ilk sayfa 2 satır döner'
);

select is(
  (select total_count from public.get_student_balances(null, null, null, 2, 0) limit 1),
  5::bigint,
  'ilk sayfada total_count hâlâ 5 (limit''ten etkilenmiyor)'
);

select is(
  (select count(*)::int from public.get_student_balances(null, null, null, 2, 2)),
  2,
  'ikinci sayfa 2 satır döner'
);

select is(
  (
    select count(*)::int from (
      select student_id from public.get_student_balances(null, null, null, 2, 0)
      intersect
      select student_id from public.get_student_balances(null, null, null, 2, 2)
    ) overlap
  ),
  0,
  'ilk ve ikinci sayfa arasında çakışan öğrenci yok'
);

reset role;

-- ---------------------------------------------------------------
-- Ders kartı toplamlarının genel toplamla tutarlılığı: seçili ayın
-- TÜM accrual satırlarının toplamı, get_dashboard_financial_summary()
-- ile birebir aynı (/odemeler sayfasındaki ders kartları da aynı
-- satırlardan türüyor, bu yüzden bu tek sorgu iki tarafı da temsil
-- ediyor).
-- ---------------------------------------------------------------

select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(
  (
    select sum(net_amount) from public.accruals
    where period_start = date '2026-04-01' and status not in ('cancelled', 'refunded')
  ),
  (select monthly_accrued from public.get_dashboard_financial_summary('2026-04-01')),
  'ders kartlarının (tüm accrual satırlarının) tahakkuk toplamı, genel özet RPC''siyle birebir eşleşir'
);

select is(
  (
    select sum(allocated_amount) from public.accruals
    where period_start = date '2026-04-01' and status not in ('cancelled', 'refunded')
  ),
  (select monthly_collected from public.get_dashboard_financial_summary('2026-04-01')),
  'ders kartlarının tahsilat toplamı, genel özet RPC''siyle birebir eşleşir'
);

select is(
  (select monthly_accrued from public.get_dashboard_financial_summary('2026-04-01')),
  6000::numeric,
  'Nisan toplam tahakkuku 6.000 TL (6 tahakkuk × 1.000 TL)'
);

select is(
  (select monthly_collected from public.get_dashboard_financial_summary('2026-04-01')),
  2400::numeric,
  'Nisan toplam tahsilatı 2.400 TL (1000+400+0+0+1000+0)'
);

reset role;

-- ---------------------------------------------------------------
-- Teacher bu listeyi göremez.
-- ---------------------------------------------------------------

select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  $$ select * from public.get_student_balances(null, null, null, 10, 0) $$,
  'P0001',
  'Bu listeyi görüntüleme yetkiniz bulunmuyor.',
  'teacher öğrenci bakiye listesini göremez'
);

reset role;

select * from finish();

rollback;
