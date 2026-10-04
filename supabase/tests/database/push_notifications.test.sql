-- Telefon bildirimi testleri (20261005120000):
--   * Ders 10 dk içinde başlıyorsa öğretmene hatırlatma kuyruğa girer,
--     tekrar çalıştırınca ikinci kez girmez; iptal edilen ders için girmez.
--   * Ders 15 dk önce bittiyse ve yoklama yoksa uyarı girer; yoklama
--     varsa girmez.
--   * Cihazı olmayan veya tercihi kapalı kullanıcıya bildirim girmez.
--   * Not açılınca yöneticiye, yönetici yanıtlayınca öğretmene; yanıtla
--     kapatmada tek bildirim, yanıtsız kapatmada "kapatıldı" bildirimi.
--   * Kullanıcı başkasının cihazını silemez, kuyruğu okuyamaz.
--
-- Çalıştırma: `npx supabase start` sonrasında `npx supabase test db`.
-- Tek transaction içinde çalışır ve sonunda rollback edilir.

begin;

select plan(15);

insert into public.organizations (id, name)
values ('c2000001-0000-0000-0000-000000000001', 'Bildirim Org');

insert into auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
values
  ('c2000001-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bildirim-admin@ornek.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('c2000001-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bildirim-ogretmen1@ornek.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('c2000001-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bildirim-ogretmen2@ornek.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

insert into public.profiles (id, organization_id, full_name, role, is_active)
values
  ('c2000001-0000-0000-0000-0000000000a1', 'c2000001-0000-0000-0000-000000000001', 'Admin', 'admin', true),
  ('c2000001-0000-0000-0000-0000000000a2', 'c2000001-0000-0000-0000-000000000001', 'Öğretmen 1', 'teacher', true),
  ('c2000001-0000-0000-0000-0000000000a3', 'c2000001-0000-0000-0000-000000000001', 'Öğretmen 2 (cihazsız)', 'teacher', true);

-- Cihazlar: admin ve öğretmen 1 var, öğretmen 2 yok.
insert into public.push_subscriptions (organization_id, profile_id, endpoint, p256dh, auth)
values
  ('c2000001-0000-0000-0000-000000000001', 'c2000001-0000-0000-0000-0000000000a1', 'https://push.example.test/admin', 'k', 'a'),
  ('c2000001-0000-0000-0000-000000000001', 'c2000001-0000-0000-0000-0000000000a2', 'https://push.example.test/t1', 'k', 'a');

insert into public.courses (id, organization_id, name, course_type, default_monthly_fee)
values ('c2000001-0000-0000-0000-0000000c0001', 'c2000001-0000-0000-0000-000000000001', 'Resim', 'individual', 1000);

insert into public.class_groups (id, organization_id, course_id, teacher_profile_id, name, weekday, start_time)
values
  ('c2000001-0000-0000-0000-0000000b0001', 'c2000001-0000-0000-0000-000000000001', 'c2000001-0000-0000-0000-0000000c0001', 'c2000001-0000-0000-0000-0000000000a2', 'Resim A', 1, '10:00'),
  ('c2000001-0000-0000-0000-0000000b0002', 'c2000001-0000-0000-0000-000000000001', 'c2000001-0000-0000-0000-0000000c0001', 'c2000001-0000-0000-0000-0000000000a3', 'Resim B', 2, '10:00');

insert into public.students (id, organization_id, first_name, last_name, identity_number)
values ('c2000001-0000-0000-0000-0000000d0001', 'c2000001-0000-0000-0000-000000000001', 'Ayşe', 'Kaya', '11111111110');

insert into public.enrollments (
  id, organization_id, student_id, course_id, class_group_id, teacher_profile_id,
  starts_on, status, list_monthly_fee, discount_type, discount_value, net_monthly_fee
)
values (
  'c2000001-0000-0000-0000-0000000e0001', 'c2000001-0000-0000-0000-000000000001',
  'c2000001-0000-0000-0000-0000000d0001', 'c2000001-0000-0000-0000-0000000c0001',
  'c2000001-0000-0000-0000-0000000b0001', 'c2000001-0000-0000-0000-0000000000a2',
  current_date - 30, 'active', 1000, 'none', 0, 1000
);

-- Oturumlar (çakışma tetikleyicisine takılmasın diye farklı saatler):
--   s1: 5 dk sonra başlıyor (hatırlatma)
--   s2: 5 dk sonra başlıyor ama iptal
--   s3: 40 dk sonra (henüz değil)
--   s4: 30 dk önce bitti, yoklama yok (uyarı)
--   s5: 110 dk önce bitti, yoklama var (uyarı yok)
--   s6: öğretmen 2'nin, 5 dk sonra — cihazı yok
alter table public.lesson_sessions disable trigger user;

insert into public.lesson_sessions (id, organization_id, class_group_id, course_id, teacher_profile_id, starts_at, ends_at, cancelled_at)
values
  ('c2000001-0000-0000-0000-000000005001', 'c2000001-0000-0000-0000-000000000001', 'c2000001-0000-0000-0000-0000000b0001', 'c2000001-0000-0000-0000-0000000c0001', 'c2000001-0000-0000-0000-0000000000a2', now() + interval '5 minutes', now() + interval '65 minutes', null),
  ('c2000001-0000-0000-0000-000000005002', 'c2000001-0000-0000-0000-000000000001', 'c2000001-0000-0000-0000-0000000b0001', 'c2000001-0000-0000-0000-0000000c0001', 'c2000001-0000-0000-0000-0000000000a2', now() + interval '7 minutes', now() + interval '67 minutes', now()),
  ('c2000001-0000-0000-0000-000000005003', 'c2000001-0000-0000-0000-000000000001', 'c2000001-0000-0000-0000-0000000b0001', 'c2000001-0000-0000-0000-0000000c0001', 'c2000001-0000-0000-0000-0000000000a2', now() + interval '40 minutes', now() + interval '100 minutes', null),
  ('c2000001-0000-0000-0000-000000005004', 'c2000001-0000-0000-0000-000000000001', 'c2000001-0000-0000-0000-0000000b0001', 'c2000001-0000-0000-0000-0000000c0001', 'c2000001-0000-0000-0000-0000000000a2', now() - interval '90 minutes', now() - interval '30 minutes', null),
  ('c2000001-0000-0000-0000-000000005005', 'c2000001-0000-0000-0000-000000000001', 'c2000001-0000-0000-0000-0000000b0001', 'c2000001-0000-0000-0000-0000000c0001', 'c2000001-0000-0000-0000-0000000000a2', now() - interval '170 minutes', now() - interval '110 minutes', null),
  ('c2000001-0000-0000-0000-000000005006', 'c2000001-0000-0000-0000-000000000001', 'c2000001-0000-0000-0000-0000000b0002', 'c2000001-0000-0000-0000-0000000c0001', 'c2000001-0000-0000-0000-0000000000a3', now() + interval '5 minutes', now() + interval '65 minutes', null);

alter table public.lesson_sessions enable trigger user;

alter table public.attendance disable trigger user;

insert into public.attendance (organization_id, lesson_session_id, enrollment_id, student_id, status)
values (
  'c2000001-0000-0000-0000-000000000001', 'c2000001-0000-0000-0000-000000005005',
  'c2000001-0000-0000-0000-0000000e0001', 'c2000001-0000-0000-0000-0000000d0001', 'present'
);

alter table public.attendance enable trigger user;

-- ---------------------------------------------------------------
-- Zamanlanmış hatırlatmalar
-- ---------------------------------------------------------------
select public.enqueue_scheduled_notifications();

select is(
  (select count(*)::int from public.notification_outbox
   where kind = 'lesson_reminder' and dedupe_key like 'lesson_reminder:c2000001-0000-0000-0000-000000005001:%'),
  1,
  '10 dk içinde başlayan ders için hatırlatma kuyruğa girer'
);

select is(
  (select count(*)::int from public.notification_outbox
   where dedupe_key like 'lesson_reminder:c2000001-0000-0000-0000-000000005002:%'
      or dedupe_key like 'lesson_reminder:c2000001-0000-0000-0000-000000005003:%'),
  0,
  'iptal edilen ve 10 dakikadan sonraki ders için hatırlatma girmez'
);

select is(
  (select count(*)::int from public.notification_outbox where profile_id = 'c2000001-0000-0000-0000-0000000000a3'),
  0,
  'cihazı olmayan öğretmene bildirim girmez'
);

select is(
  (select count(*)::int from public.notification_outbox where dedupe_key = 'attendance_reminder:c2000001-0000-0000-0000-000000005004'),
  1,
  'bitmiş ve yoklaması alınmamış ders için uyarı girer'
);

select is(
  (select count(*)::int from public.notification_outbox where dedupe_key = 'attendance_reminder:c2000001-0000-0000-0000-000000005005'),
  0,
  'yoklaması alınmış ders için uyarı girmez'
);

select public.enqueue_scheduled_notifications();

select is(
  (select count(*)::int from public.notification_outbox where organization_id = 'c2000001-0000-0000-0000-000000000001'),
  2,
  'tekrar çalıştırınca aynı bildirimler ikinci kez girmez'
);

-- Tercih kapalıysa girmez.
insert into public.notification_settings (profile_id, organization_id, lesson_reminder)
values ('c2000001-0000-0000-0000-0000000000a2', 'c2000001-0000-0000-0000-000000000001', false);

update public.lesson_sessions
set starts_at = starts_at + interval '1 minute', ends_at = ends_at + interval '1 minute'
where id = 'c2000001-0000-0000-0000-000000005001';

select public.enqueue_scheduled_notifications();

select is(
  (select count(*)::int from public.notification_outbox where kind = 'lesson_reminder'),
  1,
  'ders hatırlatması kapalıysa (saat değişse bile) yeni hatırlatma girmez'
);

delete from public.notification_settings;

-- ---------------------------------------------------------------
-- Gönderici: claim / complete
-- ---------------------------------------------------------------
create temp table _claimed as select * from public.claim_pending_notifications(50);

select is(
  (select jsonb_array_length(subscriptions) from _claimed limit 1),
  1,
  'gönderici bildirimi alıcının cihazlarıyla birlikte alır'
);

select is(
  (select count(*)::int from public.claim_pending_notifications(50)),
  0,
  'yeni alınan bildirim 1 dk dolmadan tekrar alınmaz'
);

select public.complete_notification(id, array[]::text[], array['https://push.example.test/t1'], 'gone')
from _claimed;

select is(
  (select count(*)::int from public.push_subscriptions where endpoint = 'https://push.example.test/t1'),
  0,
  'tarayıcının iptal ettiği cihaz silinir'
);

insert into public.push_subscriptions (organization_id, profile_id, endpoint, p256dh, auth)
values ('c2000001-0000-0000-0000-000000000001', 'c2000001-0000-0000-0000-0000000000a2', 'https://push.example.test/t1', 'k', 'a');

delete from public.notification_outbox;

-- ---------------------------------------------------------------
-- Not/talep bildirimleri
-- ---------------------------------------------------------------
create temp table _ids (name text primary key, id uuid);
grant select, insert on _ids to public;

select set_config('request.jwt.claims', json_build_object('sub', 'c2000001-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);
set local role authenticated;

insert into _ids select 'r1', public.create_teacher_request('Tuval lazım', null, null);

select public.delete_push_subscription('https://push.example.test/admin');

select throws_ok(
  $$ select count(*) from public.notification_outbox $$,
  '42501',
  null,
  'öğretmen bildirim kuyruğunu okuyamaz'
);

reset role;

select is(
  (select count(*)::int from public.notification_outbox where kind = 'request_new' and profile_id = 'c2000001-0000-0000-0000-0000000000a1'),
  1,
  'yeni not yöneticiye bildirilir'
);

select is(
  (select count(*)::int from public.push_subscriptions where endpoint = 'https://push.example.test/admin'),
  1,
  'öğretmen yöneticinin cihazını silemez'
);

select set_config('request.jwt.claims', json_build_object('sub', 'c2000001-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

select public.reply_teacher_request((select id from _ids where name = 'r1'), 'Sipariş verildi', true);

reset role;

select is(
  (select string_agg(kind, ',' order by kind) from public.notification_outbox where profile_id = 'c2000001-0000-0000-0000-0000000000a2'),
  'request_reply',
  'yanıtla ve kapat öğretmene tek bildirim gönderir'
);

-- Yanıtsız yeniden açma ayrı transaction gibi davranmalı; now() sabit
-- olduğu için yanıtı geçmişe çekip deniyoruz.
update public.teacher_request_replies set created_at = created_at - interval '1 minute';

select set_config('request.jwt.claims', json_build_object('sub', 'c2000001-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

select public.set_teacher_request_status((select id from _ids where name = 'r1'), 'open');

reset role;

select is(
  (select count(*)::int from public.notification_outbox where kind = 'request_status' and profile_id = 'c2000001-0000-0000-0000-0000000000a2'),
  1,
  'yanıtsız durum değişikliği öğretmene bildirilir'
);

select * from finish();

rollback;
