-- Öğretmen not/talep testleri (20261005100000):
--   * Öğretmen yalnızca kendi öğrencisine / kendi oturumuna bağlı talep
--     açabilir; tabloya doğrudan yazamaz.
--   * Öğretmen başka öğretmenin taleplerini ve yanıtlarını göremez,
--     konuyu kapatamaz; kapanmış konuya yazınca konu yeniden açılır.
--   * Yönetici yanıt yazıp kapatır; öğretmenin menü sayacı yanıtla
--     artar, listeyi görünce sıfırlanır.
--   * Başka kurumun yöneticisi talebi göremez.
--
-- Çalıştırma: `npx supabase start` sonrasında `npx supabase test db`.
-- Tek transaction içinde çalışır ve sonunda rollback edilir.

begin;

select plan(17);

insert into public.organizations (id, name)
values
  ('c1000001-0000-0000-0000-000000000001', 'Talep Org 1'),
  ('c1000002-0000-0000-0000-000000000001', 'Talep Org 2');

insert into auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
values
  ('c1000001-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'talep-admin1@ornek.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('c1000001-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'talep-ogretmen1@ornek.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('c1000001-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'talep-ogretmen2@ornek.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('c1000002-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'talep-admin2@ornek.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

insert into public.profiles (id, organization_id, full_name, role, is_active)
values
  ('c1000001-0000-0000-0000-0000000000a1', 'c1000001-0000-0000-0000-000000000001', 'Admin 1', 'admin', true),
  ('c1000001-0000-0000-0000-0000000000a2', 'c1000001-0000-0000-0000-000000000001', 'Öğretmen 1', 'teacher', true),
  ('c1000001-0000-0000-0000-0000000000a3', 'c1000001-0000-0000-0000-000000000001', 'Öğretmen 2', 'teacher', true),
  ('c1000002-0000-0000-0000-0000000000a1', 'c1000002-0000-0000-0000-000000000001', 'Admin 2', 'admin', true);

insert into public.courses (id, organization_id, name, course_type, default_monthly_fee)
values ('c1000001-0000-0000-0000-0000000c0001', 'c1000001-0000-0000-0000-000000000001', 'Resim', 'individual', 1000);

insert into public.class_groups (id, organization_id, course_id, teacher_profile_id, name, weekday, start_time)
values (
  'c1000001-0000-0000-0000-0000000b0001',
  'c1000001-0000-0000-0000-000000000001',
  'c1000001-0000-0000-0000-0000000c0001',
  'c1000001-0000-0000-0000-0000000000a2',
  'Resim A', 1, '10:00'
);

insert into public.students (id, organization_id, first_name, last_name, identity_number)
values
  ('c1000001-0000-0000-0000-0000000d0001', 'c1000001-0000-0000-0000-000000000001', 'Ayşe', 'Kaya', '11111111110'),
  ('c1000001-0000-0000-0000-0000000d0002', 'c1000001-0000-0000-0000-000000000001', 'Mehmet', 'Ak', '22222222220');

insert into public.enrollments (
  id, organization_id, student_id, course_id, class_group_id, teacher_profile_id,
  starts_on, status, list_monthly_fee, discount_type, discount_value, net_monthly_fee
)
values (
  'c1000001-0000-0000-0000-0000000e0001',
  'c1000001-0000-0000-0000-000000000001',
  'c1000001-0000-0000-0000-0000000d0001',
  'c1000001-0000-0000-0000-0000000c0001',
  'c1000001-0000-0000-0000-0000000b0001',
  'c1000001-0000-0000-0000-0000000000a2',
  current_date, 'active', 1000, 'none', 0, 1000
);

create temp table _ids (name text primary key, id uuid);
grant select, insert on _ids to public;

-- ---------------------------------------------------------------
-- Öğretmen 1
-- ---------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', 'c1000001-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);
set local role authenticated;

insert into _ids
select 'r1', public.create_teacher_request('Ayşe için tuval alınmalı', 'c1000001-0000-0000-0000-0000000d0001', null);

select is(
  (select count(*)::int from public.teacher_requests where id = (select id from _ids where name = 'r1') and status = 'open'),
  1,
  'öğretmen kendi öğrencisine bağlı açık talep oluşturur'
);

select throws_ok(
  $$ select public.create_teacher_request('Mehmet için not', 'c1000001-0000-0000-0000-0000000d0002', null) $$,
  'P0001',
  'Seçilen öğrenci size kayıtlı değil.',
  'öğretmen kendisine kayıtlı olmayan öğrenciye talep bağlayamaz'
);

select throws_ok(
  $$ select public.create_teacher_request('   ', null, null) $$,
  'P0001',
  'Not 1-2000 karakter arasında olmalıdır.',
  'boş not reddedilir'
);

select throws_ok(
  $$ insert into public.teacher_requests (organization_id, teacher_profile_id, author_profile_id, body)
     values ('c1000001-0000-0000-0000-000000000001', 'c1000001-0000-0000-0000-0000000000a2', 'c1000001-0000-0000-0000-0000000000a2', 'x') $$,
  '42501',
  null,
  'öğretmen tabloya doğrudan yazamaz'
);

select throws_ok(
  format($$ select public.set_teacher_request_status(%L, 'resolved') $$, (select id from _ids where name = 'r1')),
  'P0001',
  'Konu durumunu yalnızca yönetici değiştirebilir.',
  'öğretmen konuyu kapatamaz'
);

select throws_ok(
  format($$ select public.reply_teacher_request(%L, 'kapat', true) $$, (select id from _ids where name = 'r1')),
  'P0001',
  'Konuyu yalnızca yönetici kapatabilir.',
  'öğretmen yanıtla birlikte de kapatamaz'
);

select is(public.teacher_request_badge_count(), 0, 'yanıt yokken öğretmen sayacı 0');

-- ---------------------------------------------------------------
-- Öğretmen 2: Öğretmen 1'in talebini göremez, yanıt yazamaz.
-- ---------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'c1000001-0000-0000-0000-0000000000a3', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((select count(*)::int from public.teacher_requests), 0, 'öğretmen 2 başkasının talebini görmez');

select throws_ok(
  format($$ select public.reply_teacher_request(%L, 'merhaba') $$, (select id from _ids where name = 'r1')),
  'P0001',
  'Not veya talep bulunamadı.',
  'öğretmen 2 başkasının talebine yanıt yazamaz'
);

-- ---------------------------------------------------------------
-- Yönetici: yanıt yazıp kapatır.
-- ---------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'c1000001-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(public.teacher_request_badge_count(), 1, 'yönetici sayacı açık talep sayısını gösterir');

select lives_ok(
  format($$ select public.reply_teacher_request(%L, 'Sipariş verildi', true) $$, (select id from _ids where name = 'r1')),
  'yönetici yanıt yazıp kapatır'
);

select is(
  (select status || ':' || (resolved_by is not null)::text from public.teacher_requests where id = (select id from _ids where name = 'r1')),
  'resolved:true',
  'talep kapandı ve kapatan kaydedildi'
);

select is(public.teacher_request_badge_count(), 0, 'kapanınca yönetici sayacı düşer');

-- ---------------------------------------------------------------
-- Öğretmen 1: yanıtı görür, sayaç artar; görünce sıfırlanır.
-- Kapanmış konuya yazınca konu yeniden açılır.
-- ---------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'c1000001-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(public.teacher_request_badge_count(), 1, 'yönetici yanıtı öğretmen sayacını artırır');

select public.mark_teacher_requests_seen();

select is(public.teacher_request_badge_count(), 0, 'öğretmen görünce sayaç sıfırlanır');

select public.reply_teacher_request((select id from _ids where name = 'r1'), 'Renkli boya da lazım');

select is(
  (select status from public.teacher_requests where id = (select id from _ids where name = 'r1')),
  'open',
  'öğretmen kapanmış konuya yazınca konu yeniden açılır'
);

-- ---------------------------------------------------------------
-- Başka kurumun yöneticisi görmez.
-- ---------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'c1000002-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(
  (select count(*)::int from public.teacher_requests) + (select count(*)::int from public.teacher_request_replies),
  0,
  'başka kurumun yöneticisi talep ve yanıtları görmez'
);

select * from finish();

rollback;
