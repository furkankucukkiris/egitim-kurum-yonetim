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
| `/ogretmen-paneli`, `/ogretmen-paneli/hakedisim` | ❌ | ✅ (yalnızca kendi kayıtları) |
| `/hakedis`, `/hakedis/[id]` | ✅ | ❌ |
| `/ogrenciler`, `/ogrenciler/yeni`, `/ogrenciler/[id]`, `/ogrenciler/[id]/kayit-formu` | ✅ | ❌ |
| `/dersler`, `/program` | ✅ | ❌ |
| `/odemeler`, `/giderler` | ✅ | ❌ |
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
| `makeup_credits`, `session_change_requests` (doğrudan insert/update kapalı) | RPC'lerle tam erişim | yalnızca kendi öğrencisinin/oturumunun kayıtlarını görür; iptal/yeniden planlama yalnızca `request_session_change()` ile talep olarak |

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

### Ders iptali, yeniden planlama ve telafi hakkı sistemi

Şema ve RPC'ler `supabase/migrations/20260811100000_add_session_cancellation_and_makeup.sql`
içinde. Üç ayrı ama birbirine bağlı mekanizma:

**1. İptal / yeniden planlama.** `cancel_lesson_session()` ve
`reschedule_lesson_session()` yalnızca admin tarafından doğrudan
çağrılabilir. Teacher kendi oturumu için yalnızca
`request_session_change()` ile bir **talep** açabilir (`session_change_requests`,
durum `pending`); nihai karar `review_session_change_request()` ile
admin'e aittir — onaylanırsa talep, arka planda aynı
cancel/reschedule fonksiyonunu çağırır, reddedilirse hiçbir şey
değişmez. Yeniden planlama, seçilen yeni saatte aynı öğretmenin veya
derslik adının başka bir oturumla çakışmadığını
(`has_scheduling_conflict()`) doğrular.

**2. İptal → telafi hakkı.** `cancel_lesson_session()`, iptal edilen
oturumun tarihinde aktif kayıtlı her öğrenci için hem yoklamayı
`institution_cancelled` yapar hem de `makeup_credits` tablosunda
`reason = 'institution_cancelled'`, `status = 'open'` bir hak açar;
hakkın `source_attendance_id`'si o yoklama satırına bağlanır — iptal
ile telafi arasındaki bağ buradan geriye dönük izlenebilir. Öğrenci
kaynaklı devamsızlık ayrı bir yoldan gelir: `mark_attendance()`
içinde bir öğrenci `makeup_due` işaretlenirse, aynı şekilde
`source_attendance_id`'si o yoklama satırına bağlı ama
`reason = 'student_absence'` bir hak açılır. İki neden asla
karışmaz.

**3. Telafi planlama.** `schedule_makeup(credit_id, ...)` tek bir
hakkı iki şekilde kullanır:
- **Mevcut oturuma ekleme** (`p_target_lesson_session_id`) — grup
  derslerinde aynı dersin başka bir (iptal edilmemiş) oturumuna
  geçici misafir ekler; hedefin kontenjanı doluysa veya öğrencinin o
  saatte zaten başka bir programı varsa reddedilir.
- **Yeni, tek seferlik oturum** (öğretmen + saat + opsiyonel derslik)
  — birebir dersler ve grup dersinde tekil telafi için;
  öğretmen/derslik/öğrenci çakışması `has_scheduling_conflict()` ve
  `student_has_scheduling_conflict()` ile kontrol edilir.

Her iki yolda da hak `status = 'open'` şartıyla satır kilitlenip
güncellenir (`update ... where status = 'open'`), bu yüzden **bir
hak iki kez kullanılamaz** — ikinci çağrı "zaten kullanılmış" hatası
alır. `get_attendance_roster()`, bir oturuma misafir olarak eklenmiş
telafi öğrencilerini normal kayıtlılara ek olarak
`is_makeup_guest = true` ile döner; arayüz bunu "TELAFİ" rozetiyle
gösterir (`AttendanceRoster.tsx`).

**Finansa dokunmama.** Bu migration `accruals`/`payments` gibi hiçbir
finans tablosuna insert/update yapmaz — iptal veya telafi otomatik
tahakkuk oluşturmaz ya da bozmaz. Bir öğrenci telafi kullansa da
kullanmasa da mevcut tahakkuku olduğu gibi kalır; gerekli finansal
düzeltme (iade, ek tahsilat vb.) admin tarafından `/odemeler`
ekranından elle yapılır — bu bilinçli bir tasarım kararı, otomatik
finans mutasyonunun yanlış senaryoda (ör. kısmi ödenmiş bir dönem)
sessizce hatalı sonuç üretme riski nedeniyle.

**Kapsam dışı bırakılanlar** (orantılılık için): grup dersini
yeniden planlarken tüm kayıtlı öğrencilerin bireysel programıyla
çakışma kontrolü yapılmıyor (yalnızca öğretmen/derslik) — bu, "tüm
grup birlikte taşınıyor" varsayımıyla kabul edilebilir bir kapsam
sınırı olarak bırakıldı. `expire_stale_makeup_credits()` var ama
otomatik çalışmıyor (bu depoda cron/pg_cron kurulumu yok); admin
tarafından manuel tetiklenmesi gerekiyor.

### Dashboard finans göstergeleri

Genel Bakış (`/`) ekranındaki tüm finans rakamları
`get_dashboard_financial_summary(month_start)` ve
`get_dashboard_course_performance(month_start)` RPC'lerinden gelir
(`supabase/migrations/20260811110000_add_dashboard_financial_summary.sql`)
— sayfa kendi başına toplama/gruplama yapmaz. Dört kavram kesin
olarak ayrılır:

- **`monthly_accrued`** — bu ayın `period_start`'ına sahip
  tahakkukların toplamı (ne zaman ödendiğinden bağımsız).
- **`monthly_collected`** — bu ayın tahakkuklarından *tahsis edilen*
  tutar (`accruals.allocated_amount`) — ödeme başka bir ayda yapılmış
  olsa bile.
- **`monthly_cash_received`** — `received_at`'i bu ay içine düşen tüm
  ödemelerin toplamı — hangi döneme tahsis edildiğinden bağımsız. Geçmiş
  ayın borcunun bu ay ödenmesi buraya girer ama `monthly_collected`'a
  girmez.
- **`prior_period_carryover`** / **`total_open_receivable`** — ilki
  yalnızca bu aydan ÖNCEKİ açık dönemler, ikincisi bugüne kadarki tüm
  açık bakiye (devreden + bu ayın kendi açığı).

Eski istemci tarafı hesaplamada "bekleyen dönem" sayısı
`course_id + period_start`'ı anahtar yapan bir `Set` ile
sayılıyordu — aynı derste borcu olan farklı öğrenciler tek satıra
düşüyordu. `accruals(enrollment_id, period_start)` zaten tekil
olduğundan artık doğrudan satır sayısı (`count(*)`) kullanılıyor.

`student_advance_balance`, bir ödemenin o an açık tahakkuklardan fazla
gelen kısmını (`payment.amount - toplam tahsis`) toplar — bu tutar
`allocated_amount`'a asla giremez (`check (allocated_amount <=
net_amount)` kısıtı), yani fazla ödeme hiçbir zaman "tahsil edilen"i
şişirmez.

Test verisiyle elle doğrulanmış tam bir örnek için
[dashboard_financial_summary.manual-verification.md](supabase/tests/database/dashboard_financial_summary.manual-verification.md)
dosyasına bakın.

**Bilinen, kapsam dışı bırakılan durum:** `payments.is_refunded`
alanı var ama şemada bunu `true` yapan hiçbir RPC yok — gerçek bir
ödeme iadesi özelliği hiç uygulanmamış. Bu yüzden bir ödeme
`is_refunded = true` olarak elle işaretlense bile, ona bağlı
`accruals.allocated_amount` otomatik geri alınmıyor.
`monthly_cash_received`/`student_advance_balance` (doğrudan
`payments`'tan hesaplandığı için) bunu doğru dışlar, ama
`monthly_collected` (accrual satırından hesaplandığı için) dışlayamaz.
Gerçek bir iade akışı bu görevin kapsamı dışında bırakıldı.

Öğrenci-veli eşleme tablosunda (`student_guardians`) daha önce
yalnızca teacher dalı organizasyon kapsıyordu; admin dalı
(`current_app_role() <> 'teacher'`) organizasyon kontrolü
içermediğinden, teorik olarak bir organizasyonun admin'i başka bir
organizasyonun öğrenci-veli eşlemesini REST üzerinden görebilirdi. Bu,
`20260810150000_restrict_teacher_student_guardian_access.sql`
migration'ında düzeltildi ve `role_data_minimization.test.sql`
içinde iki ayrı organizasyon fixture'ıyla test edilir.

### Ödemeler ekranı (`/odemeler`)

Eski ekran, tahakkukları `.lte("period_start", monthEnd)` ile
çekiyordu — ay ilerledikçe ders kartları kümülatif büyüyor, "bu ayın
tahakkuku" aslında "bugüne kadarki tüm tahakkuk" oluyordu.
`period_start = monthStart` (tam eşitlik) olarak düzeltildi; ders
kartları artık yalnızca seçili ayın satırlarını gösterir.

Sayfadaki tüm üst düzey rakamlar (seçili ay tahakkuku/tahsilatı,
önceki dönem borcu, toplam açık alacak, bu ay kasaya giren nakit)
Genel Bakış (`/`) ile **aynı** `get_dashboard_financial_summary()`
RPC'sinden gelir — iki ekran hiçbir zaman farklı sayı göstermez. Ders
kartlarının toplamı da bu RPC'nin `monthly_accrued`/`monthly_collected`
alanlarıyla birebir eşleşir çünkü ikisi de aynı filtreyle
(organization + `period_start = monthStart` + status iptal/iade
dışında) aynı `accruals` satırlarını toplar — bu tutarlılık
`student_balances.test.sql`'de doğrudan test edilir.

**Öğrenci bazlı bakiye** (yeni `get_student_balances()` RPC'si,
`20260811120000_add_student_balances.sql`) ay bazlı DEĞİLDİR —
öğrencinin tüm açık/kısmi dönemlerinin toplamını gösterir, arama
(ad/soyad), ders filtresi ve durum filtresiyle daraltılabilir, gerçek
server-side sayfalama (`limit`/`offset` + `count(*) over()`) ile
gelir.

**Ödeme önizlemesi**, `record_payment_for_course()`
(`20260808120000`) ile birebir aynı dağıtım mantığını (en eski
dönemden başlayarak, o dönemin bekleyeninden fazlasını taşırmadan)
saf istemci tarafı JavaScript ile taklit eder — sunucuya ekstra istek
atmaz, girilen tutar değiştikçe anında güncellenir. Bu yalnızca bir
önizleme; gerçek dağıtım yine sunucuda aynı RPC ile yapılır.

CSV dışa aktarımı `src/lib/payments/export.ts` içindeki saf servis
katmanından (`fetchMonthlyPaymentsExportRows`/`paymentsExportRowsToCsv`)
ve `GET /odemeler/export?month=YYYY-MM` route handler'ından gelir —
sayfa bileşeni bu dosyaya bağımlı değildir, dışa aktarılan veri
ekrandaki ders kartlarıyla aynı sorgu/filtreyi kullanır. Excel'in
tr-TR ayarlarıyla doğru açılması için `;` ayraç ve UTF-8 BOM
kullanılıyor.

### Ödeme düzeltme, iade ve öğrenci avansı

Şema ve RPC'ler `supabase/migrations/20260811130000_add_payment_refunds_and_advances.sql`
içinde. Temel tasarım kararı: **`payments` ve `payment_allocations`
hiçbir zaman silinmez ya da mutasyona uğratılmaz** — "fiziksel delete
yok" kuralı, geçmiş finansal kayıtları hiç değiştirmeme ilkesine
genişletildi. Bunun yerine iki yeni, yalnızca-ekleme (append-only)
ledger tablosu var:

- **`payment_refunds`** — bir ödemeye karşı her iade/ters işlem
  OLAYI (`refund_type`: `refund` gerçek para iadesi, `reversal`
  hatalı kayıt düzeltmesi; `reason`, `created_by`, `created_at` her
  zaman zorunlu).
- **`payment_refund_allocations`** — bir iadenin, ödemenin hangi
  tahakkuk tahsislerini ne kadar geri aldığının kaydı —
  `payment_allocations`'ın simetriği.

`accruals.allocated_amount`/`status` ise **canlı** durumdur ve iade
olduğunda geri hesaplanır — bu bir "silme" değil, güncel bakiyeyi
doğru tutmaktır ("İade sonrası tahakkuk tekrar doğru açık/kısmi
duruma döner" kabul kriteri tam olarak bunu ister).

**`refund_payment(payment_id, amount, reason, refund_type)`** sıralı
bir kural izler: önce ödemenin **dağıtılmamış (avans) kısmından**
düşer; yalnızca o yetmezse **en yeni dönemden başlayarak** tahsisleri
geri alır. "En yeni önce" seçimi bilinçli: eski/vadesi geçmiş bir
borcu yeniden "açma" riskini en aza indirir. Aynı ödeme için toplam
iade tutarı asla `payments.amount`'ı aşamaz — ödeme satırı `for
update` ile kilitlenip mevcut toplam iade bu kilit altında
hesaplanır (eşzamanlı iki iade çağrısı sıraya girer; ikincisi
birincinin commit'inden sonra güncel toplamı görür — aynı desen
`record_payment_for_course`'da da kullanılıyor).

**`allocate_student_advance(payment_id, accrual_id, amount)`** bir
ödemenin avans kısmını admin'in seçtiği belirli bir tahakkuka
uygular; istenen tutar avans veya hedefin bekleyeninden fazlaysa
sessizce sınırlanır (fonksiyon gerçekte uygulanan tutarı döner).
**Otomatik/arka planda kural bazlı dağıtım yok** — yalnızca bu
doğrudan admin çağrısı. Bu bilinçli bir kapsam kararı: parayı
sessizce hareket ettiren bir arka plan işi, yanlış tahakkuka
uygulanırsa fark edilmesi zor bir hata sınıfı yaratır.

**Makbuz numarası** (`payments.receipt_number`, format
`YYYY-000123`) `record_payment_for_course()` içinde
`organizations.next_receipt_number` sayacı `for update` ile
atomik artırılarak üretilir — kurum başına tekil ve sıralı.
(Mevcut `reference_number` sütunu farklı bir amaca hizmet etmeye
devam ediyor: banka/kart referansı gibi serbest metin.)

**Admin ödeme detay sayfası** (`/odemeler/[paymentId]`) bir ödemenin
tüm tahsislerini, iade geçmişini ve (varsa) dağıtılmamış avansını
gösterir; iade/ters işlem ve avans dağıtım formları buradadır.
`/odemeler` tablosundaki her satır bu sayfaya bağlanır. Teacher bu
sayfaya, RPC'lere veya `payment_refunds`/`payment_refund_allocations`
tablolarına **hiçbir şekilde** erişemez — mevcut
`payments`/`accruals`/`payment_allocations` zaten yalnızca admin'e
açıktı, yeni tablolar aynı deseni izliyor.

`get_dashboard_financial_summary()` (Genel Bakış ve `/odemeler`'in
ortak kaynağı) iadeleri hesaba katacak şekilde yeniden tanımlandı:
`monthly_cash_received` artık gerçek nakit akışı — bu ay alınan
ödemeler EKSİ bu ay yapılan iadeler (iade parası kurumdan
GERÇEKTEN çıktığı ayın nakit akışını düşürür, ödemenin hangi aya ait
olduğundan bağımsız); `student_advance_balance` artık iade edilmiş
kısmı da düşüyor.

### Kasa & Banka modülü

Şema ve RPC'ler `supabase/migrations/20260812130000_add_cash_bank_module.sql`
içinde. `cash_accounts`/`bank_accounts`/`cash_movements`/`bank_deposits`/
`bank_deposit_items` tabloları `20260725103000`'den beri şemada vardı
ama hiç kullanılmıyordu — bu migration onları gerçek bir defter haline
getirdi. Ekran: **Kurum Ayarları → Kasa & Banka**
(`/kurum-ayarlari/kasa-banka` genel bakış, `/kurum-ayarlari/kasa-banka/[id]`
kasa hesabı detayı — hareket geçmişi, yatırım oluşturma, sayım).

**Temel tasarım kararı: `cash_movements.amount` her zaman pozitif**
(mevcut `check (amount > 0)` zaten böyleydi); yön yeni eklenen
`direction` sütununda (+1/-1) ayrı tutuluyor. Bakiye **hiçbir zaman**
ayrı bir sütunda tutulmuyor — her sorguda `sum(amount * direction)`
ile hareketlerden yeniden hesaplanıyor (bkz. bölüm 8'deki dashboard
finans göstergeleri notu — orada ayrı/önbelleklenmiş bir toplamın
gerçek veriden sessizce sapması gerçek bir hataya yol açmıştı, aynı
hataya düşmemek için burada da bilinçli olarak önbelleklenmiş bir
bakiye sütunu kullanılmadı). `get_cash_daily_balances()` günlük
bakiyeyi de aynı şekilde, her çağrıda hareketlerden yeniden kurar.

**"Hareketler asla fiziksel silinmez" kuralı iki katmanda uygulanıyor:**
1. `cash_movements`/`bank_deposits`/`bank_deposit_items` üzerinde
   `authenticated`'a `insert`/`update`/`delete` grant'i yok — yalnızca
   bu dosyadaki `security definer` RPC'ler yazabilir ve hiçbiri
   `UPDATE`/`DELETE` yapmıyor, hepsi `INSERT`-only.
2. `reverse_cash_movement()` bir hareketi düzeltmek için onu SİLMEK
   yerine ters yönlü YENİ bir `'correction'` satırı ekler
   (`reverses_movement_id` ile orijinaline bağlı, izlenebilir). Aynı
   hareket ikinci kez ters kayıtla "düzeltilemez" — `reverses_movement_id`
   üzerinden zaten bir ters kaydı olan hareketler reddedilir.

`cash_accounts`/`bank_accounts` birer tanım tablosu (courses/class_groups
gibi) — bunlar için doğrudan admin CRUD RLS'i yeterli (RPC yok).
`record_payment_for_course()`'a (`20260808120000`) eklenen
`p_cash_account_id` parametresi sayesinde, yöntem `cash` seçilip bir
kasa hesabı belirtildiğinde ödeme kaydıyla AYNI transaction'da bir
`cash_in` hareketi de oluşur — imza değiştiği için migration önce eski
5 parametreli fonksiyonu `drop function` ile kaldırıp yenisini
oluşturuyor (yoksa `create or replace` yeni bir overload yaratır,
eskisi silinmeden kalırdı).

**Banka/ATM yatırımı** (`create_bank_deposit()`) seçilen `cash_in`
hareketlerinin (yalnızca bu kasaya ait, pozitif yönlü, henüz hiçbir
yatırıma dahil edilmemiş — advisory lock + ikinci bir kontrol eşzamanlı
isteklere karşı) toplamını TEK sorgudan hesaplayıp hem
`bank_deposits.amount`'a hem de dengeleyici `-amount` yönlü yeni bir
`cash_movements` satırına (`movement_type = 'bank_deposit'`) yazar.
`bank_deposit_items` toplamının `bank_deposits.amount`'a her zaman eşit
olması ayrı bir `CHECK`/trigger ile değil, **tek yazma yolu** ile
garanti edilir (`payment_allocations` toplamı ile aynı felsefe).
**Aynı kasa hareketi birden fazla yatırıma dahil edilemez** —
`bank_deposit_items(cash_movement_id)` üzerindeki tekil indeks bunu
veritabanı seviyesinde garanti eder, RPC de ayrıca kontrol edip
anlaşılır bir hata verir. Orijinal `cash_in` hareketleri yatırım
sonrası hiç değiştirilmez/mutasyona uğramaz — yalnızca dengeleyici
`bank_deposit` hareketi eklenir, ledger felsefesiyle tutarlı.

**Kasa sayımı** (`record_cash_count_adjustment()`) fiziksel sayımı
canlı hesaplanan defter bakiyesiyle karşılaştırır; fark sıfırsa hiçbir
satır eklenmez, sıfır değilse farkın işaretine göre yönlü bir
`'correction'` hareketi eklenir.

**Makbuz yükleme** `bank-deposit-receipts` adında özel (private) bir
Storage bucket'ına yapılır — `student-photos` ile birebir aynı desende
(`is_admin()` + organizasyon klasör öneki kısıtı). Yatırım oluşturma
formunda makbuz opsiyonel; sonradan eklemek/değiştirmek için ayrı
`set_bank_deposit_receipt()` RPC'si var.

**Kapsam dışı bırakılanlar**: gerçek banka ekstresi içe aktarma/otomatik
mutabakat yok — `get_bank_account_summary()` yalnızca bu uygulamanın
kendi `bank_deposits` kayıtlarını toplar (banka entegrasyonu bu
uygulamada hiç yok, ödeme iade/avans modülündeki "gerçek dış sistem
entegrasyonu yok" notuyla aynı sınır). `cash_out` (nakit çıkışı,
ör. kasadan elle ödenen masraf) enum'da tanımlı ama bu görev
kapsamında onu üreten bir RPC eklenmedi — yalnızca sayım
düzeltmesi/ters kayıt negatif yönlü hareket üretebiliyor; masraf
ödemelerinin kasadan düşülmesi ayrı bir görev (`expenses` tablosuyla
entegrasyon) olarak bırakıldı.

### Masraf yönetimi ve net kârlılık

Şema ve RPC'ler `supabase/migrations/20260812140000_add_expense_management.sql`
içinde. `expense_categories`/`expenses` tabloları da (Kasa & Banka
gibi) `20260725103000`'den beri şemada vardı ama hiç kullanılmıyordu.
Ekran: **Giderler** (`/giderler` — kategori/şablon yönetimi, aylık
kârlılık özeti, masraf listesi; `/giderler/yeni` yeni masraf;
`/giderler/[id]` düzenleme/ödeme/iptal/belge). Kârlılık ve ders bazlı
katkı payı raporları ayrıca **Raporlar** ekranının üçüncü sekmesinde
(`/raporlar?view=karlilik`).

**Yaşam döngüsü**: `planned → paid → cancelled`. Yalnızca `planned`
durumundaki bir masraf düzenlenebilir veya ödenmiş işaretlenebilir;
`paid` bir masrafın tutarı asla yerinde değiştirilmez — düzeltme
isteniyorsa desen her yerde aynı: **iptal et (ters kayıt otomatik
oluşur) + doğrusunu yeni bir masraf olarak ekle**. `expenses`
tablosuna `authenticated`'ın insert/update/delete grant'i yok —
tüm mutasyon `create_expense`/`update_expense_details`/
`record_expense_payment`/`cancel_expense`/`set_expense_document`
RPC'lerinden geçer.

**Nakit ödenen masraf → Kasa & Banka defterine bağlanır**
(`20260812130000`'daki `cash_movements` defterinin tüketicisi):
`record_expense_payment(..., 'cash', p_cash_account_id)` aynı
transaction'da bir `cash_out` (`direction = -1`) hareketi oluşturur ve
`expenses.cash_movement_id` ile ona bağlar — `record_payment_for_course()`'un
`cash_in` tarafındaki simetriği, ve `cash_movement_type` enum'undaki
`cash_out` değerinin ilk gerçek kullanım yeri. `cancel_expense()` bir
masrafı SİLMEZ; `status = 'cancelled'` yapar VE (nakit ödenmişse)
bağlı hareketi `reverse_cash_movement()` ile ters kayıtla düzeltir —
kasa bakiyesi hiçbir zaman gerçek hareketlerden sapmaz ("Finansal
toplamlar kasa hareketleriyle tutarlı kalır" kabul kriteri tam olarak
bunu ister).

**Tekrarlayan masraflar** ayrı bir `recurring_expense_templates`
tablosuyla modellenir — `class_groups → lesson_sessions` ve
`enrollments → accruals` ile AYNI şablon/üretim deseni.
`generate_monthly_expenses(month)` her aktif şablondan o ay için bir
`expenses` satırı üretir; **dönem bazlı idempotency key**
`expenses(template_id, period_start)` üzerindeki KISMİ tekil indekstir
(yalnızca `template_id` dolu satırlarda geçerli — tek seferlik
masrafları etkilemez) — `accruals(enrollment_id, period_start)` ile
birebir aynı fikir. Aynı şablon aynı ay için tekrar çalıştırılırsa
mükerrer satır oluşmaz; bu garanti yalnızca RPC'nin `on conflict do
nothing`'ine değil, veritabanı seviyesindeki indekse dayanır (RPC'yi
atlayan bir yazma denemesi de aynı şekilde reddedilir).
`recurring_expense_templates`, `expense_categories`/`courses`'a
referans verdiği için (çapraz-organizasyon FK riski) `cash_accounts`/
`bank_accounts`'ın aksine doğrudan RLS insert değil, RPC üzerinden
yazılır — kategori/ders kimliğinin gerçekten aynı kuruma ait olduğu
`create_recurring_expense_template()` içinde açıkça doğrulanır.

**Doğrudan ders maliyeti**: `expenses.course_id` doluysa o masraf
"doğrudan" sayılır (kategori üzerindeki `is_direct_course_cost`
bayrağından bağımsız — o yalnızca UI'da hangi kategorilerin genelde
ders maliyeti olduğunu işaretlemek için bir ipucu). Raporlama bunu iki
yerde kullanır:

- `get_monthly_profitability_summary(month)` — `revenue_accrued`
  (dashboard'daki `monthly_accrued` ile AYNI filtre), `direct_expenses`
  (`course_id` dolu, iptal hariç), `indirect_expenses` (`course_id`
  boş), `gross_result = revenue - direct_expenses`,
  `net_result = revenue - (direct + indirect)`. `expenses_paid_cash`
  (nakit/tüm yöntemlerden bağımsız, `paid_at` bu ay içinde olan
  ödenmiş masraflar) zaten var olan nakit akışı raporundaki
  (`get_cash_flow_report_monthly`, `20260811140000`) `expenses_paid`
  ile AYNI filtreyi kullanır — iki rapor asla farklı sayı göstermez.
- `get_course_contribution_margins(month)` — her ders için o dersin
  bu ayki geliri (aynı `accruals` filtresi) eksi yalnızca o derse
  bağlı doğrudan giderler.

Tüm raporlama RPC'leri **muhasebe (accrual) esaslı** —
`expense_date`/`period_start` üzerinden, ödenip ödenmediğinden
bağımsız. Bu, gelir tarafındaki `monthly_accrued` ile tutarlı kalması
için bilinçli bir tercih (bkz. bölüm 8, dashboard finans göstergeleri
— aynı ayın rakamlarının farklı ekranlarda hiç ayrışmaması ilkesi).
Nakit bazlı masraf tutarı yalnızca `expenses_paid_cash` alanında ayrıca
sunulur.

**Belge yükleme** `expense-documents` adında özel (private) bir
Storage bucket'ına yapılır — `student-photos`/`bank-deposit-receipts`
ile birebir aynı desen (`is_admin()` + organizasyon klasör öneki).

**Kapsam dışı bırakılanlar**: `update_expense_details` yalnızca
`planned` durumdaki masrafları düzenler — ödenmiş bir masrafın
kategorisini/tutarını "düzeltmek" için ayrı bir RPC yok, iptal + yeni
kayıt deseni kullanılır (bkz. yukarı). Şablonların kendisini
düzenlemek için de ayrı bir RPC yok — yalnızca aktif/pasif; şablon
koşulları değiştiğinde admin yeni bir şablon oluşturup eskisini pasife
alır (geçmiş üretilmiş masrafları etkilemez, çünkü onlar zaten
bağımsız satırlardır).

### Öğretmen hakediş sistemi

Şema ve RPC'ler `supabase/migrations/20260812150000_add_teacher_compensation.sql`
içinde. `teacher_work_logs` da (Kasa & Banka / Giderler gibi)
`20260725103000`'den beri şemada vardı ama hiç kullanılmıyordu. Ekran:
**Hakediş** (`/hakedis` — aylık öğretmen özeti, üretim tetikleyici;
`/hakedis/[teacherId]` — kural yönetimi, aylık döküm, onay/ödeme,
manuel düzeltme). Öğretmen tarafı: **Programım → Hakedişim**
(`/ogretmen-paneli/hakedisim`, yalnızca kendi kayıtları).

**Bulunan ve kapatılan güvenlik açığı**: `teacher_work_logs` üzerindeki
eski RLS politikaları (`work_logs_insert`/`work_logs_update`,
`20260725103000`) öğretmenin **kendi hakediş satırını doğrudan REST
ile insert/update edebilmesine** izin veriyordu — tablo hiç
kullanılmadığı için fark edilmemişti. Bu migration bu politikaları
tamamen kaldırdı; artık `teacher_work_logs` diğer finansal defterlerle
(`cash_movements`, `expenses`) aynı desende — yalnızca `select`,
yazma yalnızca `security definer` RPC'ler üzerinden.

**Dört ücret modeli, etkin tarih aralıklı**: `teacher_compensation_rules`
— `per_lesson` (ders başına sabit), `per_minute` (dakika başına),
`per_student` (yalnızca `present` işaretli katılımcı başına),
`monthly_salary` (sabit aylık, oturum sayısından bağımsız). Aynı
öğretmen için tarih aralığı çakışan iki kural oluşturulamaz
(`create_teacher_compensation_rule()` içinde açıkça kontrol edilir).
Bir kuralı "düzenlemek" yerine desen: `end_teacher_compensation_rule()`
ile mevcut kuralı kısalt, yeni tarihte yeni kuralla başlat.

**Dört senaryo ayrı ele alınır** (`generate_teacher_compensation(month)`):

- **normal** — kuralın `compensation_type`'ına göre hesaplanır.
- **kurum iptali** (`lesson_sessions.cancellation_kind = 'institution'`)
  — kuralın düz `cancellation_rate_amount`'ı (yapılandırılmamışsa 0,
  yani ödenmez), süre/öğrenci sayısından bağımsız.
- **öğretmen devamsızlığı** (`cancellation_kind = 'teacher_absence'`)
  — tutar her zaman 0, ama satır yine de İK/izlenebilirlik amacıyla
  oluşturulur (sessizce atlanmaz). Bu ayrım için `cancel_lesson_session()`'a
  (`20260811100000`) yeni bir `p_cancellation_kind` parametresi
  eklendi — imza değiştiği için eski imza önce `drop function` ile
  kaldırıldı (bkz. bölüm 8, benzer `record_payment_for_course`
  değişikliği). `/yoklama` ekranındaki iptal formuna bu seçim eklendi.
- **telafi** (`lesson_sessions.is_makeup = true`) — kuralın
  `compensation_type`'ı AMA ayrı `makeup_rate_amount` (boşsa normal
  `rate_amount`'a düşer).

"Tamamlanmış ve onaylanmış" oturum tanımı iki farklı sinyalin
BİRLEŞİMİ: normal oturumlar için `attendance_locked_at` dolu (admin
yoklamayı kilitledi — bkz. bölüm 8, yoklama modülü), iptal edilmiş
oturumlar için `cancelled_at` dolu YETERLİ (`cancel_lesson_session()`
zaten kilitli bir oturumun iptaline izin vermiyor, yani iptal kendi
başına sonlanmış/onaylanmış bir durumdur — biri kilitlenip DE iptal
edilemez).

**İdempotency iki ayrı kısmi tekil indeksle**: oturum bazlı satırlar
için `teacher_work_logs(lesson_session_id) WHERE source = 'session'`
(oturum başına en fazla bir satır — kabul kriteri "aynı oturum için
mükerrer hakediş oluşamaz" tam olarak budur), aylık maaş satırları
için ayrı `teacher_work_logs(teacher_profile_id, period_start) WHERE
source = 'monthly_salary'`.

**Kural anlık görüntüsü (snapshot)**: uygulanan `compensation_type`,
`rate_snapshot` ve `scenario` doğrudan `teacher_work_logs` satırına
yazılır; ekranlar bu satırları **hiçbir zaman**
`teacher_compensation_rules`'a yeniden JOIN ederek göstermez — tutar
zaten üretim anında hesaplanıp satıra yazıldığından, bir kural
sonradan sonlandırılsa/yeni bir kural eklense bile geçmiş satırlar
değişmez (kabul kriteri #6, pgTAP'te doğrudan doğrulandı).

**Onay → ödeme sırası ve kilit**: `approve_teacher_compensation()`
bekleyen (`approved_at` boş) satırları toplu onaylar (idempotent —
zaten onaylı satırları tekrar saymaz); `mark_teacher_compensation_paid()`
yalnızca ONAYLI satırları ödeme olarak işaretler, onaylanmamış bir
dönemi doğrudan ödemeye çalışmak reddedilir. Onaylanmış/ödenmiş bir
satır `authenticated`'ın (admin dahil) hiçbir REST çağrısıyla doğrudan
güncellenemez — düzeltme her zaman `add_compensation_adjustment()`
ile YENİ bir satır olarak eklenir (`cash_movements`/`expenses`'teki
AYNI "asla mutasyon yok" felsefesi; `direction` sütunuyla ekleme/
kesinti işaretlenir).

**Admin ve öğretmen aynı kaynaktan hesaplar**: her iki ekran da
(`/hakedis/[id]` ve `/ogretmen-paneli/hakedisim`) `teacher_work_logs`
tablosunu AYNI sütunlarla, ekstra bir özet RPC'si olmadan doğrudan
sorgular ve toplamı istemci tarafında aynı şekilde hesaplar — tek
fark RLS'in öğretmen için satırları kendi `teacher_profile_id`'siyle
sınırlaması (kabul kriteri #4). Ayrı bir "özet" RPC'si eklenmedi —
böyle bir RPC'nin admin ve öğretmen ekranları arasında sessizce
ıraksama riski (biri güncellenip diğeri unutulursa) bu şekilde
tamamen ortadan kalkıyor.

### Denetim kaydı görüntüleyici

Şema ve RPC/fonksiyon değişiklikleri
`supabase/migrations/20260812160000_add_audit_log_hardening.sql`
içinde. Ekran: **Kurum Ayarları → Denetim Kaydı**
(`/kurum-ayarlari/denetim-kayitlari`) — sunucu taraflı sayfalama,
tablo/kullanıcı/tarih aralığı filtreleri, her satır için Türkçe alan
etiketleriyle önceki/sonraki karşılaştırması (`src/lib/audit/labels.ts`).
Yeni bir RPC gerekmedi — `audit_logs` zaten (`current_organization_id()`
+ `is_admin()`) admin'e SELECT açık olduğundan ekran doğrudan
`.from("audit_logs").select(..., profiles(full_name))` kullanır; diğer
tüm listeleme ekranlarıyla aynı desen.

**Bu görevin asıl işi yeni kod yazmak değil, mevcut 75 `audit_logs`
insert çağrısının (19 migration dosyası) tek tek gözden
geçirilmesiydi.** Sonuç: bugüne kadar hiçbir denetim satırına T.C.
kimlik no, şifre/geçici şifre, token veya `service_role` anahtarı
yazılmamış — bu depodaki HER audit_logs yazımı, satırın tamamını değil
açık bir alan listesini (`jsonb_build_object`) kullanıyor. Buna rağmen
iki kırılgan nokta ve iki gerçek kapsam boşluğu bulunup düzeltildi:

- **`audit_logs` üzerinde `authenticated`'a açık bir `revoke insert,
  update, delete`** eklendi. Bu tablo aslında baştan beri korunuyordu
  (RLS etkin + yalnızca bir SELECT politikası = Postgres bu komutları
  o rol için otomatik reddeder) ama bu örtük garantiye güvenmek yerine
  bu depodaki diğer finansal tablolarla (`cash_movements`, `expenses`,
  `teacher_work_logs`) aynı açık ifade eklendi.
- **`set_teacher_course_meb_authorization()`/`set_enrollment_meb_registration()`**
  bu depodaki TEK yerdi denetim satırını `pg_catalog.to_jsonb(satır)`
  ile SATIRIN TAMAMINDAN üretiyordu (bugün o tablolarda hassas bir
  sütun yok ama ileride sessizce sızma riski taşıyordu) — açık alan
  listesine çevrildi.
- **`log_rejected_scheduling_attempt(p_payload jsonb)`** istemciden
  gelen serbest bir jsonb'yi olduğu gibi saklıyordu — artık yalnızca
  gerçek 5 çağrı noktasında (`program/actions.ts`,
  `yoklama/session-actions.ts`, `ogrenciler/[studentId]/enrollment-actions.ts`)
  kullanılan 16 bilinen alan tutuluyor, geri kalanı sunucu tarafında
  süzülüyor.
- **Gerçek kapsam boşluğu #1**: `create_student_with_guardian()` —
  bir öğrenci/velinin T.C. kimlik numarasının sisteme GİRDİĞİ an —
  hiç denetlenmiyordu (yalnızca sonraki güncellemeler denetleniyordu).
  Artık denetleniyor; kimlik numaraları YİNE loglanmıyor, yalnızca
  ad/soyad/doğum tarihi/veli adı gibi kimlik-dışı alanlar.
- **Gerçek kapsam boşluğu #2**: `organizations` tablosu (kurum adı,
  iletişim, WhatsApp şablonu, otomasyon ayarları) hiç denetlenmiyordu
  — admin bu tabloyu 4 ayrı server action'dan doğrudan güncelliyor,
  tek bir RPC kapısı yok. Kod tekrarı veya 4 action'ı RPC'ye taşıma
  riski yerine bir `AFTER UPDATE` trigger eklendi — mevcut hiçbir
  action'a dokunmadan çalışır. Trigger yalnızca izlenen alanlardan
  biri değiştiğinde tetiklenir; `next_receipt_number` (her ödemede
  artan dahili sayaç, `20260811130000`) BİLİNÇLİ olarak dışarıda
  bırakıldı — yoksa her ödeme kaydı yanlışlıkla bir "kurum ayarları
  değişti" satırı üretirdi.

**Not edilen ama değiştirilmeyen bir tasarım detayı**: para iadeleri
kendi `table_name` değerine sahip değil — `refund_payment()` denetim
satırını `table_name = 'payments'`, `action = 'refund'`/`'reversal'`
olarak yazıyor. Ekrandaki "Ödemeler" modül filtresi bu yüzden iadeleri
de otomatik kapsar; bu davranış canlı kod yolunu riske atmamak için
bilinçli olarak değiştirilmedi.

**Maskeleme iki katmanlı**: (1) kaynak kodun kendisi zaten hassas
alanları hiç seçip audit_logs'a yazmıyor (yukarıya bakın); (2) ekranın
kendisi de bağımsız bir savunma katmanı olarak, adında `identity_number`/
`kimlik`/`password`/`token`/`service_role` gibi bir örüntü geçen HER
anahtarı (hangi tablodan gelirse gelsin) `••••••••` ile gösterir
(`isSensitiveAuditKey()`, `src/lib/audit/labels.ts`) — ileride
farkında olmadan eklenecek bir alana karşı ek bir güvenlik ağı.

## 9. Mevcut başlangıç ekranları

- Yönetim paneli
- Öğrenciler
- Ödemeler
- Yoklama
- Öğretmenler
- Raporlar
- Giriş ekranı

## 10. Aylık ders oturumu ve tahakkuk otomasyonu

Yönetici artık her ay elle "oluştur" butonuna basmak zorunda değil.
Şema ve fonksiyonlar `supabase/migrations/20260812120000_add_monthly_generation_automation.sql`
içinde.

### Neden pg_cron (Vercel Cron değil)

Üretim mantığının tamamı zaten veritabanında (security definer
fonksiyonlar) yaşıyor — `pg_cron`, bu fonksiyonları doğrudan çağırarak
çalışır; bir HTTP endpoint'i, paylaşılan bir secret veya uygulamanın
hangi platformda barındırıldığı bilgisiyle uğraşmaya gerek kalmaz.
Vercel Cron seçilseydi hem bir Route Handler + secret header
doğrulaması hem de Vercel'e özgü bir yapılandırma (`vercel.json`)
gerekirdi; bu depoda öyle bir bağımlılık yok ve bu görev kapsamında da
eklenmedi.

### Nasıl çalışır

1. Her kurumda `sessions_generation_day` ve `accruals_generation_day`
   (1-28, `whatsapp_reminder_day` ile aynı desen) ile "hangi günde
   üretilsin" ayarlanır — **Kurum Ayarları → Otomasyon** sekmesinden.
2. `run_daily_automation_sweep()` pg_cron tarafından **her gün** bir
   kez (01:00 UTC, `monthly-generation-daily-sweep` işi) çağrılır. Her
   aktif kurum için kurumun yerel "bugün"ü yapılandırılmış güne denk
   geliyorsa ve gelecek ay için henüz başarılı bir çalıştırma yoksa,
   `run_monthly_automation_job()`'ı tetikler. Üretim günü ayarı
   değiştiğinde pg_cron'u yeniden zamanlamaya gerek yok — sweep zaten
   her gün kontrol ediyor.
3. `run_monthly_automation_job()` çalıştırmayı `automation_job_runs`
   tablosuna `running` olarak kaydeder, ilgili `generate_monthly_*`
   çekirdeğini (kurum kimliği artık `auth.uid()` yerine açık parametre)
   çağırır, sonucu `succeeded`/`failed` olarak günceller. Hata
   durumunda (`exception when others`) plpgsql'in örtük savepoint'i
   sayesinde o ana kadarki TÜM kısmi insert'ler geri alınır — yalnızca
   `job_runs` satırı `failed` + `error_summary` ile kalır, yarım kalmış
   oturum/tahakkuk satırı oluşmaz.
4. Aynı kurum + iş türü + dönem için eşzamanlı iki çalışma, hem
   advisory lock hem de `automation_job_runs` üzerindeki kısmi
   unique index (`status = 'running'` iken) ile engellenir.
5. **Kurum Ayarları → Otomasyon** sekmesi son 20 çalıştırmayı listeler;
   başarısız olanların yanında **Yeniden dene** butonu vardır. Bu
   buton, admin paneli server action'ından `service_role` anahtarıyla
   (`createAdminClient()`, `src/lib/supabase/admin.ts`) çağrılır —
   `run_monthly_automation_job()` yalnızca `service_role`'e açıktır,
   normal admin oturumu (`authenticated` rolü) bu fonksiyonu doğrudan
   çağıramaz.
6. `/yoklama` ve `/odemeler` ekranlarındaki elle "oluştur" butonları
   (`generate_monthly_lesson_sessions`/`generate_monthly_accruals`
   RPC'leri) **hiç değişmeden** acil durum yedeği olarak duruyor —
   otomasyon bu RPC'lerin gövdesini kurum-parametreli iç
   fonksiyonlara taşıdı, dış imza ve davranış aynı kaldı.

### Yerel geliştirme kurulumu

Docker Desktop ile yerel Supabase (`npx supabase start`) kullanan
projelerde `pg_cron` uzantısı resmi `supabase/postgres` imajında zaten
bulunur; migration'daki `create extension if not exists pg_cron;`
yerelde de sorunsuz çalışır. `npx supabase db reset` sonrası
`select * from cron.job;` ile `monthly-generation-daily-sweep` işinin
zamanlandığını görebilirsiniz. Yereldeki pg_cron, konteyner saatine
göre (genelde UTC) her gün 01:00'de tetiklenir; belirli bir günü
beklemeden test etmek için doğrudan
`select public.run_daily_automation_sweep();` çağırabilirsiniz.

### Production (Supabase bulut) kurulumu

1. Migration'ı push edin: `npx supabase db push`. Bu, `pg_cron`
   uzantısını oluşturur ve `monthly-generation-daily-sweep` işini
   zamanlar — ekstra bir Dashboard adımı gerekmez.
2. Eğer proje `create extension pg_cron` için yetki hatası verirse
   (bazı planlarda uzantı önce Dashboard'dan açılmalıdır): Supabase
   Dashboard → **Database → Extensions** üzerinden `pg_cron`'u elle
   etkinleştirin, sonra `npx supabase db push`'u tekrar çalıştırın.
3. Zamanlanan işi doğrulamak için Dashboard → **Database → Cron**
   sayfasına bakın veya SQL Editor'dan `select * from cron.job;`
   çalıştırın.
4. Her kurum için üretim günlerini **Kurum Ayarları → Otomasyon**
   ekranından yapılandırın (varsayılan: her iki iş için de ayın 25'i).

## 11. Sonraki geliştirme sırası

1. Gerçek kullanıcı/rol akışı
2. Öğrenci ve veli CRUD işlemleri
3. Ders kayıtları ve fiyatlandırma
4. Aylık tahakkuk üretimi
5. Ödeme ve ödeme dağıtımı
6. Yoklama ve telafi
7. Kasa/ATM yatırımı mutabakatı
8. Öğretmen hak edişi
9. Aylık raporlar

## 12. Test Stratejisi ve CI

Dört katmanlı bir test yaklaşımı var; her katman farklı bir şeyi doğrular, birbirinin yerine geçmez:

| Katman | Ne test eder | Nerede | Nasıl çalıştırılır |
|---|---|---|---|
| **Unit** | Saf TypeScript hesap/biçimlendirme fonksiyonları (para ayrıştırma, ISO tarih/ay doğrulama, CSV dışa aktarım satırları) | `src/**/*.test.ts` | `npm test` |
| **Component** | Kritik formların render/etkileşim davranışı (KVKK anonimleştirme onay kilidi, kayıt formu hassas alanları) | `src/**/*.test.tsx` | `npm test` |
| **Database integration (pgTAP)** | RPC'ler, RLS politikaları, transaction/rollback davranışı, kurum izolasyonu — **asıl finansal/yetki mantığının çoğu burada yaşıyor**, TS tarafında değil | `supabase/tests/database/*.test.sql` (14 dosya) | `npx supabase start` sonrası `npm run supabase:test` |
| **E2E (Playwright)** | Admin'in ilk kurulum → zorunlu MFA kurulumu → öğretmen hesabı oluşturma akışı; öğretmenin geçici parolayla giriş → zorunlu parola değişikliği → yalnızca kendi paneli/nav öğelerini görmesi | `e2e/*.spec.ts` | `npm run test:e2e` (yerel Supabase + build gerektirir, `playwright.config.ts` ikisini de otomatik yönetir) |

**Önemli netlik:** İndirim hesabı, tahakkuk üretimi, ödeme/iade/avans dağıtımı gibi asıl finansal mantık TypeScript'te değil Postgres RPC'lerinde yaşıyor (bkz. bölüm 8-10) — bunlar unit test değil, pgTAP paketiyle test ediliyor. TS tarafındaki unit testler yalnızca formatlama/doğrulama/dışa aktarım yardımcılarını (`src/lib/format.ts`, `src/lib/payments/export.ts`, `src/lib/reports/export.ts`) kapsıyor.

**Zorunlu senaryoların pgTAP karşılığı** (hepsi zaten kapsanıyor, ilgili dosya adları):

- Dış kullanıcı kurum oluşturamaz → `bootstrap_first_admin.test.sql`
- Teacher başka öğretmenin öğrencisini/finans verisini göremez → `role_data_minimization.test.sql`, `role_simplification.test.sql`
- Mükerrer tahakkuk/oturum oluşmaz, dondurulmuş kayda tahakkuk gitmez → `monthly_generation_automation.test.sql`
- Kısmi/fazla ödeme ve iade → `payment_refunds_and_advances.test.sql`, `cash_bank_module.test.sql`
- Yoklama yalnızca dersin öğretmeni/admin tarafından alınır → `attendance_marking.test.sql`
- Kontenjan ve saat çakışması engellenir → `scheduling_conflict_engine.test.sql`
- Kurumlar arası veri sızıntısı olmaz → `role_data_minimization.test.sql`, `organizations_direct_write.test.sql`

**Saat/tarih bağımlılığından arındırma:** Testler `pg_sleep` veya gerçek `now()`'ın geçmesini beklemez — ya RPC'ler zaten açık bir tarih parametresi alır (ör. `get_meb_monthly_roster(p_month_start)`) ya da fixture satırlarına doğrudan geçmiş/gelecek `created_at` değerleri yazılıp sınır davranışı öyle test edilir (ör. rate-limit'in 15 dakika penceresi).

### CI (`.github/workflows/ci.yml`)

Beş paralel iş — hiçbiri GitHub secret'ı kullanmıyor (`db-integration` ve `e2e`, `supabase start` ile açılan geçici/yerel bir Docker Supabase'e karşı çalışıyor; anahtarlar o çalıştırmaya özgü, workflow dosyasına hiç yazılmıyor):

1. **lint-and-typecheck** — `npm run lint` + `npm run typecheck`.
2. **unit** — `npm test` (unit + component, veritabanı gerektirmez, en hızlı iş).
3. **build** — `npm run build` (placeholder env değerleriyle — hiçbir sayfa build zamanında Supabase'e ağ çağrısı yapmıyor).
4. **db-integration** — `supabase start` → `supabase db reset` (migration'ların temiz uygulandığının doğrulanması) → `supabase test db` (pgTAP paketinin tamamı).
5. **e2e** — `supabase start` + `db reset` → Playwright, admin ve öğretmen temel akışları.

Başarısız bir işin nedeni her zaman iş adından ve o işin kendi log'undan anlaşılır (pgTAP açıklayıcı Türkçe assertion mesajları kullanır, Vitest/Playwright varsayılan çıktısı zaten dosya+satır+beklenen/gerçek değeri gösterir).

**Bilinen sınır:** Bu makinede Docker olmadığı için pgTAP paketi ve E2E testleri yazılırken gerçek şema/RPC imzalarına karşı dikkatli statik inceleme yapıldı ama lokal olarak çalıştırılıp doğrulanamadı — CI'daki ilk çalıştırma bunun ilk gerçek kanıtı olacak.

## Güvenlik notu

`service_role` anahtarını hiçbir zaman `NEXT_PUBLIC_` değişkeninde veya tarayıcı kodunda kullanmayın. Gerçek çocuk/veli verisini taşımadan önce KVKK, veri barındırma bölgesi, yedekleme ve kullanıcı yetkileri ayrıca gözden geçirilmelidir — bkz. [`docs/guvenlik-kontrol-listesi.md`](docs/guvenlik-kontrol-listesi.md), [`docs/veri-saklama-politikasi.md`](docs/veri-saklama-politikasi.md) ve [`docs/yedekleme-ve-geri-yukleme.md`](docs/yedekleme-ve-geri-yukleme.md).
