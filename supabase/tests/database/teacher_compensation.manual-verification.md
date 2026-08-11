# Öğretmen hakediş modülü — canlı doğrulama notu

`teacher_compensation.test.sql` bu makinede Docker olmadığı için
yerel olarak (`npx supabase test db`) çalıştırılamadı
([[feedback-no-docker-push-to-dev]]). Fixture kurulumu diğer pgTAP
dosyalarıyla aynı desende (`delete from public.organizations` ile
başlıyor) — canlı `-dev` veritabanındaki gerçek tek-kurum verisini
silmek anlamına geleceğinden orada bilinçli olarak çalıştırılmadı.

## Canlı doğrulanan (gerçek dev DB, veri mutasyonu yok)

Migration push edildikten sonra, hiçbir satır yazmayan izin sınırı
kontrolleri `curl` ile `anon` anahtarıyla yapıldı:

| Çağrı | Beklenen | Sonuç |
| --- | --- | --- |
| `rpc/generate_teacher_compensation` (anon key) | Reddedilir | ✅ `HTTP 401`, `42501 permission denied` |
| `rpc/add_compensation_adjustment` (anon key) | Reddedilir | ✅ `HTTP 401`, `42501 permission denied` |
| `teacher_work_logs?select=id` (anon key) | RLS anon'u sıfır satıra düşürür | ✅ `HTTP 200`, `[]` |
| `teacher_compensation_rules?select=id` (anon key) | Aynı | ✅ `HTTP 200`, `[]` |

Migration (2 yeni tablo/enum, `lesson_sessions`/`teacher_work_logs`
şema eklemeleri, `cancel_lesson_session()`'ın imza değişikliği dahil,
RLS, 7 yeni RPC) tek bir transaction içinde hatasız uygulandı.

## Bu görev sırasında bulunan ve kapatılan gerçek güvenlik açığı

`teacher_work_logs` üzerindeki `work_logs_insert`/`work_logs_update`
RLS politikaları (`20260725103000`'den beri, hiç kullanılmayan bir
tablo üzerinde) `teacher_profile_id = auth.uid()` koşuluyla
öğretmenin **kendi hakediş satırını doğrudan REST üzerinden
insert/update edebilmesine** izin veriyordu — yani teorik olarak bir
öğretmen kendi maaşını/ders sayısını uydurabilirdi. Bu politikalar bu
migration'da tamamen kaldırıldı; artık yalnızca SELECT (kendi
satırları + admin tüm kurum) var, yazma yalnızca bu dosyadaki
`security definer` RPC'ler üzerinden. pgTAP'te doğrudan test edildi
(`insert ... teacher_work_logs` öğretmen JWT'siyle → `42501`).

## Yalnızca pgTAP ile doğrulanan (Docker gerektirir, kurulmadı)

`teacher_compensation.test.sql` (42 assertion) şunları izole
fixture'larla test ediyor:

- **Etkin tarih aralığı seçimi**: aynı öğretmen için çakışan tarih
  aralıklı iki kural reddediliyor; bir kural sonlandırılıp yenisi
  başladıktan sonra, her oturum KENDİ tarihinde etkin olan kuralı
  kullanıyor (Şubat oturumu eski per_minute kuralını, Ağustos oturumu
  yeni per_lesson kuralını).
- **Dört senaryo ayrı hesaplanıyor**: normal (per_minute × dakika),
  kurum iptali (düz yapılandırılmış tutar, süreden bağımsız),
  öğretmen devamsızlığı (her zaman 0, ama satır yine de izlenebilirlik
  için oluşuyor), telafi (makeup_rate_amount boşsa normal tutara
  düşüyor).
- **per_student**: yalnızca `present` işaretli katılımcılar sayılıyor,
  devamsız öğrenci hesaba katılmıyor.
- **monthly_salary**: bu tür kurala sahip öğretmen için oturum bazlı
  HİÇBİR satır üretilmiyor, ay başına tek bir toplu satır oluşuyor.
- **İdempotency**: aynı ay için ikinci çalıştırmada `created_count = 0`;
  aynı oturum için ikinci satır hem RPC hem de (superuser bağlamında
  RPC'yi atlayan) doğrudan insert denemesinde (`23505`) engelleniyor.
- **Onay → ödeme sırası**: onaylanmamış bir dönem ödendi işaretlenemiyor;
  onay idempotent (ikinci çağrı zaten onaylı satırları saymıyor);
  ödenmiş bir satır `authenticated` (admin dahil) tarafından doğrudan
  güncellenemiyor (`42501`).
- **Kural anlık görüntüsü**: üretilen satırın `rate_snapshot`'ı, o
  anki kuralın tutarını taşıyor ve kural sonradan sonlandırılsa/
  değiştirilse bile sabit kalıyor (satırlar hiçbir zaman kurala
  yeniden JOIN edilerek yeniden hesaplanmıyor).
- **Manuel düzeltme**: mevcut satırlar hiç değişmeden, ekleme/kesinti
  yeni satır olarak ekleniyor; dönem net toplamı üretilen satırlar +
  düzeltmeler olarak doğru toplanıyor.
- **Öğretmen izolasyonu**: bir öğretmen başka bir öğretmenin
  satırlarını SELECT ile göremiyor, kendi satırlarını admin ile AYNI
  sayıda görüyor (aynı kaynak tablo, RLS dışında filtre yok), hakediş
  üretme/onaylama/düzeltme RPC'lerini çağıramıyor.

## Kapsam dışı bırakılanlar

- `end_teacher_compensation_rule()` bir kuralı yalnızca kısaltır
  (bitiş tarihi ekler); geçmişte zaten üretilmiş satırları etkilemez
  (yukarıdaki snapshot testiyle doğrulandı) ama teorik olarak bir
  kuralın etki aralığını geriye doğru kısaltmak, o boşlukta kalan
  tarihler için gelecekte üretim çalıştırıldığında "kural bulunamadı"
  (`skipped_no_rule_count`) durumuna yol açabilir — bu ayrı bir
  assertion ile test edilmedi, ama `generate_teacher_compensation()`
  bu durumu hata vermeden atlayıp sayarak zaten güvenli şekilde ele
  alıyor.
- Kural düzenleme (`update_teacher_compensation_rule` gibi bir RPC)
  yok — yalnızca oluşturma ve sonlandırma. Devam eden bir kuralın
  şartları değiştiğinde desen: sonlandır + yenisini oluştur.
