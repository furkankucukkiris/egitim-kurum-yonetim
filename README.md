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
