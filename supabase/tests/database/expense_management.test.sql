-- Masraf yönetimi ve net kârlılık modülü pgTAP testleri
-- (20260812140000_add_expense_management.sql).
--
-- Kapsam: planlı → ödendi/iptal yaşam döngüsü, nakit ödenen masrafın
-- cash_movements'a bağlanması, iptalin bağlı hareketi ters kayıtla
-- düzeltmesi (fiziksel silme yok), tekrarlayan masraf şablonlarının
-- dönem bazlı idempotency key ile mükerrer üretilmemesi, admin-only
-- erişim, ve kârlılık/katkı payı raporlarının doğru hesaplanması.
--
-- Çalıştırma: `npx supabase start` sonrasında `npx supabase test db`.
-- Bu dosya tek bir transaction içinde çalışır ve sonunda rollback edilir.

begin;

select plan(39);

-- ---------------------------------------------------------------
-- Fixture kurulumu (superuser olarak).
-- ---------------------------------------------------------------

delete from public.expenses;
delete from public.recurring_expense_templates;
delete from public.expense_categories;
delete from public.cash_movements;
delete from public.cash_accounts;
delete from public.accruals;
delete from public.enrollments;
delete from public.students;
delete from public.courses;
delete from public.audit_logs;
delete from public.profiles;
delete from public.organizations;

insert into public.organizations (id, name)
values ('a7000000-0000-0000-0000-000000000001', 'Test Kurumu');

insert into auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
values
  ('a7000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@ornek.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('a7000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ogretmen@ornek.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

insert into public.profiles (id, organization_id, full_name, role, is_active)
values
  ('a7000000-0000-0000-0000-0000000000a1', 'a7000000-0000-0000-0000-000000000001', 'Admin', 'admin', true),
  ('a7000000-0000-0000-0000-0000000000a2', 'a7000000-0000-0000-0000-000000000001', 'Öğretmen', 'teacher', true);

insert into public.courses (id, organization_id, name, course_type, default_duration_minutes, default_monthly_fee)
values ('a7000000-0000-0000-0000-0000000c0001', 'a7000000-0000-0000-0000-000000000001', 'Resim', 'group', 60, 1000);

insert into public.students (id, organization_id, first_name, last_name, status)
values ('a7000000-0000-0000-0000-0000000d0001', 'a7000000-0000-0000-0000-000000000001', 'Öğrenci', 'Bir', 'active');

insert into public.enrollments (
  id, organization_id, student_id, course_id,
  starts_on, ends_on, status, list_monthly_fee, net_monthly_fee, due_day
)
values (
  'a7000000-0000-0000-0000-0000000f0001', 'a7000000-0000-0000-0000-000000000001',
  'a7000000-0000-0000-0000-0000000d0001', 'a7000000-0000-0000-0000-0000000c0001',
  '2027-01-01', null, 'active', 1000, 1000, 5
);

-- Ders geliri (2027-09) — kârlılık/katkı payı raporları için.
insert into public.accruals (
  id, organization_id, enrollment_id, student_id, period_start, due_date,
  description, gross_amount, discount_amount, net_amount, status
)
values (
  'a7000000-0000-0000-0000-0000000a0001', 'a7000000-0000-0000-0000-000000000001',
  'a7000000-0000-0000-0000-0000000f0001', 'a7000000-0000-0000-0000-0000000d0001',
  '2027-09-01', '2027-09-05', 'Eylül 2027 aidatı', 1000, 0, 1000, 'open'
);

select set_config('request.jwt.claims', json_build_object('sub', 'a7000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

select lives_ok(
  $$insert into public.cash_accounts (id, organization_id, name)
    values ('a7000000-0000-0000-0000-0000000e0001', 'a7000000-0000-0000-0000-000000000001', 'Ana Kasa')$$,
  'admin doğrudan kasa hesabı oluşturabilir'
);

-- ---------------------------------------------------------------
-- Masraf kategorileri — admin doğrudan CRUD, teacher erişemez.
-- ---------------------------------------------------------------

select lives_ok(
  $$insert into public.expense_categories (id, organization_id, name, is_direct_course_cost)
    values ('a7000000-0000-0000-0000-0000000b0001', 'a7000000-0000-0000-0000-000000000001', 'Kira', false)$$,
  'admin doğrudan masraf kategorisi oluşturabilir'
);

insert into public.expense_categories (id, organization_id, name, is_direct_course_cost)
values ('a7000000-0000-0000-0000-0000000b0002', 'a7000000-0000-0000-0000-000000000001', 'Ders Malzemesi', true);

reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'a7000000-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_like(
  $$insert into public.expense_categories (organization_id, name)
    values ('a7000000-0000-0000-0000-000000000001', 'Teacher Kategori')$$,
  '%row-level security%',
  'teacher masraf kategorisi oluşturamaz'
);

select is(
  (select count(*)::int from public.expense_categories),
  0,
  'teacher masraf kategorilerini SELECT ile bile göremez'
);

reset role;

-- ---------------------------------------------------------------
-- Masraf yaşam döngüsü: planlı → ödendi (nakit → cash_out hareketi)
-- ---------------------------------------------------------------

select set_config('request.jwt.claims', json_build_object('sub', 'a7000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  $$select public.create_expense(
    gen_random_uuid(), 500, '2027-09-10'::date, null, null, null, null
  )$$,
  'P0001', 'Masraf kategorisi bulunamadı.',
  'olmayan kategoriyle masraf oluşturulamaz'
);

select lives_ok(
  $$select public.create_expense(
    'a7000000-0000-0000-0000-0000000b0002'::uuid, 300, '2027-09-10'::date, '2027-09-20'::date,
    'a7000000-0000-0000-0000-0000000c0001'::uuid, 'Kırtasiye A.Ş.', 'Boya seti'
  )$$,
  'ders bağlı doğrudan maliyet masrafı oluşturulur'
);

select is(
  (select status::text from public.expenses where vendor_name = 'Kırtasiye A.Ş.'),
  'planned',
  'yeni masraf planlı durumda başlar'
);

select lives_ok(
  $$select public.update_expense_details(
    (select id from public.expenses where vendor_name = 'Kırtasiye A.Ş.'),
    'a7000000-0000-0000-0000-0000000b0002'::uuid, 350, '2027-09-10'::date, '2027-09-20'::date,
    'a7000000-0000-0000-0000-0000000c0001'::uuid, 'Kırtasiye A.Ş.', 'Boya seti (güncellendi)'
  )$$,
  'planlı masraf düzenlenebilir'
);

select is(
  (select amount from public.expenses where vendor_name = 'Kırtasiye A.Ş.'),
  350::numeric,
  'düzenleme sonrası tutar güncellenir'
);

select throws_ok(
  $$select public.record_expense_payment(
    (select id from public.expenses where vendor_name = 'Kırtasiye A.Ş.'),
    now(), 'cash', null
  )$$,
  'P0001', 'Nakit ödeme için bir kasa hesabı seçilmelidir.',
  'kasa hesabı verilmeden nakit ödeme reddedilir'
);

select lives_ok(
  $$select public.record_expense_payment(
    (select id from public.expenses where vendor_name = 'Kırtasiye A.Ş.'),
    now(), 'cash', 'a7000000-0000-0000-0000-0000000e0001'::uuid
  )$$,
  'kasa hesabı verilince nakit ödeme kaydedilir'
);

select is(
  (select status::text from public.expenses where vendor_name = 'Kırtasiye A.Ş.'),
  'paid',
  'ödeme sonrası durum "paid" olur'
);

select is(
  (select count(*)::int from public.cash_movements
   where cash_account_id = 'a7000000-0000-0000-0000-0000000e0001'
     and movement_type = 'cash_out' and amount = 350 and direction = -1),
  1,
  'nakit masraf ödemesi tam olarak bir cash_out hareketi oluşturur'
);

select is(
  (select cm.id from public.cash_movements cm
   inner join public.expenses ex on ex.cash_movement_id = cm.id
   where ex.vendor_name = 'Kırtasiye A.Ş.'),
  (select id from public.cash_movements where movement_type = 'cash_out'),
  'expenses.cash_movement_id doğru hareketi işaret eder'
);

select is(
  (select public.get_cash_account_balance('a7000000-0000-0000-0000-0000000e0001'::uuid)),
  -350::numeric,
  'kasa bakiyesi masraf ödemesi sonrası düşer'
);

select throws_ok(
  $$select public.update_expense_details(
    (select id from public.expenses where vendor_name = 'Kırtasiye A.Ş.'),
    'a7000000-0000-0000-0000-0000000b0002'::uuid, 999, '2027-09-10'::date, null, null, null, null
  )$$,
  'P0001', 'Yalnızca ödenmemiş (planlı) masraflar düzenlenebilir.',
  'ödenmiş masraf düzenlenemez'
);

select throws_ok(
  $$select public.record_expense_payment(
    (select id from public.expenses where vendor_name = 'Kırtasiye A.Ş.'),
    now(), 'bank_transfer', null
  )$$,
  'P0001', 'Yalnızca planlı masraflar ödenmiş olarak işaretlenebilir.',
  'zaten ödenmiş masraf ikinci kez ödenemez'
);

-- ---------------------------------------------------------------
-- İptal — fiziksel silme yok, bağlı kasa hareketi ters kayıtla düzelir
-- ---------------------------------------------------------------

select lives_ok(
  $$select public.cancel_expense(
    (select id from public.expenses where vendor_name = 'Kırtasiye A.Ş.'),
    'yanlış girilmiş masraf'
  )$$,
  'ödenmiş masraf iptal edilebilir'
);

select is(
  (select status::text from public.expenses where vendor_name = 'Kırtasiye A.Ş.'),
  'cancelled',
  'iptal sonrası durum "cancelled" olur'
);

select is(
  (select public.get_cash_account_balance('a7000000-0000-0000-0000-0000000e0001'::uuid)),
  0::numeric,
  'iptal sonrası kasa bakiyesi ters kayıtla eski haline döner'
);

select is(
  (select count(*)::int from public.cash_movements
   where cash_account_id = 'a7000000-0000-0000-0000-0000000e0001'),
  2,
  'hiçbir kasa hareketi silinmedi — 1 cash_out + 1 ters kayıt = 2 satır'
);

select throws_ok(
  $$select public.cancel_expense(
    (select id from public.expenses where vendor_name = 'Kırtasiye A.Ş.'),
    'ikinci iptal denemesi'
  )$$,
  'P0001', 'Bu masraf zaten iptal edilmiş.',
  'zaten iptal edilmiş masraf ikinci kez iptal edilemez'
);

-- ---------------------------------------------------------------
-- Fiziksel silme yok — authenticated (admin dahil) delete yapamaz
-- ---------------------------------------------------------------

select throws_ok(
  $$delete from public.expenses where vendor_name = 'Kırtasiye A.Ş.'$$,
  '42501',
  'admin dahi expenses''ten doğrudan satır silemez'
);

-- ---------------------------------------------------------------
-- Tekrarlayan masraf şablonu — dönem bazlı idempotency
-- ---------------------------------------------------------------

select lives_ok(
  $$select public.create_recurring_expense_template(
    'a7000000-0000-0000-0000-0000000b0001'::uuid, 2000, 5, null, 'Ev Sahibi', 'bank_transfer', 'Aylık kira'
  )$$,
  'tekrarlayan masraf şablonu oluşturulur'
);

select is(
  (select created_count from public.generate_monthly_expenses('2027-09-01'::date)),
  1,
  'ilk çalıştırmada şablondan 1 masraf üretilir'
);

select is(
  (select created_count from public.generate_monthly_expenses('2027-09-01'::date)),
  0,
  'aynı dönem için ikinci çalıştırmada created_count = 0'
);

select is(
  (select count(*)::int from public.expenses
   where template_id = (select id from public.recurring_expense_templates)
     and period_start = '2027-09-01'),
  1,
  'aynı şablon aynı dönem için mükerrer masraf satırı oluşturmaz'
);

-- Veritabanı seviyesinde de kısmi tekil indeks var — RPC'yi atlayıp
-- doğrudan ikinci bir satır eklemeye çalışsak bile (superuser olarak,
-- authenticated zaten insert izni olmadığından önce ona takılır)
-- engellenir.

reset role;

select throws_ok(
  $$insert into public.expenses (
      organization_id, category_id, template_id, period_start, expense_date, amount, status
    )
    select organization_id, category_id, template_id, period_start, expense_date, amount, status
    from public.expenses
    where template_id is not null
    limit 1$$,
  '23505',
  'kısmi tekil indeks (template_id, period_start), RPC''den bağımsız olarak da mükerrer satırı engeller'
);

select set_config('request.jwt.claims', json_build_object('sub', 'a7000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

-- ---------------------------------------------------------------
-- Kârlılık ve ders bazlı katkı payı raporları
-- ---------------------------------------------------------------

select is(
  (select direct_expenses from public.get_monthly_profitability_summary('2027-09-01'::date)),
  0::numeric,
  'Kırtasiye masrafı iptal edildiği için direct_expenses hesaba katılmaz'
);

select lives_ok(
  $$select public.create_expense(
    'a7000000-0000-0000-0000-0000000b0002'::uuid, 200, '2027-09-15'::date, null,
    'a7000000-0000-0000-0000-0000000c0001'::uuid, null, null
  )$$,
  'ikinci (iptal edilmemiş) ders maliyeti oluşturulur'
);

select is(
  (select direct_expenses from public.get_monthly_profitability_summary('2027-09-01'::date)),
  200::numeric,
  'direct_expenses artık iptal edilmemiş 200 tutarındaki masrafı sayar'
);

select is(
  (select indirect_expenses from public.get_monthly_profitability_summary('2027-09-01'::date)),
  2000::numeric,
  'indirect_expenses kira şablonundan üretilen 2000 tutarındaki masrafı sayar (course_id null)'
);

select is(
  (select revenue_accrued from public.get_monthly_profitability_summary('2027-09-01'::date)),
  1000::numeric,
  'revenue_accrued eylül 2027 tahakkukunu (1000) yansıtır'
);

select is(
  (select gross_result from public.get_monthly_profitability_summary('2027-09-01'::date)),
  800::numeric,
  'gross_result = gelir(1000) - doğrudan gider(200) = 800'
);

select is(
  (select net_result from public.get_monthly_profitability_summary('2027-09-01'::date)),
  -1200::numeric,
  'net_result = gelir(1000) - toplam gider(200+2000) = -1200'
);

select is(
  (
    select contribution_margin from public.get_course_contribution_margins('2027-09-01'::date)
    where course_id = 'a7000000-0000-0000-0000-0000000c0001'
  ),
  800::numeric,
  'ders bazlı katkı payı, kurum genelindeki gross_result ile aynı mantıkla hesaplanır'
);

-- ---------------------------------------------------------------
-- Yalnızca admin erişebilir
-- ---------------------------------------------------------------

reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'a7000000-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  $$select public.create_expense(
    'a7000000-0000-0000-0000-0000000b0002'::uuid, 100, '2027-09-01'::date, null, null, null, null
  )$$,
  'P0001', 'Masraf ekleme yetkiniz bulunmuyor.',
  'teacher masraf oluşturamaz'
);

select throws_ok(
  $$select public.generate_monthly_expenses('2027-09-01'::date)$$,
  'P0001', 'Aylık masraf oluşturma yetkiniz bulunmuyor.',
  'teacher tekrarlayan masraf üretemez'
);

select is(
  (select count(*)::int from public.expenses),
  0,
  'teacher, expenses''i SELECT ile bile göremez (RLS admin''e özel — sıfır satır)'
);

reset role;

select * from finish();

rollback;
