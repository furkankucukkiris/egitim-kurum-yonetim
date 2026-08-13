# Zamanlama çakışması motoru — canlı doğrulama notu

`scheduling_conflict_engine.test.sql` Docker/pgTAP olmadığı için yerel
olarak çalıştırılamadı ([[feedback-no-docker-push-to-dev]]). Bunun
yerine, migration `egitim-kurum-yonetim-dev` projesine push edildikten
sonra, gerçek bir admin JWT'siyle PostgREST'e doğrudan HTTP istekleri
atılarak **ana çakışma mantığı canlı doğrulandı** — pgTAP kadar
kapsamlı değil ama gerçek veritabanına karşı gerçek sonuçlar.

## Doğrulanan senaryolar (gerçek dev veritabanı, gerçek admin oturumu)

Kurulum: bir ders ("Resim", grup), gerçek bir `teacher` rollü profil
(`create_teacher_profile` ile oluşturuldu, test sonunda silindi).

| Senaryo | Girdi | Sonuç |
| --- | --- | --- |
| Temel seans | Öğretmen, ODA-1, Çrş 10:00-11:00 | ✅ Oluşturuldu |
| Öğretmen çakışması | Aynı öğretmen, Çrş 10:30-11:30 | ❌ Reddedildi: *"Öğretmen Test Öğretmen, Çarşamba günü 10:30 saatinde 'FINAL TEST DERSI — GRUP-A' seansıyla çakışıyor."* |
| Derslik çakışması | Farklı öğretmen (null), ODA-1, Çrş 10:45-11:15 | ❌ Reddedildi: *"'ODA-1' derslik, Çarşamba günü 10:45 saatinde 'FINAL TEST DERSI — GRUP-A' seansıyla çakışıyor."* |
| Bitişik saat | Aynı öğretmen, ODA-1, Çrş 11:00-12:00 (tam A'nın bitişinde) | ✅ Oluşturuldu — sınır durumu doğru |
| Açık uçlu tarih çakışması | Aynı öğretmen/saat, farklı `starts_on` (15 Eylül), A'nın `ends_on`'u yok | ❌ Reddedildi — A hâlâ açık olduğu için doğru |
| Tutarsız tarihler | `ends_on < starts_on` | ❌ Reddedildi: *"Program bitiş tarihi başlangıç tarihinden önce olamaz."* |
| Bireysel ders | `course_type = 'individual'` | ✅ Oluşturuldu, kapasite otomatik 1 |

Ayrıca `class_schedule_overlaps()` birim testleri doğrudan RPC olarak
çağrılıp doğrulandı:
- `10:00-11:00` vs `10:30-11:30` (aynı gün) → `true`
- `10:00-11:00` vs `11:00-12:00` (aynı gün, bitişik) → `false`
- Kesişmeyen tarih aralıkları (Oca-Haz vs Eyl-∞, aynı gün/saat) → `false`

## Bu süreçte bulunan ve düzeltilen gerçek hata

İlk push'ta `class_schedule_overlaps()` içinde
`pg_catalog.extract(epoch from ...)` kullanılmıştı — bu, `EXTRACT(...)`
özel sözdizimini bozarak `syntax error at or near "from"` hatası
verdi. `pg_catalog.extract` yerine bare `extract(...)` ile düzeltildi
(bkz. [[feedback-pg-catalog-extract-syntax]] — bu oturumda ikinci
kez yapılan aynı hata).

## Hata ayıklama sürecinde bulunan, kapsam dışı bırakılan ön-koşul bulgusu

Canlı testte admin'in kendi profilini "öğretmen" olarak atamaya
çalışırken tutarsız bir davranışla karşılaşıldı: `create_class_group`'un
kendi kontrolü `role IN ('teacher', 'admin')` kabul ederken,
`class_groups` tablosundaki (2026-07-27 tarihli, bu görevden önce var
olan) `class_groups_enforce_teacher_role` trigger'ı yalnızca
`role = 'teacher'` kabul ediyor — ikisi AYNI Türkçe hata mesajını
paylaştığı için bu tutarsızlık şimdiye kadar fark edilmemiş. Gerçek bir
`teacher` rollü profille tekrar test edildiğinde her şey beklendiği
gibi çalıştı (yukarıdaki tablo). Bu, bu görevin kapsamı dışında
bırakıldı (davranış değişikliği istenmedi) ama nihai raporda ayrıca
not edildi — isteğe bağlı bir takip görevi olabilir.
