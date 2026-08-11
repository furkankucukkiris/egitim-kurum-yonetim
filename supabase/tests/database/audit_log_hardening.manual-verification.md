# Denetim kaydı sertleştirmesi — canlı doğrulama notu

`audit_log_hardening.test.sql` bu makinede Docker olmadığı için
yerel olarak (`npx supabase test db`) çalıştırılamadı
([[feedback-no-docker-push-to-dev]]). Fixture kurulumu `delete from
public.organizations` ile başladığından canlı `-dev` veritabanındaki
gerçek tek-kurum verisini silmek anlamına gelir — bu yüzden orada
bilinçli olarak çalıştırılmadı.

## Kapsam incelemesi nasıl yapıldı

Bu görevin en büyük kısmı yeni kod yazmak değil, **mevcut 75
`audit_logs` insert çağrısının tamamını** (19 migration dosyası)
gözden geçirmekti. Bir Explore alt-ajanı her dosyayı okuyup her
`jsonb_build_object`/`to_jsonb` çağrısını, ve `identity_number`/
`password`/`service_role`/`token` gibi anahtar kelimelerin migration
ağacındaki her geçişini (yalnızca literal alan adı değil, değişken
akışını da izleyerek) taradı. Sonuç: **bugüne kadar hiçbir audit_logs
satırına T.C. kimlik no, şifre/geçici şifre, token veya
service_role anahtarı yazılmamış.**

Buna rağmen, ileriye dönük kırılganlık taşıyan iki nokta ve gerçek iki
kapsam boşluğu bulundu; hepsi bu migration'da (`20260812160000_add_audit_log_hardening.sql`)
düzeltildi:

## Canlı doğrulanan (gerçek dev DB, veri mutasyonu yok)

Migration push edildikten sonra, hiçbir satır yazmayan izin sınırı
kontrolleri `curl` ile `anon` anahtarıyla yapıldı:

| Çağrı | Beklenen | Sonuç |
| --- | --- | --- |
| `audit_logs?select=id` (anon key) | RLS anon'u sıfır satıra düşürür | ✅ `HTTP 200`, `[]` |

Migration (4 fonksiyon değişikliği + yeni trigger + `revoke`) tek bir
transaction içinde hatasız uygulandı.

## Bulunan ve düzeltilen (yalnızca pgTAP ile doğrulandı, Docker gerekli)

`audit_log_hardening.test.sql` (20 assertion):

1. **`audit_logs` zaten örtük olarak korunuyordu** (RLS etkin + yalnızca
   bir SELECT politikası = INSERT/UPDATE/DELETE için politika yok =
   Postgres bu komutları o rol için otomatik reddeder), ama bu depodaki
   diğer tüm finansal tablolarla tutarlılık için açık bir `revoke`
   eklendi. pgTAP'te doğrudan test edildi: admin dahi insert/update/delete
   yapamıyor (`42501`).
2. **`create_student_with_guardian()` artık denetleniyor** — önceden
   bir öğrenci/velinin T.C. kimlik numarasının sisteme GİRDİĞİ an hiç
   loglanmıyordu (yalnızca sonraki güncellemeler). Yeni denetim satırı
   `identity_number` anahtarını **hiç içermiyor** — pgTAP'te
   `new_data ? 'identity_number'` ile doğrudan doğrulandı (yalnızca
   maskelenmiş değil, gerçekten YOK).
3. **`organizations` tablosu artık denetleniyor** — 4 ayrı server
   action bu tabloyu doğrudan güncelliyordu, tek bir RPC kapısı
   olmadığı için bir AFTER UPDATE trigger eklendi. Trigger yalnızca
   izlenen alanlardan biri (ad, iletişim, WhatsApp şablonu, otomasyon
   ayarları) değiştiğinde tetikleniyor — dahili `next_receipt_number`
   sayacı (her ödemede artan) BİLEREK dışarıda bırakıldı; pgTAP'te bu
   ayrım doğrudan test edildi (yalnızca sayaç değişince satır
   OLUŞMUYOR, ad değişince tam olarak bir satır oluşuyor).
4. **MEB fonksiyonları artık açık alan listesi kullanıyor** —
   `set_teacher_course_meb_authorization()`/`set_enrollment_meb_registration()`
   bu depodaki TEK yerdi `pg_catalog.to_jsonb(satır)` ile SATIRIN
   TAMAMINI loglayan; bugün o tablolarda hassas bir sütun yok ama bu
   desen ileride sessizce sızma riski taşıyordu. pgTAP'te denetim
   satırının anahtar kümesinin TAM OLARAK beklenen 7 alanla eşleştiği
   doğrulandı (`jsonb_object_keys` ile).
5. **`log_rejected_scheduling_attempt(p_payload jsonb)` artık sunucu
   tarafında süzülüyor** — istemciden gelen serbest jsonb'yi olduğu
   gibi saklıyordu; artık yalnızca 16 bilinen-güvenli anahtar
   tutuluyor. pgTAP'te bilinçli olarak eklenen bir `secretField`
   anahtarının payload'dan düştüğü, bilinen bir alanın (`name`)
   kaldığı doğrulandı.

## Kapsam dışı bırakılan / not edilen (leke değil, tasarım notu)

- **`payment_refunds` kendi `table_name` değeri değildir** —
  `refund_payment()` denetim satırını `table_name = 'payments'`,
  `action = 'refund'`/`'reversal'` olarak yazıyor (ayrı bir
  `payment_refunds` tablo adı yok). Bu davranış DEĞİŞTİRİLMEDİ (canlı
  kod yolunu riske atmamak için) — denetim ekranındaki "Ödemeler"
  modül filtresi iadeleri de otomatik olarak kapsar, bu bilinçli bir
  gruplama.
