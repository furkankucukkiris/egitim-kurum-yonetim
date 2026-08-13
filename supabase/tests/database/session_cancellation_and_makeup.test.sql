-- Ders iptali / yeniden planlama / telafi hakkı pgTAP testleri
-- (20260811100000):
--   * Bir telafi hakkı iki kez kullanılamaz.
--   * İptal → telafi bağlantısı (source_attendance_id/
--     source_lesson_session_id) geriye dönük izlenebilir.
--   * Grup dersinde mevcut oturuma ekleme ve birebir/tekil yeni
--     oturum oluşturma yolları çalışır.
--   * Çakışmalı (öğretmen/öğrenci) telafi reddedilir.
--   * Finans tabloları (accruals) iptal/telafi ile kendiliğinden
--     değişmez.
--   * Teacher yalnızca talep oluşturur; nihai onay admin'e aittir.
--
-- Çalıştırma: `npx supabase start` sonrasında `npx supabase test db`.
-- Bu dosya tek bir transaction içinde çalışır ve sonunda rollback
-- edilir.

begin;

select plan(24);

-- ---------------------------------------------------------------
-- Fixture kurulumu (superuser olarak).
-- ---------------------------------------------------------------

delete from public.audit_logs;
delete from public.session_change_requests;
delete from public.makeup_credits;
delete from public.attendance;
delete from public.accruals;
delete from public.lesson_sessions;
delete from public.enrollments;
delete from public.class_groups;
delete from public.courses;
delete from public.students;
delete from public.profiles;
delete from public.organizations;

insert into public.organizations (id, name)
values ('d0000000-0000-0000-0000-000000000001', 'Test Kurumu');

insert into auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
values
  ('d0000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@ornek.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('d0000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ogretmen-a@ornek.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('d0000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ogretmen-b@ornek.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

insert into public.profiles (id, organization_id, full_name, role, is_active)
values
  ('d0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-000000000001', 'Admin', 'admin', true),
  ('d0000000-0000-0000-0000-0000000000a2', 'd0000000-0000-0000-0000-000000000001', 'Öğretmen A', 'teacher', true),
  ('d0000000-0000-0000-0000-0000000000a3', 'd0000000-0000-0000-0000-000000000001', 'Öğretmen B', 'teacher', true);

-- Grup dersi: Resim. İki paralel grup (aynı ders, farklı zaman) —
-- ikinci grup telafi hedefi olarak kullanılacak.
insert into public.courses (id, organization_id, name, course_type, default_monthly_fee)
values ('d0000000-0000-0000-0000-0000000c0001', 'd0000000-0000-0000-0000-000000000001', 'Resim', 'group', 1000);

-- Birebir ders: Piyano.
insert into public.courses (id, organization_id, name, course_type, default_monthly_fee)
values ('d0000000-0000-0000-0000-0000000c0002', 'd0000000-0000-0000-0000-000000000001', 'Piyano', 'individual', 1200);

insert into public.class_groups (id, organization_id, course_id, teacher_profile_id, name, weekday, start_time)
values
  ('d0000000-0000-0000-0000-0000000b0001', 'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000c0001', 'd0000000-0000-0000-0000-0000000000a2', 'Resim A Grubu', 1, '10:00'),
  ('d0000000-0000-0000-0000-0000000b0002', 'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000c0001', 'd0000000-0000-0000-0000-0000000000a2', 'Resim B Grubu', 3, '10:00'),
  ('d0000000-0000-0000-0000-0000000b0003', 'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000c0002', 'd0000000-0000-0000-0000-0000000000a3', 'Piyano - Y', 2, '14:00');

insert into public.students (id, organization_id, first_name, last_name)
values
  ('d0000000-0000-0000-0000-0000000d0001', 'd0000000-0000-0000-0000-000000000001', 'Ali', 'Yılmaz'),
  ('d0000000-0000-0000-0000-0000000d0002', 'd0000000-0000-0000-0000-000000000001', 'Zeynep', 'Kaya');

insert into public.enrollments (id, organization_id, student_id, course_id, class_group_id, teacher_profile_id, starts_on, status, list_monthly_fee, net_monthly_fee)
values
  ('d0000000-0000-0000-0000-0000000f0001', 'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000d0001', 'd0000000-0000-0000-0000-0000000c0001', 'd0000000-0000-0000-0000-0000000b0001', 'd0000000-0000-0000-0000-0000000000a2', date '2026-06-01' - 30, 'active', 1000, 1000),
  ('d0000000-0000-0000-0000-0000000f0002', 'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000d0002', 'd0000000-0000-0000-0000-0000000c0002', 'd0000000-0000-0000-0000-0000000b0003', 'd0000000-0000-0000-0000-0000000000a3', date '2026-06-01' - 30, 'active', 1200, 1200);

-- Ali'nin normal Resim A oturumu — iptal edilecek.
insert into public.lesson_sessions (id, organization_id, class_group_id, course_id, teacher_profile_id, starts_at, ends_at)
values (
  'd0000000-0000-0000-0000-0000000000e1', 'd0000000-0000-0000-0000-000000000001',
  'd0000000-0000-0000-0000-0000000b0001', 'd0000000-0000-0000-0000-0000000c0001', 'd0000000-0000-0000-0000-0000000000a2',
  (date '2026-06-01' + time '10:00') at time zone 'Europe/Istanbul',
  (date '2026-06-01' + time '11:00') at time zone 'Europe/Istanbul'
);

-- Resim B'nin yaklaşan bir oturumu — telafi hedefi.
insert into public.lesson_sessions (id, organization_id, class_group_id, course_id, teacher_profile_id, starts_at, ends_at)
values (
  'd0000000-0000-0000-0000-0000000000e2', 'd0000000-0000-0000-0000-000000000001',
  'd0000000-0000-0000-0000-0000000b0002', 'd0000000-0000-0000-0000-0000000c0001', 'd0000000-0000-0000-0000-0000000000a2',
  (date '2026-06-03' + time '10:00') at time zone 'Europe/Istanbul',
  (date '2026-06-03' + time '11:00') at time zone 'Europe/Istanbul'
);

-- Zeynep'in Piyano oturumu — makeup_due için.
insert into public.lesson_sessions (id, organization_id, class_group_id, course_id, teacher_profile_id, starts_at, ends_at)
values (
  'd0000000-0000-0000-0000-0000000000e3', 'd0000000-0000-0000-0000-000000000001',
  'd0000000-0000-0000-0000-0000000b0003', 'd0000000-0000-0000-0000-0000000c0002', 'd0000000-0000-0000-0000-0000000000a3',
  (date '2026-06-01' + time '14:00') at time zone 'Europe/Istanbul',
  (date '2026-06-01' + time '15:00') at time zone 'Europe/Istanbul'
);

-- Öğretmen A'nın, teacher talebi/admin onayı testinde kullanılacak
-- ayrı, ilgisiz bir oturumu.
insert into public.lesson_sessions (id, organization_id, class_group_id, course_id, teacher_profile_id, starts_at, ends_at)
values (
  'd0000000-0000-0000-0000-0000000000e4', 'd0000000-0000-0000-0000-000000000001',
  'd0000000-0000-0000-0000-0000000b0001', 'd0000000-0000-0000-0000-0000000c0001', 'd0000000-0000-0000-0000-0000000000a2',
  (date '2026-06-08' + time '10:00') at time zone 'Europe/Istanbul',
  (date '2026-06-08' + time '11:00') at time zone 'Europe/Istanbul'
);

-- Ali için mevcut bir tahakkuk — iptal/telafi ile bozulmamalı.
insert into public.accruals (id, organization_id, enrollment_id, student_id, period_start, due_date, description, gross_amount, net_amount)
values (
  'd0000000-0000-0000-0000-0000000a0001', 'd0000000-0000-0000-0000-000000000001',
  'd0000000-0000-0000-0000-0000000f0001', 'd0000000-0000-0000-0000-0000000d0001',
  date '2026-06-01', date '2026-06-05', 'Haziran', 1000, 1000
);

-- ---------------------------------------------------------------
-- 1) Admin, Resim A oturumunu iptal eder — kurum kaynaklı.
-- ---------------------------------------------------------------

select set_config('request.jwt.claims', json_build_object('sub', 'd0000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

select lives_ok(
  $$ select public.cancel_lesson_session('d0000000-0000-0000-0000-0000000000e1', 'Öğretmen raporlu') $$,
  'admin oturumu iptal edebilir'
);

select is(
  (select status::text from public.attendance where lesson_session_id = 'd0000000-0000-0000-0000-0000000000e1' and student_id = 'd0000000-0000-0000-0000-0000000d0001'),
  'institution_cancelled',
  'iptal edilen oturumda yoklama institution_cancelled olarak tutarlı hale gelir'
);

select is(
  (select count(*)::int from public.makeup_credits where source_lesson_session_id = 'd0000000-0000-0000-0000-0000000000e1' and reason = 'institution_cancelled'),
  1,
  'kurum kaynaklı iptal, açık bir telafi hakkı oluşturur'
);

select is(
  (
    select mc.source_attendance_id
    from public.makeup_credits mc
    where mc.source_lesson_session_id = 'd0000000-0000-0000-0000-0000000000e1'
  ),
  (
    select a.id from public.attendance a
    where a.lesson_session_id = 'd0000000-0000-0000-0000-0000000000e1'
      and a.student_id = 'd0000000-0000-0000-0000-0000000d0001'
  ),
  'telafi hakkı, kaynak yoklama satırına geriye dönük izlenebilir şekilde bağlı'
);

select is(
  (select net_amount from public.accruals where id = 'd0000000-0000-0000-0000-0000000a0001'),
  1000::numeric,
  'iptal işlemi mevcut tahakkuku değiştirmez'
);

-- ---------------------------------------------------------------
-- 2) Grup dersinde: telafiyi mevcut uygun bir gruba (Resim B) ekle.
-- ---------------------------------------------------------------

select lives_ok(
  $$
  select public.schedule_makeup(
    (select id from public.makeup_credits where source_lesson_session_id = 'd0000000-0000-0000-0000-0000000000e1'),
    'd0000000-0000-0000-0000-0000000000e2'
  )
  $$,
  'açık telafi hakkı mevcut uygun bir gruba eklenebilir'
);

select is(
  (select status::text from public.makeup_credits where source_lesson_session_id = 'd0000000-0000-0000-0000-0000000000e1'),
  'used',
  'telafi hakkı kullanıldı olarak işaretlendi'
);

-- Aynı hakkı ikinci kez kullanmaya çalışmak reddedilmeli.
select throws_ok(
  $$
  select public.schedule_makeup(
    (select id from public.makeup_credits where source_lesson_session_id = 'd0000000-0000-0000-0000-0000000000e1'),
    'd0000000-0000-0000-0000-0000000000e2'
  )
  $$,
  'P0001',
  'Bu telafi hakkı zaten kullanılmış veya iptal edilmiş.',
  'bir telafi hakkı iki kez kullanılamaz'
);

reset role;

-- Öğretmen A, telafi misafirini kendi oturumunun roster''ında
-- görebilir ve TELAFİ etiketiyle ayırt edilebilir.
select set_config('request.jwt.claims', json_build_object('sub', 'd0000000-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(
  (
    select is_makeup_guest
    from public.get_attendance_roster(array['d0000000-0000-0000-0000-0000000000e2']::uuid[])
    where student_id = 'd0000000-0000-0000-0000-0000000d0001'
  ),
  true,
  'telafi misafiri roster''da is_makeup_guest=true ile ayrı etiketleniyor'
);

select lives_ok(
  $$
  select public.mark_attendance(
    'd0000000-0000-0000-0000-0000000000e2',
    '[{"student_id": "d0000000-0000-0000-0000-0000000d0001", "status": "present"}]'::jsonb
  )
  $$,
  'telafi misafirinin yoklaması normal roster gibi işlenebilir'
);

reset role;

-- ---------------------------------------------------------------
-- 3) Birebir/tekil telafi: Zeynep'in Piyano dersinde makeup_due
--    işaretlenmesi yeni bir açık hak oluşturur; bu hak yeni, tek
--    seferlik bir telafi oturumuna planlanır.
-- ---------------------------------------------------------------

select set_config('request.jwt.claims', json_build_object('sub', 'd0000000-0000-0000-0000-0000000000a3', 'role', 'authenticated')::text, true);
set local role authenticated;

select lives_ok(
  $$
  select public.mark_attendance(
    'd0000000-0000-0000-0000-0000000000e3',
    '[{"student_id": "d0000000-0000-0000-0000-0000000d0002", "status": "makeup_due"}]'::jsonb
  )
  $$,
  'öğrenci makeup_due olarak işaretlenebilir'
);

reset role;

select is(
  (select count(*)::int from public.makeup_credits where reason = 'student_absence'),
  1,
  'makeup_due işaretlemesi öğrenci kaynaklı bir telafi hakkı oluşturur (kurum kaynaklıdan ayrı)'
);

select set_config('request.jwt.claims', json_build_object('sub', 'd0000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

-- Çakışma: aynı saatte (Zeynep'in kendi Piyano oturumuyla aynı an)
-- öğretmen B için yeni bir telafi oturumu açmaya çalışmak, öğretmen
-- çakışması yüzünden reddedilmeli.
select throws_ok(
  $$
  select public.schedule_makeup(
    (select id from public.makeup_credits where reason = 'student_absence'),
    null,
    'd0000000-0000-0000-0000-0000000000a3',
    null,
    (date '2026-06-01' + time '14:00') at time zone 'Europe/Istanbul',
    (date '2026-06-01' + time '15:00') at time zone 'Europe/Istanbul'
  )
  $$,
  'P0001',
  'Seçilen saatte öğretmen veya derslik uygun değil.',
  'çakışan öğretmen saatinde telafi oturumu oluşturulamaz'
);

-- Çakışma: farklı bir öğretmenle ama öğrencinin (Zeynep) kendi
-- Piyano dersiyle aynı saatte yeni oturum açmak, öğrenci çakışması
-- yüzünden reddedilmeli.
select throws_ok(
  $$
  select public.schedule_makeup(
    (select id from public.makeup_credits where reason = 'student_absence'),
    null,
    'd0000000-0000-0000-0000-0000000000a2',
    null,
    (date '2026-06-01' + time '14:00') at time zone 'Europe/Istanbul',
    (date '2026-06-01' + time '15:00') at time zone 'Europe/Istanbul'
  )
  $$,
  'P0001',
  'Öğrencinin bu saatte başka bir programı var.',
  'öğrencinin kendi programıyla çakışan telafi oturumu oluşturulamaz'
);

-- Çakışmasız bir saatte yeni telafi oturumu başarıyla oluşturulur.
select lives_ok(
  $$
  select public.schedule_makeup(
    (select id from public.makeup_credits where reason = 'student_absence'),
    null,
    'd0000000-0000-0000-0000-0000000000a3',
    'Telafi Odası',
    (date '2026-06-05' + time '16:00') at time zone 'Europe/Istanbul',
    (date '2026-06-05' + time '17:00') at time zone 'Europe/Istanbul'
  )
  $$,
  'çakışmasız saatte yeni, tek seferlik telafi oturumu oluşturulabilir'
);

select is(
  (
    select ls.is_makeup
    from public.makeup_credits mc
    inner join public.lesson_sessions ls on ls.id = mc.used_lesson_session_id
    where mc.reason = 'student_absence'
  ),
  true,
  'yeni telafi oturumu is_makeup=true olarak işaretlenir'
);

select is(
  (select count(*)::int from public.accruals),
  1,
  'telafi planlama, tahakkuk sayısını değiştirmez (finans elle yönetilir)'
);

-- ---------------------------------------------------------------
-- 4) Teacher yalnızca talep oluşturabilir; nihai onay admin'e ait.
-- ---------------------------------------------------------------

reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'd0000000-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  $$ select public.cancel_lesson_session('d0000000-0000-0000-0000-0000000000e4', 'Öğretmen isteği') $$,
  'P0001',
  'Ders oturumu iptal etme yetkiniz bulunmuyor.',
  'öğretmen doğrudan oturum iptal edemez'
);

select lives_ok(
  $$ select public.request_session_change('d0000000-0000-0000-0000-0000000000e4', 'cancel', 'Sağlık sorunu') $$,
  'öğretmen kendi oturumu için değişiklik talebi oluşturabilir'
);

reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'd0000000-0000-0000-0000-0000000000a3', 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  $$ select public.request_session_change('d0000000-0000-0000-0000-0000000000e4', 'cancel', 'İlgisiz talep') $$,
  'P0001',
  'Bu oturum için değişiklik talebi oluşturma yetkiniz bulunmuyor.',
  'öğretmen başka öğretmenin oturumu için talep oluşturamaz'
);

reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'd0000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(
  (select count(*)::int from public.get_pending_session_change_requests()),
  1,
  'admin bekleyen değişiklik talebini görür'
);

select lives_ok(
  $$
  select public.review_session_change_request(
    (select id from public.session_change_requests where lesson_session_id = 'd0000000-0000-0000-0000-0000000000e4'),
    true,
    'Uygun görüldü'
  )
  $$,
  'admin talebi onaylayabilir'
);

select isnt(
  (select cancelled_at from public.lesson_sessions where id = 'd0000000-0000-0000-0000-0000000000e4'),
  null,
  'onaylanan iptal talebi gerçekten uygulanır'
);

select is(
  (select status::text from public.session_change_requests where lesson_session_id = 'd0000000-0000-0000-0000-0000000000e4'),
  'approved',
  'talep durumu approved olarak güncellenir'
);

reset role;

select * from finish();

rollback;
