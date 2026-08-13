# Veri Saklama, Silme ve Anonimleştirme Politikası

Bu belge, sistemde tutulan kişisel verilerin ne kadar süre saklanacağını ve süre sonunda/talep üzerine ne yapılacağını tanımlar. **Bu bir hukuki görüş değildir** — kurumun kendi mali müşaviri/hukuk danışmanıyla teyit edilmesi önerilir; buradaki süreler genel kabul gören pratiklere göre varsayılan olarak belirlenmiştir ve kod bunları zorunlu kılmaz (otomatik silme job'ı yoktur — bilinçli bir tercih, bkz. aşağı).

## Veri kategorileri ve saklama süreleri

| Kategori | Örnek alanlar | Saklama | Süre sonunda |
|---|---|---|---|
| Öğrenci/veli kimlik ve iletişim | ad-soyad, TC no, doğum tarihi, adres, telefon, sağlık notu | Aktif kayıt boyunca + ayrılıştan sonra makul bir süre (kurumun idari ihtiyacına göre, örn. 1-2 yıl) | Anonimleştirme (`anonymize_student` RPC) |
| Finansal kayıtlar | ödemeler, tahakkuklar, gider belgeleri | **5 yıl** (Türk Vergi Usul Kanunu'ndaki genel muhasebe belgesi saklama süresiyle uyumlu varsayılan — kurumun kendi mali müşaviriyle teyit edilmelidir) | Anonimleştirmede kayıt SİLİNMEZ, sadece kimliklendirilemez hâle gelir (öğrenci adı "Anonim Öğrenci" olur) — muhasebe bütünlüğü korunur |
| Yoklama/devam kayıtları | ders bazlı yoklama durumu | Finansal kayıtlarla aynı süre (ilişkili oldukları için) | Anonimleştirmeyle birlikte kimliklendirilemez hâle gelir |
| Denetim kaydı (`audit_logs`) | kim ne zaman ne değiştirdi | Süresiz (kurumun kendi güvenlik/uyum ihtiyacına göre kısaltılabilir) | — |
| MEB uyum kayıtları | ders/öğretmen/öğrenci MEB durumu | Aktif kayıt + mevzuat gereği ek süre | Öğrenci anonimleştirildiğinde `enrollment_meb_registrations` satırı da kimliksizleşir (`student_id` FK korunur ama öğrenci adı artık anonim) |

## Anonimleştirme neden "silme" değil

KVKK madde 11 veri sahibine "silme" hakkı verir, ancak bu hak **mutlak değildir** — başka bir kanunun (örn. Vergi Usul Kanunu'nun muhasebe belgelerini saklama zorunluluğu) öngördüğü sürede veri saklanabilir; bu durumda uygulanması gereken, veriyi *anonimleştirmek/takma adlandırmak* (pseudonymization) — yani kişiyle ilişkisini kesip finansal bütünlüğü korumaktır. Sistemdeki `anonymize_student` RPC'si tam olarak bunu yapar:

- **Silinen/null yapılan:** ad-soyad → "Anonim Öğrenci", TC kimlik no, doğum tarihi, adres, acil durum bilgisi, sağlık notu, fotoğraf (storage'dan da), admin notları. Başka bir aktif öğrencisi olmayan veli de aynı şekilde scrub edilir.
- **Korunan (silinmeyen):** `payments`, `accruals`, `attendance` satırları — artık "Anonim Öğrenci"ye bağlı, muhasebe/istatistik bütünlüğü için kalır.
- **Ön koşul:** Öğrenci önce `archive_student` ile arşivlenmiş olmalı (RPC bunu zorunlu kılar) — aktif bir öğrenci yanlışlıkla anonimleştirilemez.
- **Geri alınamaz** ve `audit_logs`'a `action: 'anonymize'` olarak, nedeniyle birlikte kaydedilir.

## Tetikleyiciler

Anonimleştirme şu durumlarda admin tarafından **manuel olarak** tetiklenir (otomatik/zamanlanmış bir job YOKTUR — bilinçli tasarım kararı: kimlik verisini geri dönüşsüz şekilde silen bir işlemi otomatikleştirmek, yanlış tetiklenme riskini kabul edilemez kılar):

1. **KVKK veri sahibi talebi** — veli/öğrenci resmi olarak silme talebinde bulunduğunda. Talep öncesi admin, `/ogrenciler/[studentId]` sayfasındaki "Kişisel verileri dışa aktar" ile önce bir kopya çıkarıp talep sahibine sunabilir (KVKK madde 11'in "kopya alma" hakkı).
2. **Saklama süresi sonu** — yukarıdaki tabloda belirtilen süre dolduğunda, admin periyodik olarak (örn. yıllık) arşivlenmiş ve süresi dolmuş öğrencileri gözden geçirip anonimleştirir.

## Veri dışa aktarma (KVKK madde 11 — kopya alma hakkı)

`/ogrenciler/[studentId]` sayfasındaki "Kişisel verileri dışa aktar" butonu (`export_student_personal_data` RPC) öğrencinin kimlik/iletişim bilgilerini, velilerini, ders kayıtlarını, ödemelerini ve yoklama özetini tek bir JSON dosyası olarak indirir — veri sahibine sunulacak "elimizde ne var" paketidir.

---

*Bu politika kod incelemesiyle (2026-08-14) yazıldı. 5 yıllık finansal saklama süresi bir varsayılandır — kurumun kendi mali müşaviriyle teyit edip gerekirse bu belgeyi güncelleyin.*
