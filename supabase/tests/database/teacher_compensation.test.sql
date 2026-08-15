-- Öğretmen hakediş modülü pgTAP testleri
-- (20260812150000_add_teacher_compensation.sql).
--
-- Kapsam: etkin tarih aralığına göre doğru kuralın seçilmesi, dört
-- senaryonun (normal/kurum iptali/öğretmen devamsızlığı/telafi) ayrı
-- hesaplanması, per_lesson/per_minute/per_student/monthly_salary
-- modelleri, idempotent üretim (oturum başına tekil), onay→ödeme
-- sırası, kural anlık görüntüsünün (snapshot) kalıcılığı, ve
-- öğretmenin yalnızca kendi kayıtlarını görebilmesi.
--
-- Çalıştırma: `npx supabase start` sonrasında `npx supabase test db`.
-- Bu dosya tek bir transaction içinde çalışır ve sonunda rollback edilir.

begin;

select plan(42);

-- ---------------------------------------------------------------
-- Fixture kurulumu (superuser olarak). Cancelled/locked oturum
-- durumları, cancel_lesson_session()/mark_attendance() akışları ayrı
-- test dosyalarında zaten kapsandığı için burada doğrudan tabloya
-- yazılarak kısaltılıyor.
-- ---------------------------------------------------------------

delete from public.teacher_work_logs;
delete from public.teacher_compensation_rules;
delete from public.attendance;
delete from public.lesson_sessions;
delete from public.enrollments;
delete from public.students;
delete from public.courses;
delete from public.audit_logs;
delete from public.profiles;
delete from public.organizations;

insert into public.organizations (id, name)
values ('b8000000-0000-0000-0000-000000000001', 'Test Kurumu');

insert into auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
values
  ('b8000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@ornek.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('b8000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ogretmenA@ornek.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('b8000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ogretmenB@ornek.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

insert into public.profiles (id, organization_id, full_name, role, is_active)
values
  ('b8000000-0000-0000-0000-0000000000a1', 'b8000000-0000-0000-0000-000000000001', 'Admin', 'admin', true),
  ('b8000000-0000-0000-0000-0000000000a2', 'b8000000-0000-0000-0000-000000000001', 'Öğretmen A', 'teacher', true),
  ('b8000000-0000-0000-0000-0000000000a3', 'b8000000-0000-0000-0000-000000000001', 'Öğretmen B', 'teacher', true);

insert into public.courses (id, organization_id, name, course_type, default_duration_minutes, default_monthly_fee)
values ('b8000000-0000-0000-0000-0000000c0001', 'b8000000-0000-0000-0000-000000000001', 'Resim', 'group', 60, 1000);

insert into public.students (id, organization_id, first_name, last_name, status)
values
  ('b8000000-0000-0000-0000-0000000d0001', 'b8000000-0000-0000-0000-000000000001', 'Öğrenci', 'Bir', 'active'),
  ('b8000000-0000-0000-0000-0000000d0002', 'b8000000-0000-0000-0000-000000000001', 'Öğrenci', 'Iki', 'active'),
  ('b8000000-0000-0000-0000-0000000d0003', 'b8000000-0000-0000-0000-000000000001', 'Öğrenci', 'Uc', 'active');

insert into public.enrollments (
  id, organization_id, student_id, course_id, starts_on, ends_on, status,
  list_monthly_fee, net_monthly_fee, due_day
)
values
  ('b8000000-0000-0000-0000-0000000f0001', 'b8000000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-0000000d0001', 'b8000000-0000-0000-0000-0000000c0001', '2027-01-01', null, 'active', 1000, 1000, 5),
  ('b8000000-0000-0000-0000-0000000f0002', 'b8000000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-0000000d0002', 'b8000000-0000-0000-0000-0000000c0001', '2027-01-01', null, 'active', 1000, 1000, 5),
  ('b8000000-0000-0000-0000-0000000f0003', 'b8000000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-0000000d0003', 'b8000000-0000-0000-0000-0000000c0001', '2027-01-01', null, 'active', 1000, 1000, 5);

select set_config('request.jwt.claims', json_build_object('sub', 'b8000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

-- ---------------------------------------------------------------
-- Kural çakışması ve etkin tarih aralığı seçimi (Öğretmen A)
-- ---------------------------------------------------------------

select lives_ok(
  $$select public.create_teacher_compensation_rule(
    'b8000000-0000-0000-0000-0000000000a2'::uuid, 'per_minute', 10, '2027-01-01'::date, null,
    50, null, 'İlk kural'
  )$$,
  'ilk (açık uçlu) kural oluşturulur'
);

select throws_ok(
  $$select public.create_teacher_compensation_rule(
    'b8000000-0000-0000-0000-0000000000a2'::uuid, 'per_lesson', 100, '2027-05-01'::date, null
  )$$,
  'P0001', 'Bu öğretmen için seçilen tarih aralığıyla çakışan bir kural zaten var.',
  'çakışan tarih aralığıyla ikinci kural reddedilir'
);

select lives_ok(
  $$select public.end_teacher_compensation_rule(
    (select id from public.teacher_compensation_rules where teacher_profile_id = 'b8000000-0000-0000-0000-0000000000a2'),
    '2027-06-30'::date
  )$$,
  'ilk kural sonlandırılır'
);

select lives_ok(
  $$select public.create_teacher_compensation_rule(
    'b8000000-0000-0000-0000-0000000000a2'::uuid, 'per_lesson', 200, '2027-07-01'::date, null
  )$$,
  'sonlandırma sonrası çakışmayan ikinci kural oluşturulur'
);

-- ---------------------------------------------------------------
-- Öğretmen A oturumları — 4 senaryo (Şubat 2027, ilk kural: per_minute)
-- ---------------------------------------------------------------

insert into public.lesson_sessions (
  id, organization_id, course_id, teacher_profile_id, starts_at, ends_at,
  is_makeup, attendance_locked_at
)
values
  -- normal: 90 dakika, kilitli
  ('b8000000-0000-0000-0000-0000001e0001', 'b8000000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-0000000c0001', 'b8000000-0000-0000-0000-0000000000a2', '2027-02-03 10:00:00+03', '2027-02-03 11:30:00+03', false, now()),
  -- kurum iptali
  ('b8000000-0000-0000-0000-0000001e0002', 'b8000000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-0000000c0001', 'b8000000-0000-0000-0000-0000000000a2', '2027-02-05 10:00:00+03', '2027-02-05 11:00:00+03', false, null),
  -- öğretmen devamsızlığı
  ('b8000000-0000-0000-0000-0000001e0003', 'b8000000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-0000000c0001', 'b8000000-0000-0000-0000-0000000000a2', '2027-02-08 10:00:00+03', '2027-02-08 11:00:00+03', false, null),
  -- telafi, kilitli, 60 dakika
  ('b8000000-0000-0000-0000-0000001e0004', 'b8000000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-0000000c0001', 'b8000000-0000-0000-0000-0000000000a2', '2027-02-10 10:00:00+03', '2027-02-10 11:00:00+03', true, now()),
  -- henüz sonlanmamış (ne kilitli ne iptal) — üretime dahil olmamalı
  ('b8000000-0000-0000-0000-0000001e0005', 'b8000000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-0000000c0001', 'b8000000-0000-0000-0000-0000000000a2', '2027-02-12 10:00:00+03', '2027-02-12 11:00:00+03', false, null);

update public.lesson_sessions
set cancelled_at = now(), cancellation_reason = 'kurum kaynaklı', cancellation_kind = 'institution'
where id = 'b8000000-0000-0000-0000-0000001e0002';

update public.lesson_sessions
set cancelled_at = now(), cancellation_reason = 'öğretmen gelmedi', cancellation_kind = 'teacher_absence'
where id = 'b8000000-0000-0000-0000-0000001e0003';

select lives_ok(
  $$select public.generate_teacher_compensation('2027-02-01'::date)$$,
  'Şubat 2027 hakedişi hatasız üretilir'
);

select is(
  (select created_count from public.generate_teacher_compensation('2027-02-01'::date)),
  0,
  'aynı ay için ikinci çalıştırmada created_count = 0 (idempotent)'
);

select is(
  (select count(*)::int from public.teacher_work_logs where lesson_session_id = 'b8000000-0000-0000-0000-0000001e0005'),
  0,
  'henüz sonlanmamış (kilitli/iptal değil) oturum için hakediş satırı oluşmaz'
);

select is(
  (select total_amount from public.teacher_work_logs where lesson_session_id = 'b8000000-0000-0000-0000-0000001e0001'),
  900::numeric,
  'normal oturum: per_minute (10 ₺/dk) × 90 dakika = 900'
);

select is(
  (select scenario from public.teacher_work_logs where lesson_session_id = 'b8000000-0000-0000-0000-0000001e0001'),
  'regular',
  'normal oturumun senaryosu "regular"'
);

select is(
  (select total_amount from public.teacher_work_logs where lesson_session_id = 'b8000000-0000-0000-0000-0000001e0002'),
  50::numeric,
  'kurum iptali: yapılandırılmış düz tutar (50) kullanılır, dakika hesaba katılmaz'
);

select is(
  (select scenario from public.teacher_work_logs where lesson_session_id = 'b8000000-0000-0000-0000-0000001e0002'),
  'institution_cancelled',
  'kurum iptali senaryosu doğru etiketlenir'
);

select is(
  (select total_amount from public.teacher_work_logs where lesson_session_id = 'b8000000-0000-0000-0000-0000001e0003'),
  0::numeric,
  'öğretmen devamsızlığı: tutar her zaman 0'
);

select is(
  (select scenario from public.teacher_work_logs where lesson_session_id = 'b8000000-0000-0000-0000-0000001e0003'),
  'teacher_absence',
  'öğretmen devamsızlığı satırı yine de izlenebilirlik için oluşturulur'
);

select is(
  (select total_amount from public.teacher_work_logs where lesson_session_id = 'b8000000-0000-0000-0000-0000001e0004'),
  600::numeric,
  'telafi: makeup_rate_amount ayarlanmadığı için normal rate_amount (10 ₺/dk × 60 dk) kullanılır'
);

select is(
  (select scenario from public.teacher_work_logs where lesson_session_id = 'b8000000-0000-0000-0000-0000001e0004'),
  'makeup',
  'telafi senaryosu doğru etiketlenir'
);

-- ---------------------------------------------------------------
-- İkinci kural (per_lesson, Ağustos 2027) — etkin tarih aralığına
-- göre doğru kuralın seçildiğini kanıtlar.
-- ---------------------------------------------------------------

insert into public.lesson_sessions (
  id, organization_id, course_id, teacher_profile_id, starts_at, ends_at,
  is_makeup, attendance_locked_at
)
values (
  'b8000000-0000-0000-0000-0000001e0006', 'b8000000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-0000000c0001',
  'b8000000-0000-0000-0000-0000000000a2', '2027-08-03 10:00:00+03', '2027-08-03 12:00:00+03', false, now()
);

select is(
  (select created_count from public.generate_teacher_compensation('2027-08-01'::date)),
  1,
  'Ağustos 2027 için 1 satır üretilir'
);

select is(
  (select total_amount from public.teacher_work_logs where lesson_session_id = 'b8000000-0000-0000-0000-0000001e0006'),
  200::numeric,
  'Ağustos oturumu ikinci (per_lesson, 200₺ sabit) kuralı kullanır — süreden bağımsız'
);

-- Oturum bazlı tekil indeks: RPC'yi atlayıp aynı oturum için ikinci
-- satır eklemeye çalışmak (superuser olarak) veritabanı seviyesinde
-- de reddedilir.

reset role;

select throws_ok(
  $$insert into public.teacher_work_logs (
      organization_id, teacher_profile_id, lesson_session_id, work_date, period_start,
      unit_amount, total_amount, direction, source
    )
    select organization_id, teacher_profile_id, lesson_session_id, work_date, period_start,
      unit_amount, total_amount, direction, source
    from public.teacher_work_logs
    where lesson_session_id = 'b8000000-0000-0000-0000-0000001e0006'$$,
  '23505',
  'aynı oturum için ikinci hakediş satırı veritabanı seviyesinde de engellenir'
);

select set_config('request.jwt.claims', json_build_object('sub', 'b8000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

-- ---------------------------------------------------------------
-- Öğretmen B — per_student ve monthly_salary modelleri
-- ---------------------------------------------------------------

select lives_ok(
  $$select public.create_teacher_compensation_rule(
    'b8000000-0000-0000-0000-0000000000a3'::uuid, 'per_student', 30, '2027-01-01'::date, '2027-12-31'::date
  )$$,
  'Öğretmen B için per_student kuralı oluşturulur'
);

insert into public.lesson_sessions (
  id, organization_id, course_id, teacher_profile_id, starts_at, ends_at,
  is_makeup, attendance_locked_at
)
values (
  'b8000000-0000-0000-0000-0000001e0007', 'b8000000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-0000000c0001',
  'b8000000-0000-0000-0000-0000000000a3', '2027-03-03 10:00:00+03', '2027-03-03 11:00:00+03', false, now()
);

insert into public.attendance (organization_id, lesson_session_id, enrollment_id, student_id, status)
values
  ('b8000000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-0000001e0007', 'b8000000-0000-0000-0000-0000000f0001', 'b8000000-0000-0000-0000-0000000d0001', 'present'),
  ('b8000000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-0000001e0007', 'b8000000-0000-0000-0000-0000000f0002', 'b8000000-0000-0000-0000-0000000d0002', 'present'),
  ('b8000000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-0000001e0007', 'b8000000-0000-0000-0000-0000000f0003', 'b8000000-0000-0000-0000-0000000d0003', 'absent');

select is(
  (select created_count from public.generate_teacher_compensation('2027-03-01'::date)),
  1,
  'Mart 2027 için Öğretmen B''ye 1 satır üretilir'
);

select is(
  (select total_amount from public.teacher_work_logs where lesson_session_id = 'b8000000-0000-0000-0000-0000001e0007'),
  60::numeric,
  'per_student: yalnızca "present" 2 öğrenci × 30₺ = 60 (devamsız öğrenci sayılmaz)'
);

select is(
  (select student_count from public.teacher_work_logs where lesson_session_id = 'b8000000-0000-0000-0000-0000001e0007'),
  2,
  'student_count anlık görüntüsü doğru katılımcı sayısını taşır'
);

-- monthly_salary: aynı öğretmen için ayrı bir dönemde (Nisan) maaş
-- kuralı; oturum sayısından bağımsız TEK toplu satır.

select lives_ok(
  $$select public.end_teacher_compensation_rule(
    (select id from public.teacher_compensation_rules where teacher_profile_id = 'b8000000-0000-0000-0000-0000000000a3'),
    '2027-03-31'::date
  )$$,
  'Öğretmen B''nin per_student kuralı sonlandırılır'
);

select lives_ok(
  $$select public.create_teacher_compensation_rule(
    'b8000000-0000-0000-0000-0000000000a3'::uuid, 'monthly_salary', 15000, '2027-04-01'::date, null
  )$$,
  'Öğretmen B için monthly_salary kuralı oluşturulur'
);

insert into public.lesson_sessions (
  id, organization_id, course_id, teacher_profile_id, starts_at, ends_at,
  is_makeup, attendance_locked_at
)
values (
  'b8000000-0000-0000-0000-0000001e0008', 'b8000000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-0000000c0001',
  'b8000000-0000-0000-0000-0000000000a3', '2027-04-05 10:00:00+03', '2027-04-05 11:00:00+03', false, now()
);

select lives_ok(
  $$select public.generate_teacher_compensation('2027-04-01'::date)$$,
  'Nisan 2027 hakedişi hatasız üretilir'
);

select is(
  (select count(*)::int from public.teacher_work_logs where lesson_session_id = 'b8000000-0000-0000-0000-0000001e0008'),
  0,
  'monthly_salary kuralı olan öğretmen için oturum bazlı satır ÜRETİLMEZ'
);

select is(
  (select count(*)::int from public.teacher_work_logs
   where teacher_profile_id = 'b8000000-0000-0000-0000-0000000000a3' and period_start = '2027-04-01' and source = 'monthly_salary'),
  1,
  'bunun yerine tek bir aylık toplu satır oluşur'
);

select is(
  (select total_amount from public.teacher_work_logs
   where teacher_profile_id = 'b8000000-0000-0000-0000-0000000000a3' and source = 'monthly_salary'),
  15000::numeric,
  'aylık maaş tutarı kuraldaki sabit tutarla birebir eşleşir'
);

-- ---------------------------------------------------------------
-- Onay → ödeme sırası ve kilit
-- ---------------------------------------------------------------

select is(
  (select public.approve_teacher_compensation('b8000000-0000-0000-0000-0000000000a2'::uuid, '2027-02-01'::date)),
  4,
  'Şubat 2027''nin 4 satırı (regular/institution_cancelled/teacher_absence/makeup) onaylanır'
);

select is(
  (select public.approve_teacher_compensation('b8000000-0000-0000-0000-0000000000a2'::uuid, '2027-02-01'::date)),
  0,
  'ikinci onay çağrısı zaten onaylı satırları tekrar saymaz (idempotent)'
);

select throws_ok(
  $$select public.mark_teacher_compensation_paid('b8000000-0000-0000-0000-0000000000a2'::uuid, '2027-08-01'::date)$$,
  'P0001', 'Ödenmiş işaretlenecek onaylı bir hakediş bulunamadı.',
  'henüz onaylanmamış bir dönem ödendi olarak işaretlenemez'
);

select is(
  (select public.mark_teacher_compensation_paid('b8000000-0000-0000-0000-0000000000a2'::uuid, '2027-02-01'::date)),
  4,
  'onaylı 4 satır ödendi olarak işaretlenir'
);

select throws_ok(
  $$update public.teacher_work_logs set total_amount = 1
    where lesson_session_id = 'b8000000-0000-0000-0000-0000001e0001'$$,
  '42501',
  'admin dahi ödenmiş bir hakediş satırını doğrudan güncelleyemez'
);

-- ---------------------------------------------------------------
-- Kural anlık görüntüsü kalıcıdır — kural sonradan sonlandırılsa
-- bile geçmiş satırın rate_snapshot''ı değişmez.
-- ---------------------------------------------------------------

select is(
  (select rate_snapshot from public.teacher_work_logs where lesson_session_id = 'b8000000-0000-0000-0000-0000001e0001'),
  10::numeric,
  'onaylanmış/ödenmiş satırın rate_snapshot''ı, üretildiği andaki kural tutarını korur'
);

-- ---------------------------------------------------------------
-- Manuel düzeltme — mevcut satırlar değişmez, yeni satır eklenir
-- ---------------------------------------------------------------

select lives_ok(
  $$select public.add_compensation_adjustment(
    'b8000000-0000-0000-0000-0000000000a2'::uuid, '2027-02-01'::date, 100, 1, 'performans primi'
  )$$,
  'ekleme (bonus) düzeltmesi eklenir'
);

select lives_ok(
  $$select public.add_compensation_adjustment(
    'b8000000-0000-0000-0000-0000000000a2'::uuid, '2027-02-01'::date, 25, -1, 'geç kalma kesintisi'
  )$$,
  'kesinti düzeltmesi eklenir'
);

select is(
  (
    select coalesce(sum(total_amount * direction), 0) from public.teacher_work_logs
    where teacher_profile_id = 'b8000000-0000-0000-0000-0000000000a2' and period_start = '2027-02-01'
  ),
  (900 + 50 + 0 + 600 + 100 - 25)::numeric,
  'Şubat 2027 net toplamı: 4 üretilen satır + iki düzeltme, hiçbiri mutasyona uğramadan'
);

-- ---------------------------------------------------------------
-- Öğretmen izolasyonu — yalnızca kendi verisi, RPC'lere erişim yok
-- ---------------------------------------------------------------

select set_config('request.jwt.claims', json_build_object('sub', 'b8000000-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(
  (select count(*)::int from public.teacher_work_logs where teacher_profile_id = 'b8000000-0000-0000-0000-0000000000a3'),
  0,
  'Öğretmen A, Öğretmen B''nin hakediş satırlarını SELECT ile göremez'
);

select is(
  (select count(*)::int from public.teacher_work_logs where teacher_profile_id = 'b8000000-0000-0000-0000-0000000000a2'),
  7,
  'Öğretmen A kendi 7 satırını (Şubat''ta üretilen 4 + Ağustos''ta üretilen 1 + 2 düzeltme) tam olarak görür — admin ile aynı sayı'
);

select throws_ok(
  $$select public.generate_teacher_compensation('2027-02-01'::date)$$,
  'P0001', 'Aylık hakediş oluşturma yetkiniz bulunmuyor.',
  'öğretmen hakediş üretemez'
);

select throws_ok(
  $$select public.add_compensation_adjustment(
    'b8000000-0000-0000-0000-0000000000a2'::uuid, '2027-02-01'::date, 500, 1, 'kendime prim'
  )$$,
  'P0001', 'Hakediş düzeltmesi ekleme yetkiniz bulunmuyor.',
  'öğretmen kendine düzeltme ekleyemez'
);

select throws_ok(
  $$insert into public.teacher_work_logs (
      organization_id, teacher_profile_id, work_date, period_start, unit_amount, total_amount, direction, source
    )
    values (
      'b8000000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-0000000000a2',
      '2027-02-01', '2027-02-01', 999, 999, 1, 'adjustment'
    )$$,
  '42501',
  'öğretmen kendi hakediş satırını doğrudan REST ile insert edemez (eski güvenlik açığı kapatıldı)'
);

reset role;

select * from finish();

rollback;
