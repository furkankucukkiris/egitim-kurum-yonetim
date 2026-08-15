# Production Hazırlık Raporu

**İncelenen commit:** `ce184a7eccb094037b08c8b6c70af2648a2a56ea` (branch `fix/e2e-seed-and-branch-protection`, `main`'in devamı — bkz. "Repo durumu" bölümü)
**Rapor tarihi:** 2026-08-15
**Hazırlayan:** Claude (bu oturum) — kullanıcı onayıyla, doğrudan Supabase Cloud/Vercel/GitHub erişimi olmadan.

---

## 1. Repo durumu

`main` dalı, bu görev başladığında `9edede6` (MFA QR kodu render düzeltmesi) commit'indeydi. Çalışılan `fix/e2e-seed-and-branch-protection` branch'i bu commit'in üzerine, bu oturumda üretilen üretim-hazırlığı değişikliklerini içeren **1 yeni commit** (`ce184a7`) ekledi:

- `e2e/basic-flows.spec.ts`, `e2e/global-setup.ts`, `e2e/security-headers.spec.ts` (yeni)
- `src/instrumentation.ts` (yeni), `src/lib/env-validation.ts` (yeni)
- `src/app/api/health/route.ts` (yeni)
- `.github/dependabot.yml` (yeni), `.github/workflows/codeql.yml` (yeni)
- `docs/guvenlik-kontrol-listesi.md`, `docs/production-cloud-checklist.md` (yeni), `README.md`

Bu commit `origin/fix/e2e-seed-and-branch-protection`'a push edildi. **`main`'e merge edilmedi** — bu depodaki `CI` workflow'u yalnızca `main`'e push'ta ve `pull_request` olaylarında tetikleniyor (branch push'ında değil); bu değişiklikleri CI'dan geçirmek için bir PR açılması gerekiyor. PR linki kullanıcıya bu oturumda verildi, bu rapor yazıldığında **henüz açılmamıştı**:

> https://github.com/furkankucukkiris/egitim-kurum-yonetim/compare/main...fix/e2e-seed-and-branch-protection?expand=1

**Bu, raporun en büyük tek bloklayıcısıdır** — aşağıdaki tüm kod değişiklikleri yerel olarak doğrulandı ama CI'daki `db-integration` ve `e2e` job'ları (Docker gerektirdiğinden bu makinede çalıştırılamıyor) bu spesifik commit için henüz koşmadı.

## 2. Çalıştırılan komutlar ve sonuçlar (yerel)

| Komut | Sonuç |
|---|---|
| `npm install` (bu makinede `npm ci` bir önceki oturumdan kalan kilitli bir native binary yüzünden EPERM verdi; `npm install` aynı `package-lock.json`'a göre temiz kurdu) | ✅ 0 güvenlik açığı |
| `npm run lint` | ✅ hatasız |
| `npm run typecheck` | ✅ hatasız |
| `npm test` (unit + component) | ✅ 5 dosya, 38/38 test |
| `npm run build` (CI'daki `build` job'uyla birebir aynı placeholder env değerleriyle) | ✅ başarılı, 43 route derlendi, `instrumentation.ts` build'i etkilemedi (register() yalnızca gerçek sunucu başlangıcında çalışır — beklenen davranış doğrulandı) |
| `npx supabase db reset` / `npx supabase test db` (pgTAP) | ❌ **çalıştırılamadı** — bu makinede Docker yok |
| `npm run test:e2e` | ❌ **çalıştırılamadı** — Docker + yerel Supabase gerektiriyor |
| Secret taraması: `git grep` (JWT/`eyJ...` deseni, `service_role` literal ataması) çalışan ağaçta + `git log -p --all -S "eyJ"` tüm commit geçmişinde | ✅ gerçek bir secret bulunamadı (tek eşleşme bir `package-lock.json` sha512 integrity hash'indeki tesadüfi "eyJ" alt dizesiydi) |
| `.env*` commit geçmişi taraması (`git log --all --diff-filter=A --name-only`) | ✅ `.env.example` dışında hiç `.env*` dosyası commit edilmemiş |
| `SUPABASE_SERVICE_ROLE_KEY` referans taraması (tüm repo) | ✅ yalnızca `src/lib/supabase/admin.ts`, `src/lib/env-validation.ts` (ikisi de `"server-only"`), `e2e/global-setup.ts` (test setup), ve dokümantasyon/CI dosyaları — 30 `"use client"` bileşeninin hiçbirinde yok |

**Kullanıcının önceden doğruladığı durum** (bu oturumda tekrar koşulmadı, bu commit'e özgü değil): 17 pgTAP dosyasında 420 test, admin+öğretmen E2E akışları, temiz veritabanına migration — bunlar `a5724c3` commit'inde (bu branch'in bir önceki hâli, PR #7 ile `main`'e merge edildi) CI'da yeşildi. **Bu session'ın değişiklikleri (özellikle E2E'ye dokunan `basic-flows.spec.ts`/`global-setup.ts` düzenlemeleri) bu doğrulamanın bir parçası değildi ve yeniden koşulmalı.**

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

## 4. Migration sonucu

Bu commit için `db-integration` job'u (temiz veritabanına migration + pgTAP) **henüz koşmadı** (bölüm 1'e bakınız — PR açılmayı bekliyor). Kod incelemesiyle: bu oturumda hiçbir migration dosyası değiştirilmedi veya eklenmedi — yalnızca uygulama/test/CI/doküman dosyalarına dokunuldu, bu yüzden migration davranışının bir önceki yeşil koşudan (`a5724c3`) farklı olması beklenmiyor, ama bu bir **varsayım**dır, kanıt değil; PR açıldığında CI sonucu bu rapora eklenmelidir.

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

Domain yok (kullanıcı tercihi — bkz. bölüm 5). Vercel varsayılan `*.vercel.app` adresleri otomatik HTTPS/HSTS sağlar; production deployment henüz yapılmadığından bu **henüz canlı olarak doğrulanmadı**. `e2e/security-headers.spec.ts` CSP/`X-Frame-Options`/vb. header'ları CI'da (PR açıldığında) doğrulayacak.

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

1. **CSP `script-src 'unsafe-inline'`** — nonce tabanlı bir CSP daha sıkı olurdu ama Next.js App Router hydration'ını bozma riski, bu makinede E2E ile doğrulanamadığından bilinçli olarak uygulanmadı. Telafi edici kontrol: `default-src 'self'` + `frame-ancestors 'none'` zaten üçüncü taraf script/iframe enjeksiyonunu byük ölçüde engelliyor.
2. **`httpOnly:false` oturum cookie'si** — bilinçli mimari tercih (client-side Supabase auth çağrıları için gerekli), CSP'ye bağımlı bir telafi. Nonce tabanlı CSP eklenmedikçe bu risk aynı seviyede kalır.
3. **Bu commit CI'dan henüz geçmedi** (bölüm 1) — en büyük tekil risk, PR açılıp CI yeşil olana kadar bu değişiklikler "kodda var ama kanıtlanmamış" durumda.
4. **Restore tatbikatı hiç yapılmadı** — yedeğin var olması, geri yüklenebilir olduğunu kanıtlamıyor.
5. **CodeQL'in bu repoda gerçekten sonuç üretip üretemeyeceği** (Advanced Security/repo görünürlüğüne bağlı) doğrulanmadı.

## 15. Bloklayıcı maddeler (production onayından önce)

- [ ] PR açılıp CI'ın (5 job, bu commit için) tamamının yeşil olduğu görülmeli.
- [ ] Production Supabase projesi oluşturulup `docs/production-cloud-checklist.md` bölüm 1 tamamlanmalı.
- [ ] Vercel hosting kurulup bölüm 2 tamamlanmalı (özellikle Preview/Production env ayrımı).
- [ ] Staging smoke testi (bölüm 3, 22 madde) en az bir kez gerçek ortamda koşulup sonuçlanmalı.
- [ ] En az bir staging restore tatbikatı yapılıp `yedekleme-ve-geri-yukleme.md`'ye gerçek sonuçla yazılmalı.
- [ ] Branch protection + Dependabot/secret scanning Dashboard ayarları açılmalı.
- [ ] Production smoke testi (bölüm 5) production'da bir kez koşulmalı.

## 16. Karar: **CONDITIONAL GO**

Gerekçe (verilen karar kurallarına göre): kod, yerel test/lint/typecheck/build başarılı ve secret taraması temiz — ama (a) bu spesifik commit CI'dan (migration/pgTAP/E2E) henüz geçmedi, (b) gerçek Supabase Cloud production projesi, Vercel hosting, staging smoke testi ve restore tatbikatı hiçbiri henüz doğrulanmadı. Bunlar "Migration, Auth, MFA, RLS, private Storage, cron, HTTPS ve staging smoke testleri başarılıysa: GO" eşiğinin altında kalıyor ama "RLS/service-role/signup/migration/MFA/backup/private Storage konusunda doğrulanmamış KRİTİK bir risk" de yok (mevcut kod tabanı zaten önceki oturumlarda bunları kapsamlıca test etmişti) — bu yüzden **NO-GO değil, CONDITIONAL GO**: bölüm 15'teki maddeler tamamlanmadan gerçek öğrenci/veli/finans verisi girilmemelidir.
