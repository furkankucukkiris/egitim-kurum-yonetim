-- ============================================================
-- TAM SIFIRLAMA — DİKKAT: GERİ ALINAMAZ
-- ============================================================
-- Bu script kurumu, tüm öğrencileri, velileri, dersleri, ders
-- programlarını, tahakkukları, ödemeleri, yoklamaları ve
-- MEB kayıtlarını KALICI OLARAK SİLER.
--
-- Giriş bilgin (auth.users) SİLİNMEZ — aynı e-posta/parolayla
-- tekrar giriş yapabilirsin. Ama silme sonrasında bir profil
-- kalmayacağı için uygulama seni otomatik olarak /kurulum'a
-- yönlendirmez; giriş yaptıktan sonra tarayıcıdan elle
--   https://<uygulama-adresin>/kurulum
-- adresine gitmen gerekir.
--
-- Nasıl çalıştırılır:
--   1. Supabase Dashboard → SQL Editor → New query
--   2. Bu dosyanın tamamını yapıştır
--   3. "Run" — geri dönüşü yok, çalıştırmadan önce emin ol
--
-- Uygulamanın kod/şema geçmişine (supabase/migrations/) hiç
-- dokunmaz; sadece VERİYİ temizler.
--
-- Yüklenen kurum logosu ve öğrenci fotoğrafı DOSYALARI bu
-- scriptin kapsamında DEĞİL — Supabase, storage tablolarına
-- doğrudan SQL ile silmeyi güvenlik gereği engelliyor. Bu
-- veritabanı satırları silindikten sonra o dosyalar artık
-- hiçbir kayıttan referans edilmeyen "yetim" dosyalar olarak
-- kalır (uygulamayı bozmaz, sadece depolama alanı kaplar).
-- İstersen ayrıca temizlemek için Dashboard → Storage →
-- "organization-logos" ve "student-photos" klasörlerine gir,
-- tüm dosyaları seçip sil.
-- ============================================================

begin;

delete from public.audit_logs;
delete from public.bank_deposit_items;
delete from public.bank_deposits;
delete from public.cash_movements;
delete from public.expenses;
delete from public.expense_categories;
delete from public.teacher_work_logs;
delete from public.payment_allocations;
delete from public.payments;
delete from public.accruals;
delete from public.attendance;
delete from public.lesson_sessions;
delete from public.enrollment_meb_registrations;
delete from public.teacher_course_meb_authorizations;
delete from public.enrollments;
delete from public.class_groups;
delete from public.courses;
delete from public.student_guardians;
delete from public.guardians;
delete from public.students;
delete from public.bank_accounts;
delete from public.cash_accounts;
delete from public.profiles;
delete from public.organizations;

commit;
