-- Ödeme düzeltme/iade/avans pgTAP testleri (20260811130000):
--   * Kısmi iade önce ödemenin dağıtılmamış (avans) kısmından düşer;
--     yalnızca o yetmezse en yeni dönemden başlayarak tahsisler geri
--     alınır ve accrual open/partial/paid arasında doğru geçiş yapar.
--   * Aynı ödeme için toplam iade, ödeme tutarını aşamaz.
--   * Avans, admin onayıyla belirli bir tahakkuka uygulanır; hedef
--     tahakkukun bekleyeninde ve ödemenin avansında kapanır (aşarsa
--     otomatik sınırlanır), başka öğrencinin tahakkukuna uygulanamaz.
--   * Makbuz numarası her ödemede üretilir ve tekildir.
--   * Teacher bu verilerin hiçbirine hiçbir şekilde erişemez.
--   * Her işlem audit_logs'a yazılır.
--
-- Not (concurrency): pgTAP tek oturumda çalıştığından gerçek eşzamanlı
-- iki transaction'ı bu dosyada başlatmak mümkün değil. Bunun yerine,
-- "aynı ödeme için art arda iki iade, ikincisi toplamı aşarsa
-- reddedilir" senaryosu sıralı olarak test ediliyor — asıl güvenlik
-- mekanizması (payments satırının FOR UPDATE ile kilitlenmesi,
-- record_payment_for_course'da zaten kullanılan aynı desen) eşzamanlı
-- çağrılarda da aynı şekilde çalışır: ikinci transaction, birincinin
-- commit'inden sonra güncel toplam iade tutarını görür.
--
-- Çalıştırma: `npx supabase start` sonrasında `npx supabase test db`.
-- Bu dosya tek bir transaction içinde çalışır ve sonunda rollback
-- edilir.

begin;

select plan(33);

-- ---------------------------------------------------------------
-- Fixture kurulumu (superuser olarak).
-- ---------------------------------------------------------------

delete from public.audit_logs;
delete from public.payment_refund_allocations;
delete from public.payment_refunds;
delete from public.payment_allocations;
delete from public.payments;
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
values ('b2000000-0000-0000-0000-0000000c0001', 'b2000000-0000-0000-0000-000000000001', 'Resim', 'group', 1000);

insert into public.students (id, organization_id, first_name, last_name)
values
  ('b2000000-0000-0000-0000-0000000d0001', 'b2000000-0000-0000-0000-000000000001', 'Sinem', 'Bir'),
  ('b2000000-0000-0000-0000-0000000d0002', 'b2000000-0000-0000-0000-000000000001', 'Deniz', 'Iki'),
  ('b2000000-0000-0000-0000-0000000d0003', 'b2000000-0000-0000-0000-000000000001', 'Kaan', 'Uc');

insert into public.enrollments (id, organization_id, student_id, course_id, teacher_profile_id, starts_on, status, list_monthly_fee, net_monthly_fee)
values
  ('b2000000-0000-0000-0000-0000000e0001', 'b2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-0000000d0001', 'b2000000-0000-0000-0000-0000000c0001', 'b2000000-0000-0000-0000-0000000000a2', date '2026-03-01', 'active', 1000, 1000),
  ('b2000000-0000-0000-0000-0000000e0002', 'b2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-0000000d0002', 'b2000000-0000-0000-0000-0000000c0001', 'b2000000-0000-0000-0000-0000000000a2', date '2026-03-01', 'active', 1000, 1000),
  ('b2000000-0000-0000-0000-0000000e0003', 'b2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-0000000d0003', 'b2000000-0000-0000-0000-0000000c0001', 'b2000000-0000-0000-0000-0000000000a2', date '2026-03-01', 'active', 1000, 1000);

-- Tetikleyicinin otomatik açtığı Mart tahakkuklarını bu testin
-- dışında tutmak için iptal ediyoruz.
update public.accruals set status = 'cancelled' where period_start = date '2026-03-01';

-- Sinem: Nisan + Mayıs tahakkukları, ikisi de bir sonraki payment ile
-- tamamen ödenecek.
insert into public.accruals (id, organization_id, enrollment_id, student_id, period_start, due_date, description, gross_amount, net_amount, allocated_amount, status)
values
  ('b2000000-0000-0000-0000-0000000f0001', 'b2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-0000000e0001', 'b2000000-0000-0000-0000-0000000d0001', date '2026-04-01', date '2026-04-05', 'Nisan', 1000, 1000, 0, 'open'),
  ('b2000000-0000-0000-0000-0000000f0002', 'b2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-0000000e0001', 'b2000000-0000-0000-0000-0000000d0001', date '2026-05-01', date '2026-05-05', 'Mayıs', 1000, 1000, 0, 'open');

-- Deniz: Haziran tahakkuku, ilk başta hiç ödeme almadı — avans
-- dağıtımı testinde kullanılacak.
insert into public.accruals (id, organization_id, enrollment_id, student_id, period_start, due_date, description, gross_amount, net_amount, allocated_amount, status)
values ('b2000000-0000-0000-0000-0000000f0003', 'b2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-0000000e0002', 'b2000000-0000-0000-0000-0000000d0002', date '2026-06-01', date '2026-06-05', 'Haziran', 1000, 1000, 0, 'open');

-- Kaan: farklı öğrenci, çapraz-öğrenci avans kontrolü için.
insert into public.accruals (id, organization_id, enrollment_id, student_id, period_start, due_date, description, gross_amount, net_amount, allocated_amount, status)
values ('b2000000-0000-0000-0000-0000000f0004', 'b2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-0000000e0003', 'b2000000-0000-0000-0000-0000000d0003', date '2026-06-01', date '2026-06-05', 'Haziran', 1000, 1000, 0, 'open');

-- Sinem'in ödemesi: 2.500 TL, Nisan+Mayıs'ı tam kapatıyor, 500 TL
-- avans olarak dağıtılmamış kalıyor (record_payment_for_course'un
-- yapacağı gibi, ama tarih kontrolü için elle kurgulandı).
insert into public.payments (id, organization_id, student_id, course_id, received_at, amount, method, recorded_by)
values ('b2000000-0000-0000-0000-0000000a0001', 'b2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-0000000d0001', 'b2000000-0000-0000-0000-0000000c0001', now(), 2500, 'cash', 'b2000000-0000-0000-0000-0000000000a1');

insert into public.payment_allocations (organization_id, payment_id, accrual_id, amount)
values
  ('b2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-0000000a0001', 'b2000000-0000-0000-0000-0000000f0001', 1000),
  ('b2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-0000000a0001', 'b2000000-0000-0000-0000-0000000f0002', 1000);

update public.accruals set allocated_amount = 1000, status = 'paid'
where id in ('b2000000-0000-0000-0000-0000000f0001', 'b2000000-0000-0000-0000-0000000f0002');

-- Deniz'in ödemesi: 1.000 TL, hiçbir tahakkuka henüz tahsis edilmedi
-- (tamamı avans) — avans dağıtım testinde kullanılacak.
insert into public.payments (id, organization_id, student_id, course_id, received_at, amount, method, recorded_by)
values ('b2000000-0000-0000-0000-0000000a0002', 'b2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-0000000d0002', 'b2000000-0000-0000-0000-0000000c0001', now(), 1000, 'cash', 'b2000000-0000-0000-0000-0000000000a1');

-- ---------------------------------------------------------------
-- admin: iade senaryosu (Senaryo A).
-- ---------------------------------------------------------------

select set_config('request.jwt.claims', json_build_object('sub', 'b2000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

-- İade #1 (300 TL): tamamı avanstan (500 TL) düşer, tahakkuklara
-- dokunmaz.
select lives_ok(
  $$ select public.refund_payment('b2000000-0000-0000-0000-0000000a0001', 300, 'test iade 1', 'refund') $$,
  'ilk kısmi iade (avans içinde) kaydedilebilir'
);

select is(
  (select allocated_amount from public.accruals where id = 'b2000000-0000-0000-0000-0000000f0001'),
  1000::numeric,
  'iade #1 sonrası Nisan tahakkuku değişmedi (avanstan karşılandı)'
);

select is(
  (select allocated_amount from public.accruals where id = 'b2000000-0000-0000-0000-0000000f0002'),
  1000::numeric,
  'iade #1 sonrası Mayıs tahakkuku değişmedi (avanstan karşılandı)'
);

select is(
  (select unallocated_total from public.get_payment_detail('b2000000-0000-0000-0000-0000000a0001')),
  200::numeric,
  'iade #1 sonrası kalan avans 200 TL'
);

-- İade #2 (400 TL): 200 TL kalan avanstan, 200 TL de en yeni dönemden
-- (Mayıs) tahsis geri alınarak karşılanır.
select lives_ok(
  $$ select public.refund_payment('b2000000-0000-0000-0000-0000000a0001', 400, 'test iade 2', 'refund') $$,
  'ikinci kısmi iade (avans + en yeni dönem) kaydedilebilir'
);

select is(
  (select allocated_amount from public.accruals where id = 'b2000000-0000-0000-0000-0000000f0002'),
  800::numeric,
  'iade #2 sonrası Mayıs tahakkuku 800 TL''ye düştü'
);

select is(
  (select status from public.accruals where id = 'b2000000-0000-0000-0000-0000000f0002'),
  'partial',
  'iade #2 sonrası Mayıs tahakkuku partial durumuna döndü'
);

select is(
  (select allocated_amount from public.accruals where id = 'b2000000-0000-0000-0000-0000000f0001'),
  1000::numeric,
  'iade #2, en eski dönem olan Nisan''a dokunmadı'
);

select is(
  (select status from public.accruals where id = 'b2000000-0000-0000-0000-0000000f0001'),
  'paid',
  'Nisan tahakkuku hâlâ paid'
);

-- İade #3 (1900 TL): kalan iade edilebilir tutar 1800 TL, bu yüzden
-- reddedilmeli — "aynı ödeme için toplam iade, ödeme tutarını aşamaz."
select throws_ok(
  $$ select public.refund_payment('b2000000-0000-0000-0000-0000000a0001', 1900, 'aşırı iade denemesi', 'refund') $$,
  'P0001',
  'İade tutarı, ödemenin kalan iade edilebilir tutarını aşamaz.',
  'kalan tutarı aşan iade reddedilir'
);

-- İade #4 (1800 TL — tam kalan tutar): Mayıs''ın kalanı (800) ve
-- ardından Nisan (1000) tamamen geri alınır; ödeme artık tamamen
-- iade edilmiş olur.
select lives_ok(
  $$ select public.refund_payment('b2000000-0000-0000-0000-0000000a0001', 1800, 'kalan tam iade', 'refund') $$,
  'kalan tam tutarın iadesi kaydedilebilir'
);

select is(
  (select allocated_amount from public.accruals where id = 'b2000000-0000-0000-0000-0000000f0002'),
  0::numeric,
  'iade #4 sonrası Mayıs tamamen geri alındı'
);

select is(
  (select status from public.accruals where id = 'b2000000-0000-0000-0000-0000000f0002'),
  'open',
  'Mayıs tahakkuku tekrar open durumuna döndü'
);

select is(
  (select allocated_amount from public.accruals where id = 'b2000000-0000-0000-0000-0000000f0001'),
  0::numeric,
  'iade #4 sonrası Nisan da tamamen geri alındı'
);

select is(
  (select status from public.accruals where id = 'b2000000-0000-0000-0000-0000000f0001'),
  'open',
  'Nisan tahakkuku tekrar open durumuna döndü'
);

select is(
  (select is_refunded from public.payments where id = 'b2000000-0000-0000-0000-0000000a0001'),
  true,
  'ödeme tamamı iade edildiği için is_refunded=true oldu'
);

select is(
  (select count(*)::int from public.get_payment_refunds_detail('b2000000-0000-0000-0000-0000000a0001')),
  3,
  'başarısız 3. iade denemesi kayıt oluşturmadı — yalnızca 3 başarılı iade var'
);

select is(
  (select sum(amount) from public.payment_refunds where payment_id = 'b2000000-0000-0000-0000-0000000a0001'),
  2500::numeric,
  'toplam iade tutarı tam olarak ödeme tutarına eşit (2.500 TL)'
);

-- ---------------------------------------------------------------
-- Senaryo B: avans dağıtımı.
-- ---------------------------------------------------------------

select is(
  (select public.allocate_student_advance('b2000000-0000-0000-0000-0000000a0002', 'b2000000-0000-0000-0000-0000000f0003', 600)),
  600::numeric,
  'avansın bir kısmı hedef tahakkuka uygulanabilir'
);

select is(
  (select allocated_amount from public.accruals where id = 'b2000000-0000-0000-0000-0000000f0003'),
  600::numeric,
  'Haziran tahakkuku 600 TL tahsis aldı'
);

select is(
  (select status from public.accruals where id = 'b2000000-0000-0000-0000-0000000f0003'),
  'partial',
  'Haziran tahakkuku partial oldu'
);

-- Kalan avans 400 TL, istenen 1000 TL — hem avansla hem tahakkukun
-- bekleyeniyle (400) sınırlanır, 400 TL uygulanır.
select is(
  (select public.allocate_student_advance('b2000000-0000-0000-0000-0000000a0002', 'b2000000-0000-0000-0000-0000000f0003', 1000)),
  400::numeric,
  'fazla istenen avans, kalan avans/bekleyenle sınırlanarak uygulanır'
);

select is(
  (select status from public.accruals where id = 'b2000000-0000-0000-0000-0000000f0003'),
  'paid',
  'Haziran tahakkuku tamamen ödendi'
);

select throws_ok(
  $$ select public.allocate_student_advance('b2000000-0000-0000-0000-0000000a0002', 'b2000000-0000-0000-0000-0000000f0003', 100) $$,
  'P0001',
  'Bu ödemenin dağıtılmamış (avans) tutarı yetersiz.',
  'avansı tükenmiş ödeme tekrar dağıtılamaz'
);

select throws_ok(
  $$ select public.allocate_student_advance('b2000000-0000-0000-0000-0000000a0002', 'b2000000-0000-0000-0000-0000000f0004', 100) $$,
  'P0001',
  'Avans yalnızca aynı öğrencinin bir tahakkukuna uygulanabilir.',
  'avans başka öğrencinin tahakkukuna uygulanamaz'
);

-- ---------------------------------------------------------------
-- Senaryo C: makbuz numarası.
-- ---------------------------------------------------------------

select ok(
  (select receipt_number from public.payments where id = 'b2000000-0000-0000-0000-0000000a0001') is not null,
  'kaydedilen ödemenin makbuz numarası var'
);

select lives_ok(
  $$ select public.record_payment_for_course('b2000000-0000-0000-0000-0000000d0003', 'b2000000-0000-0000-0000-0000000c0001', 50, 'cash', null) $$,
  'yeni bir ödeme record_payment_for_course ile kaydedilebilir'
);

select isnt(
  (select receipt_number from public.payments where student_id = 'b2000000-0000-0000-0000-0000000d0003' order by created_at desc limit 1),
  (select receipt_number from public.payments where id = 'b2000000-0000-0000-0000-0000000a0001'),
  'iki farklı ödemenin makbuz numarası birbirinden farklı'
);

-- ---------------------------------------------------------------
-- Audit log.
-- ---------------------------------------------------------------

select ok(
  exists (
    select 1 from public.audit_logs
    where table_name = 'payments' and record_id = 'b2000000-0000-0000-0000-0000000a0001' and action = 'refund'
  ),
  'iade işlemi audit_logs''a yazıldı'
);

select ok(
  exists (
    select 1 from public.audit_logs
    where table_name = 'payment_allocations' and action = 'allocate_advance'
  ),
  'avans dağıtımı audit_logs''a yazıldı'
);

reset role;

-- ---------------------------------------------------------------
-- Teacher: hiçbir şekilde erişemez.
-- ---------------------------------------------------------------

select set_config('request.jwt.claims', json_build_object('sub', 'b2000000-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(
  (select count(*)::int from public.payment_refunds),
  0,
  'teacher payment_refunds tablosunda hiçbir satır göremez'
);

select throws_ok(
  $$ select public.refund_payment('b2000000-0000-0000-0000-0000000a0001', 10, 'yetkisiz deneme', 'refund') $$,
  'P0001',
  'Ödeme iadesi/ters işlem yetkiniz bulunmuyor.',
  'teacher iade kaydedemez'
);

select throws_ok(
  $$ select * from public.get_payment_detail('b2000000-0000-0000-0000-0000000a0001') $$,
  'P0001',
  'Bu ödeme detayını görüntüleme yetkiniz bulunmuyor.',
  'teacher ödeme detayını göremez'
);

reset role;

select * from finish();

rollback;
