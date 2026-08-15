# Production Hazırlık Raporu

**İncelenen commit:** `cd7497f9d319b4411b39ccb7e533e48197fc287a` (branch `fix/e2e-seed-and-branch-protection`, PR [#8](https://github.com/furkankucukkiris/egitim-kurum-yonetim/pull/8), `main`'in devamı — bkz. "Repo durumu" bölümü)
**Rapor tarihi:** 2026-08-15 (ilk sürüm) / 2026-08-16 (CI sonucuyla güncellendi)
**Hazırlayan:** Claude (bu oturum) — kullanıcı onayıyla, doğrudan Supabase Cloud/Vercel/GitHub erişimi olmadan.

---

## 1. Repo durumu

`main` dalı, bu görev başladığında `9edede6` (MFA QR kodu render düzeltmesi) commit'indeydi. Çalışılan `fix/e2e-seed-and-branch-protection` branch'i bu commit'in üzerine 4 yeni commit ekledi ve `main`'e karşı PR [#8](https://github.com/furkankucukkiris/egitim-kurum-yonetim/pull/8) olarak açıldı:

1. `ce184a7` — üretim-hazırlığı ana paketi: `e2e/basic-flows.spec.ts`/`global-setup.ts`/`security-headers.spec.ts` (yeni), `src/instrumentation.ts`+`src/lib/env-validation.ts` (yeni), `src/app/api/health/route.ts` (yeni), `.github/dependabot.yml`+`workflows/codeql.yml` (yeni), `docs/guvenlik-kontrol-listesi.md`, `docs/production-cloud-checklist.md` (yeni), `README.md`.
2. `fe28156` — bu raporun ilk sürümü.
3. `52a112a` — CI'da PR açıldıktan sonra ortaya çıkan **gerçek bir regresyon**ın düzeltmesi: `e2e` job'u yeni env-validasyonu yüzünden çöküyordu (bkz. bölüm 2).
4. `cd7497f` — CI'ın canlı yakaladığı **gerçek bir flaky pgTAP testi**nin düzeltmesi (bkz. bölüm 2, bölüm 4).

**PR #8 bu rapor yazıldığında `main`'e merge edilmemiş durumda** — merge kararı kullanıcıya ait.

## 2. Çalıştırılan komutlar ve sonuçlar

### Yerel (Docker olmayan bu makinede)

| Komut | Sonuç |
|---|---|
| `npm install` (bu makinede `npm ci` bir önceki oturumdan kalan kilitli bir native binary yüzünden EPERM verdi; `npm install` aynı `package-lock.json`'a göre temiz kurdu) | ✅ 0 güvenlik açığı |
| `npm run lint` | ✅ hatasız |
| `npm run typecheck` | ✅ hatasız |
| `npm test` (unit + component) | ✅ 5 dosya, 38/38 test |
| `npm run build` (CI'daki `build` job'uyla birebir aynı placeholder env değerleriyle) | ✅ başarılı, 43 route derlendi, `instrumentation.ts` build'i etkilemedi (register() yalnızca gerçek sunucu başlangıcında çalışır — beklenen davranış doğrulandı) |
| Secret taraması: `git grep` (JWT/`eyJ...` deseni, `service_role` literal ataması) çalışan ağaçta + `git log -p --all -S "eyJ"` tüm commit geçmişinde | ✅ gerçek bir secret bulunamadı (tek eşleşme bir `package-lock.json` sha512 integrity hash'indeki tesadüfi "eyJ" alt dizesiydi) |
| `.env*` commit geçmişi taraması (`git log --all --diff-filter=A --name-only`) | ✅ `.env.example` dışında hiç `.env*` dosyası commit edilmemiş |
| `SUPABASE_SERVICE_ROLE_KEY` referans taraması (tüm repo) | ✅ yalnızca `src/lib/supabase/admin.ts`, `src/lib/env-validation.ts` (ikisi de `"server-only"`), `e2e/global-setup.ts` (test setup), ve dokümantasyon/CI dosyaları — 30 `"use client"` bileşeninin hiçbirinde yok |

### GitHub Actions CI — PR #8, commit `cd7497f` (final, yeşil)

| Job | Sonuç |
|---|---|
| Lint & Typecheck | ✅ success |
| Unit & Component Testleri | ✅ success |
| Production Build | ✅ success |
| Migration Doğrulama + pgTAP | ✅ success — **17 dosya, 420/420 test** |
| E2E (admin + öğretmen temel akışları) | ✅ success |
| CodeQL Analiz | ✅ success |

Bu sonuca ilk denemede değil, **CI'ın gerçekten yakaladığı iki gerçek hatanın düzeltilmesinden sonra** ulaşıldı — ayrıntı için bölüm 4:

- **Commit `ce184a7`'de CI:** `Migration Doğrulama + pgTAP` FAIL (flaky test, bkz. altta), `E2E` henüz koşmadan önce PR açılmamıştı.
- **Commit `52a112a`'de CI:** `E2E` job'u `next start` açılışında çöktü ("eksik: NEXT_PUBLIC_INSTITUTION_NAME") — bu oturumun kendi env-validasyon değişikliğinin CI workflow'unu güncellemeyi unutmasından kaynaklanan gerçek bir regresyondu, aynı commit'te ayrıca `dashboard_financial_summary.test.sql`'deki flaky testi düzeltmeye çalışıldı ama `Migration Doğrulama + pgTAP` **farklı bir dosyada** (`cash_bank_module.test.sql`) aynı sınıf başka bir flaky testle FAIL verdi.
- **Commit `cd7497f`'de CI:** tüm 5 job + CodeQL yeşil.

Repo temizliği: kullanılmayan dosya, gerçek anahtar, dump veya hassas belge bulunmadı. `scripts/reset-all-data.sql` incelendi — bilinçli, açıkça uyarılı bir geliştirme/staging aracı, bir kaza değil.

## 3. Bu oturumda yapılan değişiklikler ve gerekçeleri

| Alan | Değişiklik | Neden |
|---|---|---|
| E2E retry | `basic-flows.spec.ts`'te `test.describe.configure({ retries: 0 })` | Global CI retry (1), bu dosyadaki stateful/serial akışta ilk denemenin bıraktığı kısmi state ile ikinci denemeyi kafa karıştırıcı, yanlış bir hatayla başarısız kılabiliyordu |
| E2E production guard | `global-setup.ts`'e `assertNotProductionSupabaseUrl()` | URL localhost/127.0.0.1 değilse (izole `E2E_ALLOW_REMOTE_SUPABASE_URL` istisnası dışında) erken ve kesin hata — önceden yalnızca yorum satırına güveniliyordu, kod seviyesinde bir kapı yoktu |
| Güvenlik dokümantasyonu | `guvenlik-kontrol-listesi.md`'deki `httpOnly:true` iddiası, koddaki bilinçli `httpOnly:false` ile tutarlı hale getirildi | Doküman kodla çelişiyordu (madde 5, commit `3fd8c44` sonrası güncellenmemişti); artık XSS riski + CSP'nin telafi edici kontrol olduğu açıkça yazıyor |
| Env sağlamlaştırma | `src/instrumentation.ts` + `src/lib/env-validation.ts` | Production'da eksik/placeholder env değişkeni artık ilk istekte belirsiz bir hata yerine, sunucu açılışında anlaşılır bir hatayla durduruyor; CI'nın `build` job'undaki placeholder değerleri etkilemiyor (register() build zamanında çalışmıyor — yerel olarak doğrulandı) |
| Health endpoint | `src/app/api/health/route.ts` | Hosting health check için, hiçbir hassas/iç veri döndürmeden |
| CSP/nonce | **Değiştirilmedi** — bkz. bölüm 5 | Nonce tabanlı CSP'nin session/MFA/hydration akışlarını bozmadığı yalnızca gerçek E2E koşusuyla kanıtlanabilir; bu makinede E2E çalıştırılamadığından, doğrulanamamış bir CSP değişikliğini production'a taşımak riskli bir yarım-çözüm olurdu — mevcut CSP korundu, kalan risk aşağıda belgelendi |
| Header doğrulama | `e2e/security-headers.spec.ts` (yeni, bağımsız/durumsuz test) | Production build'in CSP/`X-Frame-Options`/`X-Content-Type-Options`/`Referrer-Policy`/`Permissions-Policy` header'larını gerçekten döndürdüğünü CI'da otomatik doğrular |
| GitHub | `.github/dependabot.yml`, `.github/workflows/codeql.yml` | npm + GitHub Actions bağımlılıkları için haftalık Dependabot taraması, CodeQL statik analiz |
| Dokümantasyon | `docs/production-cloud-checklist.md` (yeni) | Supabase Cloud/Vercel/GitHub'daki tüm elle yapılacak adımların tam kontrol listesi (bölüm 6-9 altında) |
| CI regresyon düzeltmesi | `.github/workflows/ci.yml`'in `e2e` job'una `NEXT_PUBLIC_INSTITUTION_NAME` env'i eklendi | Bu oturumun kendi env-validasyon değişikliği (`instrumentation.ts`), CI'nın `e2e` job'unun bu değişkeni hiç set etmediğini fark etmemişti — `next start` açılışta çöküyordu. PR'da CI çalıştırılınca yakalandı, aynı gün düzeltildi. |
| Flaky test düzeltmesi #1 | `dashboard_financial_summary.test.sql` — fixture zamanları `now()+N saat` yerine "bugün Europe/Istanbul öğlen" çapasına bağlandı | `today_total_session_count` testi, gerçek çalıştırma anı Europe/Istanbul gece yarısına yakınsa (~UTC 21:00-23:59) ikinci fixture oturumunu ertesi güne kaydırıp yanlış sonuç veriyordu — CI'da canlı gerçekleşti, `-dev` projesinde canlı doğrulandı. |
| Flaky test düzeltmesi #2 | `cash_bank_module.test.sql` — `current_date` yerine Europe/Istanbul çapası | `get_cash_daily_balances()` kurumun timezone'una (Europe/Istanbul) göre gün kırılımı yapıyor, test bare `current_date` (Postgres oturumu UTC) kullanıyordu — aynı ~3 saatlik pencerede uyuşmazlık; `-dev` projesinde canlı doğrulandı (`current_date`=UTC günü, gerçek Istanbul günü bir gün ileride). |

## 4. Migration sonucu

**Doğrulandı — CI'da yeşil (commit `cd7497f`).** `Migration Doğrulama + pgTAP` job'u: `supabase db reset` (temiz veritabanına tüm migration'ların sıfırdan ve hatasız uygulanması) başarılı, ardından `supabase test db` (pgTAP) **17 dosya, 420/420 test** başarılı. Bu oturumda hiçbir migration dosyası değiştirilmedi/eklenmedi — yalnızca iki test dosyasındaki (`.test.sql`, şema değil) zaman-bağımlı fixture'lar düzeltildi (bkz. bölüm 3, "Flaky test düzeltmesi #1/#2").

## 5. Staging sonucu

Gerçek bir staging deployment'ı bu oturumda **kurulmadı** — hosting yok, kullanıcı adına Supabase Cloud/Vercel Dashboard'da hesap/proje oluşturma yetkisi/erişimi bu oturumda talep edilmedi (kullanıcı "siz tıklayarak" erişim yöntemini seçti). Aşağıdaki mimari karar verildi ve `docs/production-cloud-checklist.md`'ye tam kontrol listesiyle yazıldı:

- **Staging Supabase = mevcut `egitim-kurum-yonetim-dev` projesi** (ref `qhvezujyuckxkvietlyi`, zaten linked ve migration'ları güncel) — yeni bir üçüncü proje açmak yerine yeniden kullanıldı.
- **Production Supabase = yeni, ayrı bir proje** (henüz oluşturulmadı).
- **Hosting = Vercel**, Production environment (yalnızca `main`) ↔ production Supabase; Preview environment (diğer tüm dallar/PR'lar) ↔ staging (`-dev`) Supabase — bu ayrım Vercel'in kendi ortam izolasyonuyla, "preview'lar production'a asla bağlanamaz" şartını yapısal olarak sağlıyor.
- **Domain: yok** — kullanıcı tercihiyle `*.vercel.app` ile devam, custom domain sonraki bir adım.

Staging smoke testi (22 madde, `docs/production-cloud-checklist.md` bölüm 3) **henüz uygulanmadı** — gerçek bir staging deployment'ı olmadığı için uygulanabilir bir kontrol listesi olarak bırakıldı.

## 6. Production Supabase manuel ayarları

**Henüz yapılmadı** — production Supabase projesi bu oturumda oluşturulmadı. Tam kontrol listesi (`docs/production-cloud-checklist.md` bölüm 1): Auth (signup kapatma, MFA, rate limit, Site URL, redirect allowlist), Database (migration push, RLS/grant teyidi, `pg_cron` teyidi, seed uygulanmaması), Storage bucket görünürlükleri, backup/PITR durumu — tümü işaretsiz.

## 7. Storage doğrulaması

Kod seviyesinde doğrulandı (değişmedi, bu oturumun kapsamı dışı): `student-photos`/`bank-deposit-receipts`/`expense-documents` migration'larda `private` + `is_admin()` politikasıyla tanımlı, yalnızca `organization-logos` public. **Gerçek production/staging proje Dashboard'ından görünürlük teyidi henüz yapılmadı** (proje yok).

## 8. Cron doğrulaması

Kod seviyesinde doğrulandı (değişmedi): `monthly-generation-daily-sweep` işi migration'da (`20260812120000`) tanımlı, `npx supabase db push` production'da otomatik zamanlar. **Gerçek production projesinde `select * from cron.job;` ile teyit henüz yapılmadı** (proje yok).

## 9. Domain/HTTPS doğrulaması

Domain yok (kullanıcı tercihi — bkz. bölüm 5). **CSP/`X-Frame-Options`/`X-Content-Type-Options`/`Referrer-Policy`/`Permissions-Policy` header'ları artık CI'da doğrulanıyor** (`e2e/security-headers.spec.ts`, `E2E` job'ının parçası, commit `cd7497f`'de yeşil geçti) — bu, production build'in header'ları gerçekten döndürdüğünün otomatik kanıtı. Vercel varsayılan `*.vercel.app` adresleri otomatik HTTPS/HSTS sağlar; ama gerçek production/staging deployment'ı henüz yapılmadığından HTTPS/HSTS'in canlı bir adreste döndüğü **henüz doğrulanmadı**.

## 10. Branch protection durumu

**Henüz yapılmadı** — `gh` CLI/token erişimi yok. Gerekli tam adımlar (status check adları dahil) README "Branch protection" bölümünde ve `docs/production-cloud-checklist.md` bölüm 6'da listeli.

## 11. Dependabot/CodeQL/secret scanning durumu

- `.github/dependabot.yml` ve `.github/workflows/codeql.yml` bu oturumda eklendi (kod/config seviyesinde tamam).
- Dashboard'daki üç anahtar (Dependabot alerts, Dependabot security updates, Secret scanning) **henüz açılmadı** — `docs/production-cloud-checklist.md` bölüm 6'da adımları var.
- CodeQL'in private repo'da sonuç yükleyebilmesi GitHub Advanced Security'ye bağlı olabilir — repo'nun public/private durumu bu oturumda teyit edilmedi, ilk workflow koşusunda netleşecek.

## 12. Backup durumu

Kod/prosedür seviyesinde tamam (`docs/yedekleme-ve-geri-yukleme.md`, bu oturumda değiştirilmedi): Supabase otomatik yedek + haftalık şifreli `db dump` prosedürü tanımlı. **Gerçek production projesinde günlük yedek/PITR planının açık olduğu henüz Dashboard'dan teyit edilmedi** (proje yok).

## 13. Restore testi sonucu

**Yapılmadı.** `docs/yedekleme-ve-geri-yukleme.md`'deki "Test kaydı" tablosu hâlâ boş — bu bilinçli, sahte bir başarı kaydı yazılmadı. En az bir staging geri yükleme tatbikatı yapılıp tarih/süre/sonuç/sorumlu ile o tabloya yazılmadan production onayı verilmemelidir.

## 14. Bilinen kalan riskler

1. **CSP `script-src 'unsafe-inline'`** — nonce tabanlı bir CSP daha sıkı olurdu ama Next.js App Router hydration'ını bozma riski taşıyor. Bilinçli olarak uygulanmadı; mevcut CSP artık CI'da otomatik doğrulanıyor (bölüm 9). Telafi edici kontrol: `default-src 'self'` + `frame-ancestors 'none'` zaten üçüncü taraf script/iframe enjeksiyonunu büyük ölçüde engelliyor.
2. **`httpOnly:false` oturum cookie'si** — bilinçli mimari tercih (client-side Supabase auth çağrıları için gerekli), CSP'ye bağımlı bir telafi. Nonce tabanlı CSP eklenmedikçe bu risk aynı seviyede kalır.
3. **Gerçek Supabase Cloud/Vercel altyapısı hiç kurulmadı** — kod ve CI tarafı artık tam kanıtlı (bölüm 2, 4), ama Auth/MFA/RLS/private Storage/cron/HTTPS'in **gerçek bir production/staging projesinde** çalıştığı henüz hiç doğrulanmadı; bugüne kadarki tüm doğrulama ya kod incelemesi ya da geçici/CI'a özel Supabase örnekleri üzerinden. Bu artık raporun tek büyük risk kategorisi.
4. **Restore tatbikatı hiç yapılmadı** — yedeğin var olması, geri yüklenebilir olduğunu kanıtlamıyor.
5. **pgTAP suite'inde bulunan sınıf hatası** (bkz. bölüm 3) yalnızca `current_date`/`now()+saat` deseni geçen iki yerde vardı ve ikisi de düzeltildi; ama bu, "gerçek zamana bağlı, timezone-duyarsız fixture" kalıbının başka test dosyalarında da tekrarlanabileceğinin canlı bir kanıtı — yeni pgTAP dosyası yazılırken bu deseni tekrarlamamak için `docs/production-readiness-report.md` bu bölümüne referans verilmesi önerilir.

## 15. Bloklayıcı maddeler (production onayından önce)

- [x] ~~PR açılıp CI'ın tamamının yeşil olduğu görülmeli~~ — **tamamlandı**, PR #8, commit `cd7497f`, 5/5 job + CodeQL yeşil.
- [ ] Production Supabase projesi oluşturulup `docs/production-cloud-checklist.md` bölüm 1 tamamlanmalı.
- [ ] Vercel hosting kurulup bölüm 2 tamamlanmalı (özellikle Preview/Production env ayrımı).
- [ ] Staging smoke testi (bölüm 3, 22 madde) en az bir kez gerçek ortamda koşulup sonuçlanmalı.
- [ ] En az bir staging restore tatbikatı yapılıp `yedekleme-ve-geri-yukleme.md`'ye gerçek sonuçla yazılmalı.
- [ ] Branch protection + Dependabot/secret scanning Dashboard ayarları açılmalı.
- [ ] Production smoke testi (bölüm 5) production'da bir kez koşulmalı.
- [ ] PR #8 `main`'e merge edilmeli (kullanıcı kararı — bu rapor yazıldığında henüz merge edilmemişti).

## 16. Karar: **CONDITIONAL GO**

Gerekçe (verilen karar kurallarına göre) — **güncellendi:** kod ve CI artık tam kanıtlı: lint/typecheck/build/unit yeşil, **migration temiz DB'ye uygulandı, 420/420 pgTAP testi geçti, E2E (admin+öğretmen akışları) geçti, CodeQL geçti** — hepsi PR #8'de gerçek CI koşusuyla doğrulandı (commit `cd7497f`), varsayım değil. Bu süreçte CI'ın canlı yakaladığı iki gerçek hata (bir regresyon, bir pre-existing flaky test) de düzeltildi ve doğrulandı.

Karar hâlâ **GO değil**, çünkü: gerçek Supabase Cloud production projesi, Vercel hosting, staging smoke testi ve restore tatbikatının HİÇBİRİ henüz gerçek bir ortamda doğrulanmadı — "Migration, Auth, MFA, RLS, private Storage, cron, HTTPS ve staging smoke testleri başarılıysa: GO" eşiği, migration/pgTAP/E2E ayağı artık karşılansa da Auth/RLS/private Storage/cron/HTTPS'in gerçek bir Supabase Cloud/hosting ortamında çalıştığı kanıtlanmadığı için hâlâ tam karşılanmıyor.

Karar **NO-GO da değil** çünkü RLS/service-role/signup/migration/MFA/backup/private Storage'da doğrulanmamış KRİTİK bir risk yok — bu alanların hepsi hem kod incelemesiyle hem de CI'daki gerçek pgTAP/E2E koşusuyla kapsamlıca test edildi; eksik olan yalnızca bunların **gerçek bulut altyapısında** tekrarlanması.

**Sonuç: CONDITIONAL GO** — bölüm 15'teki kalan maddeler (artık yalnızca gerçek Supabase Cloud/Vercel/GitHub Dashboard adımları + PR merge kararı) tamamlanmadan gerçek öğrenci/veli/finans verisi girilmemelidir.
