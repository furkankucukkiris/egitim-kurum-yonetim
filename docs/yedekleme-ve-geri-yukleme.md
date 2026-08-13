# Yedekleme ve Geri Yükleme Prosedürü

## Supabase'in sağladığı yedekleme

Supabase, ücretli planlarda (Pro ve üzeri) veritabanının **günlük otomatik yedeğini** alır ve genellikle 7 günlük saklama sunar; daha uzun saklama ve Point-in-Time-Recovery (PITR — dakika hassasiyetinde geri dönüş) ek satın alınabilir bir özelliktir. Bu, kod tarafından kontrol edilemez — **Dashboard → Database → Backups** üzerinden planınızı ve PITR'ın açık olup olmadığını kontrol edin.

**Yapılması gereken:** Gerçek veri taşımaya başlamadan önce, projenizin planında günlük yedeğin (ideal olarak PITR'ın) açık olduğunu Dashboard'dan teyit edin ve bu belgeye tarih/plan bilgisini not edin.

## Ek periyodik dışa aktarma (bağımsız kopya)

Supabase'in kendi yedeğine ek olarak, kurumun kontrolünde bağımsız bir kopya tutmak için `supabase` CLI ile düzenli `db dump` alınmalı:

```bash
supabase db dump --linked -f yedek-$(date +%Y%m%d).sql
```

- **Sıklık:** En az haftalık; finansal kapanış günlerinde (ay sonu) ek bir yedek alınması önerilir.
- **Şifreleme:** Dump dosyası düz metin SQL'dir ve öğrenci/veli PII'si içerir — diskte veya bulutta saklamadan önce şifrelenmelidir (örn. `gpg --symmetric --cipher-algo AES256 yedek-20260814.sql` veya bulut sağlayıcının sunucu taraflı şifrelemesi + erişim kısıtlı bir bucket).
- **Saklama yeri:** Kurumun kendi Supabase projesinden **fiziksel olarak ayrı** bir konum (farklı bulut sağlayıcı hesabı veya şifreli harici depolama) — tek nokta arızasını önlemek için.
- **Saklama süresi:** Bkz. [`veri-saklama-politikasi.md`](./veri-saklama-politikasi.md) — finansal kayıtlarla aynı süre (varsayılan 5 yıl) referans alınabilir; daha eski dump'lar güvenli şekilde imha edilmelidir.
- **Erişim:** Yalnızca kurum yöneticisi (ve varsa yedekleme sorumlusu) erişebilmeli; parola/anahtar başka bir kanaldan (örn. parola yöneticisi) saklanmalı.

## Geri yükleme prosedürü (test edilebilir adımlar)

Bu prosedür **düzenli olarak** (örn. 6 ayda bir) gerçek bir felaket senaryosu simüle edilerek test edilmelidir — yedeğin var olması yetmez, geri yüklenebilir olduğu kanıtlanmalı.

1. **Yeni, boş bir Supabase projesi oluşturun** (test/staging amaçlı — asla doğrudan production üzerine geri yükleme yapmayın, önce test projesinde doğrulayın).
2. Bu repoyu o projeye bağlayın:
   ```bash
   supabase link --project-ref <test-proje-ref>
   ```
3. Şifreli dump'ı açıp geri yükleyin:
   ```bash
   gpg --decrypt yedek-20260814.sql.gpg > yedek-20260814.sql
   psql "$(supabase db url --linked)" -f yedek-20260814.sql
   ```
   (Alternatif: `supabase db dump` yerine Supabase Dashboard'daki "Restore" özelliğini kullanıyorsanız, o akışı izleyin — dump formatı Dashboard'un beklediğiyle uyumlu olmalı.)
4. Repo'daki `supabase/migrations/` klasöründeki tüm migration'ların dump içeriğiyle senkron olduğunu doğrulayın:
   ```bash
   supabase db push --dry-run
   ```
   Boş çıktı (push edilecek migration yok) bekleniyor — eğer eksik migration listelenirse dump'ın alındığı tarihten sonra şema değişmiş demektir, sırayla uygulayın.
5. **Smoke test** — uygulamayı bu test projesine karşı çalıştırıp en az şunları doğrulayın:
   - Admin girişi (varsa MFA dahil) çalışıyor.
   - Bir öğrenci kaydı ve bir ödeme kaydı görünüyor (rastgele 2-3 satır çapraz kontrol).
   - RLS çalışıyor: bir teacher hesabıyla giriş yapıp `students`/`guardians` tablolarına erişememesi test edilir.
6. Sonucu (tarih, süre, başarılı/başarısız, karşılaşılan sorunlar) bu dosyanın altına veya kurumun kendi kayıt defterine not edin.

### Test kaydı

| Tarih | Kim yaptı | Süre | Sonuç | Not |
|---|---|---|---|---|
| _(henüz yapılmadı)_ | | | | |

---

*Bu prosedür kod incelemesiyle (2026-08-14) yazıldı; gerçek bir geri yükleme testi henüz yapılmadı — yukarıdaki tabloyu ilk test sonrasında doldurun.*
