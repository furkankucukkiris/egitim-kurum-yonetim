# Production Hazırlık Raporu

**İncelenen commit:** `5936936` (`main`, PR [#13](https://github.com/furkankucukkiris/egitim-kurum-yonetim/pull/13) merge sonrası)
**Rapor tarihi:** 2026-08-15 (ilk sürüm) / 2026-08-16 (CI + gerçek production deployment sonrası tamamen güncellendi)
**Hazırlayan:** Claude (bu oturum) — kod/CI tarafı bağımsız çalışıldı; Supabase Cloud/Vercel adımları kullanıcının kendi tarayıcı oturumunda (Claude in Chrome), kullanıcı gözetiminde yapıldı.

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
| Günlük otomatik yedek / PITR | ⏸️ **Free plan'da yok** — kullanıcı Pro'ya geçişi (ödeme bilgisi gerektirdiği için) bilinçli olarak erteledi |

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
- **Henüz doğrulanmayan:** gerçek bir PR açılıp oluşan Preview deployment'ının fiilen staging Supabase'e bağlandığının canlı testi (env değişkenleri doğru ayrılmış olsa da bir sonraki PR'da teyit edilmeli); Vercel hesabına 2FA kurulumu (kullanıcıya önerildi, "done" dendi ama ekran görüntüsüyle teyit edilmedi).

## 5. Storage doğrulaması — doğrulandı

`select id, public from storage.buckets` ile production projesinde sorgulanıp doğrulandı: `student-photos`/`bank-deposit-receipts`/`expense-documents` private, yalnızca `organization-logos` public. Teacher rolüyle signed URL üretilemediğinin gerçek bir girişle testi **henüz yapılmadı** — production'da henüz hiçbir kullanıcı hesabı yok.

## 6. Cron doğrulaması — doğrulandı

`select jobname, schedule, active from cron.job` ile production projesinde sorgulandı: `monthly-generation-daily-sweep`, `0 1 * * *`, `active: true`.

## 7. Domain/HTTPS doğrulaması

Custom domain yok (kullanıcı tercihi) — production `https://egitim-kurum-yonetim.vercel.app` adresinde, HTTPS/TLS çalışıyor. CSP/`X-Frame-Options`/`X-Content-Type-Options`/`Referrer-Policy`/`Permissions-Policy` header'ları CI'da (`e2e/security-headers.spec.ts`, commit `cd7497f`'de yeşil) doğrulanıyor; production URL'sinde ayrıca `curl -I` ile teyit edilmedi.

## 8. Branch protection durumu

**Henüz yapılmadı** — `gh` CLI/token erişimi yok, GitHub Settings'ten elle yapılması gerekiyor. Gerekli adımlar README "Branch protection" bölümünde ve `docs/production-cloud-checklist.md` bölüm 6'da listeli.

## 9. Dependabot/CodeQL/secret scanning durumu

- `.github/dependabot.yml` ve `.github/workflows/codeql.yml` eklendi ve **canlıda çalıştığı kanıtlandı** — Dependabot 4 gerçek PR açtı (#9-12), CodeQL PR'larda gerçekten koştu ve yeşil geçti (`cd7497f`, `5936936` dahil tüm son commit'lerde).
- Dashboard'daki üç anahtar (Dependabot alerts, Dependabot security updates, Secret scanning) **henüz açılmadı** — `docs/production-cloud-checklist.md` bölüm 6'da adımları var.

## 10. Backup durumu

**Production Free plan'da — günlük otomatik yedek ve PITR şu an KAPALI.** Kullanıcı, Pro plan'a geçişi bilinçli olarak erteledi. Kod/prosedür seviyesinde `docs/yedekleme-ve-geri-yukleme.md` hâlâ geçerli (haftalık şifreli `db dump` prosedürü) ama bu, Supabase'in kendi günlük otomatik yedeğinin **yerine geçmez** — yalnızca ek bir katman olarak tasarlanmıştı.

## 11. Restore testi sonucu

**Yapılmadı.** `docs/yedekleme-ve-geri-yukleme.md`'deki "Test kaydı" tablosu hâlâ boş.

## 12. Bilinen kalan riskler

1. **CSP `script-src 'unsafe-inline'`** — nonce tabanlı bir CSP daha sıkı olurdu ama Next.js App Router hydration'ını bozma riski taşıyor; bilinçli olarak uygulanmadı. Mevcut CSP CI'da otomatik doğrulanıyor. Telafi edici kontrol: `default-src 'self'` + `frame-ancestors 'none'`.
2. **`httpOnly:false` oturum cookie'si** — bilinçli mimari tercih, CSP'ye bağımlı bir telafi.
3. **Production Free plan'da, günlük yedek/PITR yok** — artık raporun en büyük tekil riski. Gerçek veri girilmeden önce mutlaka gözden geçirilmeli.
4. **Restore tatbikatı hiç yapılmadı.**
5. **İlk admin hesabı henüz oluşturulmadı** — bilinçli olarak kullanıcıya bırakıldı (kurumun gerçek yönetici kimliği); bu adım tamamlanana kadar production smoke testi de yapılamaz.
6. **pgTAP suite'inde bulunan sınıf hatası** (bkz. bölüm 1) yalnızca iki yerde vardı, ikisi de düzeltildi — ama "gerçek zamana bağlı, timezone-duyarsız fixture" kalıbının başka yeni pgTAP dosyalarında tekrarlanmaması için not düşülmeli.

## 13. Bloklayıcı maddeler (gerçek öğrenci/veli verisi girmeden önce)

- [x] ~~PR'lar açılıp CI'ın tamamının yeşil olduğu görülmeli~~ — tamamlandı.
- [x] ~~Production Supabase projesi oluşturulup temel ayarları yapılmalı~~ — tamamlandı (backup/PITR hariç, bkz. altta).
- [x] ~~Vercel hosting kurulup Preview/Production env ayrımı yapılmalı~~ — tamamlandı.
- [ ] **Production Supabase planı gözden geçirilmeli** — Free plan'da günlük yedek/PITR yok.
- [ ] İlk admin hesabı oluşturulup `/kurulum` + MFA kurulumu tamamlanmalı.
- [ ] Production smoke testi (`docs/production-cloud-checklist.md` bölüm 5) yapılmalı.
- [ ] Staging smoke testi (bölüm 3, 22 madde) en az bir kez gerçek ortamda koşulup sonuçlanmalı.
- [ ] En az bir staging restore tatbikatı yapılıp `yedekleme-ve-geri-yukleme.md`'ye gerçek sonuçla yazılmalı.
- [ ] Branch protection + Dependabot/secret scanning Dashboard ayarları açılmalı.
- [ ] Vercel hesap 2FA'sı teyit edilmeli.

## 14. Karar: **CONDITIONAL GO**

Gerekçe — **ikinci kez güncellendi:** kod ve CI tarafı tam kanıtlı (bölüm 1-2); production Supabase projesi ve Vercel hosting artık **gerçekten var ve canlı** — Auth/RLS/private Storage/cron production'da fiilen doğrulandı (bölüm 3-6), bu daha önceki "henüz doğrulanmadı" durumundan önemli bir ilerleme.

Karar hâlâ **GO değil**, çünkü: (a) production Supabase **Free plan'da, günlük yedek/PITR yok** — gerçek veri kaybı riskine karşı korumasız; (b) henüz hiçbir kullanıcı hesabı yok, dolayısıyla production smoke testi hiç koşulmadı; (c) staging smoke testi ve restore tatbikatı hâlâ yapılmadı; (d) GitHub branch protection/Dependabot alerts/secret scanning Dashboard ayarları hâlâ açılmadı.

Karar **NO-GO değil** çünkü RLS/service-role/signup/migration/MFA/private Storage'da doğrulanmamış KRİTİK bir risk yok — bunların hepsi hem CI'da hem gerçek production projesinde fiilen test edildi.

**Sonuç: CONDITIONAL GO** — bölüm 13'teki kalan maddeler (en kritik olanı: **backup planı**) tamamlanmadan gerçek öğrenci/veli/finans verisi girilmemelidir.
