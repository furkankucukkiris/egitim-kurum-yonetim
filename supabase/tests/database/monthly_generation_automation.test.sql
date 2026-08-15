-- Aylık ders oturumu / tahakkuk otomasyonu pgTAP testleri
-- (20260812120000_add_monthly_generation_automation.sql).
--
-- Kapsam: run_monthly_automation_job idempotency, kurum kimliği
-- doğrulaması, eşzamanlı çalışma engeli, manuel yeniden deneme
-- yetkilendirmesi, service_role dışına kapalı olması, hata durumunda
-- kısmi veri kalmaması (savepoint/rollback), ve mevcut
-- generate_monthly_lesson_sessions/generate_monthly_accruals RPC'lerinin
-- refactor sonrası aynı davranışı sürdürmesi.
--
-- run_daily_automation_sweep() gerçek `now()`e bağlı olduğundan (üretim
-- günü 1-28 ile sınırlı, ayın 29-31'inde hiçbir kurum eşleşmez) burada
-- test edilmiyor — bkz.
-- monthly_generation_automation.manual-verification.md.
--
-- Çalıştırma: `npx supabase start` sonrasında `npx supabase test db`.
-- Bu dosya tek bir transaction içinde çalışır ve sonunda rollback edilir.

begin;

select plan(26);

-- ---------------------------------------------------------------
-- Fixture kurulumu (superuser olarak).
-- ---------------------------------------------------------------

delete from public.automation_job_runs;
delete from public.accruals;
delete from public.enrollments;
delete from public.lesson_sessions;
delete from public.class_groups;
delete from public.courses;
delete from public.students;
delete from public.audit_logs;
delete from public.profiles;
delete from public.organizations;

insert into public.organizations (id, name)
values ('e5000000-0000-0000-0000-000000000001', 'Test Kurumu');

insert into auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
values
  ('e5000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@ornek.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('e5000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ogretmen@ornek.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

insert into public.profiles (id, organization_id, full_name, role, is_active)
values
  ('e5000000-0000-0000-0000-0000000000a1', 'e5000000-0000-0000-0000-000000000001', 'Admin', 'admin', true),
  ('e5000000-0000-0000-0000-0000000000a2', 'e5000000-0000-0000-0000-000000000001', 'Öğretmen', 'teacher', true);

insert into public.courses (id, organization_id, name, course_type, default_duration_minutes, default_monthly_fee)
values ('e5000000-0000-0000-0000-0000000c0001', 'e5000000-0000-0000-0000-000000000001', 'Resim', 'group', 60, 1000);

-- weekday 3 = Çarşamba; sabit tarih formülüyle değil extract(isodow)
-- ile hesaplanıyor ki hangi gün olduğu manuel hesaba bağlı olmasın.
insert into public.class_groups (
  id, organization_id, course_id, teacher_profile_id, name,
  weekday, start_time, duration_minutes, starts_on, ends_on, is_active
)
values (
  'e5000000-0000-0000-0000-0000000b0001', 'e5000000-0000-0000-0000-000000000001',
  'e5000000-0000-0000-0000-0000000c0001', 'e5000000-0000-0000-0000-0000000000a2',
  'Grup A', 3, '10:00', 60, '2027-01-01', null, true
);

insert into public.students (id, organization_id, first_name, last_name, status)
values ('e5000000-0000-0000-0000-0000000d0001', 'e5000000-0000-0000-0000-000000000001', 'Öğrenci', 'Bir', 'active');

insert into public.enrollments (
  id, organization_id, student_id, course_id, class_group_id,
  starts_on, ends_on, status, list_monthly_fee, net_monthly_fee, due_day
)
values (
  'e5000000-0000-0000-0000-0000000f0001', 'e5000000-0000-0000-0000-000000000001',
  'e5000000-0000-0000-0000-0000000d0001', 'e5000000-0000-0000-0000-0000000c0001',
  'e5000000-0000-0000-0000-0000000b0001', '2027-01-01', null, 'active', 1000, 1000, 5
);

-- Dondurulmuş bir kayıt: tahakkuk otomasyonunun bunu ATLAMASI gerekir
-- (WHERE koşulu yalnızca status = 'active' alır).
insert into public.students (id, organization_id, first_name, last_name, status)
values ('e5000000-0000-0000-0000-0000000d0002', 'e5000000-0000-0000-0000-000000000001', 'Öğrenci', 'Iki', 'active');

insert into public.enrollments (
  id, organization_id, student_id, course_id, class_group_id,
  starts_on, ends_on, status, list_monthly_fee, net_monthly_fee, due_day
)
values (
  'e5000000-0000-0000-0000-0000000f0002', 'e5000000-0000-0000-0000-000000000001',
  'e5000000-0000-0000-0000-0000000d0002', 'e5000000-0000-0000-0000-0000000c0001',
  'e5000000-0000-0000-0000-0000000b0001', '2027-01-01', null, 'frozen', 1000, 1000, 5
);

-- ---------------------------------------------------------------
-- Ders oturumu otomasyonu — ilk çalıştırma
-- ---------------------------------------------------------------

select lives_ok(
  $$select public.run_monthly_automation_job(
    'e5000000-0000-0000-0000-000000000001'::uuid,
    'lesson_sessions'::public.automation_job_type,
    '2027-03-01'::date, 'schedule', null
  )$$,
  'run_monthly_automation_job (lesson_sessions, ilk çalıştırma) hata vermeden tamamlanır'
);

select is(
  (
    select status::text from public.automation_job_runs
    where organization_id = 'e5000000-0000-0000-0000-000000000001'
      and job_type = 'lesson_sessions' and period = '2027-03-01'
    order by created_at desc limit 1
  ),
  'succeeded',
  'ilk ders oturumu çalıştırması succeeded olarak işaretlenir'
);

select is(
  (
    select (counts->>'created_count')::int from public.automation_job_runs
    where organization_id = 'e5000000-0000-0000-0000-000000000001'
      and job_type = 'lesson_sessions' and period = '2027-03-01'
    order by created_at desc limit 1
  ),
  (
    select count(*)::int from generate_series('2027-03-01'::date, '2027-03-31'::date, interval '1 day') d(v)
    where extract(isodow from v)::int = 3
  ),
  'created_count, dönemdeki eşleşen hafta günü sayısıyla birebir eşleşir'
);

select is(
  (
    select count(*)::int from public.lesson_sessions
    where class_group_id = 'e5000000-0000-0000-0000-0000000b0001'
      and starts_at >= '2027-03-01'::timestamptz and starts_at < '2027-04-01'::timestamptz
  ),
  (
    select count(*)::int from generate_series('2027-03-01'::date, '2027-03-31'::date, interval '1 day') d(v)
    where extract(isodow from v)::int = 3
  ),
  'gerçekten oluşturulan oturum satırı sayısı bekleneni tutar'
);

-- ---------------------------------------------------------------
-- İdempotency: aynı dönem tekrar çalıştırılınca mükerrer kayıt olmaz
-- ---------------------------------------------------------------

select lives_ok(
  $$select public.run_monthly_automation_job(
    'e5000000-0000-0000-0000-000000000001'::uuid,
    'lesson_sessions'::public.automation_job_type,
    '2027-03-01'::date, 'schedule', null
  )$$,
  'aynı dönem için ikinci çalıştırma da hata vermeden tamamlanır'
);

select is(
  (
    select (counts->>'created_count')::int from public.automation_job_runs
    where organization_id = 'e5000000-0000-0000-0000-000000000001'
      and job_type = 'lesson_sessions' and period = '2027-03-01'
    order by created_at desc limit 1
  ),
  0,
  'ikinci çalıştırmada created_count = 0 (hepsi zaten mevcuttu)'
);

select is(
  (
    select count(*)::int from public.lesson_sessions
    where class_group_id = 'e5000000-0000-0000-0000-0000000b0001'
      and starts_at >= '2027-03-01'::timestamptz and starts_at < '2027-04-01'::timestamptz
  ),
  (
    select count(*)::int from generate_series('2027-03-01'::date, '2027-03-31'::date, interval '1 day') d(v)
    where extract(isodow from v)::int = 3
  ),
  'toplam oturum satırı sayısı ikinci çalıştırmadan sonra değişmez'
);

-- ---------------------------------------------------------------
-- Tahakkuk otomasyonu — ilk çalıştırma ve idempotency
-- ---------------------------------------------------------------

select lives_ok(
  $$select public.run_monthly_automation_job(
    'e5000000-0000-0000-0000-000000000001'::uuid,
    'accruals'::public.automation_job_type,
    '2027-03-01'::date, 'schedule', null
  )$$,
  'run_monthly_automation_job (accruals, ilk çalıştırma) hata vermeden tamamlanır'
);

select is(
  (
    select (counts->>'created_count')::int from public.automation_job_runs
    where organization_id = 'e5000000-0000-0000-0000-000000000001'
      and job_type = 'accruals' and period = '2027-03-01'
    order by created_at desc limit 1
  ),
  1,
  'tek aktif kayıt için created_count = 1'
);

select lives_ok(
  $$select public.run_monthly_automation_job(
    'e5000000-0000-0000-0000-000000000001'::uuid,
    'accruals'::public.automation_job_type,
    '2027-03-01'::date, 'schedule', null
  )$$,
  'aynı dönem için ikinci tahakkuk çalıştırması da hata vermeden tamamlanır'
);

select is(
  (
    select (counts->>'created_count')::int from public.automation_job_runs
    where organization_id = 'e5000000-0000-0000-0000-000000000001'
      and job_type = 'accruals' and period = '2027-03-01'
    order by created_at desc limit 1
  ),
  0,
  'ikinci tahakkuk çalıştırmasında created_count = 0'
);

select is(
  (
    select count(*)::int from public.accruals
    where enrollment_id = 'e5000000-0000-0000-0000-0000000f0001' and period_start = '2027-03-01'
  ),
  1,
  'mükerrer tahakkuk satırı oluşmaz — hâlâ tek satır'
);

select is(
  (
    select count(*)::int from public.accruals
    where enrollment_id = 'e5000000-0000-0000-0000-0000000f0002' and period_start = '2027-03-01'
  ),
  0,
  'dondurulmuş (frozen) kayıt için hiç tahakkuk oluşmaz'
);

-- ---------------------------------------------------------------
-- Kurum kimliği doğrulaması
-- ---------------------------------------------------------------

select throws_ok(
  $$select public.run_monthly_automation_job(
    '00000000-0000-0000-0000-000000000000'::uuid,
    'accruals'::public.automation_job_type,
    '2027-03-01'::date, 'schedule', null
  )$$,
  'P0001', 'Geçersiz kurum kimliği.',
  'olmayan kurum kimliği reddedilir'
);

-- ---------------------------------------------------------------
-- Eşzamanlı çalışma engeli
-- ---------------------------------------------------------------

insert into public.automation_job_runs (organization_id, job_type, period, status, triggered_by)
values ('e5000000-0000-0000-0000-000000000001', 'accruals', '2027-05-01', 'running', 'schedule');

select throws_ok(
  $$select public.run_monthly_automation_job(
    'e5000000-0000-0000-0000-000000000001'::uuid,
    'accruals'::public.automation_job_type,
    '2027-05-01'::date, 'schedule', null
  )$$,
  'P0001', 'Bu dönem için zaten çalışan bir otomasyon işi var.',
  'aynı dönem için hâlâ çalışan bir iş varken ikinci çağrı reddedilir'
);

update public.automation_job_runs set status = 'failed', finished_at = now()
where organization_id = 'e5000000-0000-0000-0000-000000000001' and job_type = 'accruals' and period = '2027-05-01';

-- ---------------------------------------------------------------
-- Manuel yeniden deneme yetkilendirmesi
-- ---------------------------------------------------------------

select throws_ok(
  $$select public.run_monthly_automation_job(
    'e5000000-0000-0000-0000-000000000001'::uuid,
    'accruals'::public.automation_job_type,
    '2027-05-01'::date, 'manual_retry', 'e5000000-0000-0000-0000-0000000000a2'::uuid
  )$$,
  'P0001', 'Otomasyon işini yeniden deneme yetkiniz bulunmuyor.',
  'teacher profiliyle yeniden deneme reddedilir'
);

select lives_ok(
  $$select public.run_monthly_automation_job(
    'e5000000-0000-0000-0000-000000000001'::uuid,
    'accruals'::public.automation_job_type,
    '2027-05-01'::date, 'manual_retry', 'e5000000-0000-0000-0000-0000000000a1'::uuid
  )$$,
  'admin profiliyle yeniden deneme başarıyla tamamlanır'
);

select is(
  (
    select triggered_by from public.automation_job_runs
    where organization_id = 'e5000000-0000-0000-0000-000000000001'
      and job_type = 'accruals' and period = '2027-05-01'
    order by created_at desc limit 1
  ),
  'manual_retry',
  'yeniden deneme satırı manual_retry olarak işaretlenir'
);

-- ---------------------------------------------------------------
-- service_role dışına kapalı — authenticated (admin dahil) çağıramaz
-- ---------------------------------------------------------------

select set_config('request.jwt.claims', json_build_object('sub', 'e5000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  $$select public.run_monthly_automation_job(
    'e5000000-0000-0000-0000-000000000001'::uuid,
    'accruals'::public.automation_job_type,
    '2027-06-01'::date, 'schedule', null
  )$$,
  '42501',
  'yönetici oturumu bile run_monthly_automation_job''ı doğrudan çağıramaz (yalnızca service_role)'
);

reset role;

-- ---------------------------------------------------------------
-- Hata durumunda kısmi veri kalmaz (savepoint/rollback)
-- ---------------------------------------------------------------

update public.organizations set timezone = 'Invalid/Zone'
where id = 'e5000000-0000-0000-0000-000000000001';

select lives_ok(
  $$select public.run_monthly_automation_job(
    'e5000000-0000-0000-0000-000000000001'::uuid,
    'lesson_sessions'::public.automation_job_type,
    '2027-04-01'::date, 'schedule', null
  )$$,
  'geçersiz saat dilimiyle çalıştırma dahi run_monthly_automation_job''dan hata fırlatmaz (hata job_runs''a yazılır)'
);

select is(
  (
    select status::text from public.automation_job_runs
    where organization_id = 'e5000000-0000-0000-0000-000000000001'
      and job_type = 'lesson_sessions' and period = '2027-04-01'
    order by created_at desc limit 1
  ),
  'failed',
  'geçersiz saat dilimi çalıştırması failed olarak işaretlenir'
);

select ok(
  (
    select error_summary is not null from public.automation_job_runs
    where organization_id = 'e5000000-0000-0000-0000-000000000001'
      and job_type = 'lesson_sessions' and period = '2027-04-01'
    order by created_at desc limit 1
  ),
  'başarısız çalıştırmada error_summary doludur'
);

select is(
  (
    select count(*)::int from public.lesson_sessions
    where class_group_id = 'e5000000-0000-0000-0000-0000000b0001'
      and starts_at >= '2027-04-01'::timestamptz and starts_at < '2027-05-01'::timestamptz
  ),
  0,
  'başarısız çalıştırma hiçbir oturum satırı bırakmaz (kısmi veri yok)'
);

update public.organizations set timezone = 'Europe/Istanbul'
where id = 'e5000000-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------
-- Mevcut RPC'ler (generate_monthly_lesson_sessions/generate_monthly_accruals)
-- refactor sonrası aynı şekilde çalışmaya devam eder.
-- ---------------------------------------------------------------

select set_config('request.jwt.claims', json_build_object('sub', 'e5000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

select lives_ok(
  $$select * from public.generate_monthly_lesson_sessions('2027-07-01'::date)$$,
  'generate_monthly_lesson_sessions RPC''si admin için hâlâ çalışır'
);

select is(
  (select created_count from public.generate_monthly_lesson_sessions('2027-08-01'::date)),
  (
    select count(*)::int from generate_series('2027-08-01'::date, '2027-08-31'::date, interval '1 day') d(v)
    where extract(isodow from v)::int = 3
  ),
  'generate_monthly_lesson_sessions, refactor öncesiyle aynı created_count''ı döner'
);

select is(
  (select created_count from public.generate_monthly_accruals('2027-07-01'::date)),
  1,
  'generate_monthly_accruals RPC''si admin için hâlâ çalışır ve doğru sayıyı döner'
);

reset role;

select * from finish();

rollback;
