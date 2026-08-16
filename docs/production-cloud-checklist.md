# Production Bulut/Hosting Kontrol Listesi

Bu belge, kodun kendisinin garanti edemeyeceği — Supabase Cloud Dashboard, Vercel Dashboard ve GitHub repo ayarlarından **elle** yapılması gereken — adımları listeler. Kod tarafında yapılabilecek her şey için bkz. [`guvenlik-kontrol-listesi.md`](./guvenlik-kontrol-listesi.md) ve [`production-readiness-report.md`](./production-readiness-report.md).

## Durum (2026-08-17 itibarıyla): Production canlı, admin hesabı + smoke testi tamamlandı

Kullanıcının kendi tarayıcı oturumu üzerinden (Claude in Chrome) Supabase Cloud, Vercel ve GitHub'da gerçek adımlar atıldı — aşağıdaki liste artık büyük kısmı **fiilen tamamlanmış** durumu yansıtıyor, salt planlama değil:

- **Production Supabase projesi:** `egitim-kurum-yonetim-prod`, ref `kdykfuiedtsztxbpnnns`, Frankfurt (`eu-central-1`), **Free plan**. Tüm 61 migration uygulandı, `pg_cron` işi (`monthly-generation-daily-sweep`) aktif, Storage bucket görünürlükleri doğrulandı.
- **İlk admin hesabı oluşturuldu ve doğrulandı:** `furkan.kucukkiris@gmail.com`, TOTP MFA kurulu (`status: verified`). Not: ilk deneme yanlışlıkla `localhost`'un işaret ettiği staging (`-dev`) projesinde yapılmıştı, gerçek production projesinde hesap oluşturulunca düzeltildi.
- **Production hosting:** Vercel, proje `egitim-kurum-yonetim`, adres **`https://egitim-kurum-yonetim.vercel.app`**. `main` dalından otomatik deploy edildi, `/giris` ve `/api/health` canlıda doğrulandı, security header'lar `curl -I` ile production URL'sinde teyit edildi.
- **Ortam ayrımı kuruldu:** Vercel'de 3 Supabase değişkeni (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) **Production** kapsamına production değerleriyle, **ayrıca Preview** kapsamına staging (`-dev`) değerleriyle **ayrı ayrı** girildi — Preview asla production'a bağlanamaz.
- **Supabase Auth:** "Allow new users to sign up" kapatıldı, Site URL gerçek Vercel adresine ayarlandı, redirect allowlist'e yalnızca bu adres eklendi, TOTP MFA varsayılan olarak zaten açıktı.
- **GitHub repository ayarları tamamlandı:** Dependency graph + Dependabot alerts + Dependabot security updates açıldı; `main` için branch protection kuralı (yalnızca force-push/silme engeli, PR zorunlu değil — bilinçli tercih, bkz. bölüm 6) oluşturuldu; Secret/Push protection zaten açıktı. Vercel hesap 2FA'sı zaten aktif olduğu doğrulandı.
- **Production smoke testi (bölüm 5) 8/10 madde tamamlandı** — kalan 2 madde (signed URL foto testi, teacher-hesabıyla canlı erişim testi) kullanıcı kararıyla gerçek veri girişine kadar ertelendi.
- **Bilinçli olarak yapılmayan/ertelenen:** Production Supabase **Free plan'da** — kullanıcı, Pro plan'a (kart bilgisi girişi gerektirdiği için) geçişi ertelemeyi seçti; bu karar artık gerçek ölçümle rakamsal temelli (200 öğrenciye kadar yıllarca kapasite yeterli, bkz. `production-readiness-report.md` bölüm 10). Bu, **günlük otomatik yedek ve PITR'ın şu an kapalı olduğu** anlamına geliyor — bkz. [`yedekleme-ve-geri-yukleme.md`](./yedekleme-ve-geri-yukleme.md). Gerçek öğrenci/veli verisi girilmeden önce bu karar gözden geçirilmeli.
- **Henüz yapılmayanlar:** custom domain, staging smoke testi (bölüm 3, 22 madde), restore tatbikatı.

Aşağıdaki liste bu güncel duruma göre işaretlendi; işaretli olmayan maddeler hâlâ gerçek bir eylem gerektiriyor.

## Mimari kararı: staging ortamı

Kullanıcı henüz hosting/domain kurmadığından ve karar bu görevde bırakıldığından, en düşük sürtünmeli ve en az yeni hesap/proje gerektiren kurulum seçildi:

- **Staging Supabase projesi = mevcut `egitim-kurum-yonetim-dev` projesi** (ref `qhvezujyuckxkvietlyi`, zaten linked, migration'lar zaten güncel). Yeni bir üçüncü proje açmak yerine, zaten var olan ve disposable/test amaçlı kullanılan bu proje staging rolünü üstlenir. Production verisi asla bu projeye girmez.
- **Production Supabase projesi = yeni, sıfırdan oluşturulacak ayrı bir proje** (bkz. aşağı).
- **Hosting = Vercel**, tek proje, iki ortam ayrımıyla:
  - **Production environment** (yalnızca `main` dalı) → **production** Supabase projesinin URL/anahtarları.
  - **Preview environment** (main dışındaki her dal/PR) → **staging** (`-dev`) Supabase projesinin URL/anahtarları.

  Bu ayrım kritik: Vercel'de ortam değişkenleri Production/Preview/Development için AYRI AYRI tanımlanır — production anahtarları Preview kapsamına hiç girilmezse, bir PR preview'ı **yapısal olarak** production veritabanına bağlanamaz (README madde 7'nin "Preview deployment'ların production Supabase'e bağlanmasını engelle" şartı, kodda değil Vercel'in kendi ortam izolasyonunda karşılanır).
- **Domain: şimdilik yok.** Production ve staging, Vercel'in verdiği `*.vercel.app` adresleriyle yayınlanır. Custom domain (`yonetim.alanadiniz.com` gibi) bir alan adı satın alındığında ayrı, sonraki bir adım olarak eklenir (bkz. aşağıdaki "Sonradan: custom domain" bölümü) — domain satın alma bir ödeme işlemi olduğundan bu kullanıcı tarafından yapılmalıdır.
- Daha sonra staging'i production'dan tamamen ayrı, temiz bir üçüncü Supabase projesine taşımak istenirse, aşağıdaki "1. Supabase Cloud — Production projesi" adımları aynen tekrarlanıp yalnızca Vercel Preview ortam değişkenleri yeni projeye çevrilir.

---

## 1. Supabase Cloud — Production projesi

- [x] Yeni bir Supabase Cloud projesi oluşturuldu: **`egitim-kurum-yonetim-prod`**, ref **`kdykfuiedtsztxbpnnns`**, `-dev` projesinden ayrı.
- [x] `supabase link --project-ref kdykfuiedtsztxbpnnns` ile bağlandı (iş bitince CLI tekrar `-dev`'e relink edildi, yanlışlıkla prod'a komut gitmesin diye).
- [x] `supabase db push` ile tüm 61 migration hatasız uygulandı.
- [x] `supabase db push --dry-run` `"Remote database is up to date."` verdi (bekleyen migration yok).
- [x] `pg_cron` extension'ı yetki hatası vermeden otomatik oluştu — Dashboard'dan elle açmaya gerek kalmadı.
- [x] `select jobname, schedule, active from cron.job;` ile `monthly-generation-daily-sweep` işi listelendi (`0 1 * * *`, `active: true`).
- [x] Production'a **hiç** `seed.sql` uygulanmadı — `select count(*) from organizations/profiles` ile 0/0 doğrulandı.
- [ ] RLS tüm tablolarda açık — migration'lar garanti ediyor, ama Dashboard üzerinden rastgele birkaç tabloda elle teyit edilmedi (kod incelemesiyle güvenilir kabul edildi).
- [ ] Finansal tablolarda `authenticated`'a doğrudan yazma grant'i olmadığı bu spesifik production projesinde elle sorgulanmadı (migration'lar garanti ediyor, `-dev` ve CI'da defalarca test edildi).
- [ ] `service_role` dışındaki rollerin otomasyon fonksiyonlarını çağıramadığı bu projede elle sorgulanmadı (migration garantisi).

### Authentication

- [x] Dashboard → Authentication → Sign In / Providers → **"Allow new users to sign up" KAPATILDI**.
- [x] TOTP MFA (App Authenticator) — Dashboard → Authentication → Multi-Factor'da **varsayılan olarak zaten "Enabled"** geldi, ekstra işlem gerekmedi.
- [ ] Admin MFA kurtarma prosedürü: authenticator + kurtarma kodu birlikte kaybedilirse Dashboard → Authentication → Users → Factors'tan manuel silme yetkisi kullanıcının kendisinde (proje sahibi) — ayrıca yazılı bir prosedür/ikinci sorumlu henüz kayıt altına alınmadı.
- [x] Dashboard → Authentication → Rate Limits gözden geçirildi — Supabase'in makul varsayılanları (30 req/5dk sign-in, 150 req/5dk token refresh vb.), bu ölçekteki bir kurum için değiştirmeye gerek görülmedi.
- [x] **Site URL** gerçek production adresine ayarlandı: `https://egitim-kurum-yonetim.vercel.app`.
- [x] **Redirect URL allowlist**'e yalnızca `https://egitim-kurum-yonetim.vercel.app/**` eklendi (Total URLs: 1) — gereksiz wildcard yok. Staging (`-dev`) projesinin kendi Site URL/redirect ayarları bu görevde değiştirilmedi.

### Storage

| Bucket | Beklenen görünürlük | Durum |
|---|---|---|
| `organization-logos` | public (kasıtlı) | ✅ doğrulandı |
| `student-photos` | **private** | ✅ doğrulandı |
| `bank-deposit-receipts` | **private** | ✅ doğrulandı |
| `expense-documents` | **private** | ✅ doğrulandı |

- [x] `select id, public from storage.buckets` ile 4 bucket'ın görünürlüğü sorgulanıp yukarıdaki tabloyla birebir doğrulandı.
- [x] Signed URL süreleri kodda kısa (600 sn) — bu değişmedi, Dashboard'da bunu geçersiz kılan bir proje ayarı yok.
- [ ] Teacher rolüyle gerçek bir girişle signed URL üretilemediği / admin tarafında gerçek dosya yüklemesiyle signed URL görüntülemenin canlı testi — **kullanıcı kararıyla ertelendi** (2026-08-17): bucket privacy + kod yolu CI kanıtı yeterli sayıldı, gerçek veri girişiyle birlikte doğal olarak teyit edilecek.

### Database backups

- [ ] **Production Free plan'da — günlük otomatik yedek ve PITR şu an KAPALI.** Kullanıcı, Pro plan'a geçişi (kart bilgisi gerektirdiği için) bilinçli olarak erteledi — bu karar artık gerçek ölçümle rakamsal temelli (bkz. `production-readiness-report.md` bölüm 10: 200 öğrenciye kadar Free plan DB/storage kapasitesi yıllarca yeterli). Kapasite sorunu değil ama gerçek veri kaybı riski hâlâ açık; gerçek öğrenci/veli/finans verisi girilmeden önce bu karar mutlaka gözden geçirilmeli — [`yedekleme-ve-geri-yukleme.md`](./yedekleme-ve-geri-yukleme.md)'ye tarih/plan notu düşülmedi çünkü henüz bir yedek planı yok.
- [ ] En az bir staging geri yükleme tatbikatı [`yedekleme-ve-geri-yukleme.md`](./yedekleme-ve-geri-yukleme.md)'deki "Test kaydı" tablosuna gerçek tarih/süre/sonuçla yazılmadan production onayı verilmedi.

---

## 2. Vercel hosting kurulumu

- [x] Vercel hesabı GitHub ile oluşturuldu/giriş yapıldı, `furkankucukkiris/egitim-kurum-yonetim` reposu import edildi (proje: `egitim-kurum-yonetim`, team: `furkankucukkiris-projects`, Hobby plan).
- [x] **Production Branch** = `main` (Vercel varsayılanı, projenin git default branch'i — import ekranında "main" olarak gösterildi).
- [ ] Node.js sürümü Vercel proje ayarlarından elle teyit edilmedi (Vercel'in kendi build image varsayılanına güvenildi — build başarılı oldu, sorun çıkmadı).
- [x] **Environment Variables** ekranında dört değişken **Production** kapsamına production Supabase proje değerleriyle girildi:
  - `NEXT_PUBLIC_SUPABASE_URL` = `https://kdykfuiedtsztxbpnnns.supabase.co`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY` (Sensitive işaretli, asla `NEXT_PUBLIC_` öneki yok)
  - `NEXT_PUBLIC_INSTITUTION_NAME` = "Özel Şermin Şahin Kişisel Gelişim Kursu" (Production ve Preview ortak — hassas değil)
- [x] Aynı üç Supabase değişkeni **yalnızca Preview** kapsamına, staging (`-dev`, ref `qhvezujyuckxkvietlyi`) proje değerleriyle **ayrıca** girildi — "Environments" seçiminde Production kutucuğu bilinçli olarak kaldırılıp yalnızca Preview bırakıldı, Production değerleriyle KARIŞTIRILMADI.
- [x] İlk production deploy'u (PR #13'ün merge commit'i, `main`) başarıyla tamamlandı, `https://egitim-kurum-yonetim.vercel.app/giris` ve `/api/health` (`{"status":"ok"}`) canlıda doğrulandı.
- [ ] Bir test PR'ı açılıp oluşan Preview deployment'ının **staging** Supabase'e bağlandığı (production'a değil) henüz canlı doğrulanmadı — env değişkenleri doğru ayrılmış olsa da bir sonraki gerçek PR'da teyit edilmeli.
- [x] HTTP → HTTPS yönlendirmesi ve TLS — `https://egitim-kurum-yonetim.vercel.app` tarayıcıdan sorunsuz açıldı (Vercel varsayılanı, `*.vercel.app` için otomatik).
- [x] HSTS — Vercel varsayılan domainlerinde otomatik; custom domain eklendiğinde tekrar teyit edilmeli (bkz. aşağı).
- [x] Vercel hesabına 2FA — `vercel.com/account/settings/authentication` sayfasından sorgulanıp doğrulandı: **Two-Factor Authentication: Active**, Authenticator App (TOTP) enrolled.

### Sonradan: custom domain

Bir alan adı satın alındığında:

- [ ] `management.<alanadiniz>` veya `yonetim.<alanadiniz>` gibi bir alt alan adı, DNS sağlayıcısında Vercel'in verdiği hedefe **CNAME** kaydıyla bağlandı (Vercel proje → Settings → Domains ekranındaki tam talimat izlenmeli).
- [ ] Apex domain (`alanadiniz.com`) ve `www` için yönlendirme kararı (örn. apex → tanıtım sitesi, `www` → apex'e 301) belgelendi.
- [ ] Custom domain bağlandıktan sonra Supabase Auth **Site URL** ve **Redirect allowlist** bu yeni adrese güncellendi (üstteki madde hâlâ eski `*.vercel.app` adresini gösteriyor olabilir).
- [ ] TLS sertifikasının yeni domain için geçerli olduğu ve HSTS'in aktif olduğu teyit edildi.
- [ ] **Not (README'ye de yazılmalı):** yönetim uygulamasının bir alt alan adında çalışması tek başına güvenlik sağlamaz — asıl güvenlik Auth/MFA/RLS/server-side yetkilendirmeden gelir; domain yalnızca erişim kolaylığı/kurumsal görünürlüktür.

---

## 3. Staging smoke testi

Staging (Vercel Preview + `-dev` Supabase) üzerinde, production onayından önce aşağıdakiler test edilmeli. Erişim varsa gerçek tarayıcıdan yapılıp sonuç bu listeye not edilmeli; erişim yoksa bu liste uygulanabilir bir kontrol listesi olarak kalır.

- [ ] İlk admin hesabı oluşturma (`/kurulum`)
- [ ] Admin MFA kurulumu ve doğrulaması
- [ ] MFA kurtarma kodu akışı
- [ ] Öğretmen hesabı oluşturma (geçici parola üretimi)
- [ ] Öğretmenin geçici parolayla girişi ve zorunlu parola değişikliği
- [ ] Öğretmenin yalnızca kendi panelini/nav öğelerini gördüğü
- [ ] Öğrenci ve veli oluşturma
- [ ] Öğrenci fotoğrafı yükleme (private storage'a)
- [ ] Ders ve program (class group) oluşturma
- [ ] Oturum (lesson session) üretme
- [ ] Yoklama alma ve kilitleme (`mark_attendance` + `unlock_session_attendance`)
- [ ] Tahakkuk üretme
- [ ] Nakit ödeme alma → kasa hareketinin (`cash_movements`) oluştuğu
- [ ] Bankaya yatırma ve dekont yükleme
- [ ] Gider oluşturma ve belge yükleme
- [ ] Öğretmen hak edişi üretme (`generate_teacher_compensation`)
- [ ] WhatsApp mesajının gerçek adapter yapılandırılmadan "gönderildi" GÖRÜNMEDİĞİ (`src/lib/whatsapp/adapter.ts` — placeholder/no-op adapter'ın sessizce başarı döndürmediği teyit edilmeli)
- [ ] Deneme dersinin (varsa "trial" durumundaki kayıt) tahakkuk VE MEB yoklaması ÜRETMEDİĞİ
- [ ] Bekleme listesindeki (`bekleme-listesi`) kaydın `enrollments` sayılmadığı — dashboard finans özetini etkilemediği
- [ ] Teacher hesabıyla: finans ekranları (`/odemeler`, `/giderler`, `/hakedis`), veli/öğrenci detayları, `/kurum-ayarlari/denetim-kayitlari` ve private Storage bucket'larına erişilemediği (`/yetkisiz`'e yönlendiği veya nav'da hiç görünmediği)
- [ ] Aylık otomasyonun (`run_daily_automation_sweep` / Kurum Ayarları → Otomasyon → "Yeniden dene") kontrollü şekilde manuel çalıştırılması

---

## 4. Production yayın sırası

1. ✅ Production Supabase projesini oluştur (bkz. bölüm 1).
2. ✅ Auth (signup kapatma, Site URL, redirect), MFA (varsayılan açık), rate limit (gözden geçirildi, değiştirilmedi) ayarlarını yap.
3. ✅ `supabase db push` ile migration'ları uygula, `--dry-run` ile doğrula.
4. ✅ Storage bucket görünürlüklerini doğrula.
5. ✅ `pg_cron` işini (`monthly-generation-daily-sweep`) doğrula.
6. ⏸️ Günlük yedek/PITR durumunu Dashboard'dan doğrula ve not et — **ertelendi** (Free plan, bkz. bölüm 1 "Database backups").
7. ✅ Vercel hosting projesini oluştur (bkz. bölüm 2).
8. ✅ Production environment değişkenlerini (4 değişken) Vercel'e gir.
9. ✅ `main` dalını deploy et — branch protection kuruldu (bkz. bölüm 6), CI yeşildi (PR #13).
10. ⏸️ (Alan adı alındığında) yönetim alt alan adını bağla — şimdilik `*.vercel.app` ile devam ediliyor.
11. ✅ HTTPS/TLS production URL'sinde doğrulandı; CSP/diğer header'lar hem CI'daki `e2e/security-headers.spec.ts` ile hem de production URL'sinde `curl -I` ile doğrulandı.
12. ✅ İlk admin kullanıcısı gerçek production Supabase projesinde oluşturuldu (e-posta + parola, auto-confirm).
13. ✅ O kullanıcıyla `https://egitim-kurum-yonetim.vercel.app/giris` üzerinden giriş yapılıp `/kurulum` akışı tamamlandı.
14. ✅ MFA kurulumu tamamlandı (`auth.mfa_factors`'ta `status: verified` olarak doğrulandı).
15. ✅ Aşağıdaki "Production smoke testi" yapıldı — 8/10 madde, 2 madde kullanıcı kararıyla ertelendi (bkz. bölüm 5).
16. ⬜ İkinci bir admin veya en azından "authenticator+kurtarma kodu ikisi de kaybolursa Supabase Dashboard'dan factor silme yetkisi kimde" prosedürünü yazılı olarak kaydet.
17. ⬜ Gerçek öğrenci/veli verisi girilmeden önce: staging smoke testi (bölüm 3) ve restore tatbikatı hâlâ açık, backup planı kararı gözden geçirilmeli (bkz. `production-readiness-report.md` bölüm 15).

## 5. Production smoke testi

Veri silmeyen, minimum veri oluşturan bir kontrol. **2026-08-17'de gerçek production'da yapıldı:**

- [x] Admin girişi
- [x] MFA doğrulaması
- [x] Dashboard (`/`) açılması
- [x] Bir test öğretmeni oluşturma ve ardından pasife alma (`SMOKE TEST Öğretmen`)
- [x] Bir test öğrenci kaydı oluşturma ve ardından arşivleme (`SMOKE TEST`, geçerli-checksum'lı sentetik T.C. no ile)
- [ ] Private Storage erişiminin (signed URL ile öğrenci fotoğrafı görüntüleme) çalıştığının doğrulanması — **kullanıcı kararıyla ertelendi**, bkz. bölüm 1 "Storage"
- [ ] Teacher hesabıyla (varsa ayrı bir test öğretmen hesabıyla) admin ekranlarına erişilemediğinin doğrulanması — **kullanıcı kararıyla ertelendi**, mevcut RLS/rol testleri yeterli kanıt sayıldı
- [x] SQL Editor'dan `select * from cron.job;` ile cron işinin varlığının doğrulanması
- [x] `curl -I https://egitim-kurum-yonetim.vercel.app/giris` ile güvenlik header'larının (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, HSTS) döndüğü doğrulandı
- [x] Hosting loglarında (Vercel → Logs) parola/token/TC kimlik no/telefon/e-posta/service-role/belge URL'si gibi hassas veri GEÇMEDİĞİ örnekleme ile kontrol edildi — temiz, yalnızca Supabase SDK'nın bilinen `getSession()` uyarısı görüldü

**Production üzerinde KESİNLİKLE çalıştırılmaz:** `supabase db reset`, `seed.sql`, admin bootstrap E2E paketi, toplu test verisi üretimi, veri silen/şemayı yeniden oluşturan herhangi bir script (`scripts/reset-all-data.sql` dahil — bu script yalnızca geliştirme/staging için, dosyanın kendi başlığında "GERİ ALINAMAZ" uyarısıyla işaretli).

---

## 6. GitHub repository ayarları — tamamlandı (2026-08-17)

Bu depoda `gh` CLI/token erişimi yok — aşağıdakiler Claude in Chrome üzerinden Settings ekranından yapıldı. Branch protection kararı README'deki "tam koruma" önerisinden **bilinçli olarak saptı** — kullanıcı tek geliştiricili bu repoda PR zorunluluğu istemedi, sadece force-push/silme engeli kuruldu.

- [x] **Settings → Code security and analysis → Dependency graph** açık.
- [x] **Settings → Code security and analysis → Dependabot alerts** açık.
- [x] **Settings → Code security and analysis → Dependabot security updates** açık.
- [x] **Secret scanning + Push protection** — zaten açıktı (public repo varsayılanı), ek işlem gerekmedi.
- [x] `.github/dependabot.yml` merge sonrası ilk taramayı otomatik başlattı — Dependabot 4 gerçek PR açtı (#9-12), canlı doğrulandı.
- [x] `.github/workflows/codeql.yml` — CodeQL PR'larda gerçekten koştu ve yeşil geçti, ek Advanced Security izni sorunu çıkmadı.
- [x] **Branch protection** — `main` için classic rule oluşturuldu: yalnızca "Allow force pushes" ve "Allow deletions" kapalı (varsayılan), "Require a pull request before merging" ve "Require status checks" **bilinçli olarak açılmadı**. GitHub sudo-mode doğrulama kodu istediği için kural oluşturma adımı kullanıcı tarafından tamamlandı.
- [ ] Branch protection kuralına `CodeQL Analiz` status check olarak eklenmesi (opsiyonel, PR-zorunluluğu olmadığı için şu an anlamsız — yalnızca ileride PR akışına geçilirse tekrar değerlendirilmeli).
