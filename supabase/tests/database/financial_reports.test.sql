-- /raporlar ekranının iki ayrı raporu için pgTAP testleri
-- (20260811140000): get_accrual_report_monthly,
-- get_accrual_report_by_course, get_cash_flow_report_monthly,
-- get_cash_flow_report_by_method.
--
-- Kurgu (rapor aralığı Temmuz-Eylül 2026):
--   * Tüm kayıtlar Ocak 2026'da başlıyor (starts_on) — tetikleyicinin
--     otomatik oluşturduğu Ocak tahakkuku rapor aralığının dışında
--     kalır, test verisini kirletmez. Temmuz/Ağustos/Eylül tahakkukları
--     elle ekleniyor.
--   * Ali (Resim): Temmuz borcu (1.000) tam kapalı ('paid'). Ödeme
--     Ağustos 5'te alınıyor (cash) — TAHAKKUK raporunda Temmuz'un
--     tahsilatı olarak görünmeli, NAKİT raporunda Ağustos'un girişi
--     olarak. Bu ödemenin 200 TL'si Eylül'de iade ediliyor.
--   * Ayşe (Piyano): Ağustos borcu (1.000) tam kapalı ('paid'),
--     ödeme de Ağustos'ta (bank_transfer) — aynı ay içinde kapanan
--     kontrol senaryosu.
--   * Mehmet (Resim): Temmuz borcu (1.000) hiç ödenmemiş, 'overdue'.
--   * Elif (Resim, students.status = 'left'): Ağustos borcu (1.000)
--     kısmi ödenmiş (300, card) — 'partial'. Öğrenci durumu filtresi
--     'active' seçildiğinde tamamen elenmeli (hem tahakkuk hem nakit
--     tarafında).
--   * Kaan (Resim): Eylül borcu (500), hiç ödenmemiş, 'open'.
--   * Ağustos'ta Resim dersine bağlı 400 TL'lik ödenmiş bir gider.
--
-- Aşağıdaki testler ayrıca "grafik ve tablo toplamları eşleşir"
-- kabul kriterini doğrudan doğrular: aylık kırılımın toplamı, ders/
-- yöntem kırılımının toplamıyla birebir karşılaştırılıyor (aynı satır
-- kümesinden türedikleri için farklı olmaları mümkün değil, ama bu
-- assertion'lar bunu somut biçimde kanıtlıyor).
--
-- Çalıştırma: `npx supabase start` sonrasında `npx supabase test db`.
-- Bu dosya tek bir transaction içinde çalışır ve sonunda rollback
-- edilir. Elle hesaplanan tüm beklenen değerler
-- financial_reports.manual-verification.md dosyasında.

begin;

select plan(35);

-- ---------------------------------------------------------------
-- Fixture kurulumu (superuser olarak).
-- ---------------------------------------------------------------

delete from public.payment_refund_allocations;
delete from public.payment_refunds;
delete from public.payment_allocations;
delete from public.payments;
delete from public.expenses;
delete from public.expense_categories;
delete from public.accruals;
delete from public.enrollments;
delete from public.courses;
delete from public.students;
delete from public.profiles;
delete from public.organizations;

insert into public.organizations (id, name)
values ('b2000000-0000-0000-0000-000000000001', 'Test Kurumu');

insert into auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
values
  ('b2000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@ornek.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('b2000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ogretmen@ornek.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

insert into public.profiles (id, organization_id, full_name, role, is_active)
values
  ('b2000000-0000-0000-0000-0000000000a1', 'b2000000-0000-0000-0000-000000000001', 'Admin', 'admin', true),
  ('b2000000-0000-0000-0000-0000000000a2', 'b2000000-0000-0000-0000-000000000001', 'Öğretmen', 'teacher', true);

insert into public.courses (id, organization_id, name, course_type, default_monthly_fee)
values
  ('b2000000-0000-0000-0000-0000000c0001', 'b2000000-0000-0000-0000-000000000001', 'Resim', 'group', 1000),
  ('b2000000-0000-0000-0000-0000000c0002', 'b2000000-0000-0000-0000-000000000001', 'Piyano', 'individual', 1000);

insert into public.students (id, organization_id, first_name, last_name, status)
values
  ('b2000000-0000-0000-0000-0000000d0001', 'b2000000-0000-0000-0000-000000000001', 'Ali', 'Bir', 'active'),
  ('b2000000-0000-0000-0000-0000000d0002', 'b2000000-0000-0000-0000-000000000001', 'Ayşe', 'Iki', 'active'),
  ('b2000000-0000-0000-0000-0000000d0003', 'b2000000-0000-0000-0000-000000000001', 'Mehmet', 'Uc', 'active'),
  ('b2000000-0000-0000-0000-0000000d0004', 'b2000000-0000-0000-0000-000000000001', 'Elif', 'Dort', 'left'),
  ('b2000000-0000-0000-0000-0000000d0005', 'b2000000-0000-0000-0000-000000000001', 'Kaan', 'Bes', 'active');

-- Hepsi Ocak 2026'da kaydolmuş (tetikleyici Ocak tahakkuku açar —
-- rapor aralığımızın (Temmuz-Eylül) dışında, hesaplara karışmaz).
insert into public.enrollments (id, organization_id, student_id, course_id, teacher_profile_id, starts_on, status, list_monthly_fee, net_monthly_fee)
values
  ('b2000000-0000-0000-0000-0000000e0001', 'b2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-0000000d0001', 'b2000000-0000-0000-0000-0000000c0001', 'b2000000-0000-0000-0000-0000000000a2', date '2026-01-01', 'active', 1000, 1000),
  ('b2000000-0000-0000-0000-0000000e0002', 'b2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-0000000d0002', 'b2000000-0000-0000-0000-0000000c0002', 'b2000000-0000-0000-0000-0000000000a2', date '2026-01-01', 'active', 1000, 1000),
  ('b2000000-0000-0000-0000-0000000e0003', 'b2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-0000000d0003', 'b2000000-0000-0000-0000-0000000c0001', 'b2000000-0000-0000-0000-0000000000a2', date '2026-01-01', 'active', 1000, 1000),
  ('b2000000-0000-0000-0000-0000000e0004', 'b2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-0000000d0004', 'b2000000-0000-0000-0000-0000000c0001', 'b2000000-0000-0000-0000-0000000000a2', date '2026-01-01', 'active', 1000, 1000),
  ('b2000000-0000-0000-0000-0000000e0005', 'b2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-0000000d0005', 'b2000000-0000-0000-0000-0000000c0001', 'b2000000-0000-0000-0000-0000000000a2', date '2026-01-01', 'active', 1000, 1000);

-- Rapor aralığındaki tahakkuklar (elle).
insert into public.accruals (id, organization_id, enrollment_id, student_id, period_start, due_date, description, gross_amount, net_amount, allocated_amount, status)
values
  ('b2000000-0000-0000-0000-0000000f0001', 'b2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-0000000e0001', 'b2000000-0000-0000-0000-0000000d0001', date '2026-07-01', date '2026-07-05', 'Temmuz', 1000, 1000, 1000, 'paid'),
  ('b2000000-0000-0000-0000-0000000f0002', 'b2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-0000000e0002', 'b2000000-0000-0000-0000-0000000d0002', date '2026-08-01', date '2026-08-05', 'Ağustos', 1000, 1000, 1000, 'paid'),
  ('b2000000-0000-0000-0000-0000000f0003', 'b2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-0000000e0003', 'b2000000-0000-0000-0000-0000000d0003', date '2026-07-01', date '2026-07-05', 'Temmuz', 1000, 1000, 0, 'overdue'),
  ('b2000000-0000-0000-0000-0000000f0004', 'b2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-0000000e0004', 'b2000000-0000-0000-0000-0000000d0004', date '2026-08-01', date '2026-08-05', 'Ağustos', 1000, 1000, 300, 'partial'),
  ('b2000000-0000-0000-0000-0000000f0005', 'b2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-0000000e0005', 'b2000000-0000-0000-0000-0000000d0005', date '2026-09-01', date '2026-09-05', 'Eylül', 500, 500, 0, 'open');

-- Ali: Temmuz borcunu Ağustos 5'te öder (cash, Resim).
insert into public.payments (id, organization_id, student_id, course_id, received_at, amount, method)
values ('b2000000-0000-0000-0000-0000000a0001', 'b2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-0000000d0001', 'b2000000-0000-0000-0000-0000000c0001', (date '2026-08-05' + time '10:00') at time zone 'Europe/Istanbul', 1000, 'cash');

insert into public.payment_allocations (organization_id, payment_id, accrual_id, amount)
values ('b2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-0000000a0001', 'b2000000-0000-0000-0000-0000000f0001', 1000);

-- Ali'nin ödemesinden Eylül'de 200 TL iade edilir.
insert into public.payment_refunds (id, organization_id, payment_id, amount, refund_type, reason, created_at)
values ('b2000000-0000-0000-0000-0000000b0001', 'b2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-0000000a0001', 200, 'refund', 'Test iadesi', (date '2026-09-10' + time '10:00') at time zone 'Europe/Istanbul');

-- Ayşe: Ağustos borcunu aynı ay öder (bank_transfer, Piyano).
insert into public.payments (id, organization_id, student_id, course_id, received_at, amount, method)
values ('b2000000-0000-0000-0000-0000000a0002', 'b2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-0000000d0002', 'b2000000-0000-0000-0000-0000000c0002', (date '2026-08-10' + time '10:00') at time zone 'Europe/Istanbul', 1000, 'bank_transfer');

insert into public.payment_allocations (organization_id, payment_id, accrual_id, amount)
values ('b2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-0000000a0002', 'b2000000-0000-0000-0000-0000000f0002', 1000);

-- Elif (left): Ağustos borcuna 300 TL kısmi ödeme (card, Resim).
insert into public.payments (id, organization_id, student_id, course_id, received_at, amount, method)
values ('b2000000-0000-0000-0000-0000000a0004', 'b2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-0000000d0004', 'b2000000-0000-0000-0000-0000000c0001', (date '2026-08-12' + time '10:00') at time zone 'Europe/Istanbul', 300, 'card');

insert into public.payment_allocations (organization_id, payment_id, accrual_id, amount)
values ('b2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-0000000a0004', 'b2000000-0000-0000-0000-0000000f0004', 300);

-- Ağustos'ta Resim'e bağlı, ödenmiş 400 TL'lik gider.
insert into public.expense_categories (id, organization_id, name)
values ('b2000000-0000-0000-0000-0000000c9001', 'b2000000-0000-0000-0000-000000000001', 'Kira');

insert into public.expenses (id, organization_id, category_id, course_id, expense_date, paid_at, amount, status)
values ('b2000000-0000-0000-0000-0000000e9001', 'b2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-0000000c9001', 'b2000000-0000-0000-0000-0000000c0001', date '2026-08-20', (date '2026-08-20' + time '09:00') at time zone 'Europe/Istanbul', 400, 'paid');

-- ---------------------------------------------------------------
-- Admin olarak doğrulama. Rapor aralığı: Temmuz-Eylül 2026.
-- ---------------------------------------------------------------

select set_config('request.jwt.claims', json_build_object('sub', 'b2000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

select has_function('public', 'get_accrual_report_monthly', array['date', 'date', 'uuid', 'text'], 'get_accrual_report_monthly tanımlı');
select has_function('public', 'get_accrual_report_by_course', array['date', 'date', 'uuid', 'text'], 'get_accrual_report_by_course tanımlı');
select has_function('public', 'get_cash_flow_report_monthly', array['date', 'date', 'uuid', 'text', 'text'], 'get_cash_flow_report_monthly tanımlı');
select has_function('public', 'get_cash_flow_report_by_method', array['date', 'date', 'uuid', 'text'], 'get_cash_flow_report_by_method tanımlı');

-- --- Rapor A: Tahakkuk performansı — aylık kırılım (filtresiz) ---

select is(
  (select accrued from public.get_accrual_report_monthly('2026-07-01', '2026-09-01') where month_start = '2026-07-01'),
  2000::numeric, 'Temmuz tahakkuku 2.000 TL (Ali + Mehmet)'
);

select is(
  (select collected from public.get_accrual_report_monthly('2026-07-01', '2026-09-01') where month_start = '2026-07-01'),
  1000::numeric, 'Temmuz tahsilatı 1.000 TL — ödeme Ağustos''ta alınmış olsa da Temmuz''un tahakkuku olarak sayılır'
);

select is(
  (select overdue_amount from public.get_accrual_report_monthly('2026-07-01', '2026-09-01') where month_start = '2026-07-01'),
  1000::numeric, 'Temmuz gecikmiş tutarı 1.000 TL (Mehmet)'
);

select is(
  (select accrued from public.get_accrual_report_monthly('2026-07-01', '2026-09-01') where month_start = '2026-08-01'),
  2000::numeric, 'Ağustos tahakkuku 2.000 TL (Ayşe + Elif)'
);

select is(
  (select partial_amount from public.get_accrual_report_monthly('2026-07-01', '2026-09-01') where month_start = '2026-08-01'),
  700::numeric, 'Ağustos kısmi bakiyesi 700 TL (Elif: 1.000 - 300)'
);

select is(
  (select open_amount from public.get_accrual_report_monthly('2026-07-01', '2026-09-01') where month_start = '2026-09-01'),
  500::numeric, 'Eylül açık tutarı 500 TL (Kaan) — Eylül''deki iade nakit tarafını etkiler, tahakkuk tarafını etkilemez'
);

-- --- Rapor A: öğrenci durumu filtresi (yalnızca 'active') ---

select is(
  (select accrued from public.get_accrual_report_monthly('2026-07-01', '2026-09-01', null, 'active') where month_start = '2026-08-01'),
  1000::numeric, '''active'' filtresiyle Ağustos tahakkuku 1.000 TL — Elif (left) elenir'
);

select is(
  (select partial_amount from public.get_accrual_report_monthly('2026-07-01', '2026-09-01', null, 'active') where month_start = '2026-08-01'),
  0::numeric, '''active'' filtresiyle Ağustos''ta kısmi bakiye kalmaz (Elif elendi)'
);

-- --- Rapor A: ders bazlı kırılım (filtresiz) ---

select is(
  (select accrued from public.get_accrual_report_by_course('2026-07-01', '2026-09-01') where course_id = 'b2000000-0000-0000-0000-0000000c0001'),
  3500::numeric, 'Resim dersi toplam tahakkuku 3.500 TL (Ali+Mehmet+Elif+Kaan)'
);

select is(
  (select collected from public.get_accrual_report_by_course('2026-07-01', '2026-09-01') where course_id = 'b2000000-0000-0000-0000-0000000c0001'),
  1300::numeric, 'Resim dersi toplam tahsilatı 1.300 TL (Ali 1.000 + Elif 300)'
);

select is(
  (select accrued from public.get_accrual_report_by_course('2026-07-01', '2026-09-01') where course_id = 'b2000000-0000-0000-0000-0000000c0002'),
  1000::numeric, 'Piyano dersi toplam tahakkuku 1.000 TL (Ayşe)'
);

select results_eq(
  $$ select sum(accrued) from public.get_accrual_report_by_course('2026-07-01', '2026-09-01') $$,
  $$ select sum(accrued) from public.get_accrual_report_monthly('2026-07-01', '2026-09-01') $$,
  'ders kırılımı toplamı = aylık kırılım toplamı (4.500 TL) — grafik/tablo tutarlılığı'
);

select results_eq(
  $$ select sum(collected) from public.get_accrual_report_by_course('2026-07-01', '2026-09-01') $$,
  $$ select sum(collected) from public.get_accrual_report_monthly('2026-07-01', '2026-09-01') $$,
  'ders kırılımı tahsilat toplamı = aylık kırılım tahsilat toplamı (2.300 TL)'
);

select is(
  (select accrued from public.get_accrual_report_by_course('2026-07-01', '2026-09-01', null, 'active') where course_id = 'b2000000-0000-0000-0000-0000000c0001'),
  2500::numeric, '''active'' filtresiyle Resim tahakkuku 2.500 TL (Elif''in 1.000''i düşer)'
);

-- --- Rapor B: Nakit akışı — aylık kırılım (filtresiz) ---

select is(
  (select cash_in from public.get_cash_flow_report_monthly('2026-07-01', '2026-09-01') where month_start = '2026-07-01'),
  0::numeric, 'Temmuz''da alınan nakit yok'
);

select is(
  (select cash_in from public.get_cash_flow_report_monthly('2026-07-01', '2026-09-01') where month_start = '2026-08-01'),
  2300::numeric, 'Ağustos nakit girişi 2.300 TL (Ali 1.000 + Ayşe 1.000 + Elif 300) — Ali''nin borcu Temmuz''a ait olsa da nakit Ağustos''ta sayılır'
);

select is(
  (select expenses_paid from public.get_cash_flow_report_monthly('2026-07-01', '2026-09-01') where month_start = '2026-08-01'),
  400::numeric, 'Ağustos''ta ödenen gider 400 TL'
);

select is(
  (select net_cash from public.get_cash_flow_report_monthly('2026-07-01', '2026-09-01') where month_start = '2026-08-01'),
  1900::numeric, 'Ağustos net nakit 1.900 TL (2.300 - 0 - 400)'
);

select is(
  (select cash_in from public.get_cash_flow_report_monthly('2026-07-01', '2026-09-01') where month_start = '2026-09-01'),
  0::numeric, 'Eylül''de yeni nakit girişi yok'
);

select is(
  (select refunds from public.get_cash_flow_report_monthly('2026-07-01', '2026-09-01') where month_start = '2026-09-01'),
  200::numeric, 'Eylül iadesi 200 TL — ödeme Ağustos''ta alınmış olsa da iade Eylül''ün nakit çıkışı olarak sayılır'
);

select is(
  (select net_cash from public.get_cash_flow_report_monthly('2026-07-01', '2026-09-01') where month_start = '2026-09-01'),
  -200::numeric, 'Eylül net nakit -200 TL — iade net tahsilatı doğru azaltıyor'
);

-- --- Rapor B: filtreler ---

select is(
  (select cash_in from public.get_cash_flow_report_monthly('2026-07-01', '2026-09-01', null, null, 'active') where month_start = '2026-08-01'),
  2000::numeric, '''active'' filtresiyle Ağustos nakit girişi 2.000 TL — Elif (left) elenir'
);

select is(
  (select cash_in from public.get_cash_flow_report_monthly('2026-07-01', '2026-09-01', 'b2000000-0000-0000-0000-0000000c0001', null, null) where month_start = '2026-08-01'),
  1300::numeric, 'Resim filtresiyle Ağustos nakit girişi 1.300 TL (Ali + Elif, Ayşe/Piyano hariç)'
);

select is(
  (select cash_in from public.get_cash_flow_report_monthly('2026-07-01', '2026-09-01', null, 'cash', null) where month_start = '2026-08-01'),
  1000::numeric, '''cash'' yöntem filtresiyle Ağustos nakit girişi 1.000 TL (yalnızca Ali)'
);

-- --- Rapor B: yöntem bazlı kırılım (filtresiz) ---

select is(
  (select net_cash from public.get_cash_flow_report_by_method('2026-07-01', '2026-09-01') where method = 'cash'),
  800::numeric, '''cash'' yöntemi net 800 TL (1.000 giriş - 200 iade)'
);

select is(
  (select cash_in from public.get_cash_flow_report_by_method('2026-07-01', '2026-09-01') where method = 'card'),
  300::numeric, '''card'' yöntemi girişi 300 TL (Elif)'
);

select is(
  (select payment_count from public.get_cash_flow_report_by_method('2026-07-01', '2026-09-01') where method = 'bank_transfer'),
  1, '''bank_transfer'' yöntemi işlem sayısı 1'
);

select results_eq(
  $$ select sum(cash_in) from public.get_cash_flow_report_by_method('2026-07-01', '2026-09-01') $$,
  $$ select sum(cash_in) from public.get_cash_flow_report_monthly('2026-07-01', '2026-09-01') $$,
  'yöntem kırılımı nakit toplamı = aylık kırılım nakit toplamı (2.300 TL) — grafik/tablo tutarlılığı'
);

select is(
  (select count(*)::integer from public.get_cash_flow_report_by_method('2026-07-01', '2026-09-01', null, 'active') where method = 'card'),
  0, '''active'' filtresiyle ''card'' satırı hiç görünmez (Elif''in tek ödemesi elendi)'
);

reset role;

-- ---------------------------------------------------------------
-- Teacher bu raporları göremez.
-- ---------------------------------------------------------------

select set_config('request.jwt.claims', json_build_object('sub', 'b2000000-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  $$ select * from public.get_accrual_report_monthly('2026-07-01', '2026-09-01') $$,
  'P0001',
  'Bu raporu görüntüleme yetkiniz bulunmuyor.',
  'teacher tahakkuk raporunu göremez'
);

select throws_ok(
  $$ select * from public.get_cash_flow_report_monthly('2026-07-01', '2026-09-01') $$,
  'P0001',
  'Bu raporu görüntüleme yetkiniz bulunmuyor.',
  'teacher nakit akışı raporunu göremez'
);

reset role;

select * from finish();

rollback;
