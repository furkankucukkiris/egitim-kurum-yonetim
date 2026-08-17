# Yedekleme ve Geri Yükleme Prosedürü

## Supabase'in sağladığı yedekleme

Supabase, ücretli planlarda (Pro ve üzeri) veritabanının **günlük otomatik yedeğini** alır ve genellikle 7 günlük saklama sunar; daha uzun saklama ve Point-in-Time-Recovery (PITR — dakika hassasiyetinde geri dönüş) ek satın alınabilir bir özelliktir. Bu, kod tarafından kontrol edilemez — **Dashboard → Database → Backups** üzerinden planınızı ve PITR'ın açık olup olmadığını kontrol edin.

**Yapılması gereken:** Gerçek veri taşımaya başlamadan önce, projenizin planında günlük yedeğin (ideal olarak PITR'ın) açık olduğunu Dashboard'dan teyit edin ve bu belgeye tarih/plan bilgisini not edin.

## Ek periyodik dışa aktarma (bağımsız kopya)

Supabase'in kendi yedeğine ek olarak, kurumun kontrolünde bağımsız bir kopya tutulmalı.

**Docker/yerel `pg_dump` varsa** (bu makinede yok, ama Docker kurulu başka bir makineden çalıştırılabilir):

```bash
supabase db dump --linked -f yedek-$(date +%Y%m%d).sql
```

**Docker yoksa (bu makinenin gerçek durumu) — `scripts/backup-data.sql` kullanın:**

Bu betik `public` şemasındaki tüm tabloları (yapı değişse bile otomatik keşfederek) tek bir JSON belgesi olarak dışa aktarır, Docker/`pg_dump` gerektirmez:

```bash
supabase db query --linked --file scripts/backup-data.sql > yedek-$(date +%Y%m%d).json
```

**İki yöntem de:**

- **Sıklık:** En az haftalık; finansal kapanış günlerinde (ay sonu) ek bir yedek alınması önerilir.
- **Şifreleme:** Dosya düz metin (SQL veya JSON) olarak çıkar ve öğrenci/veli PII'si içerir — diskte veya bulutta saklamadan önce şifrelenmelidir: `gpg --symmetric --cipher-algo AES256 yedek-20260817.json` (parolayı bir parola yöneticisinde saklayın).
- **Saklama yeri:** Kurumun kendi Supabase projesinden **fiziksel olarak ayrı** bir konum (farklı bulut sağlayıcı hesabı veya şifreli harici depolama) — tek nokta arızasını önlemek için. Bu makinede geçici olarak `C:\Users\label\Yedekler\egitim-kurum-yonetim\` içinde tutuluyor — **bu, "fiziksel olarak ayrı" şartını karşılamıyor**, düzenli olarak harici bir konuma (bulut sürücü, harici disk) da kopyalanmalı.
- **Saklama süresi:** Bkz. [`veri-saklama-politikasi.md`](./veri-saklama-politikasi.md) — finansal kayıtlarla aynı süre (varsayılan 5 yıl) referans alınabilir; daha eski dump'lar güvenli şekilde imha edilmelidir.
- **Erişim:** Yalnızca kurum yöneticisi (ve varsa yedekleme sorumlusu) erişebilmeli; parola/anahtar başka bir kanaldan (örn. parola yöneticisi) saklanmalı.
- **Kapsam notu:** `scripts/backup-data.sql` yalnızca `public` şemasını (iş verisini) yedekler — `auth.*` (kullanıcı/MFA) ve `storage.*` (dosya blob'ları) kapsam dışıdır. Bkz. aşağıdaki "2026-08-17 tatbikatı" notu.

### Gerçek yedek kaydı

| Tarih | Proje | Yöntem | Boyut (şifreli) | Kim |
|---|---|---|---|---|
| 2026-08-17 | `-dev` (`qhvezujyuckxkvietlyi`) | `scripts/backup-data.sql` | 4,7 KB | Claude (kullanıcı gözetiminde) |
| 2026-08-17 | `-prod` (`kdykfuiedtsztxbpnnns`) | `scripts/backup-data.sql` | 2,3 KB | Claude (kullanıcı gözetiminde) |

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
   (Alternatif: `supabase db dump` yerine Supabase Dashboard'daki "Restore" özelliğini kullanıyorsanız, o akışı izleyin — dump formatı Dashboard'un beklediğiyle uyumlu olmalı. Docker yoksa ve `scripts/backup-data.sql` ile alınmış bir JSON yedeğiniz varsa, 2026-08-17 tatbikatındaki `jsonb_populate_recordset`-tabanlı geri yükleme yöntemini kullanın — bkz. aşağıdaki "2026-08-17 tatbikatı" bölümü.)
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
| 2026-08-17 | Claude (kullanıcı gözetiminde) | ~11 dakika | ✅ Başarılı | Bkz. aşağıdaki "2026-08-17 tatbikatı" bölümü — prosedür yukarıdaki adımlardan **saptı**, detaylar ve kısıtlar orada. |

## 2026-08-17 tatbikatı — gerçekleştirilen prosedür ve sapmalar

Bu ortamda (Windows, Docker yok) yukarıdaki dokümante prosedür **olduğu gibi çalıştırılamadı** — hem `supabase db dump` hem yerel `pg_dump` Docker gerektiriyor. Bunun yerine SQL tabanlı bir eşdeğer uygulandı ve gerçek bir felaket senaryosu `-dev` (`qhvezujyuckxkvietlyi`) projesinin **kendi üzerinde** simüle edildi (3. bir test projesi açılamadı — Free plan organizasyon başına 2 proje ile sınırlı, `-dev`+`-prod` zaten bu limiti dolduruyor).

**Adımlar:**
1. **Yedek (dump yerine):** `-dev`'deki tüm iş verisi (organizations, profiles, students, guardians, enrollments, courses, class_groups, lesson_sessions, attendance, accruals, payments, payment_allocations, cash/bank hesapları ve hareketleri, expenses, teacher_compensation_rules, teacher_work_logs, waitlist_entries, prospects, admin_mfa_recovery_codes — 27 tablo, 32 satır) tek bir SQL sorgusuyla JSON olarak dışa aktarıldı.
2. **Felaket simülasyonu:** Bu tabloların tamamı FK-sırasına uygun şekilde `DELETE` edildi (audit_logs ve login_attempts dahil, restore kapsamı dışı — aşağıya bkz.) — `organizations`/`profiles`/`students`/`payments` sıfıra indiği doğrulandı.
3. **Geri yükleme:** JSON'dan üretilen `INSERT ... jsonb_populate_recordset(...)` script'i çalıştırıldı. İki gerçek engelle karşılaşıldı ve düzeltildi:
   - `prospects` ↔ `lesson_sessions` arasında dairesel FK (`trial_lesson_id` / `prospect_id`) — `prospects` önce `trial_lesson_id` boş olarak eklendi, `lesson_sessions` sonra eklendi, en sonda `UPDATE` ile bağlantı tamamlandı.
   - `enrollments` tablosuna INSERT, `enrollments_create_initial_accrual` trigger'ını tetikleyip otomatik bir tahakkuk satırı yaratıyor — bu, yedekteki gerçek tahakkuk kaydıyla (aynı `enrollment_id`+`period_start`) çakışıyordu; `accruals` insert'inden hemen önce tetiklenen satır silinip yerine yedekteki (orijinal `id`'li, `payment_allocations`'ın referans verdiği) satır eklendi.
4. **Migration senkron kontrolü:** `supabase db push --dry-run` — restore öncesi/sonrası şemaya hiç dokunulmadığı için beklendiği gibi ama **gerçek, önceden var olan bir sapma ortaya çıktı:** `20260815150000_grant_has_any_organization_to_service_role.sql` migration'ı `-dev`'e hiç uygulanmamıştı (production'da uygulanmıştı, `-dev`'de unutulmuştu). `supabase db push` ile canlıda düzeltildi, proje artık senkron.
5. **Smoke test:** Hem SQL join'iyle (org→admin profili→öğrenci→enrollment→accrual→payment tek sorguda, hepsi doğru ilişkili) hem de **gerçek uygulamada** (`localhost:3000`, admin oturumu açıkken) doğrulandı — Genel Bakış ₺1.000 tahakkuk/₺1.000 tahsilat/1 aktif öğrenci gösterdi, Öğrenciler listesinde `STAGING SMOKE` göründü. RLS: şema/politikalar restore'da hiç değişmediği için `pg_class.relrowsecurity` ile tüm ana tablolarda hâlâ açık olduğu doğrulandı (canlı bir teacher-erişim testi tekrarlanmadı, staging smoke testinde zaten yapılmıştı — bkz. `production-readiness-report.md` bölüm 13).

**Kapsam dışı bırakılanlar (bilinçli, dokümante ediliyor):**
- `audit_logs` (26 satır) — denetim geçmişi, iş verisi değil; restore kapsamına alınmadı.
- `auth.users`/`auth.mfa_factors` (gerçek kimlik doğrulama kayıtları) — bu tatbikatta **hiç dokunulmadı** (silinmedi, yeniden oluşturulmadı), bu yüzden admin girişi zaten kesintisiz çalıştı. Gerçek bir felakette (örn. veritabanı tamamen kaybedilirse) bu şema da kaybolur ve pg_dump/pg_restore (ya da Supabase'in kendi PITR'ı) olmadan MFA sırları gibi şifrelenmiş/hash'lenmiş alanlar **birebir** geri getirilemez — kullanıcıların yeniden davet edilmesi/MFA'yı yeniden kurması gerekir. Bu, raporun "Free plan'da günlük yedek/PITR yok" riskini (bkz. `production-readiness-report.md` bölüm 10, 14) doğrudan teyit ediyor: SQL-seviyeli iş verisi kurtarımı mümkün ve bugün kanıtlandı, ama kimlik/oturum verisinin birebir kurtarımı yalnızca Supabase'in kendi (ücretli) yedeğiyle mümkün.
- Storage'daki gerçek dosyalar (öğrenci fotoğrafı, dekont, gider belgesi) — veritabanı satırları geri geldi ama dosya blob'ları bu tatbikatın kapsamında kopyalanmadı (`storage.objects` metadata'sı zaten silinmemişti, dokunulmadı).

**Sonuç:** İş verisi (öğrenci/veli/ders/yoklama/tahakkuk/ödeme/hakediş) tarafında geri yükleme **gerçekten kanıtlandı** — migration'lar + bir veri yedeği varsa, veritabanı kaybedilse bile uygulama verisi kurtarılabilir. Tek gerçek boşluk, kimlik doğrulama/MFA verisinin bu yöntemle birebir kurtarılamaması — bu, Free plan'da PITR'ın neden hâlâ en büyük risk olduğunu somut olarak gösteriyor.

---

*Bu prosedür kod incelemesiyle (2026-08-14) yazıldı; ilk gerçek geri yükleme testi 2026-08-17'de yapıldı (yukarıya bkz.) — Docker olmadığı için dokümandaki `pg_dump`/`psql` adımları yerine SQL-tabanlı bir eşdeğer kullanıldı. Docker/pg_dump mevcut bir makineden tam ikili restore ayrıca test edilmemiştir.*
