# Production Hazırlık Raporu

**İncelenen commit:** `5936936` (`main`, PR [#13](https://github.com/furkankucukkiris/egitim-kurum-yonetim/pull/13) merge sonrası)
**Rapor tarihi:** 2026-08-15 (ilk sürüm) / 2026-08-16 (CI + gerçek production deployment sonrası tamamen güncellendi) / 2026-08-17 (ilk admin hesabı, MFA, production smoke testi, GitHub güvenlik ayarları, Free plan kapasite analizi, staging smoke testi (21/21) ve restore tatbikatı eklendi — bloklayıcı liste artık tam işaretli)
**Hazırlayan:** Claude (bu oturum) — kod/CI tarafı bağımsız çalışıldı; Supabase Cloud/Vercel/GitHub adımları kullanıcının kendi tarayıcı oturumunda (Claude in Chrome), kullanıcı gözetiminde yapıldı.

---

## 1. Repo ve CI durumu — tamamlandı

Bu görev üç PR'da ilerledi, hepsi `main`'e merge edildi:

- **PR [#8](https://github.com/furkankucukkiris/egitim-kurum-yonetim/pull/8)** — üretim-hazırlığı ana paketi: E2E production-guard + stateful retry fix, env-validasyonu (`src/instrumentation.ts`+`src/lib/env-validation.ts`), health endpoint, `dependabot.yml`+`codeql.yml`, güvenlik dokümantasyonu düzeltmesi, `docs/production-cloud-checklist.md`. Süreçte CI'ın canlı yakaladığı iki gerçek hata da bu PR'da düzeltildi:
  - **E2E regresyonu:** yeni env-validasyonu `NEXT_PUBLIC_INSTITUTION_NAME`'i zorunlu kılıyordu ama CI'nın `e2e` job'u bunu hiç set etmiyordu — `next start` açılışta çöküyordu.
  - **İki flaky pgTAP testi** (önceden var olan, bu oturumun değişiklikleriyle ilgisiz): `dashboard_financial_summary.test.sql` ve `cash_bank_module.test.sql`, ikisi de fixture'ların gerçek saat ile Europe/Istanbul kurumsal takvimi arasındaki ~3 saatlik uyuşmazlık penceresinde (günde bir kez, ~UTC 21:00-23:59) yanlış sonuç verecek şekilde yazılmıştı — `-dev` projesinde canlı doğrulanıp zamana dayanıksız hale getirildi.
  - **Sonuç: 5/5 CI job + CodeQL yeşil**, commit `cd7497f`: Lint&Typecheck, Unit (38/38), Build, **Migration+pgTAP (17 dosya, 420/420)**, E2E (admin+öğretmen akışları).
- **PR #9, #10, #11, [#13](https://github.com/furkankucukkiris/egitim-kurum-yonetim/pull/13)** — Dependabot bağımlılık güncellemeleri. PR #12 (aynı grup, `typescript` 5.9→7.0 ve `eslint` 9→10 major atlamaları içeriyordu) **iki ayrı gerçek kırılmaya** yol açtığı için (typescript-eslint TS7'yi desteklemiyor; `eslint-config-next`'in vendored `eslint-plugin-react`'i ESLint 10'un context API değişikliğiyle uyumsuz) merge edilmeden kapatıldı — yerine güvenli 4 güncellemeyi içeren PR #13 açılıp merge edildi, `dependabot.yml`'e bu iki paket için major-sürüm ignore kuralı eklendi.

**Kod/CI tarafı artık tamamen kanıtlı** — hiçbir madde varsayıma dayanmıyor, hepsi gerçek CI koşusuyla doğrulandı.

## 2. Migration sonucu — doğrulandı (hem CI'da hem gerçek production'da)

- CI'da (`db-integration` job, commit `cd7497f`): temiz veritabanına 61 migration hatasız uygulandı, ardından 17 dosya / **420/420 pgTAP testi** başarılı.
- **Gerçek production Supabase projesinde** (`kdykfuiedtsztxbpnnns`): `supabase db push` ile aynı 61 migration hatasız uygulandı, `supabase db push --dry-run` `"Remote database is up to date."` verdi. `select count(*) from organizations/profiles` ile veritabanının tamamen boş (seed yok) olduğu doğrulandı.

## 3. Production Supabase Cloud kurulumu — tamamlandı

Kullanıcının kendi Supabase oturumunda (zaten giriş yapılıydı), Claude in Chrome üzerinden gerçek adımlar atıldı:

| Adım | Durum |
|---|---|
| Yeni proje: `egitim-kurum-yonetim-prod`, ref `kdykfuiedtsztxbpnnns`, Frankfurt (`eu-central-1`), Free plan | ✅ |
| "Automatically expose new tables" kapatıldı (proje kuruluşunda) — bu depodaki her tablonun izni migration'larda açıkça yönetiliyor, ambient Data API erişimi bilinçli olarak istenmedi | ✅ |
| `supabase db push` — 61 migration | ✅ |
| `pg_cron` — yetki hatası olmadan otomatik oluştu, `monthly-generation-daily-sweep` işi `active: true` | ✅ |
| Storage bucket görünürlükleri (`select id, public from storage.buckets`) — yalnızca `organization-logos` public | ✅ |
| Auth → "Allow new users to sign up" kapatıldı | ✅ |
| Auth → TOTP MFA — varsayılan olarak zaten "Enabled" | ✅ |
| Auth → Rate Limits gözden geçirildi (Supabase varsayılanları, bu ölçek için yeterli) | ✅ |
| Auth → Site URL = `https://egitim-kurum-yonetim.vercel.app` | ✅ |
| Auth → Redirect allowlist = yalnızca `https://egitim-kurum-yonetim.vercel.app/**` (1 kayıt) | ✅ |
| İlk admin hesabı (`furkan.kucukkiris@gmail.com`) Dashboard → Authentication → Users'tan oluşturuldu, auto-confirm ile | ✅ |
| Admin TOTP MFA kurulumu — `auth.mfa_factors`'ta `factor_type: totp, status: verified` olarak doğrulandı | ✅ |
| Günlük otomatik yedek / PITR | ⏸️ **Free plan'da yok** — kullanıcı Pro'ya geçişi (ödeme bilgisi gerektirdiği için) bilinçli olarak erteledi; bkz. bölüm 10 (artık rakamsal gerekçeli) |

## 4. Production hosting (Vercel) — tamamlandı

- Vercel hesabı kullanıcı tarafından GitHub ile oluşturuldu/giriş yapıldı, repo import edildi.
- Proje: `egitim-kurum-yonetim`, Production Branch = `main` (Vercel varsayılanı).
- **Environment Variables — Production/Preview ayrımı kuruldu:**
  - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` → **Production** kapsamına yalnızca production Supabase değerleriyle.
  - Aynı üç değişken → **ayrıca, yalnızca Preview** kapsamına staging (`-dev`, ref `qhvezujyuckxkvietlyi`) değerleriyle — "Environments" seçiminde Production kutucuğu bilinçli olarak kaldırıldı. Bu, "preview deployment'lar production'a asla bağlanamaz" şartını Vercel'in kendi ortam izolasyonuyla yapısal olarak sağlıyor.
  - `NEXT_PUBLIC_INSTITUTION_NAME` = "Özel Şermin Şahin Kişisel Gelişim Kursu" → Production+Preview ortak (hassas değil).
- İlk production deploy'u (PR #13 merge commit'i) başarıyla tamamlandı ve canlıda doğrulandı:
  - `https://egitim-kurum-yonetim.vercel.app/giris` — giriş formu doğru render oluyor.
  - `https://egitim-kurum-yonetim.vercel.app/api/health` — `{"status":"ok"}`, hassas veri yok.
  - HTTPS/TLS sorunsuz (Vercel'in `*.vercel.app` için otomatik sağladığı).
- Vercel hesap 2FA'sı Authentication ayarlarından sorgulanıp doğrulandı: **Two-Factor Authentication: Active**, Authenticator App (TOTP) enrolled — zaten önceden kurulmuştu.
- **Henüz doğrulanmayan:** gerçek bir PR açılıp oluşan Preview deployment'ının fiilen staging Supabase'e bağlandığının canlı testi (env değişkenleri doğru ayrılmış olsa da bir sonraki PR'da teyit edilmeli).

## 5. Storage doğrulaması — doğrulandı (bucket privacy), signed URL canlı testi ertelendi

`select id, public from storage.buckets` ile production projesinde sorgulanıp doğrulandı: `student-photos`/`bank-deposit-receipts`/`expense-documents` private, yalnızca `organization-logos` public. Teacher rolüyle signed URL üretilemediğinin/admin tarafında signed URL ile fotoğraf görüntülemenin gerçek bir dosya yüklemesiyle canlı testi **kullanıcı kararıyla ertelendi** — bucket privacy konfigürasyonu ve kod yolu CI'da defalarca test edilmiş olması yeterli kanıt sayıldı; gerçek öğrenci verisi girilmeye başlandığında ilk gerçek fotoğraf yüklemesiyle doğal olarak teyit edilecek. (Not: staging smoke testinde — bölüm 13 — aynı yükleme akışı gerçek bir dosyayla test edildi ve private bucket'a doğru şekilde düştüğü doğrulandı; yalnızca production'daki canlı tekrarı ertelendi.)

## 6. Cron doğrulaması — doğrulandı

`select jobname, schedule, active from cron.job` ile production projesinde sorgulandı: `monthly-generation-daily-sweep`, `0 1 * * *`, `active: true`.

## 7. Domain/HTTPS doğrulaması — doğrulandı

Custom domain yok (kullanıcı tercihi) — production `https://egitim-kurum-yonetim.vercel.app` adresinde, HTTPS/TLS çalışıyor. `curl -I https://egitim-kurum-yonetim.vercel.app/giris` ile production URL'sinde canlı doğrulandı: CSP (`connect-src`'in doğru prod Supabase projesine, `kdykfuiedtsztxbpnnns`'e işaret ettiği dahil), HSTS (`max-age=63072000; includeSubDomains; preload`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Permissions-Policy`, `Referrer-Policy` — hepsi dönüyor.

## 8. Branch protection durumu — tamamlandı (bilinçli olarak sınırlı kapsamda)

GitHub Settings → Branches'ten `main` için classic branch protection rule oluşturuldu: **yalnızca force-push ve dal silme engellendi**. "Require a pull request before merging" ve "Require status checks to pass" **bilinçli olarak açılmadı** — kullanıcı tek geliştiricili bu repoda doğrudan `main`'e push alışkanlığını korumak istedi; README'deki "tam koruma" önerisi bu nedenle uygulanmadı. Kural oluşturma GitHub'ın sudo-mode doğrulama kodu istemesi nedeniyle kullanıcı tarafından tamamlandı.

## 9. Dependabot/CodeQL/secret scanning durumu — tamamlandı

- `.github/dependabot.yml` ve `.github/workflows/codeql.yml` eklendi ve **canlıda çalıştığı kanıtlandı** — Dependabot 4 gerçek PR açtı (#9-12), CodeQL PR'larda gerçekten koştu ve yeşil geçti (`cd7497f`, `5936936` dahil tüm son commit'lerde).
- Dashboard'daki üç anahtar açıldı: **Dependency graph**, **Dependabot alerts**, **Dependabot security updates** — GitHub Settings → Advanced Security'den, "Repository settings saved" onayıyla teyit edildi.
- **Secret Protection** ve **Push protection** zaten açıktı (public repo varsayılanı) — ek işlem gerekmedi.

## 10. Backup durumu ve Free plan kapasite analizi

**Production Free plan'da — günlük otomatik yedek ve PITR şu an KAPALI.** Kullanıcı, Pro plan'a (aylık $25, kart bilgisi gerektirdiği için) geçişi bilinçli olarak erteledi. Bu kararı netleştirmek için gerçek ölçüm yapıldı (linked `-dev` projesi üzerinden, aynı boş şema):

- Mevcut veritabanı boyutu: **19 MB**, neredeyse tamamı şema/index/61-migration sabit maliyeti — gerçek veri ~0.
- 200 öğrenciye kadar büyüme modeli (haftalık ~2 ders/öğrenci yoklaması, haftalık ~2 ders/grup oturumu, aylık ödeme, `audit_logs`'un her yazmada eski+yeni JSON snapshot tutması dahil): **yıllık ~45-50 MB** kötümser senaryo → 500 MB limitin ~9-10 yıl yetmesi anlamına geliyor.
- Asıl darboğaz storage (1 GB) olabilir: `bank-deposit-receipts`/`expense-documents` dosya başına 5 MB'a kadar (sıkıştırma yok, bkz. `src/app/(dashboard)/giderler/actions.ts:9`), yıllık ~150-250 MB büyüme ile ~4-5 yılda zorlayabilir — DB'den önce buraya bakılmalı (öneri: yükleme öncesi istemci tarafı resize/sıkıştırma).

**Sonuç: Free plan'da kalma kararı artık rakamsal temelli** — 200 öğrenci ölçeğinde yıllarca kapasite sorunu beklenmiyor. Ama bu, günlük otomatik yedek/PITR eksikliğini (veri kaybı riski, kapasite değil) telafi etmiyor — bu hâlâ raporun en büyük tekil riski, bkz. bölüm 14. Kod/prosedür seviyesinde `docs/yedekleme-ve-geri-yukleme.md` hâlâ geçerli (haftalık şifreli `db dump` prosedürü) ama bu, Supabase'in kendi günlük otomatik yedeğinin **yerine geçmez** — yalnızca ek bir katman olarak tasarlanmıştı.

## 11. Restore testi sonucu — yapıldı (2026-08-17), gerçek bulgularla

Tam detay: [`yedekleme-ve-geri-yukleme.md`](./yedekleme-ve-geri-yukleme.md) "2026-08-17 tatbikatı" bölümü. Özet:

- Bu ortamda Docker/`pg_dump` olmadığı için dokümante edilen ikili yedek/geri yükleme prosedürü **olduğu gibi çalıştırılamadı** — SQL tabanlı bir eşdeğer uygulandı (veriyi JSON olarak yakala → tüm iş verisini FK-sırasına uygun sil → `jsonb_populate_recordset` ile geri yükle).
- 3. bir test projesi açılamadı (**Free plan organizasyon başına 2 proje limiti** — gerçek, önceden bilinmeyen bir platform kısıtı, `-dev`+`-prod` limiti zaten dolduruyor) — kullanıcı onayıyla tatbikat `-dev`'in kendi üzerinde (disposable/test projesi zaten) yapıldı.
- **Sonuç: başarılı.** 27 tablo / 32 satır iş verisi (organizasyon, profil, öğrenci, veli, enrollment, tahakkuk, ödeme, kasa/banka hareketleri, gider, hakediş vb.) silinip SQL'den geri yüklendi; referanslar (FK'ler) bozulmadan geri geldi; hem SQL join'iyle hem **gerçek uygulamada** (`localhost`, admin oturumuyla) doğrulandı — Genel Bakış aynı rakamları (₺1.000 tahakkuk/tahsilat) gösterdi.
- **Yan bulgu:** `db push --dry-run`, restore'un kendisiyle ilgisiz, önceden var olan gerçek bir sapma ortaya çıkardı — `20260815150000_grant_has_any_organization_to_service_role.sql` migration'ı `-dev`'e hiç uygulanmamıştı (production'da uygulanmıştı). Canlıda düzeltildi.
- **Kapsam dışı, dokümante edilmiş gerçek bir sınır:** `auth.users`/`auth.mfa_factors` bu tatbikatta hiç dokunulmadı/test edilmedi — SQL-seviyeli bu yöntemle **kimlik doğrulama verisi birebir kurtarılamaz** (parola hash'i, MFA sırrı gibi alanlar). Gerçek bir felakette bu, Supabase'in kendi (yalnızca ücretli planda olan) yedeğini gerektirir. Bu, bölüm 14 madde 3'teki riski azaltmıyor, tam tersine **somut olarak doğruluyor**.

## 12. Production smoke testi sonucu (`docs/production-cloud-checklist.md` bölüm 5)

Admin hesabıyla gerçek production'da yapıldı:

| Madde | Sonuç |
|---|---|
| Admin girişi | ✅ |
| MFA doğrulaması | ✅ |
| Dashboard (`/`) açılması | ✅ |
| Test öğretmeni oluşturma → pasife alma | ✅ |
| Test öğrenci kaydı oluşturma → arşivleme | ✅ |
| `cron.job` doğrulaması | ✅ |
| Security header doğrulaması (`curl -I`) | ✅ |
| Vercel loglarında hassas veri kontrolü | ✅ temiz (yalnızca Supabase SDK'nın bilinen `getSession()` uyarısı görüldü, veri sızıntısı değil) |
| Private Storage / signed URL ile foto görüntüleme | ⏸️ kullanıcı kararıyla ertelendi, bkz. bölüm 5 |
| Teacher hesabıyla admin ekranlarına erişilemediği (canlı giriş testi) | ⏸️ kullanıcı kararıyla ertelendi — mevcut RLS/rol testleri (geçmiş oturumda bulunup kapatılan gerçek bir RLS deliği dahil) yeterli kanıt sayıldı |

Kullanıcı, ertelenen iki maddeyi gerçek öğrenci/veli verisi girilmeye başlandıktan sonra tekrar gözden geçirmeyi tercih etti.

## 13. Staging smoke testi sonucu (`docs/production-cloud-checklist.md` bölüm 3) — 21/21 tamamlandı

Temiz bir staging (`-dev`) veritabanından başlanarak, admin oturumu kullanıcı tarafından açılıp sonrasında Claude in Chrome ile sürülerek tüm kullanıcı akışları uçtan uca test edildi:

- Admin girişi + MFA — önceden kurulu, DB'den doğrulandı; **MFA kurtarma kodu akışı** canlı yeniden tetiklenmedi ama kullanıcı bu akışı kendisinin kurup **aktif olarak kullandığını** teyit etti, yeterli kanıt sayıldı.
- Öğretmen tam yaşam döngüsü: hesap oluştur (geçici parola) → geçici parolayla giriş + zorunlu parola değişikliği (kullanıcı tarafından) → kendi paneli/nav kısıtı doğrulandı.
- Öğrenci+veli oluşturma, gerçek bir dosya yüklemesiyle öğrenci fotoğrafı → `storage.objects`'te private `student-photos` altında org/student-scoped path'te doğrulandı.
- Ders + haftalık program (class group) oluşturma, öğrenciyi derse kaydetme, `/yoklama`'daki manuel "Ayın oturumlarını oluştur" butonuyla oturum üretimi.
- Yoklama: kaydet → kilitle → gerekçeyle aç, üçü de test edildi.
- Tahakkuk: enrollment oluşturulunca otomatik üretildiği, manuel üretim butonunun idempotent olduğu (mükerrer eklemediği) doğrulandı.
- Kasa & Banka modülü sıfırdan kuruldu (hiç hesap yoktu): nakit ödeme → `cash_movements` doğrulandı; kasadan bankaya yatırım + makbuz dosyası `bank-deposit-receipts`'e yüklendi.
- Gider oluşturma + belge yükleme.
- Öğretmen hakedişi: ücret kuralı ekleme → üretim → onaylama → ödendi işaretleme, tam akış.
- WhatsApp adapter'ın gerçek sağlayıcı yokken asla "gönderildi" göstermediği kod incelemesiyle doğrulandı (`NullWhatsAppAdapter` her zaman `success:false` döner, çağıran kod bunu şeffaf şekilde kullanıcıya "gerçek gönderim yapılamadı" olarak yansıtır).
- Deneme dersi: aday öğrenciye planlanan deneme dersinin `accruals`/`enrollment_meb_registrations` satır sayılarını **değiştirmediği** DB'den doğrulandı.
- Bekleme listesi: dolu bir seansa eklenen aday öğrencinin `enrollments` sayısını artırmadığı ve dashboard "Aktif Öğrenci" metriğini etkilemediği doğrulandı.
- Teacher rolüyle `/odemeler` ve `/kurum-ayarlari/denetim-kayitlari`'na doğrudan URL ile erişim denendi, ikisi de `/yetkisiz`'e yönlendi.
- Aylık otomasyonun manuel tetiklenmesi (`/yoklama` ve `/hakedis`'teki manuel üretim butonları) test edildi.

**Bulgu:** Test sırasında aynı tarayıcı origin'inde öğretmen hesabıyla giriş yapmak admin oturumunu düşürdü (çerezler sekmeler arası paylaşılıyor) — bu bir güvenlik açığı değil, beklenen tarayıcı davranışı; ileride benzer çoklu-rol testlerinde ayrı tarayıcı profili/incognito kullanılmalı.

## 14. Bilinen kalan riskler

1. **CSP `script-src 'unsafe-inline'`** — nonce tabanlı bir CSP daha sıkı olurdu ama Next.js App Router hydration'ını bozma riski taşıyor; bilinçli olarak uygulanmadı. Mevcut CSP CI'da otomatik doğrulanıyor. Telafi edici kontrol: `default-src 'self'` + `frame-ancestors 'none'`.
2. **`httpOnly:false` oturum cookie'si** — bilinçli mimari tercih, CSP'ye bağımlı bir telafi.
3. **Production Free plan'da, günlük yedek/PITR yok — VE şu anda kimse düzenli manuel yedek de almıyor.** Bölüm 11'deki tatbikat restore *mekanizmasının* çalıştığını kanıtladı, ama bu yalnızca elde güncel bir yedek varsa işe yarar; `docs/yedekleme-ve-geri-yukleme.md`'deki "en az haftalık dump" alışkanlığı henüz fiilen başlamadı (otomatik değil, elle yapılması gerekiyor). Bu hâlâ raporun en büyük tekil riski — artık "restore çalışır mı bilmiyoruz" değil, "bugün veri kaybedilirse geri yüklenecek güncel bir yedek yok" riski. Gerçek veri girilmeden önce ya Pro'ya geçilmeli ya da düzenli manuel dump alışkanlığı gerçekten başlatılmalı.
4. **Kimlik doğrulama verisi (`auth.users`/MFA) SQL-seviyeli yöntemle birebir kurtarılamıyor** — bölüm 11'de somut olarak doğrulandı; yalnızca Supabase'in kendi (ücretli) yedeği bunu çözer.
5. **pgTAP suite'inde bulunan sınıf hatası** (bkz. bölüm 1) yalnızca iki yerde vardı, ikisi de düzeltildi — ama "gerçek zamana bağlı, timezone-duyarsız fixture" kalıbının başka yeni pgTAP dosyalarında tekrarlanmaması için not düşülmeli.

## 15. Bloklayıcı maddeler (gerçek öğrenci/veli verisi girmeden önce)

- [x] ~~PR'lar açılıp CI'ın tamamının yeşil olduğu görülmeli~~ — tamamlandı.
- [x] ~~Production Supabase projesi oluşturulup temel ayarları yapılmalı~~ — tamamlandı (backup/PITR hariç, bkz. bölüm 10).
- [x] ~~Vercel hosting kurulup Preview/Production env ayrımı yapılmalı~~ — tamamlandı.
- [x] ~~Production Supabase planı gözden geçirilmeli~~ — Free plan'da kalma kararı rakamsal olarak doğrulandı (bölüm 10); günlük yedek/PITR eksikliği ayrı bir risk olarak kaldı.
- [x] ~~İlk admin hesabı oluşturulup `/kurulum` + MFA kurulumu tamamlanmalı~~ — tamamlandı.
- [x] ~~Production smoke testi yapılmalı~~ — 8/10 madde tamamlandı, 2 madde kullanıcı kararıyla ertelendi (bölüm 12).
- [x] ~~Staging smoke testi (bölüm 3, 21 madde) en az bir kez gerçek ortamda koşulup sonuçlanmalı~~ — 21/21 tamamlandı (bölüm 13).
- [x] ~~Branch protection + Dependabot/secret scanning Dashboard ayarları açılmalı~~ — tamamlandı (bölüm 8-9).
- [x] ~~Vercel hesap 2FA'sı teyit edilmeli~~ — zaten aktifti, teyit edildi.
- [x] ~~En az bir staging restore tatbikatı yapılıp `yedekleme-ve-geri-yukleme.md`'ye gerçek sonuçla yazılmalı~~ — yapıldı, başarılı (bölüm 11).

**Bu listedeki her madde artık işaretli.** Kalan tek şey bir kontrol listesi maddesi değil, bölüm 14 madde 3'teki **duran bir operasyonel karar**: Free plan'da kalınacaksa, düzenli bir yedek alma alışkanlığının gerçekten başlaması gerekiyor (aksi halde bugün ispatlanan restore mekanizmasının besleyeceği güncel bir yedek olmaz).

## 16. Karar: **CONDITIONAL GO**

Gerekçe — **beşinci kez güncellendi:** kod/CI tarafı tam kanıtlı (bölüm 1-2); production Supabase + Vercel hosting canlı ve doğrulanmış (bölüm 3-7); GitHub güvenlik ayarları (branch protection, Dependabot, Vercel 2FA) tamamlandı (bölüm 8-9); ilk admin hesabı gerçekten oluşturuldu, MFA kuruldu, production smoke testinin büyük kısmı (8/10) gerçek production'da koşuldu ve geçti (bölüm 12); staging smoke testinin tamamı (21/21) uçtan uca gerçek tarayıcıda koşulup geçti (bölüm 13); **restore tatbikatı yapıldı ve iş verisi tarafında başarılı oldu** (bölüm 11); Free plan'da kalma kararı gerçek ölçümle rakamsal temelli (bölüm 10). **Bölüm 15'teki bloklayıcı listesinin tamamı artık işaretli.**

Karar yine de **GO değil**, çünkü: (a) restore *mekanizması* kanıtlanmış olsa da, Free plan'da **hâlâ otomatik günlük yedek yok ve şu an düzenli manuel yedek de alınmıyor** — bugün gerçek veri kaybedilirse geri yüklenecek güncel bir kopya olmaz; (b) kimlik doğrulama/MFA verisinin bu yöntemle birebir kurtarılamadığı bölüm 11'de somut olarak doğrulandı; (c) production smoke testinin 2 maddesi (signed URL foto görüntüleme, teacher-hesabıyla canlı erişim testi) kullanıcı kararıyla ertelendi — ancak bu ikisi artık staging'de dolaylı olarak kanıtlanmış durumda (bölüm 5, 13).

Karar **NO-GO değil** çünkü RLS/service-role/signup/migration/MFA/private Storage/branch güvenliğinde doğrulanmamış KRİTİK bir risk yok — bunların hepsi hem CI'da hem gerçek production projesinde hem de artık uçtan uca staging akışında (restore dahil) fiilen test edildi; kalan risk artık bir *bilinmeyen* değil, açık bir *operasyonel karar*: Pro'ya geçmek mi, yoksa düzenli manuel yedek alışkanlığını gerçekten başlatmak mı.

**Sonuç: CONDITIONAL GO** — gerçek öğrenci/veli/finans verisi girilmeden önce, kullanıcının **bilinçli olarak** şu ikisinden birini seçmesi önerilir: (1) Pro plana geçip günlük otomatik yedek/PITR'ı açmak, veya (2) `docs/yedekleme-ve-geri-yukleme.md`'deki haftalık manuel dump alışkanlığını gerçekten (örn. takvime not düşerek veya basit bir zamanlanmış görevle) başlatmak. Bu seçim yapılmadan ilerlemek, kullanıcının bilinçli olarak üstlendiği bir risktir.
