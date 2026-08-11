# Kasa & Banka modülü — canlı doğrulama notu

`cash_bank_module.test.sql` bu makinede Docker olmadığı için yerel
olarak (`npx supabase test db`) çalıştırılamadı
([[feedback-no-docker-push-to-dev]]). Fixture kurulumu diğer pgTAP
dosyalarıyla aynı desende (`delete from public.organizations` ile
başlıyor) — bu, canlı `-dev` veritabanındaki gerçek tek-kurum verisini
silmek anlamına geleceğinden, bilinçli olarak orada çalıştırılmadı.

## Canlı doğrulanan (gerçek dev DB, veri mutasyonu yok)

Migration push edildikten sonra, hiçbir satır yazmayan, yalnızca izin
sınırlarını sınayan çağrılar `curl` ile `anon` anahtarıyla PostgREST'e
doğrudan yapıldı:

| Çağrı | Beklenen | Sonuç |
| --- | --- | --- |
| `rpc/create_bank_deposit` (anon key) | Reddedilir — yalnızca `authenticated` (ve içeride `is_admin()`) erişebilir | ✅ `HTTP 401`, `42501 permission denied for function create_bank_deposit` |
| `cash_movements?select=id` (anon key) | RLS anon'u sıfır satıra düşürür | ✅ `HTTP 200`, `[]` |
| `bank_deposits?select=id` (anon key) | Aynı | ✅ `HTTP 200`, `[]` |

Migration'ın tamamı (şema değişiklikleri, RLS, 8 yeni RPC, storage
bucket + policy) **tek bir transaction** içinde hatasız uygulandı —
`create or replace function` ile `record_payment_for_course`'un imzası
değiştiği için önce eski imzanın `drop function` ile kaldırılması
gerekiyordu; bu adım da dahil migration `supabase db push` ile
sorunsuz geçti.

## Yalnızca pgTAP ile doğrulanan (Docker gerektirir, kurulmadı)

`cash_bank_module.test.sql` (35 assertion) şunları izole fixture'larla
test ediyor:

- **Nakit ödeme → otomatik cash_in**: `record_payment_for_course(...,
  'cash', ..., p_cash_account_id)` kasa hesabı verilmeden reddediliyor;
  verildiğinde tam olarak bir `cash_in` hareketi oluşuyor, `payment_id`
  doğru ödemeye bağlanıyor, bakiye artıyor.
- **Banka/ATM yatırımı**: seçilen `cash_in` hareketlerinin toplamı
  `bank_deposits.amount` ile birebir eşleşiyor, `bank_deposit_items`
  toplamı da aynı tutara eşit, kasa bakiyesi tam olarak yatırım tutarı
  kadar düşüyor, yatırılan hareketler `get_undeposited_cash_movements`'ta
  artık görünmüyor.
- **Aynı hareket iki kez yatırılamaz**: hem RPC seviyesinde (anlaşılır
  hata mesajıyla) hem de RPC'yi atlayıp doğrudan (superuser bağlamında)
  `bank_deposit_items`'a ikinci satırı eklemeye çalışarak — ikincisi
  veritabanı seviyesindeki tekil indeksin (`23505`) RPC'den bağımsız
  olarak da çalıştığını kanıtlıyor.
- **Kasa sayımı**: defterle uyumlu sayımda hiçbir satır eklenmiyor
  (`delta = 0`); fazla/eksik bulunan nakit doğru işaretli (`+`/`-`)
  bir `correction` hareketi olarak ekleniyor ve bakiyeyi doğru
  yönde değiştiriyor.
- **Ters kayıt, fiziksel silme yok**: `reverse_cash_movement()`
  orijinali SİLMEK yerine ters yönlü yeni bir satır ekliyor, bakiye
  düzeltmeden önceki değere dönüyor, toplam satır sayısı hiç
  azalmıyor (yalnızca artıyor); aynı hareket ikinci kez ters
  kayıtla düzeltilmeye çalışıldığında reddediliyor.
- **`authenticated` (admin dahil) `cash_movements`'ten doğrudan
  `DELETE`/`UPDATE` yapamıyor** (`42501`) — tek yazma yolu RPC'ler.
- **Günlük bakiye tamamen hareketlerden yeniden hesaplanıyor**:
  `get_cash_daily_balances()`'ın döndürdüğü `running_balance`,
  `get_cash_account_balance()`'ın canlı hesapladığı bakiyeyle
  birebir eşleşiyor — ayrı/önbelleklenmiş bir bakiye sütunu hiçbir
  yerde yok.
- **Admin-only**: teacher rolü `create_bank_deposit`/
  `record_cash_count_adjustment`'ı çağıramıyor, `cash_movements`'i
  `SELECT` ile bile göremiyor (RLS sıfır satıra düşürüyor).
- **`cash_accounts`/`bank_accounts` doğrudan admin CRUD**: admin
  doğrudan tablo üzerinden ekleyebiliyor, teacher `42501` alıyor.

## Kapsam dışı bırakılanlar

- **Makbuz yükleme** (`bank-deposit-receipts` storage bucket'ı ve
  `set_bank_deposit_receipt()` RPC'si) pgTAP'te test edilmedi — dosya
  yükleme Storage API'si üzerinden gerçekleşiyor, pgTAP salt SQL
  katmanında çalıştığından bunu simüle etmek pratik değil. Bucket'ın
  `private` olduğu ve `student-photos` ile birebir aynı desende
  `is_admin()` + organizasyon klasör öneki kısıtı taşıdığı kod
  incelemesiyle doğrulandı (bkz. migration, `storage.objects` policy
  tanımı `student-photos`'unkiyle satır satır aynı).
- **Gerçek banka mutabakatı** (`get_bank_account_summary()`) yalnızca
  bu uygulamanın kendi `bank_deposits` kayıtlarını toplar — banka
  ekstresi içe aktarma/eşleştirme yok. Bu uygulamada hiç banka entegrasyonu
  bulunmadığından kapsam dışı bırakıldı (ödeme iade/avans
  modülündeki benzer "gerçek dış sistem entegrasyonu yok" notuyla
  aynı tasarım sınırı).
