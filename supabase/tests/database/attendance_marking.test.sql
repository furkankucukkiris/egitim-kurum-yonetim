-- Yoklama modülünün pgTAP testleri (20260810160000):
--   * Teacher yalnızca kendi oturumuna yoklama kaydedebilir.
--   * Mükerrer attendance satırı oluşmaz (upsert idempotent).
--   * Aktiflik tarihleri doğru uygulanır (henüz başlamamış / ayrılmış
--     öğrenci reddedilir).
--   * Kilitli oturuma teacher da admin de yazamaz; yalnızca admin,
--     gerekçe belirterek kilidi açabilir.
--   * Değişiklikler audit_logs'a yazılır.
--
-- Çalıştırma: `npx supabase start` sonrasında `npx supabase test db`.
-- Bu dosya tek bir transaction içinde çalışır ve sonunda rollback
-- edilir.

begin;

select plan(20);

-- ---------------------------------------------------------------
-- Fixture kurulumu (superuser olarak).
-- ---------------------------------------------------------------

delete from public.audit_logs;
delete from public.attendance;
delete from public.lesson_sessions;
delete from public.enrollments;
delete from public.class_groups;
delete from public.courses;
delete from public.students;
delete from public.profiles;
delete from public.organizations;

insert into public.organizations (id, name)
values ('c0000000-0000-0000-0000-000000000001', 'Test Kurumu');

insert into auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
values
  ('c0000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@ornek.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('c0000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ogretmen1@ornek.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('c0000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ogretmen2@ornek.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

insert into public.profiles (id, organization_id, full_name, role, is_active)
values
  ('c0000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-000000000001', 'Admin', 'admin', true),
  ('c0000000-0000-0000-0000-0000000000a2', 'c0000000-0000-0000-0000-000000000001', 'Öğretmen 1', 'teacher', true),
  ('c0000000-0000-0000-0000-0000000000a3', 'c0000000-0000-0000-0000-000000000001', 'Öğretmen 2', 'teacher', true);

insert into public.courses (id, organization_id, name, course_type, default_monthly_fee)
values ('c0000000-0000-0000-0000-0000000c0001', 'c0000000-0000-0000-0000-000000000001', 'Piyano', 'individual', 1000);

insert into public.class_groups (id, organization_id, course_id, teacher_profile_id, name, weekday, start_time)
values (
  'c0000000-0000-0000-0000-0000000b0001',
  'c0000000-0000-0000-0000-000000000001',
  'c0000000-0000-0000-0000-0000000c0001',
  'c0000000-0000-0000-0000-0000000000a2',
  'Piyano A Grubu', 1, '10:00'
);

-- Sabit bir tarihte (2026-06-15) gerçekleşen ders oturumu, öğretmen 1'e ait.
insert into public.lesson_sessions (id, organization_id, class_group_id, course_id, teacher_profile_id, starts_at, ends_at)
values (
  'c0000000-0000-0000-0000-0000000000e1',
  'c0000000-0000-0000-0000-000000000001',
  'c0000000-0000-0000-0000-0000000b0001',
  'c0000000-0000-0000-0000-0000000c0001',
  'c0000000-0000-0000-0000-0000000000a2',
  (date '2026-06-15' + time '10:00') at time zone 'Europe/Istanbul',
  (date '2026-06-15' + time '11:00') at time zone 'Europe/Istanbul'
);

insert into public.students (id, organization_id, first_name, last_name)
values
  ('c0000000-0000-0000-0000-0000000d0001', 'c0000000-0000-0000-0000-000000000001', 'Ali', 'Yılmaz'),
  ('c0000000-0000-0000-0000-0000000d0002', 'c0000000-0000-0000-0000-000000000001', 'Ayşe', 'Kara'),
  ('c0000000-0000-0000-0000-0000000d0003', 'c0000000-0000-0000-0000-000000000001', 'Can', 'Demir');

-- Ali: oturum tarihinde aktif kayıtlı (roster'da olmalı).
insert into public.enrollments (id, organization_id, student_id, course_id, class_group_id, teacher_profile_id, starts_on, ends_on, status, list_monthly_fee, net_monthly_fee)
values (
  'c0000000-0000-0000-0000-0000000f0001', 'c0000000-0000-0000-0000-000000000001',
  'c0000000-0000-0000-0000-0000000d0001', 'c0000000-0000-0000-0000-0000000c0001',
  'c0000000-0000-0000-0000-0000000b0001', 'c0000000-0000-0000-0000-0000000000a2',
  date '2026-06-15' - 30, null, 'active', 1000, 1000
);

-- Ayşe: kaydı gelecekte başlıyor (henüz roster'da olmamalı).
insert into public.enrollments (id, organization_id, student_id, course_id, class_group_id, teacher_profile_id, starts_on, ends_on, status, list_monthly_fee, net_monthly_fee)
values (
  'c0000000-0000-0000-0000-0000000f0002', 'c0000000-0000-0000-0000-000000000001',
  'c0000000-0000-0000-0000-0000000d0002', 'c0000000-0000-0000-0000-0000000c0001',
  'c0000000-0000-0000-0000-0000000b0001', 'c0000000-0000-0000-0000-0000000000a2',
  date '2026-06-15' + 5, null, 'active', 1000, 1000
);

-- Can: kaydı geçmişte sona ermiş (artık roster'da olmamalı).
insert into public.enrollments (id, organization_id, student_id, course_id, class_group_id, teacher_profile_id, starts_on, ends_on, status, list_monthly_fee, net_monthly_fee)
values (
  'c0000000-0000-0000-0000-0000000f0003', 'c0000000-0000-0000-0000-000000000001',
  'c0000000-0000-0000-0000-0000000d0003', 'c0000000-0000-0000-0000-0000000c0001',
  'c0000000-0000-0000-0000-0000000b0001', 'c0000000-0000-0000-0000-0000000000a2',
  date '2026-06-15' - 60, date '2026-06-15' - 5, 'active', 1000, 1000
);

-- ---------------------------------------------------------------
-- Öğretmen 1: kendi oturumunun roster'ını görür, yalnızca aktif
-- kayıtlı öğrenciyi (Ali) içerir.
-- ---------------------------------------------------------------

select set_config('request.jwt.claims', json_build_object('sub', 'c0000000-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(
  (select count(*)::int from public.get_attendance_roster(array['c0000000-0000-0000-0000-0000000000e1']::uuid[])),
  1,
  'roster yalnızca o tarihte aktif kayıtlı öğrenciyi içerir (Ayşe/Can dışlanır)'
);

select is(
  (select student_first_name from public.get_attendance_roster(array['c0000000-0000-0000-0000-0000000000e1']::uuid[]) limit 1),
  'Ali',
  'roster''daki tek öğrenci Ali'
);

-- Tekil işaretleme.
select lives_ok(
  $$ select public.mark_attendance(
    'c0000000-0000-0000-0000-0000000000e1',
    '[{"student_id": "c0000000-0000-0000-0000-0000000d0001", "status": "present"}]'::jsonb
  ) $$,
  'öğretmen kendi oturumu için yoklama girebilir'
);

select is(
  (select count(*)::int from public.attendance where lesson_session_id = 'c0000000-0000-0000-0000-0000000000e1'),
  1,
  'bir attendance satırı oluştu'
);

select is(
  (select status::text from public.attendance where lesson_session_id = 'c0000000-0000-0000-0000-0000000000e1' and student_id = 'c0000000-0000-0000-0000-0000000d0001'),
  'present',
  'durum present olarak kaydedildi'
);

-- Aynı öğrenci için tekrar işaretleme (durum değişikliği) — upsert,
-- mükerrer satır oluşturmamalı.
select lives_ok(
  $$ select public.mark_attendance(
    'c0000000-0000-0000-0000-0000000000e1',
    '[{"student_id": "c0000000-0000-0000-0000-0000000d0001", "status": "absent", "note": "haber verildi"}]'::jsonb
  ) $$,
  'aynı öğrenci için tekrar işaretleme (upsert) hata vermez'
);

select is(
  (select count(*)::int from public.attendance where lesson_session_id = 'c0000000-0000-0000-0000-0000000000e1'),
  1,
  'ikinci işaretlemeden sonra hâlâ tek satır var (mükerrer satır oluşmadı)'
);

select is(
  (select status::text from public.attendance where lesson_session_id = 'c0000000-0000-0000-0000-0000000000e1' and student_id = 'c0000000-0000-0000-0000-0000000d0001'),
  'absent',
  'durum absent olarak güncellendi'
);

-- Henüz kaydı başlamamış / sona ermiş öğrenci reddedilmeli.
select throws_ok(
  $$ select public.mark_attendance(
    'c0000000-0000-0000-0000-0000000000e1',
    '[{"student_id": "c0000000-0000-0000-0000-0000000d0002", "status": "present"}]'::jsonb
  ) $$,
  'P0001',
  'Öğrenci bu oturum tarihinde bu programa kayıtlı değil.',
  'henüz başlamamış kayıt için yoklama girilemez'
);

select throws_ok(
  $$ select public.mark_attendance(
    'c0000000-0000-0000-0000-0000000000e1',
    '[{"student_id": "c0000000-0000-0000-0000-0000000d0003", "status": "present"}]'::jsonb
  ) $$,
  'P0001',
  'Öğrenci bu oturum tarihinde bu programa kayıtlı değil.',
  'daha önce ayrılmış kayıt için yoklama girilemez'
);

reset role;

-- ---------------------------------------------------------------
-- Öğretmen 2: bu oturumun sahibi değil.
-- ---------------------------------------------------------------

select set_config('request.jwt.claims', json_build_object('sub', 'c0000000-0000-0000-0000-0000000000a3', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(
  (select count(*)::int from public.get_attendance_roster(array['c0000000-0000-0000-0000-0000000000e1']::uuid[])),
  0,
  'başka öğretmenin oturumu roster''da görünmez'
);

select throws_ok(
  $$ select public.mark_attendance(
    'c0000000-0000-0000-0000-0000000000e1',
    '[{"student_id": "c0000000-0000-0000-0000-0000000d0001", "status": "present"}]'::jsonb
  ) $$,
  'P0001',
  'Bu oturum için yoklama girme yetkiniz bulunmuyor.',
  'başka öğretmenin oturumuna yoklama giremez'
);

reset role;

-- ---------------------------------------------------------------
-- Audit log: iki başarılı işaretleme (present, sonra absent) en az
-- iki attendance kaydı bırakmış olmalı.
-- ---------------------------------------------------------------

select ok(
  (select count(*)::int from public.audit_logs where table_name = 'attendance') >= 2,
  'yoklama değişiklikleri audit_logs''a yazıldı'
);

-- ---------------------------------------------------------------
-- Kilitleme: yalnızca admin kilitleyebilir; kilitliyken hiç kimse
-- (öğretmen dahil) yoklama değiştiremez; admin yalnızca gerekçeyle
-- kilidi açabilir.
-- ---------------------------------------------------------------

select set_config('request.jwt.claims', json_build_object('sub', 'c0000000-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  $$ select public.lock_session_attendance('c0000000-0000-0000-0000-0000000000e1') $$,
  'P0001',
  'Yoklama kilitleme yetkiniz bulunmuyor.',
  'öğretmen yoklama kilitleyemez'
);

reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'c0000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

select lives_ok(
  $$ select public.lock_session_attendance('c0000000-0000-0000-0000-0000000000e1') $$,
  'admin oturumu kilitleyebilir'
);

reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'c0000000-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  $$ select public.mark_attendance(
    'c0000000-0000-0000-0000-0000000000e1',
    '[{"student_id": "c0000000-0000-0000-0000-0000000d0001", "status": "present"}]'::jsonb
  ) $$,
  'P0001',
  'Bu oturumun yoklaması kilitli; değişiklik için yönetici kilidi açmalıdır.',
  'öğretmen kilitli oturuma yazamaz'
);

reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'c0000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  $$ select public.mark_attendance(
    'c0000000-0000-0000-0000-0000000000e1',
    '[{"student_id": "c0000000-0000-0000-0000-0000000d0001", "status": "present"}]'::jsonb
  ) $$,
  'P0001',
  'Bu oturumun yoklaması kilitli; değişiklik için yönetici kilidi açmalıdır.',
  'kilitliyken admin de yazamaz'
);

select throws_ok(
  $$ select public.unlock_session_attendance('c0000000-0000-0000-0000-0000000000e1', '') $$,
  'P0001',
  'Kilidi açma gerekçesi zorunludur.',
  'gerekçesiz kilit açma reddedilir'
);

select lives_ok(
  $$ select public.unlock_session_attendance('c0000000-0000-0000-0000-0000000000e1', 'Yanlış işaretlenmiş, düzeltiliyor') $$,
  'admin gerekçeyle kilidi açabilir'
);

select lives_ok(
  $$ select public.mark_attendance(
    'c0000000-0000-0000-0000-0000000000e1',
    '[{"student_id": "c0000000-0000-0000-0000-0000000d0001", "status": "present"}]'::jsonb
  ) $$,
  'kilit açıldıktan sonra yoklama tekrar değiştirilebilir'
);

reset role;

select * from finish();

rollback;
