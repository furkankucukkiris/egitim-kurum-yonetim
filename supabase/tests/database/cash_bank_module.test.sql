-- Kasa & Banka modülü pgTAP testleri
-- (20260812130000_add_cash_bank_module.sql).
--
-- Kapsam: nakit ödeme → otomatik cash_in hareketi, banka/ATM yatırımı
-- (bakiye düşüşü + bank_deposits/bank_deposit_items oluşumu), aynı
-- hareketin iki yatırıma dahil edilememesi, kasa sayımı/düzeltme,
-- ters kayıtla düzeltme (fiziksel silme yok), günlük bakiyenin
-- hareketlerden yeniden hesaplanması, admin-only RLS ve yetkilendirme.
--
-- Çalıştırma: `npx supabase start` sonrasında `npx supabase test db`.
-- Bu dosya tek bir transaction içinde çalışır ve sonunda rollback edilir.

begin;

select plan(35);

-- ---------------------------------------------------------------
-- Fixture kurulumu (superuser olarak).
-- ---------------------------------------------------------------

delete from public.bank_deposit_items;
delete from public.bank_deposits;
delete from public.cash_movements;
delete from public.cash_accounts;
delete from public.bank_accounts;
delete from public.payment_allocations;
delete from public.payments;
delete from public.accruals;
delete from public.enrollments;
delete from public.students;
delete from public.courses;
delete from public.audit_logs;
delete from public.profiles;
delete from public.organizations;

insert into public.organizations (id, name)
values ('f6000000-0000-0000-0000-000000000001', 'Test Kurumu');

insert into auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
values
  ('f6000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@ornek.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('f6000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ogretmen@ornek.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

insert into public.profiles (id, organization_id, full_name, role, is_active)
values
  ('f6000000-0000-0000-0000-0000000000a1', 'f6000000-0000-0000-0000-000000000001', 'Admin', 'admin', true),
  ('f6000000-0000-0000-0000-0000000000a2', 'f6000000-0000-0000-0000-000000000001', 'Öğretmen', 'teacher', true);

insert into public.courses (id, organization_id, name, course_type, default_duration_minutes, default_monthly_fee)
values ('f6000000-0000-0000-0000-0000000c0001', 'f6000000-0000-0000-0000-000000000001', 'Resim', 'group', 60, 1000);

insert into public.students (id, organization_id, first_name, last_name, status)
values ('f6000000-0000-0000-0000-0000000d0001', 'f6000000-0000-0000-0000-000000000001', 'Öğrenci', 'Bir', 'active');

insert into public.enrollments (
  id, organization_id, student_id, course_id,
  starts_on, ends_on, status, list_monthly_fee, net_monthly_fee, due_day
)
values (
  'f6000000-0000-0000-0000-0000000f0001', 'f6000000-0000-0000-0000-000000000001',
  'f6000000-0000-0000-0000-0000000d0001', 'f6000000-0000-0000-0000-0000000c0001',
  '2027-01-01', null, 'active', 1000, 1000, 5
);

-- Kasa/banka hesapları admin olarak, doğrudan tablo üzerinden (RLS ile).

select set_config('request.jwt.claims', json_build_object('sub', 'f6000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

select lives_ok(
  $$insert into public.cash_accounts (id, organization_id, name)
    values ('f6000000-0000-0000-0000-0000000e0001', 'f6000000-0000-0000-0000-000000000001', 'Ana Kasa')$$,
  'admin doğrudan kasa hesabı oluşturabilir'
);

select lives_ok(
  $$insert into public.bank_accounts (id, organization_id, bank_name, iban)
    values ('f6000000-0000-0000-0000-0000000b0001', 'f6000000-0000-0000-0000-000000000001', 'Test Bankası', 'TR000000000000000000000000')$$,
  'admin doğrudan banka hesabı oluşturabilir'
);

reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'f6000000-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_like(
  $$insert into public.cash_accounts (organization_id, name)
    values ('f6000000-0000-0000-0000-000000000001', 'Teacher Kasa')$$,
  '%row-level security%',
  'teacher kasa hesabı oluşturamaz'
);

reset role;

-- ---------------------------------------------------------------
-- Nakit ödeme → otomatik cash_in hareketi
-- ---------------------------------------------------------------

select set_config('request.jwt.claims', json_build_object('sub', 'f6000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  $$select public.record_payment_for_course(
    'f6000000-0000-0000-0000-0000000d0001'::uuid, 'f6000000-0000-0000-0000-0000000c0001'::uuid,
    500, 'cash', null, null
  )$$,
  'P0001', 'Nakit ödeme için bir kasa hesabı seçilmelidir.',
  'kasa hesabı verilmeden nakit ödeme reddedilir'
);

select lives_ok(
  $$select public.record_payment_for_course(
    'f6000000-0000-0000-0000-0000000d0001'::uuid, 'f6000000-0000-0000-0000-0000000c0001'::uuid,
    600, 'cash', 'ilk taksit', 'f6000000-0000-0000-0000-0000000e0001'::uuid
  )$$,
  'kasa hesabı verilince nakit ödeme kaydedilir'
);

select is(
  (select count(*)::int from public.cash_movements
   where cash_account_id = 'f6000000-0000-0000-0000-0000000e0001'
     and movement_type = 'cash_in' and amount = 600 and direction = 1),
  1,
  'nakit ödeme tam olarak bir cash_in hareketi oluşturur'
);

select is(
  (select payment_id from public.cash_movements
   where cash_account_id = 'f6000000-0000-0000-0000-0000000e0001' and movement_type = 'cash_in'),
  (select id from public.payments where amount = 600),
  'cash_in hareketi doğru ödeme kaydına bağlanır'
);

select is(
  (select public.get_cash_account_balance('f6000000-0000-0000-0000-0000000e0001'::uuid)),
  600::numeric,
  'kasa bakiyesi nakit ödeme sonrası 600 olur'
);

-- İkinci nakit ödeme (yatırım/kısmi yatırım senaryoları için).

select lives_ok(
  $$select public.record_payment_for_course(
    'f6000000-0000-0000-0000-0000000d0001'::uuid, 'f6000000-0000-0000-0000-0000000c0001'::uuid,
    400, 'cash', 'ikinci taksit', 'f6000000-0000-0000-0000-0000000e0001'::uuid
  )$$,
  'ikinci nakit ödeme de kaydedilir'
);

select is(
  (select public.get_cash_account_balance('f6000000-0000-0000-0000-0000000e0001'::uuid)),
  1000::numeric,
  'kasa bakiyesi iki ödeme sonrası 1000 olur'
);

-- ---------------------------------------------------------------
-- Banka/ATM yatırımı — bakiye düşer, bank_deposits/bank_deposit_items oluşur
-- ---------------------------------------------------------------

select throws_ok(
  $$select public.create_bank_deposit(
    'f6000000-0000-0000-0000-0000000e0001'::uuid, 'f6000000-0000-0000-0000-0000000b0001'::uuid,
    now(), array[]::uuid[], null, null
  )$$,
  'P0001', 'En az bir kasa hareketi seçilmelidir.',
  'boş hareket listesiyle yatırım oluşturulamaz'
);

select lives_ok(
  $$select public.create_bank_deposit(
    'f6000000-0000-0000-0000-0000000e0001'::uuid, 'f6000000-0000-0000-0000-0000000b0001'::uuid,
    now(),
    (select array_agg(id) from public.cash_movements
     where cash_account_id = 'f6000000-0000-0000-0000-0000000e0001' and movement_type = 'cash_in'),
    'ilk yatırım', null
  )$$,
  'seçilen iki cash_in hareketiyle yatırım oluşturulur'
);

select is(
  (select amount from public.bank_deposits where cash_account_id = 'f6000000-0000-0000-0000-0000000e0001'),
  1000::numeric,
  'yatırım tutarı seçilen hareketlerin toplamına eşittir (600+400)'
);

select is(
  (select coalesce(sum(bdi.amount), 0) from public.bank_deposit_items bdi
   inner join public.bank_deposits bd on bd.id = bdi.bank_deposit_id
   where bd.cash_account_id = 'f6000000-0000-0000-0000-0000000e0001'),
  (select amount from public.bank_deposits where cash_account_id = 'f6000000-0000-0000-0000-0000000e0001'),
  'bank_deposit_items toplamı bank_deposits.amount ile birebir eşleşir'
);

select is(
  (select public.get_cash_account_balance('f6000000-0000-0000-0000-0000000e0001'::uuid)),
  0::numeric,
  'yatırım sonrası kasa bakiyesi düşer (1000 - 1000 = 0)'
);

select is(
  (select count(*)::int from public.get_undeposited_cash_movements('f6000000-0000-0000-0000-0000000e0001'::uuid)),
  0,
  'yatırılan hareketler artık bekleyen listesinde görünmez'
);

-- Aynı hareket iki kez yatırılamaz.

select throws_ok(
  $$select public.create_bank_deposit(
    'f6000000-0000-0000-0000-0000000e0001'::uuid, 'f6000000-0000-0000-0000-0000000b0001'::uuid,
    now(),
    (select array[id] from public.cash_movements
     where cash_account_id = 'f6000000-0000-0000-0000-0000000e0001' and movement_type = 'cash_in' limit 1),
    null, null
  )$$,
  'P0001',
  'Seçilen hareketlerden biri artık uygun değil (başka kasaya ait, negatif yönlü veya zaten yatırılmış olabilir).',
  'zaten yatırılmış bir hareket ikinci kez yatırıma dahil edilemez'
);

-- Veritabanı seviyesinde de tekil indeks var — authenticated'ın zaten
-- bu tabloya insert izni yok (yalnızca RPC'ler yazabilir), o kontrolü
-- atlayıp indeksin kendisini sınamak için superuser bağlamına geçiyoruz.
-- İkinci, ayrı bir yatırım satırı oluşturuluyor ki asıl sınanan
-- bank_deposit_items_cash_movement_unique (yalnızca cash_movement_id)
-- indeksi tetiklensin — aynı (bank_deposit_id, cash_movement_id) çiftini
-- tekrarlamak farklı (ve burada test edilmeyen) bir composite unique
-- kısıtını (bank_deposit_id, cash_movement_id) tetikler.

reset role;

insert into public.bank_deposits (
  id, organization_id, cash_account_id, bank_account_id, deposited_at, amount
)
values (
  'f6000000-0000-0000-0000-0000000e0099', 'f6000000-0000-0000-0000-000000000001',
  'f6000000-0000-0000-0000-0000000e0001', 'f6000000-0000-0000-0000-0000000b0001',
  now(), 1
);

select throws_like(
  $$insert into public.bank_deposit_items (organization_id, bank_deposit_id, cash_movement_id, amount)
    select 'f6000000-0000-0000-0000-000000000001', 'f6000000-0000-0000-0000-0000000e0099',
      bdi.cash_movement_id, bdi.amount
    from public.bank_deposit_items bdi
    limit 1$$,
  '%bank_deposit_items_cash_movement_unique%',
  'unique index, aynı cash_movement_id''nin farklı bir yatırıma da ikinci kez eklenmesini veritabanı seviyesinde engeller'
);

select set_config('request.jwt.claims', json_build_object('sub', 'f6000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

-- ---------------------------------------------------------------
-- Kasa sayımı / düzeltme
-- ---------------------------------------------------------------

select throws_ok(
  $$select public.record_cash_count_adjustment(
    'f6000000-0000-0000-0000-0000000e0001'::uuid, 50, null
  )$$,
  'P0001', 'Sayım farkı için bir açıklama girilmelidir.',
  'açıklamasız sayım düzeltmesi reddedilir'
);

select is(
  (select delta from public.record_cash_count_adjustment(
    'f6000000-0000-0000-0000-0000000e0001'::uuid, 0, 'defterle uyumlu'
  )),
  0::numeric,
  'defterle uyumlu sayımda delta = 0'
);

select is(
  (select count(*)::int from public.cash_movements
   where cash_account_id = 'f6000000-0000-0000-0000-0000000e0001' and movement_type = 'correction'),
  0,
  'delta = 0 iken hiçbir düzeltme hareketi eklenmez'
);

select is(
  (select delta from public.record_cash_count_adjustment(
    'f6000000-0000-0000-0000-0000000e0001'::uuid, 50, 'kasada fazla nakit bulundu'
  )),
  50::numeric,
  'fazla bulunan nakit için delta = +50'
);

select is(
  (select public.get_cash_account_balance('f6000000-0000-0000-0000-0000000e0001'::uuid)),
  50::numeric,
  'pozitif düzeltme sonrası bakiye 50 olur'
);

select is(
  (select delta from public.record_cash_count_adjustment(
    'f6000000-0000-0000-0000-0000000e0001'::uuid, 20, 'kasada eksik nakit bulundu'
  )),
  -30::numeric,
  'eksik bulunan nakit için delta negatif (50 -> 20)'
);

select is(
  (select public.get_cash_account_balance('f6000000-0000-0000-0000-0000000e0001'::uuid)),
  20::numeric,
  'negatif düzeltme sonrası bakiye 20 olur'
);

-- ---------------------------------------------------------------
-- Ters kayıt — fiziksel silme yok, yeni ters yönlü satır eklenir
-- ---------------------------------------------------------------

select lives_ok(
  $$select public.reverse_cash_movement(
    (select id from public.cash_movements
     where cash_account_id = 'f6000000-0000-0000-0000-0000000e0001'
       and movement_type = 'correction' and direction = -1 and reverses_movement_id is null
     order by created_at desc limit 1),
    'yanlışlıkla girilmiş sayım düzeltmesi'
  )$$,
  'ters kayıt oluşturulabilir'
);

select is(
  (select public.get_cash_account_balance('f6000000-0000-0000-0000-0000000e0001'::uuid)),
  50::numeric,
  'ters kayıt sonrası bakiye eksi düzeltmeden önceki değere döner (20 -> 50)'
);

select is(
  (select count(*)::int from public.cash_movements
   where cash_account_id = 'f6000000-0000-0000-0000-0000000e0001'),
  6,
  'hiçbir satır silinmedi — 2 ödeme + 1 yatırım + 2 sayım düzeltmesi + 1 ters kayıt = 6 satır'
);

select throws_ok(
  $$select public.reverse_cash_movement(
    (select id from public.cash_movements
     where cash_account_id = 'f6000000-0000-0000-0000-0000000e0001'
       and movement_type = 'correction' and direction = -1 and reverses_movement_id is null
     order by created_at desc limit 1),
    'aynı hareketi ikinci kez ters kayıtla düzeltme denemesi'
  )$$,
  'P0001', 'Bu hareket için zaten bir ters kayıt oluşturulmuş.',
  'aynı hareket ikinci kez ters kayıtla düzeltilemez'
);

-- ---------------------------------------------------------------
-- Günlük bakiye tamamen hareketlerden yeniden hesaplanır
-- ---------------------------------------------------------------

-- `current_date` yerine Europe/Istanbul çapası kullanılıyor —
-- get_cash_daily_balances() organizasyonun timezone'una (varsayılan
-- Europe/Istanbul) göre gün kırılımı yapıyor, ama pgTAP oturumunun
-- `current_date`'i Postgres sunucu saat dilimine (UTC) göre çözülüyor.
-- İkisi günün ~3 saatlik bir diliminde (UTC 21:00-23:59, Istanbul zaten
-- ertesi gün) uyuşmuyor — bu pencerede bare current_date, hareketin
-- gerçekte bucketlandığı Istanbul gününden bir gün geride kalıp
-- running_balance'ı 0 döndürüyordu (CI'da canlı gerçekleşmiş, flaky bir
-- hataydı; bkz. dashboard_financial_summary.test.sql'deki aynı sınıf
-- düzeltme).
select is(
  (
    select running_balance from public.get_cash_daily_balances(
      'f6000000-0000-0000-0000-0000000e0001'::uuid,
      (pg_catalog.now() at time zone 'Europe/Istanbul')::date,
      (pg_catalog.now() at time zone 'Europe/Istanbul')::date
    )
  ),
  50::numeric,
  'get_cash_daily_balances, get_cash_account_balance ile aynı bakiyeyi (canlı hesaplanmış) döner'
);

-- ---------------------------------------------------------------
-- Fiziksel silme yok — authenticated (admin dahil) delete yapamaz
-- ---------------------------------------------------------------

select throws_like(
  $$delete from public.cash_movements where cash_account_id = 'f6000000-0000-0000-0000-0000000e0001'$$,
  '%permission denied%',
  'admin dahi cash_movements''ten doğrudan satır silemez'
);

select throws_like(
  $$update public.cash_movements set amount = 1 where cash_account_id = 'f6000000-0000-0000-0000-0000000e0001'$$,
  '%permission denied%',
  'admin dahi cash_movements''i doğrudan güncelleyemez'
);

-- ---------------------------------------------------------------
-- Yalnızca admin erişebilir
-- ---------------------------------------------------------------

reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'f6000000-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  $$select public.create_bank_deposit(
    'f6000000-0000-0000-0000-0000000e0001'::uuid, 'f6000000-0000-0000-0000-0000000b0001'::uuid,
    now(), array[gen_random_uuid()], null, null
  )$$,
  'P0001', 'Banka yatırımı oluşturma yetkiniz bulunmuyor.',
  'teacher banka yatırımı oluşturamaz'
);

select throws_ok(
  $$select public.record_cash_count_adjustment('f6000000-0000-0000-0000-0000000e0001'::uuid, 100, 'deneme')$$,
  'P0001', 'Kasa sayımı kaydetme yetkiniz bulunmuyor.',
  'teacher kasa sayımı kaydedemez'
);

select is(
  (select count(*)::int from public.cash_movements),
  0,
  'teacher, cash_movements''i SELECT ile bile göremez (RLS admin''e özel — sıfır satır)'
);

reset role;

select * from finish();

rollback;
