# Production Bulut/Hosting Kontrol Listesi

Bu belge, kodun kendisinin garanti edemeyeceği — Supabase Cloud Dashboard, Vercel Dashboard ve GitHub repo ayarlarından **elle** yapılması gereken — adımları listeler. Kod tarafında yapılabilecek her şey için bkz. [`guvenlik-kontrol-listesi.md`](./guvenlik-kontrol-listesi.md) ve [`production-readiness-report.md`](./production-readiness-report.md).

## Durum (2026-08-16 itibarıyla): Production canlı

Kullanıcının kendi tarayıcı oturumu üzerinden (Claude in Chrome) Supabase Cloud ve Vercel'de gerçek adımlar atıldı — aşağıdaki liste artık bir kısmı **fiilen tamamlanmış** durumu yansıtıyor, salt planlama değil:

- **Production Supabase projesi:** `egitim-kurum-yonetim-prod`, ref `kdykfuiedtsztxbpnnns`, Frankfurt (`eu-central-1`), **Free plan**. Tüm 61 migration uygulandı, `pg_cron` işi (`monthly-generation-daily-sweep`) aktif, Storage bucket görünürlükleri doğrulandı, veritabanı tamamen boş (0 kurum/profil — seed yok).
- **Production hosting:** Vercel, proje `egitim-kurum-yonetim`, adres **`https://egitim-kurum-yonetim.vercel.app`**. `main` dalından otomatik deploy edildi, `/giris` ve `/api/health` canlıda doğrulandı.
- **Ortam ayrımı kuruldu:** Vercel'de 3 Supabase değişkeni (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) **Production** kapsamına production değerleriyle, **ayrıca Preview** kapsamına staging (`-dev`) değerleriyle **ayrı ayrı** girildi — Preview asla production'a bağlanamaz.
- **Supabase Auth:** "Allow new users to sign up" kapatıldı, Site URL gerçek Vercel adresine ayarlandı, redirect allowlist'e yalnızca bu adres eklendi, TOTP MFA varsayılan olarak zaten açıktı.
- **Bilinçli olarak yapılmayan/ertelenen:** Production Supabase **Free plan'da** — kullanıcı, Pro plan'a (kart bilgisi girişi gerektirdiği için) geçişi şimdilik ertelemeyi seçti. Bu, **günlük otomatik yedek ve PITR'ın şu an kapalı olduğu** anlamına geliyor — bkz. [`yedekleme-ve-geri-yukleme.md`](./yedekleme-ve-geri-yukleme.md). Gerçek öğrenci/veli verisi girilmeden önce bu karar gözden geçirilmeli.
- **Henüz yapılmayanlar:** ilk admin hesabının Supabase Dashboard'dan oluşturulup `/kurulum` akışının tamamlanması (bilinçli olarak kullanıcıya bırakıldı — kurumun gerçek admin kimliği), custom domain, GitHub branch protection/Dependabot alerts/secret scanning ayarları, restore tatbikatı.

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
- [ ] Teacher rolüyle gerçek bir girişle signed URL üretilemediği bu production projesinde **henüz test edilmedi** (henüz hiçbir kullanıcı hesabı yok — ilk admin bile oluşturulmadı).

### Database backups

- [ ] **Production Free plan'da — günlük otomatik yedek ve PITR şu an KAPALI.** Kullanıcı, Pro plan'a geçişi (kart bilgisi gerektirdiği için) şimdilik bilinçli olarak erteledi. Gerçek öğrenci/veli/finans verisi girilmeden önce bu karar mutlaka gözden geçirilmeli — [`yedekleme-ve-geri-yukleme.md`](./yedekleme-ve-geri-yukleme.md)'ye tarih/plan notu düşülmedi çünkü henüz bir yedek planı yok.
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
- [ ] Vercel hesabına 2FA (authenticator app) kurulumu kullanıcıya soruldu — kullanıcı "done" dedi ama ekran görüntüsüyle teyit edilmedi, hesap güvenliği için önerilir.

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
9. ✅ `main` dalını deploy et — **branch protection henüz kurulmadı** (bkz. bölüm 6), CI yeşildi (PR #13).
10. ⏸️ (Alan adı alındığında) yönetim alt alan adını bağla — şimdilik `*.vercel.app` ile devam ediliyor.
11. ✅ HTTPS/TLS production URL'sinde doğrulandı; CSP/diğer header'lar CI'daki `e2e/security-headers.spec.ts` ile doğrulanıyor (production URL'sinde `curl -I` ile ayrıca teyit edilmedi).
12. **⬜ SIRADA — kullanıcı tarafından yapılmalı:** İlk admin kullanıcısını Supabase Dashboard → Authentication → Users'tan oluştur (e-posta + parola) — kurumun gerçek yönetici kimliği olduğu için bilinçli olarak kullanıcıya bırakıldı.
13. ⬜ O kullanıcıyla `https://egitim-kurum-yonetim.vercel.app/giris` üzerinden giriş yapıp `/kurulum` akışını tamamla.
14. ⬜ MFA kurulumunu tamamla, kurtarma kodunu güvenli bir yere kaydet.
15. ⬜ Aşağıdaki "Production smoke testi"ni yap.
16. ⬜ İkinci bir admin veya en azından "authenticator+kurtarma kodu ikisi de kaybolursa Supabase Dashboard'dan factor silme yetkisi kimde" prosedürünü yazılı olarak kaydet.
17. ⬜ Gerçek öğrenci/veli verisi ancak yukarıdaki TÜM adımlar (ve bölüm 6'daki GitHub ayarları) başarılıysa girilmeye başlanır.

## 5. Production smoke testi

Veri silmeyen, minimum veri oluşturan bir kontrol:

- [ ] Admin girişi
- [ ] MFA doğrulaması
- [ ] Dashboard (`/`) açılması
- [ ] Bir test öğretmeni oluşturma ve ardından pasife alma
- [ ] Bir test öğrenci kaydı oluşturma ve ardından arşivleme
- [ ] Private Storage erişiminin (signed URL ile öğrenci fotoğrafı görüntüleme) çalıştığının doğrulanması
- [ ] Teacher hesabıyla (varsa ayrı bir test öğretmen hesabıyla) admin ekranlarına erişilemediğinin doğrulanması
- [ ] SQL Editor'dan `select * from cron.job;` ile cron işinin varlığının doğrulanması
- [ ] `curl -I https://<production-adresi>/giris` ile güvenlik header'larının (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, HSTS) döndüğünün doğrulanması
- [ ] Hosting loglarında (Vercel → Logs) parola/token/TC kimlik no/telefon/e-posta/service-role/belge URL'si gibi hassas veri GEÇMEDİĞİNİN örnekleme ile kontrolü

**Production üzerinde KESİNLİKLE çalıştırılmaz:** `supabase db reset`, `seed.sql`, admin bootstrap E2E paketi, toplu test verisi üretimi, veri silen/şemayı yeniden oluşturan herhangi bir script (`scripts/reset-all-data.sql` dahil — bu script yalnızca geliştirme/staging için, dosyanın kendi başlığında "GERİ ALINAMAZ" uyarısıyla işaretli).

---

## 6. GitHub repository ayarları

Bu depoda `gh` CLI/token erişimi yok — aşağıdakiler Settings üzerinden elle yapılmalı. Branch protection için gerekli status check adları README "Branch protection" bölümünde listelidir; buraya ek olarak:

- [ ] **Settings → Code security and analysis → Dependabot alerts** açık.
- [ ] **Settings → Code security and analysis → Dependabot security updates** açık.
- [ ] **Settings → Code security and analysis → Secret scanning** açık (kullanılabiliyorsa — bazı planlarda yalnızca public repo'larda ücretsizdir, private repo'da GitHub Advanced Security gerekebilir).
- [ ] `.github/dependabot.yml` (bu görevde eklendi) merge sonrası ilk taramayı otomatik başlatır — ilk PR'ların açıldığı teyit edilmeli (Insights → Dependency graph → Dependabot).
- [ ] `.github/workflows/codeql.yml` (bu görevde eklendi) — **not:** `security-events: write` izniyle sonuç yükler; private repo'da CodeQL'in GitHub Actions'tan sonuç yükleyebilmesi için GitHub Advanced Security'nin etkin olması gerekebilir (public repo'da ek koşul yok). İlk workflow çalışmasının Actions sekmesinde başarılı bittiği ve Security → Code scanning alerts ekranının doldurduğu teyit edilmeli.
- [ ] Branch protection kuralına (README'deki listeye ek olarak) `CodeQL Analiz` de gerekli status check olarak eklenmesi (opsiyonel ama önerilir).
