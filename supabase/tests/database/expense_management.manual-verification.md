# Masraf yönetimi modülü — canlı doğrulama notu

`expense_management.test.sql` bu makinede Docker olmadığı için yerel
olarak (`npx supabase test db`) çalıştırılamadı
([[feedback-no-docker-push-to-dev]]). Fixture kurulumu diğer pgTAP
dosyalarıyla aynı desende (`delete from public.organizations` ile
başlıyor) — canlı `-dev` veritabanındaki gerçek tek-kurum verisini
silmek anlamına geleceğinden orada bilinçli olarak çalıştırılmadı.

## Canlı doğrulanan (gerçek dev DB, veri mutasyonu yok)

Migration push edildikten sonra, hiçbir satır yazmayan izin sınırı
kontrolleri `curl` ile `anon` anahtarıyla yapıldı:

| Çağrı | Beklenen | Sonuç |
| --- | --- | --- |
| `rpc/create_expense` (anon key) | Reddedilir | ✅ `HTTP 401`, `42501 permission denied for function create_expense` |
| `rpc/generate_monthly_expenses` (anon key) | Reddedilir | ✅ `HTTP 401`, `42501 permission denied for function generate_monthly_expenses` |
| `expenses?select=id` (anon key) | RLS anon'u sıfır satıra düşürür | ✅ `HTTP 200`, `[]` |
| `recurring_expense_templates?select=id` (anon key) | Aynı | ✅ `HTTP 200`, `[]` |

Migration (yeni tablo, şema eklemeleri, RLS, 11 yeni RPC, storage
bucket + policy) tek bir transaction içinde hatasız uygulandı.

## Yalnızca pgTAP ile doğrulanan (Docker gerektirir, kurulmadı)

`expense_management.test.sql` (39 assertion) şunları izole
fixture'larla test ediyor:

- **Yaşam döngüsü**: planlı → ödendi geçişi yalnızca `planned`
  durumundaki masraflarda çalışıyor; ödenmiş bir masraf ne tekrar
  ödenebiliyor ne de `update_expense_details` ile düzenlenebiliyor
  (düzeltme yalnızca iptal + yeni kayıt yoluyla).
- **Nakit ödeme → cash_out hareketi**: `record_expense_payment(...,
  'cash', p_cash_account_id)` kasa hesabı verilmeden reddediliyor;
  verildiğinde tam olarak bir `cash_out` (`direction = -1`) hareketi
  oluşuyor, `expenses.cash_movement_id` doğru hareketi işaret ediyor,
  kasa bakiyesi tutar kadar düşüyor.
- **İptal → ters kayıt, fiziksel silme yok**: ödenmiş bir masraf iptal
  edildiğinde bağlı `cash_movement` SİLİNMİYOR — `cancel_expense()`
  içeride `reverse_cash_movement()`'ı çağırıyor, yeni bir ters yönlü
  satır ekleniyor, kasa bakiyesi iptalden önceki değerine dönüyor,
  toplam hareket sayısı hiç azalmıyor. Aynı masraf ikinci kez iptal
  edilemiyor. `authenticated` (admin dahil) `expenses`'ten doğrudan
  `DELETE` yapamıyor (`42501`).
- **Tekrarlayan masraf idempotency**: `generate_monthly_expenses()`
  aynı dönem için ikinci çalıştırmada `created_count = 0` döndürüyor,
  mükerrer satır oluşmuyor; `expenses(template_id, period_start)`
  üzerindeki KISMİ tekil indeks, RPC'yi atlayıp doğrudan (superuser
  bağlamında) ikinci bir satır eklemeye çalışıldığında da (`23505`)
  aynı garantiyi RPC'den bağımsız olarak sağlıyor.
- **Kârlılık ve katkı payı raporları**: `get_monthly_profitability_summary()`
  — iptal edilmiş bir masrafın `direct_expenses`'e hiç girmediği,
  doğrudan (`course_id` dolu) ve dolaylı (`course_id` boş) giderlerin
  doğru ayrıldığı, `gross_result`/`net_result`'ın beklenen tutarlarla
  birebir eşleştiği sayısal olarak doğrulanıyor.
  `get_course_contribution_margins()`'ın tek-ders senaryosunda kurum
  genelindeki `gross_result` ile aynı sonucu verdiği kontrol ediliyor.
- **Admin-only**: teacher `create_expense`/`generate_monthly_expenses`'i
  çağıramıyor, `expenses`'i `SELECT` ile bile göremiyor, masraf
  kategorisi oluşturamıyor.

## Kapsam dışı bırakılanlar

- **Belge yükleme** (`expense-documents` bucket'ı ve
  `set_expense_document()`) pgTAP'te test edilmedi — dosya yükleme
  Storage API'si üzerinden gerçekleşiyor, salt SQL katmanında simüle
  etmek pratik değil. Bucket'ın `student-photos`/`bank-deposit-receipts`
  ile birebir aynı desende (`is_admin()` + organizasyon klasör öneki)
  olduğu kod incelemesiyle doğrulandı.
- **Nakit dışı ödenmiş masrafların iptali** (`bank_transfer`/`card`/
  vb.) testte örtük olarak kapsanıyor (`cash_movement_id` null
  olduğunda `cancel_expense()` `reverse_cash_movement()`'ı hiç
  çağırmıyor — kod yolunda `if v_expense.cash_movement_id is not null`
  koşuluyla korunuyor) ama ayrı bir assertion ile doğrulanmadı.
