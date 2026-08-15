# Production Bulut/Hosting Kontrol Listesi

Bu belge, kodun kendisinin garanti edemeyeceği — Supabase Cloud Dashboard, Vercel Dashboard ve GitHub repo ayarlarından **elle** yapılması gereken — adımları listeler. Hiçbiri bu oturumda otomatik uygulanmadı (bu depodan Supabase/Vercel/GitHub'a programatik erişim yok); her madde production onayından önce elle işaretlenmelidir. Kod tarafında yapılabilecek her şey için bkz. [`guvenlik-kontrol-listesi.md`](./guvenlik-kontrol-listesi.md) ve [`production-readiness-report.md`](./production-readiness-report.md).

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

- [ ] Yeni bir Supabase Cloud projesi oluşturuldu (Production, `-dev` projesinden **ayrı**).
- [ ] `supabase link --project-ref <production-ref>` ile bu repo (ayrı bir yerel checkout'ta veya CI'da, `-dev` linkiyle karıştırılmadan) bağlandı.
- [ ] `supabase db push` ile tüm migration'lar uygulandı.
- [ ] `supabase db push --dry-run` boş çıktı verdi (bekleyen migration yok).
- [ ] `create extension pg_cron` yetki hatası verdiyse Dashboard → Database → Extensions'tan elle etkinleştirildi, push tekrar çalıştırıldı.
- [ ] SQL Editor'dan `select * from cron.job;` ile `monthly-generation-daily-sweep` işi listelendi.
- [ ] Production'a **hiç** `seed.sql` uygulanmadı (`db push` seed çalıştırmaz — yalnızca `db reset` çalıştırır, bu komut production'da asla kullanılmamalı).
- [ ] RLS tüm tablolarda açık (migration'lar bunu zaten garanti ediyor — `supabase db diff` veya Dashboard → Database → Tables üzerinden rastgele birkaç tabloda "RLS enabled" teyit edilebilir).
- [ ] Finansal tablolarda (`payments`, `accruals`, `cash_movements`, `bank_deposits`, `expenses`, `teacher_work_logs` vb.) `authenticated` rolüne doğrudan insert/update/delete grant'i olmadığı doğrulandı — README bölüm 8-10'daki "yalnızca RPC üzerinden yazma" tasarımının canlıda da geçerli olduğunun teyidi.
- [ ] `service_role` dışındaki hiçbir rol `run_monthly_automation_job()` gibi otomasyon fonksiyonlarını doğrudan çağıramıyor (fonksiyon grant'i zaten migration'da `service_role`'e kısıtlı — Dashboard → Database → Functions'tan teyit edilebilir).

### Authentication

- [ ] Dashboard → Authentication → Providers → Email → **"Allow new users to sign up" KAPALI**.
- [ ] E-posta/parola sağlayıcısı yalnızca mevcut hesapların girişine izin verecek şekilde (yukarıdaki maddeyle birlikte) yapılandırıldı.
- [ ] TOTP MFA enroll/verify etkin — Dashboard → Authentication → Providers → MFA altında TOTP açık (bu depoda migration `32a45dc`'de yerel/CI için açıkça etkinleştirilmişti; production projesinde varsayılan olarak açık olması beklenir ama **elle teyit edilmeli**).
- [ ] Admin MFA kurtarma prosedürü tanımlı: normal yol uygulama içindeki kurtarma kodu (`/mfa-kurtar`); authenticator VE kurtarma kodu birlikte kaybedilirse, Supabase Dashboard → Authentication → Users → ilgili kullanıcı → Factors sekmesinden manuel factor silme yetkisinin kimde olduğu (proje sahibi/organizasyon üyeleri) not edildi.
- [ ] Dashboard → Authentication → Rate Limits — platform seviyesi login rate limit'leri gözden geçirildi (uygulama seviyesindeki `login_attempts` kısıtının yerine geçmez, ek katman).
- [ ] **Site URL** gerçek yönetim paneli adresine ayarlandı (`https://<vercel-production-domain>`).
- [ ] **Redirect URL allowlist** yalnızca şunları içeriyor: `http://localhost:3000/*` (yerel geliştirme), staging Vercel Preview adresi, production adresi. Gereksiz wildcard (`https://*.vercel.app/*` gibi geniş bir joker) YOK.

### Storage

| Bucket | Beklenen görünürlük |
|---|---|
| `organization-logos` | public (kasıtlı) |
| `student-photos` | **private** |
| `bank-deposit-receipts` | **private** |
| `expense-documents` | **private** |

- [ ] Dashboard → Storage'dan yukarıdaki 4 bucket'ın görünürlüğü teyit edildi — yalnızca `organization-logos` public.
- [ ] Signed URL süreleri kodda kısa (600 sn, `src/lib/supabase/*`'te tanımlı) — Dashboard'da bunu geçersiz kılan bir proje ayarı olmadığı teyit edildi.
- [ ] Teacher rolüyle giriş yapılıp `student-photos`/`bank-deposit-receipts`/`expense-documents` için signed URL üretilemediği (RLS/RPC seviyesinde zaten engelli — bkz. README bölüm 8) staging'de test edildi.

### Database backups

- [ ] Dashboard → Database → Backups — planın günlük otomatik yedeği içerdiği teyit edildi, tarih/plan bilgisi [`yedekleme-ve-geri-yukleme.md`](./yedekleme-ve-geri-yukleme.md) dosyasına not edildi.
- [ ] PITR (Point-in-Time Recovery) durumu (açık/kapalı, ek ücretli) teyit edilip aynı dosyaya not edildi.
- [ ] En az bir staging geri yükleme tatbikatı [`yedekleme-ve-geri-yukleme.md`](./yedekleme-ve-geri-yukleme.md)'deki "Test kaydı" tablosuna gerçek tarih/süre/sonuçla yazılmadan production onayı verilmedi.

---

## 2. Vercel hosting kurulumu

- [ ] Vercel hesabı/organizasyonu oluşturuldu, bu GitHub repo'suna bağlı yeni bir proje oluşturuldu.
- [ ] **Production Branch** proje ayarlarından `main` olarak sabitlendi (Settings → Git → Production Branch).
- [ ] Node.js sürümü Vercel proje ayarlarında 20.x (README madde 1'deki gereksinimle uyumlu) olarak ayarlandı.
- [ ] **Environment Variables** ekranında dört değişken **Production** kapsamına yalnızca production Supabase proje değerleriyle girildi:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY` (yalnızca Production/Preview'da — asla `NEXT_PUBLIC_` öneki yok, "Sensitive" işaretlendi)
  - `NEXT_PUBLIC_INSTITUTION_NAME`
- [ ] Aynı dört değişken **Preview** kapsamına, bu kez staging (`-dev`) Supabase proje değerleriyle ayrıca girildi — Production değerleriyle KARIŞTIRILMADI (bkz. yukarıdaki mimari kararı).
- [ ] Bir test PR'ı açılıp oluşan Preview deployment URL'sinden `/api/health`'e istek atılarak deployment'ın ayakta olduğu, ve (varsa) `/giris`'te CSP header'ının döndüğü doğrulandı.
- [ ] HTTP → HTTPS yönlendirmesi (Vercel varsayılanı) ve TLS sertifikasının geçerli olduğu tarayıcıdan teyit edildi.
- [ ] HSTS — Vercel varsayılan domainlerinde (`*.vercel.app`) otomatik HTTPS + HSTS uygular; custom domain eklendiğinde bu madde tekrar teyit edilmeli (bkz. aşağı).

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

1. Production Supabase projesini oluştur (bkz. bölüm 1).
2. Auth, MFA, rate limit, Site URL ve redirect ayarlarını yap.
3. `supabase db push` ile migration'ları uygula, `--dry-run` ile doğrula.
4. Storage bucket görünürlüklerini doğrula.
5. `pg_cron` işini (`monthly-generation-daily-sweep`) doğrula.
6. Günlük yedek/PITR durumunu Dashboard'dan doğrula ve not et.
7. Vercel hosting projesini oluştur (bkz. bölüm 2).
8. Production environment değişkenlerini (4 değişken) Vercel'e gir.
9. `main` dalını deploy et (branch protection + CI yeşili şart — bkz. README "Branch protection").
10. (Alan adı alındığında) yönetim alt alan adını bağla — şimdilik `*.vercel.app` ile devam.
11. HTTPS, HSTS, CSP ve diğer header'ları production URL'sinde doğrula (`curl -I` veya tarayıcı devtools).
12. İlk admin kullanıcısını Supabase Dashboard → Authentication → Users'tan oluştur (e-posta + parola).
13. O kullanıcıyla `/giris` üzerinden giriş yapıp `/kurulum` akışını tamamla.
14. MFA kurulumunu tamamla, kurtarma kodunu güvenli bir yere kaydet.
15. Aşağıdaki "Production smoke testi"ni yap.
16. İkinci bir admin veya en azından "authenticator+kurtarma kodu ikisi de kaybolursa Supabase Dashboard'dan factor silme yetkisi kimde" prosedürünü yazılı olarak kaydet.
17. Gerçek öğrenci/veli verisi ancak yukarıdaki TÜM adımlar başarılıysa girilmeye başlanır.

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
