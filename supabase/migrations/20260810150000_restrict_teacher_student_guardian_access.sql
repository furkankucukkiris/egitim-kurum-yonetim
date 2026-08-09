-- KVKK / least-privilege: teacher artık students, guardians ve
-- student_guardians tablolarına DOĞRUDAN hiç erişemiyor (kendi
-- öğrencisi için bile). Önceki durumda (20260727210000'de tanımlanan
-- students_select_scoped/student_guardians_select_scoped) teacher
-- kendi öğrencisinin/velisinin TÜM sütunlarını (T.C. kimlik no,
-- doğum tarihi, çıkış nedeni, yönetici notu, fotoğraf yolu; veli
-- tarafında fatura unvanı, vergi/TC no, fatura adresi, e-posta)
-- Supabase REST API'sini doğrudan çağırarak görebilirdi — arayüz bu
-- alanları hiç istemese bile RLS satır erişimi tüm sütunları açığa
-- çıkarıyordu.
--
-- Teacher'ın yoklama/program ekranları için ihtiyaç duyduğu asgari
-- veri (öğrenci id/ad/soyad/durumu) zaten
-- public.get_teacher_enrollments() RPC'si üzerinden geliyor (bkz.
-- 20260810130000_simplify_roles_to_admin_teacher.sql) ve bu RPC
-- SECURITY DEFINER olduğu için RLS'i atlayıp yalnızca kendi
-- tanımladığı dar sütun listesini döner — T.C. no, doğum tarihi,
-- çıkış nedeni, yönetici notu, fotoğraf yolu gibi alanları hiç
-- içermez. Bu migration sadece alttaki tablolara doğrudan erişimi
-- kapatıyor; RPC'nin kendisi değişmedi.
--
-- courses.default_monthly_fee sütunu bu migration'ın kapsamı dışında
-- bırakıldı: courses_select_org politikası hâlâ tüm kurum üyelerine
-- (teacher dahil) açık. Bu, öğrenci/veli kişisel verisi değil, kurum
-- ders kataloğu fiyatıdır ve teacher'ın kendi programındaki ders adını
-- görebilmesi (class_groups → courses embed) buna bağlıdır; bilinçli
-- bir kapsam kararı olarak README'de belgelenmiştir.

-- =========================================================
-- 1. students: teacher dalı tamamen kaldırıldı.
-- =========================================================

drop policy if exists students_select_scoped on public.students;

create policy students_select_scoped
on public.students
for select
to authenticated
using (
  organization_id = public.current_organization_id()
  and public.is_admin()
);

-- =========================================================
-- 2. student_guardians: teacher dalı tamamen kaldırıldı. Bu tablo
--    kendi başına PII taşımasa da (student_id/guardian_id eşlemesi,
--    ilişki türü, may_receive_financial_messages) veli kaydının var
--    olduğunu ve finansal mesaj tercihini ifşa ediyordu; hiçbir
--    teacher ekranı bunu kullanmıyor.
-- =========================================================

drop policy if exists student_guardians_select_scoped on public.student_guardians;

create policy student_guardians_select_scoped
on public.student_guardians
for select
to authenticated
using (
  exists (
    select 1
    from public.students s
    where s.id = student_id
      and s.organization_id = public.current_organization_id()
  )
  and public.is_admin()
);

-- =========================================================
-- Not: public.teacher_has_student(uuid) ve
-- public.teacher_has_guardian(uuid) fonksiyonları (20260727210000)
-- artık hiçbir RLS politikası tarafından çağrılmıyor. Bilinçli olarak
-- silinmediler — ileride teacher'a dar kapsamlı bir okuma özelliği
-- (ör. yalnızca ad/telefon) eklenmesi gerekirse hazır satır-kapsamı
-- yardımcı fonksiyonlar olarak kullanılabilirler. Şu an inert
-- (erişimsiz) durumdalar; kaldırılmaları bu migration'ın güvenlik
-- hedefi için gerekli değil.

notify pgrst, 'reload schema';
