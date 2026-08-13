# Aylık üretim otomasyonu — canlı doğrulama notu

`monthly_generation_automation.test.sql` bu makinede Docker olmadığı
için yerel olarak (`npx supabase test db`) çalıştırılamadı
([[feedback-no-docker-push-to-dev]]). Migration
`egitim-kurum-yonetim-dev` projesine push edildi ve aşağıdaki iki şey
**gerçek dev veritabanına karşı** doğrulandı. Geri kalanı için (aşağıya
bakın) pgTAP dosyası tek doğrulama kaynağı — çalıştırılabilirliği
`scheduling_conflict_engine.test.sql` ile aynı, önceden kanıtlanmış
fixture/assertion desenini birebir izlemesine dayanıyor.

## Canlı doğrulanan (gerçek dev DB, veri mutasyonu yok)

Kuruma ait gerçek veriyi bozmamak için yalnızca **izin sınırlarını**
test eden, hiçbir satır yazmayan iki çağrı yapıldı (`anon` anahtarıyla,
`curl` ile PostgREST'e doğrudan):

| Çağrı | Beklenen | Sonuç |
| --- | --- | --- |
| `rpc/run_monthly_automation_job` (anon key) | Reddedilir — bu fonksiyon yalnızca `service_role`'e açık | ✅ `HTTP 401`, `42501 permission denied for function run_monthly_automation_job` |
| `automation_job_runs?select=id` (anon key) | Tablo şema önbelleğinde var, RLS anon'u sıfır satıra düşürür (diğer tüm tablolarla aynı desen — bkz. `lesson_sessions` grant'leri, anon'a özel bir `revoke` yok, RLS tek başına yeterli) | ✅ `HTTP 200`, `[]` |

İkinci sonuç migration'ın PostgREST şema önbelleğini başarıyla
yenilediğini (`notify pgrst, 'reload schema'`), tablonun gerçekten var
olduğunu ve RLS politikasının anon'u dışladığını kanıtlıyor.

`supabase db push` migration'ı **tek bir transaction** içinde uyguladı
ve hatasız tamamlandı — bu, `create extension pg_cron` ve
`cron.schedule(...)` çağrısının da (migration'ın son adımı) başarıyla
çalıştığının dolaylı ama güçlü kanıtı: ikisinden biri patlasaydı tüm
migration rollback olur, `db push` hata basardı. pg_cron işinin
kendisini görsel olarak doğrulamak için (bu oturumda doğrudan `psql`
erişimi yoktu): Supabase Dashboard → Database → Cron sayfasında
`monthly-generation-daily-sweep` adlı işin listelendiği, veya SQL
Editor'dan `select * from cron.job;` çalıştırılarak teyit edilebilir.

## Yalnızca pgTAP ile doğrulanan (Docker gerektirir, kurulmadı)

`monthly_generation_automation.test.sql` şunları izole fixture'larla
(kendi transaction'ında, sonunda rollback) test ediyor:

- `run_monthly_automation_job` idempotency (ders oturumu + tahakkuk,
  ikinci çağrıda `created_count = 0`, mükerrer satır yok),
- geçersiz `organization_id` reddi,
- aynı dönem için "zaten çalışan iş var" engeli,
- `manual_retry`'ın yalnızca ilgili kurumun aktif admin'i tarafından
  tetiklenebilmesi,
- `authenticated` rolünün (admin dahil) fonksiyonu doğrudan
  çağıramaması (yalnızca `service_role`),
- **hata durumunda kısmi veri kalmaması**: kurumun `timezone`'u geçici
  olarak geçersiz bir değere ayarlanıp ders oturumu üretimi
  tetikleniyor — fonksiyon hata fırlatmıyor (`run_monthly_automation_job`
  hatayı yakalayıp `job_runs`'a yazıyor), ve o dönem için **hiçbir**
  `lesson_sessions` satırının oluşmadığı doğrulanıyor,
- refactor edilen `generate_monthly_lesson_sessions`/
  `generate_monthly_accruals` RPC'lerinin (artık ince sarmalayıcı)
  admin için aynı `created_count` davranışını sürdürmesi.

Bu senaryoları gerçek dev veritabanına karşı çalıştırmak, aynı
`scheduling_conflict_engine.test.sql`'in yaptığı gibi `delete from
public.courses / students / profiles / organizations ...` ile
başlıyor — bu, canlı tek-kurumlu veritabanındaki **gerçek kurum
verisini silmek** anlamına gelir, bu yüzden burada bilinçli olarak
çalıştırılmadı. Docker kurulursa `npx supabase start` + `npx supabase
test db` ile yerelde güvenle çalıştırılabilir.

## `run_daily_automation_sweep()` neden pgTAP'te yok

Bu fonksiyon gerçek `now()`'a bağlı: her kurumun yerel "bugün"ü,
`sessions_generation_day`/`accruals_generation_day` (1-28 aralığı)
ile eşleştiğinde tetikleniyor. Testin hangi gün çalıştığından bağımsız
deterministik olması için ya "bugün"ü sahte bir değere sabitlemek (bu
depoda zaman dondurma altyapısı yok) ya da ayın 29-31'inde doğal olarak
başarısız olacak kırılgan bir test yazmak gerekirdi — ikisi de tercih
edilmedi. Sweep'in kendisi yalnızca ince bir döngü + tarih kontrolü
(iş mantığının tamamı zaten pgTAP'te kapsanan
`run_monthly_automation_job`'da); gerçek zamanlanmış çalışmasını
doğrulamanın en güvenilir yolu, üretim günü ayarını admin panelinden
("Otomasyon" sekmesi) bugünün gününe geçici olarak ayarlayıp ertesi
gün `automation_job_runs`'ta yeni bir `succeeded` satır oluştuğunu
görmek, ya da SQL Editor'dan doğrudan `select
public.run_daily_automation_sweep();` çağırıp aynı tabloyu kontrol
etmektir.
