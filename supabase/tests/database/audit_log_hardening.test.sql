-- Denetim kaydı (audit_logs) sertleştirmesi pgTAP testleri
-- (20260812160000_add_audit_log_hardening.sql).
--
-- Kapsam: authenticated'ın (admin dahil) audit_logs'a doğrudan
-- insert/update/delete yapamaması, admin'in yalnızca kendi kurumunun
-- kayıtlarını görebilmesi, teacher'ın hiç görememesi,
-- create_student_with_guardian()'ın artık denetlendiği ve T.C.
-- kimlik numarasını LOGLAMADIĞI, log_rejected_scheduling_attempt()'in
-- bilinmeyen payload anahtarlarını süzdüğü, ve organizations
-- trigger'ının yalnızca izlenen alanlar değiştiğinde (dahili
-- next_receipt_number sayacında DEĞİL) tetiklendiği.
--
-- Çalıştırma: `npx supabase start` sonrasında `npx supabase test db`.
-- Bu dosya tek bir transaction içinde çalışır ve sonunda rollback edilir.

begin;

select plan(20);

-- ---------------------------------------------------------------
-- Fixture kurulumu (superuser olarak). İki kurum: izolasyon testi
-- için.
-- ---------------------------------------------------------------

delete from public.audit_logs;
delete from public.students;
delete from public.guardians;
delete from public.profiles;
delete from public.organizations;

insert into public.organizations (id, name)
values
  ('c9000000-0000-0000-0000-000000000001', 'Test Kurumu 1'),
  ('c9000000-0000-0000-0000-000000000002', 'Test Kurumu 2');

insert into auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
values
  ('c9000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin1@ornek.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('c9000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ogretmen@ornek.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

insert into public.profiles (id, organization_id, full_name, role, is_active)
values
  ('c9000000-0000-0000-0000-0000000000a1', 'c9000000-0000-0000-0000-000000000001', 'Admin 1', 'admin', true),
  ('c9000000-0000-0000-0000-0000000000a2', 'c9000000-0000-0000-0000-000000000001', 'Öğretmen', 'teacher', true);

insert into public.audit_logs (organization_id, table_name, record_id, action, new_data)
values
  ('c9000000-0000-0000-0000-000000000001', 'students', 'x', 'create', '{}'::jsonb),
  ('c9000000-0000-0000-0000-000000000002', 'students', 'y', 'create', '{}'::jsonb);

select set_config('request.jwt.claims', json_build_object('sub', 'c9000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

-- ---------------------------------------------------------------
-- Görünürlük ve izolasyon
-- ---------------------------------------------------------------

select is(
  (select count(*)::int from public.audit_logs),
  1,
  'admin yalnızca kendi kurumunun denetim kayıtlarını görür'
);

select is(
  (select organization_id from public.audit_logs limit 1),
  'c9000000-0000-0000-0000-000000000001'::uuid,
  'görülen kayıt gerçekten kendi kurumuna ait'
);

reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'c9000000-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(
  (select count(*)::int from public.audit_logs),
  0,
  'teacher denetim kayıtlarını hiç göremez (admin''e özel RLS)'
);

reset role;

-- ---------------------------------------------------------------
-- Fiziksel yazma yok — authenticated (admin dahil) insert/update/
-- delete yapamaz.
-- ---------------------------------------------------------------

select set_config('request.jwt.claims', json_build_object('sub', 'c9000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  $$insert into public.audit_logs (organization_id, table_name, action)
    values ('c9000000-0000-0000-0000-000000000001', 'students', 'create')$$,
  '42501',
  'admin dahi audit_logs''a doğrudan insert yapamaz'
);

select throws_ok(
  $$update public.audit_logs set action = 'tampered' where organization_id = 'c9000000-0000-0000-0000-000000000001'$$,
  '42501',
  'admin dahi audit_logs''ı doğrudan güncelleyemez'
);

select throws_ok(
  $$delete from public.audit_logs where organization_id = 'c9000000-0000-0000-0000-000000000001'$$,
  '42501',
  'admin dahi audit_logs''tan doğrudan satır silemez'
);

-- ---------------------------------------------------------------
-- Öğrenci/veli ilk kaydı artık denetleniyor, T.C. kimlik numarası
-- HİÇ loglanmıyor.
-- ---------------------------------------------------------------

select lives_ok(
  $$select public.create_student_with_guardian(
    '12345678950', 'Ali', 'Yılmaz',
    '98765432150', 'Ayşe Yılmaz', '05551234567'
  )$$,
  'öğrenci/veli kaydı oluşturulur'
);

select is(
  (select count(*)::int from public.audit_logs where table_name = 'students' and action = 'create'),
  1,
  'öğrenci kaydı için tam olarak bir denetim satırı oluşur (daha önce hiç oluşmuyordu)'
);

select ok(
  not (
    (select new_data from public.audit_logs where table_name = 'students' and action = 'create') ? 'identity_number'
  ),
  'öğrenci denetim satırında identity_number anahtarı HİÇ yok'
);

select is(
  (select new_data->>'first_name' from public.audit_logs where table_name = 'students' and action = 'create'),
  'Ali',
  'öğrenci denetim satırı kimlik-dışı alanları (first_name) doğru içerir'
);

-- ---------------------------------------------------------------
-- MEB fonksiyonları artık açık alan listesi kullanıyor (to_jsonb
-- değil) — new_data yalnızca beklenen anahtarları içerir.
-- ---------------------------------------------------------------

insert into public.courses (id, organization_id, name, course_type, default_duration_minutes, default_monthly_fee)
values ('c9000000-0000-0000-0000-0000000c0001', 'c9000000-0000-0000-0000-000000000001', 'Resim', 'group', 60, 1000);

select lives_ok(
  $$select public.set_teacher_course_meb_authorization(
    'c9000000-0000-0000-0000-0000000000a2'::uuid, 'c9000000-0000-0000-0000-0000000c0001'::uuid,
    'approved', 'BELGE-123', '2027-01-01'::date, null, 'test'
  )$$,
  'MEB öğretmen yetkisi ayarlanır'
);

select is(
  (
    select array(select jsonb_object_keys(new_data) from public.audit_logs
     where table_name = 'teacher_course_meb_authorizations' order by 1)
  ),
  array['checked_at','checked_by','document_number','note','status','valid_from','valid_until'],
  'MEB yetki denetim satırı yalnızca bilinen alanları içerir (satırın tamamı değil)'
);

-- ---------------------------------------------------------------
-- log_rejected_scheduling_attempt: bilinmeyen anahtarlar süzülür.
-- ---------------------------------------------------------------

select lives_ok(
  $$select public.log_rejected_scheduling_attempt(
    'class_groups', 'create_rejected', 'çakışma var',
    jsonb_build_object('name', 'Grup A', 'teacherProfileId', 'c9000000-0000-0000-0000-0000000000a2', 'secretField', 'sizinle-paylaşılmamalı')
  )$$,
  'reddedilen zamanlama girişimi kaydedilir'
);

select ok(
  (
    select new_data->'payload' ? 'name' from public.audit_logs
    where table_name = 'class_groups' and action = 'create_rejected'
  ),
  'bilinen alan (name) payload''da kalır'
);

select ok(
  not (
    select new_data->'payload' ? 'secretField' from public.audit_logs
    where table_name = 'class_groups' and action = 'create_rejected'
  ),
  'bilinmeyen alan (secretField) payload''dan süzülür'
);

-- ---------------------------------------------------------------
-- organizations trigger: yalnızca izlenen alanlar değiştiğinde
-- tetiklenir, dahili sayaç (next_receipt_number) tetiklemez.
-- ---------------------------------------------------------------

select is(
  (select count(*)::int from public.audit_logs where table_name = 'organizations'),
  0,
  'başlangıçta organizations denetim satırı yok'
);

update public.organizations
set next_receipt_number = next_receipt_number + 1
where id = 'c9000000-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from public.audit_logs where table_name = 'organizations'),
  0,
  'yalnızca next_receipt_number değişmesi (her ödemede olur) denetim satırı OLUŞTURMAZ'
);

update public.organizations
set name = 'Yeni Kurum Adı'
where id = 'c9000000-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from public.audit_logs where table_name = 'organizations'),
  1,
  'izlenen bir alan (name) değiştiğinde tam olarak bir denetim satırı oluşur'
);

select is(
  (select new_data->>'name' from public.audit_logs where table_name = 'organizations'),
  'Yeni Kurum Adı',
  'organizations denetim satırı yeni değeri doğru taşır'
);

select is(
  (select old_data->>'name' from public.audit_logs where table_name = 'organizations'),
  'Test Kurumu 1',
  'organizations denetim satırı eski değeri doğru taşır'
);

reset role;

select * from finish();

rollback;
