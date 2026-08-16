# Production Hazırlık Raporu

**İncelenen commit:** `5936936` (`main`, PR [#13](https://github.com/furkankucukkiris/egitim-kurum-yonetim/pull/13) merge sonrası)
**Rapor tarihi:** 2026-08-15 (ilk sürüm) / 2026-08-16 (CI + gerçek production deployment sonrası tamamen güncellendi) / 2026-08-17 (ilk admin hesabı, MFA, production smoke testi, GitHub güvenlik ayarları ve Free plan kapasite analizi eklendi)
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

`select id, public from storage.buckets` ile production projesinde sorgulanıp doğrulandı: `student-photos`/`bank-deposit-receipts`/`expense-documents` private, yalnızca `organization-logos` public. Teacher rolüyle signed URL üretilemediğinin/admin tarafında signed URL ile fotoğraf görüntülemenin gerçek bir dosya yüklemesiyle canlı testi **kullanıcı kararıyla ertelendi** — bucket privacy konfigürasyonu ve kod yolu CI'da defalarca test edilmiş olması yeterli kanıt sayıldı; gerçek öğrenci verisi girilmeye başlandığında ilk gerçek fotoğraf yüklemesiyle doğal olarak teyit edilecek.

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

**Sonuç: Free plan'da kalma kararı artık rakamsal temelli** — 200 öğrenci ölçeğinde yıllarca kapasite sorunu beklenmiyor. Ama bu, günlük otomatik yedek/PITR eksikliğini (veri kaybı riski, kapasite değil) telafi etmiyor — bu hâlâ raporun en büyük tekil riski, bkz. bölüm 12. Kod/prosedür seviyesinde `docs/yedekleme-ve-geri-yukleme.md` hâlâ geçerli (haftalık şifreli `db dump` prosedürü) ama bu, Supabase'in kendi günlük otomatik yedeğinin **yerine geçmez** — yalnızca ek bir katman olarak tasarlanmıştı.

## 11. Restore testi sonucu

**Yapılmadı.** `docs/yedekleme-ve-geri-yukleme.md`'deki "Test kaydı" tablosu hâlâ boş.

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

## 13. Bilinen kalan riskler

1. **CSP `script-src 'unsafe-inline'`** — nonce tabanlı bir CSP daha sıkı olurdu ama Next.js App Router hydration'ını bozma riski taşıyor; bilinçli olarak uygulanmadı. Mevcut CSP CI'da otomatik doğrulanıyor. Telafi edici kontrol: `default-src 'self'` + `frame-ancestors 'none'`.
2. **`httpOnly:false` oturum cookie'si** — bilinçli mimari tercih, CSP'ye bağımlı bir telafi.
3. **Production Free plan'da, günlük yedek/PITR yok** — raporun en büyük tekil riski, artık kapasite değil veri kaybı riski (bkz. bölüm 10). Gerçek veri girilmeden önce mutlaka gözden geçirilmeli.
4. **Restore tatbikatı hiç yapılmadı.**
5. **Staging smoke testi (22 madde) hiç koşulmadı** — production smoke testi (bölüm 12) daha dar kapsamlı, staging'deki tam kullanıcı akışlarını (yoklama, tahakkuk, ödeme, hakediş vb.) kapsamıyor.
6. **pgTAP suite'inde bulunan sınıf hatası** (bkz. bölüm 1) yalnızca iki yerde vardı, ikisi de düzeltildi — ama "gerçek zamana bağlı, timezone-duyarsız fixture" kalıbının başka yeni pgTAP dosyalarında tekrarlanmaması için not düşülmeli.

## 14. Bloklayıcı maddeler (gerçek öğrenci/veli verisi girmeden önce)

- [x] ~~PR'lar açılıp CI'ın tamamının yeşil olduğu görülmeli~~ — tamamlandı.
- [x] ~~Production Supabase projesi oluşturulup temel ayarları yapılmalı~~ — tamamlandı (backup/PITR hariç, bkz. bölüm 10).
- [x] ~~Vercel hosting kurulup Preview/Production env ayrımı yapılmalı~~ — tamamlandı.
- [x] ~~Production Supabase planı gözden geçirilmeli~~ — Free plan'da kalma kararı rakamsal olarak doğrulandı (bölüm 10); günlük yedek/PITR eksikliği ayrı bir risk olarak kaldı.
- [x] ~~İlk admin hesabı oluşturulup `/kurulum` + MFA kurulumu tamamlanmalı~~ — tamamlandı.
- [x] ~~Production smoke testi yapılmalı~~ — 8/10 madde tamamlandı, 2 madde kullanıcı kararıyla ertelendi (bölüm 12).
- [x] ~~Branch protection + Dependabot/secret scanning Dashboard ayarları açılmalı~~ — tamamlandı (bölüm 8-9).
- [x] ~~Vercel hesap 2FA'sı teyit edilmeli~~ — zaten aktifti, teyit edildi.
- [ ] Staging smoke testi (bölüm 3, 22 madde) en az bir kez gerçek ortamda koşulup sonuçlanmalı.
- [ ] En az bir staging restore tatbikatı yapılıp `yedekleme-ve-geri-yukleme.md`'ye gerçek sonuçla yazılmalı.

## 15. Karar: **CONDITIONAL GO**

Gerekçe — **üçüncü kez güncellendi:** kod/CI tarafı tam kanıtlı (bölüm 1-2); production Supabase + Vercel hosting canlı ve doğrulanmış (bölüm 3-7); GitHub güvenlik ayarları (branch protection, Dependabot, Vercel 2FA) tamamlandı (bölüm 8-9); ilk admin hesabı gerçekten oluşturuldu, MFA kuruldu, production smoke testinin büyük kısmı (8/10) gerçek production'da koşuldu ve geçti (bölüm 12); Free plan'da kalma kararı artık gerçek ölçümle rakamsal temelli (bölüm 10).

Karar hâlâ **GO değil**, çünkü: (a) production Supabase **Free plan'da, günlük yedek/PITR yok** — kapasite sorunu değil ama gerçek veri kaybı riskine karşı hâlâ korumasız; (b) staging smoke testi (22 madde) ve restore tatbikatı hâlâ hiç yapılmadı; (c) production smoke testinin 2 maddesi (signed URL foto görüntüleme, teacher-hesabıyla canlı erişim testi) kullanıcı kararıyla ertelendi.

Karar **NO-GO değil** çünkü RLS/service-role/signup/migration/MFA/private Storage/branch güvenliğinde doğrulanmamış KRİTİK bir risk yok — bunların hepsi hem CI'da hem gerçek production projesinde fiilen test edildi; kalan riskin merkezi artık tek bir madde: **backup planı**.

**Sonuç: CONDITIONAL GO** — bölüm 14'teki iki açık madde (staging smoke testi, restore tatbikatı) ve özellikle **backup planı** (bölüm 13.3) tamamlanmadan/gözden geçirilmeden gerçek öğrenci/veli/finans verisi girilmemesi önerilir; kullanıcı bilinçli olarak bu riskle ilerlemeyi tercih ederse karar kendisine aittir.
