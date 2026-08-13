# Production Güvenlik Kontrol Listesi

Bu liste, sistem gerçek öğrenci/veli/finans verisi taşımaya başlamadan önce ve düzenli aralıklarla (örn. her önemli sürümde) gözden geçirilmelidir. Kod tarafında yapılabilecek her şey yapılmıştır; işaretli olmayan maddeler **Supabase Dashboard'dan elle** yapılması gereken, kodun garanti edemeyeceği adımlardır.

## 1. Supabase Auth / kimlik doğrulama

- [ ] **Production projesinde `Enable email signup` kapalı.** (Dashboard → Authentication → Providers → Email). Yerel `supabase/config.toml`'da `enable_signup = false` zaten kapalı ama bu ayar production'a otomatik senkronize olmaz — Dashboard'dan elle kapatılmalı. *Not: Uygulama kodu hiçbir yerde `auth.signUp()` çağırmıyor ve RLS zaten `organization_id = current_organization_id()`'ye dayandığı için profili olmayan (yani kendi kendine kayıt olmuş) bir kullanıcı hiçbir veriye erişemez — ama bu ayarı da kapatmak savunma derinliği için gereklidir.*
- [x] Kullanıcı hesapları yalnızca admin panelinden (`Öğretmenler` ekranı) veya `bootstrap_first_admin` ile (tek seferlik) oluşturuluyor — kod tarafında doğrulandı.
- [x] Admin girişi için MFA (TOTP) **zorunlu** — `src/lib/auth.ts`'teki `loadProfile()` gate'i, hiç faktör yoksa `/mfa-kur`'a, doğrulanmamış oturumu `/mfa-dogrula`'ya yönlendiriyor. Kurtarma kodu (`admin_mfa_recovery_codes`, hash'li) authenticator kaybı senaryosu için var.
- [ ] Bir admin'in authenticator'ını kaybettiği ve kurtarma kodunu da kaybettiği acil durum senaryosu için: Supabase Dashboard → Authentication → Users → ilgili kullanıcı → "Factors" sekmesinden manuel MFA factor silme yetkisinin kimde olduğunu (Supabase proje sahibi) not edin.
- [x] Giriş rate-limit: `login_attempts` tablosu + `check_login_rate_limit`/`record_login_attempt` RPC'leri — 15 dakikada 5 başarısız denemeden sonra bloklar (`src/app/giris/actions.ts`).
- [ ] Supabase'in kendi platform-seviyesi rate limit'lerini de gözden geçirin (Dashboard → Authentication → Rate Limits) — uygulama seviyesindeki limit bunun yerine geçmez, ek bir katmandır.

## 2. Cookie / session

- [x] Oturum cookie'leri kodda açıkça `httpOnly: true`, `sameSite: "lax"`, ve production'da `secure: true` olarak set ediliyor (`src/lib/supabase/server.ts`, `src/lib/supabase/proxy.ts`) — artık kütüphane varsayılanına bırakılmıyor.
- [x] Pasif (`is_active = false`) bir kullanıcının geçerli bir oturum token'ı olsa da veri göremediği doğrulandı: `current_organization_id()`/`current_app_role()` fonksiyonları `profiles.is_active = true` şartını içeriyor, `is_active = false` olunca bu fonksiyonlar `NULL` döner ve tüm RLS politikaları (`organization_id = current_organization_id()`) hiçbir satır döndürmez.

## 3. HTTP güvenlik başlıkları

- [x] `next.config.ts`'de production-only: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, ve ölçülü bir `Content-Security-Policy`.
- [ ] **Bilinen sınırlama:** CSP `script-src`'de `'unsafe-inline'` var — Next.js App Router'ın nonce'suz hydration bootstrap script'i buna ihtiyaç duyuyor. Daha sıkı bir CSP için middleware üzerinden nonce enjeksiyonu gerekir (mevcut `src/lib/supabase/proxy.ts`'e eklenebilir) — bu, "uygulamayı bozmama" önceliğiyle şimdilik bir sonraki adım olarak not edildi, yapılmadı.
- [ ] Barındırma sağlayıcınız (Vercel/vb.) HSTS'i genelde otomatik ekler — HTTPS zorunluluğunu Dashboard/hosting ayarlarından teyit edin.

## 4. Storage

| Bucket | Görünürlük | Not |
|---|---|---|
| `organization-logos` | **public** | Kasıtlı — kurum logosu hassas değil, oturumsuz gösterilebilmesi gerekiyor. |
| `student-photos` | private | Yalnızca `is_admin()`, signed URL 10 dk. |
| `bank-deposit-receipts` | private | Yalnızca admin, signed URL 10 dk. |
| `expense-documents` | private | Yalnızca admin, signed URL 10 dk. |

- [x] Hassas hiçbir bucket public değil.
- [x] Signed URL süreleri kısa (600 saniye) — tarayıcıda açık kalan bir sekmeden URL kopyalanıp paylaşılsa bile kısa ömürlü.

## 5. Secret yönetimi

- [x] `SUPABASE_SERVICE_ROLE_KEY` hiçbir `NEXT_PUBLIC_` değişkeninde veya client component'te kullanılmıyor (grep ile doğrulandı) — yalnızca `src/lib/supabase/admin.ts` (`"server-only"` importlu) ve üç server action dosyasında.
- [x] `.env.local` git tarafından izlenmiyor (`.gitignore`), `.env.example` yalnızca placeholder içeriyor.
- [x] Repo genelinde gerçek bir JWT/servis anahtarı deseni (`eyJ...`, gerçek `service_role` değeri) bulunamadı — yalnızca değişken adı referansları ve dokümantasyon var.
- [ ] Bu taramayı periyodik olarak tekrarlayın (özellikle commit geçmişine bir şey sızmışsa `git log -p` ile de kontrol edilmeli — bu oturumda yalnızca güncel ağaç tarandı).

## 6. Loglama

- [x] İncelenen `console.error` çağrılarının hiçbiri TC kimlik no, telefon, e-posta gibi kullanıcı verisini loglamıyor — yalnızca Postgres hata nesnesi (`code`, `message`, `details`, `hint`) logluyor.
- [ ] Barındırma sağlayıcınızın log saklama/erişim politikasını (kim görebilir, ne kadar saklanır) gözden geçirin.

## 7. Veri yaşam döngüsü

- [x] Hiçbir fiziksel `DELETE` yok — öğrenci/veli kayıtları `archive_student` ile soft-delete ediliyor.
- [x] KVKK "veri sahibi talebi" akışı var: `/ogrenciler/[studentId]` sayfasında "KVKK işlemleri" bölümü — kişisel veri paketini JSON olarak dışa aktarma + (yalnızca arşivlenmiş öğrenciler için) geri alınamaz anonimleştirme.
- [ ] Bkz. [`veri-saklama-politikasi.md`](./veri-saklama-politikasi.md) ve [`yedekleme-ve-geri-yukleme.md`](./yedekleme-ve-geri-yukleme.md).

## 8. Yetkilendirme (zaten mevcut, bu paketle değişmedi)

- [x] 3 katmanlı model: `requireRole` (sayfa/action) → RLS (`is_admin()`/scoped fonksiyonlar) → security-definer RPC'ler.
- [x] `teacher` rolü `students`/`guardians`/`student_guardians`/`enrollments` tablolarına doğrudan erişemiyor (README'de belgelendi, bu paket bunu değiştirmedi).

---

*Bu liste kod incelemesiyle (2026-08-14) oluşturuldu. Yeni bir modül eklendiğinde veya Supabase proje ayarları değiştiğinde güncellenmelidir.*
