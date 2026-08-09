# Eğitim Kurumu Yönetim Sistemi

Responsive çalışan, öğrenci kayıtları, tahakkuk/tahsilat, yoklama, öğretmen çalışma takibi, kasa-banka hareketleri ve raporlama için hazırlanmış başlangıç projesidir.

## Teknoloji

- Next.js (App Router)
- TypeScript
- Tailwind CSS
- Supabase Auth + PostgreSQL + Storage
- Supabase CLI ve SQL migration yapısı

## 1. Gereksinimler

- Node.js 20 veya üzeri
- npm
- Git
- Yerel Supabase kullanacaksanız Docker Desktop

## 2. Kurulum

```bash
npm install
cp .env.example .env.local
npm run dev
```

Tarayıcıda `http://localhost:3000` adresini açın.

> Supabase bilgileri girilmeden uygulama demo verileriyle açılır. Gerçek veri yazılmaz.

## 3. Supabase bulut projesi bağlama

1. Supabase üzerinde yeni proje oluşturun.
2. Project URL, Publishable Key ve `service_role` anahtarını `.env.local` içine yazın.
3. CLI ile giriş yapın ve projeyi bağlayın:

```bash
npx supabase login
npx supabase link --project-ref PROJE_REF
npx supabase db push
```

4. **Authentication > Sign In / Providers** ekranında **"Allow new
   users to sign up"** seçeneğini kapatın. Sistem tek kurumla
   sınırlıdır; dışarıdan kimse kendi kendine kayıt olamamalı, yeni
   hesaplar yalnızca aktif yönetici tarafından oluşturulmalıdır.
   Yerel geliştirmede bu ayar `supabase/config.toml` içinde
   `enable_signup = false` ile zaten kapalıdır — production projesinde
   aynı ayarı Dashboard üzerinden elle kapatmanız gerekir.

`SUPABASE_SERVICE_ROLE_KEY` yalnızca sunucuda öğretmen Auth hesabı
oluşturmak için kullanılır. Bu değişkene `NEXT_PUBLIC_` öneki
eklemeyin; anahtarı tarayıcı koduna veya Git deposuna koymayın.

## 4. Yerel Supabase ile geliştirme

Docker Desktop çalışırken:

```bash
npx supabase start
npx supabase db reset
```

Komut çıktısındaki yerel API URL ve publishable/anon key değerlerini `.env.local` içine yazın.

## 5. İlk yönetici hesabı

Sistem tek kurumla sınırlıdır ve dışarıdan kayıt kapalıdır (bkz. bölüm
3). İlk yönetici hesabı yalnızca aşağıdaki iki yoldan biriyle, ve
yalnızca sistemde henüz hiç kurum yokken oluşturulabilir:

1. **`/kurulum` (önerilen yol).** Supabase Dashboard > Authentication
   > Users ekranından oturum açabilecek bir kullanıcı oluşturun
   (e-posta + parola), bu kullanıcıyla uygulamada `/giris` üzerinden
   giriş yapın ve `/kurulum` sayfasındaki formu doldurun. Bu form,
   veritabanındaki `bootstrap_first_admin` fonksiyonunu çağırır; bu
   fonksiyon sistemde zaten bir kurum veya profil varsa çalışmayı
   reddeder. Kurulum tamamlandıktan sonra `/kurulum` sayfası herkes
   için (URL'ye doğrudan gidilse bile) devre dışı kalır.

2. **Manuel SQL (yedek yol).** Aynı kısıt veritabanı fonksiyonu
   içinde uygulandığı için, `bootstrap_first_admin` RPC'sini SQL
   Editor'dan doğrudan çağırmak da mümkündür:

   ```sql
   select public.bootstrap_first_admin(
     'Şermin Şahin Kişisel Gelişim Kursu',
     'Yönetici Adı Soyadı'
   );
   ```

   Bu çağrı `auth.uid()`'a bağlı çalıştığından SQL Editor'da
   `set local role authenticated;` ve ilgili kullanıcının JWT'siyle
   çalıştırılmalıdır; pratikte 1. yoldaki `/kurulum` formu tercih
   edilmelidir.

Sistemde bir kurum kurulduktan sonra yeni hesaplar yalnızca aktif bir
yönetici tarafından oluşturulabilir (bkz. bölüm 7).

## 6. Önemli klasörler

```text
src/app/                 Sayfalar
src/components/          Ortak arayüz bileşenleri
src/lib/supabase/        Supabase istemci ve oturum kodları
supabase/migrations/     Veritabanı şeması ve RLS politikaları
```

## 7. Öğretmen hesabı akışı

1. Yönetici, **Öğretmenler** ekranından ad, e-posta ve telefonla
   gerçek öğretmen hesabı oluşturur.
2. Sistem bir defaya mahsus geçici parola gösterir.
3. Öğretmen e-posta ve geçici parolayla giriş yapar.
4. İlk girişte kendi güçlü parolasını belirlemeden panele geçemez.
5. Öğretmen yalnızca kendisine atanmış seansları, öğrencileri ve
   ders bazlı MEB kayıt durumlarını görür; ücret, indirim, tahakkuk,
   veli finans bilgisi, diğer öğretmenler, raporlar ve kurum
   ayarlarına erişemez (bkz. bölüm 8, Yetki matrisi).

Geçici parola kaybolursa yönetici aynı ekrandan yeni bir geçici
parola üretebilir. Öğretmen hesabını silmek yerine pasife alma
seçeneği kullanılır; böylece geçmiş kayıtların bağlantıları korunur.

## 8. Yetki matrisi (roller ve erişim)

Sistemde yalnızca iki rol kullanılır: **admin** (kurumun tamamını
yönetir) ve **teacher** (yalnızca kendi programını/öğrencilerini
görür). `finance` ve `viewer` rolleri kaldırıldı — neden veritabanı
enum'undan silinmedikleri ve mevcut `finance`/`viewer` profillerine ne
olduğu için bkz. `supabase/migrations/20260810130000_simplify_roles_to_admin_teacher.sql`
başındaki not. Özet: enum değeri kalıyor ama hiçbir insert yolu onu
üretmiyor ve hiçbir RLS politikası/RPC ona ayrıcalık tanımıyor; böyle
bir profil varsa (yönetici otomatik yükseltilmeden/düşürülmeden)
tamamen erişimsiz kalır, gerekirse Supabase Studio'dan elle
admin/teacher olarak güncellenmelidir.

Yetki üç katmanda ayrı ayrı uygulanır — menüde bir bağlantının
görünmemesi güvenlik sağlamaz, bu yüzden her katman kendi başına
yetkiyi kontrol eder:

1. **Sayfa/Server Action (`requireRole`, `src/lib/auth.ts`).** Her
   sayfa ve her mutasyon yapan server action, izin verilen rolleri
   açıkça listeler; listede olmayan rol `/yetkisiz`e yönlendirilir.
2. **RLS (Postgres row level security).** Her tablonun satır erişimi
   `is_admin()` / `teacher_owns_enrollment()` / `teacher_owns_session()`
   gibi fonksiyonlarla karar verilir; Next.js katmanı atlanıp
   doğrudan Supabase REST API çağrılsa bile aynı kısıt geçerlidir.
   Storage'da da aynı prensip geçerli: `student-photos` bucket'ı
   yalnızca `is_admin()` olan kullanıcıya açık (bkz. `storage.objects`
   üzerindeki `student_photos_org_access` politikası).
3. **RPC'ler (security definer fonksiyonlar).** KVKK kapsamındaki
   kişisel veri içeren tablolar (`students`, `guardians`,
   `student_guardians`, `enrollments`) teacher için doğrudan `select`e
   tamamen kapalıdır — T.C. kimlik no, doğum tarihi, veli fatura/vergi
   bilgisi, ücret/indirim gibi sütunlar teacher'a hiçbir REST
   sorgusuyla ulaşmaz. Teacher yalnızca `get_teacher_enrollments()`
   gibi dar kapsamlı, yalnızca öğrenci id/ad/soyad/durum döndüren
   RPC'ler üzerinden veri okur.

### Sayfa erişimi

| Yol | admin | teacher |
| --- | --- | --- |
| `/` (Genel Bakış, finans özeti) | ✅ | ❌ (`/ogretmen-paneli`'ne yönlenir) |
| `/ogretmen-paneli` | ❌ | ✅ |
| `/ogrenciler`, `/ogrenciler/yeni`, `/ogrenciler/[id]`, `/ogrenciler/[id]/kayit-formu` | ✅ | ❌ |
| `/dersler`, `/program` | ✅ | ❌ |
| `/odemeler` | ✅ | ❌ |
| `/yoklama` | ✅ (tüm oturumlar) | ✅ (yalnızca kendi oturumları) |
| `/meb-yoklama` | ✅ (tüm kayıtlar) | ✅ (yalnızca kendi öğrencileri) |
| `/meb`, `/ogretmenler`, `/raporlar`, `/kurum-ayarlari/*` | ✅ | ❌ |

### Veri erişimi (RLS/RPC özeti)

| Tablo / RPC | admin | teacher |
| --- | --- | --- |
| `accruals`, `payments`, `payment_allocations`, `cash_*`, `bank_*`, `expenses` | tam erişim | erişim yok |
| `enrollments` (ücret, indirim, net tutar sütunları dahil) | tam erişim | erişim yok — bunun yerine `get_teacher_enrollments()` RPC'si (yalnızca finansal olmayan sütunlar, yalnızca kendi kayıtları) |
| `students` (T.C. no, doğum tarihi, çıkış nedeni, yönetici notu, fotoğraf yolu dahil) | tam erişim | erişim yok — kendi öğrencisi için bile; ad/soyad/durum yalnızca `get_teacher_enrollments()` üzerinden gelir |
| `guardians` (fatura unvanı, vergi/TC no, adres, e-posta), `student_guardians` | tam erişim (yalnızca kendi organizasyonu) | erişim yok |
| `class_groups`, `lesson_sessions` | tam erişim | yalnızca kendi programı/oturumu |
| `attendance` (doğrudan insert/update kapalı — bkz. aşağı) | `mark_attendance()` ile | `mark_attendance()` ile, yalnızca kendi oturumu |
| `profiles` | tüm kurum | yalnızca kendi satırı |
| `teacher_course_meb_authorizations`, `enrollment_meb_registrations`, `get_meb_monthly_roster()` | tam erişim | yalnızca kendi kayıtları |
| Storage `student-photos` (öğrenci fotoğrafının aslı) | tam erişim (yalnızca kendi organizasyonu) | erişim yok |

`courses.default_monthly_fee` (ders kataloğu fiyatı) bilinçli olarak
bu daraltmanın dışında bırakıldı: `courses_select_org` politikası
hâlâ tüm kurum üyelerine (teacher dahil) açık, çünkü teacher'ın kendi
programındaki ders adını görebilmesi (`class_groups → courses` embed)
buna bağlı. Bu bir öğrenci/veli kişisel verisi değil, kurum fiyat
listesi olduğu için ayrı bir RPC'ye taşınmadı; daha sıkı bir kısıt
istenirse `get_teacher_enrollments()` zaten döndürdüğü `course_name`
alanı üzerinden `class_groups` embed'i de aynı RPC'ye taşınabilir.

### Yoklama modülü

`attendance` tablosuna artık kimse (admin dahil) doğrudan insert/update
yapamaz — tüm yazmalar `public.mark_attendance(lesson_session_id,
entries)` RPC'sinden geçer (`supabase/migrations/20260810160000_add_attendance_marking.sql`).
Bu fonksiyon tek çağrıda (tek transaction):

- çağıranın o oturum için yetkili olduğunu (admin, ya da
  `teacher_owns_session()` ile oturumun öğretmeni) doğrular,
- her öğrencinin oturum TARİHİNDE gerçekten aktif kayıtlı olduğunu
  kontrol eder (sonradan kaydolan/önceden ayrılan öğrenci reddedilir),
- `(lesson_session_id, student_id)` tekil kısıtı üzerinden upsert
  yapar (mükerrer satır oluşmaz, tekrar çağrı idempotenttir),
- durum/not değiştiyse `audit_logs`'a eski ve yeni değeri yazar.

`lesson_sessions.attendance_locked_at/attendance_locked_by` bir
oturumun yoklamasını kilitler; kilitliyken `mark_attendance()`
**admin dahil kimse için** çalışmaz. Yalnızca admin,
`unlock_session_attendance(lesson_session_id, reason)` ile gerekçe
belirterek kilidi açabilir (gerekçe `audit_logs`'a yazılır). Roster
(o oturumda kimin yoklamasının alınacağı) `get_attendance_roster()`
RPC'sinden gelir — `students`/`enrollments` tablolarına teacher'ın
doğrudan erişimi olmadığından, bu da security definer bir fonksiyon.
`get_unmarked_past_sessions()` admin'e yoklaması hiç girilmemiş geçmiş
oturumları listeler (`/yoklama` sayfasında uyarı olarak gösterilir).

Öğrenci-veli eşleme tablosunda (`student_guardians`) daha önce
yalnızca teacher dalı organizasyon kapsıyordu; admin dalı
(`current_app_role() <> 'teacher'`) organizasyon kontrolü
içermediğinden, teorik olarak bir organizasyonun admin'i başka bir
organizasyonun öğrenci-veli eşlemesini REST üzerinden görebilirdi. Bu,
`20260810150000_restrict_teacher_student_guardian_access.sql`
migration'ında düzeltildi ve `role_data_minimization.test.sql`
içinde iki ayrı organizasyon fixture'ıyla test edilir.

## 9. Mevcut başlangıç ekranları

- Yönetim paneli
- Öğrenciler
- Ödemeler
- Yoklama
- Öğretmenler
- Raporlar
- Giriş ekranı

## 10. Sonraki geliştirme sırası

1. Gerçek kullanıcı/rol akışı
2. Öğrenci ve veli CRUD işlemleri
3. Ders kayıtları ve fiyatlandırma
4. Aylık tahakkuk üretimi
5. Ödeme ve ödeme dağıtımı
6. Yoklama ve telafi
7. Kasa/ATM yatırımı mutabakatı
8. Öğretmen hak edişi
9. Aylık raporlar

## Güvenlik notu

`service_role` anahtarını hiçbir zaman `NEXT_PUBLIC_` değişkeninde veya tarayıcı kodunda kullanmayın. Gerçek çocuk/veli verisini taşımadan önce KVKK, veri barındırma bölgesi, yedekleme ve kullanıcı yetkileri ayrıca gözden geçirilmelidir.
