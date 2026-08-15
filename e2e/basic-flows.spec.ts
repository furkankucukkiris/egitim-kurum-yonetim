import { expect, test, type Page } from "@playwright/test";
import * as OTPAuth from "otpauth";
import {
  E2E_ADMIN_EMAIL,
  E2E_ADMIN_FULL_NAME,
  E2E_ADMIN_PASSWORD,
  E2E_ORGANIZATION_NAME,
} from "./fixtures";

// Bu iki akış (admin kurulumu → öğretmen hesabı oluşturma → öğretmen
// girişi) birbirine bağımlı ve sıralı çalışması gerekiyor — aynı dosya
// içinde test.describe.configure({ mode: "serial" }) ile, dosyalar
// arası (alfabetik) sıralamaya güvenmek yerine açıkça garanti ediliyor.
//
// retries: 0 BİLİNÇLİ — playwright.config.ts'teki global CI retry'si
// (1) burada YOK SAYILIYOR. Bu dosyadaki iki test aynı boş veritabanı
// üzerinde paylaşılan state (aynı admin kullanıcı, kapanışta tutulan
// teacherEmail/teacherTemporaryPassword) ile sıralı çalışıyor; ilk
// test (kurulum) yarıda başarısız olup Playwright onu otomatik tekrar
// denerse, ikinci denemede sistemde artık bir kurum/admin/MFA factor'ü
// VAR olur — /kurulum ilk assertion'ında (toHaveURL /\/kurulum/) veya
// zorunlu MFA adımında, asıl hatayı gizleyen, kafa karıştırıcı ikincil
// bir hatayla başarısız olur. Bağımsız/durumsuz E2E dosyaları
// eklenirse onlar için global retry (CI'da 1) korunmaya devam eder —
// bu override yalnızca bu dosyaya özgü.
test.describe.configure({ mode: "serial", retries: 0 });

const teacherEmail = `e2e-ogretmen-${Date.now()}@example.test`;
let teacherTemporaryPassword = "";

test.describe("Admin temel akışı", () => {
  test("ilk kurulum, MFA ve öğretmen hesabı oluşturma", async ({
    page,
  }) => {
    await loginAs(page, E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD);

    // Henüz hiçbir kurum/profil yok → /kurulum'a yönlendirilir. Yanlış bir
    // sayfaya (ör. sistemde zaten bir kurum varsa düşülen /hesap-erisimi)
    // yönlendirilirse bunu heading kontrolünden ÖNCE, mevcut URL'i içeren
    // net bir hatayla yakalıyoruz — aksi halde hata yalnızca "heading
    // bulunamadı" der ve asıl neden (yanlış yönlendirme) gizlenir.
    await expect(page, `Beklenmeyen URL: ${page.url()}`).toHaveURL(/\/kurulum/);
    await expect(page.getByRole("heading", { name: "Kurum hesabını oluşturun" })).toBeVisible();

    await page.getByLabel("Kurum adı").fill(E2E_ORGANIZATION_NAME);
    await page.getByLabel("Yönetici adı soyadı").fill(E2E_ADMIN_FULL_NAME);
    await page.getByRole("button", { name: "Kurulumu tamamla" }).click();

    // Admin + hiç MFA factor'ü yok → /mfa-kur'a zorunlu yönlendirme.
    await expect(
      page.getByRole("heading", { name: "İki adımlı doğrulama kurulumu" }),
    ).toBeVisible();

    await completeMfaEnrollment(page);

    // MFA tamamlanınca panele düşer — admin-only bir nav öğesi görünür olmalı.
    // href ile eşleştiriyoruz: nav ikonu (bkz. app-shell.tsx) aria-hidden
    // değil, dolayısıyla erişilebilir ad "◎ Öğrenciler" oluyor — Playwright'ın
    // varsayılan alt dize eşleşmesi bu yüzden "☆ Aday Öğrenciler" ile de
    // çakışıp strict-mode ihlaline yol açıyordu.
    await expect(page.locator('a[href="/ogrenciler"]')).toBeVisible();

    // Playwright her test icin yeni ve izole bir browser context acar. Bu
    // adim ayri test oldugunda admin oturumu kaybolup /giris'e donuyordu.
    await page.goto("/ogretmenler");

    await page.getByLabel("Ad soyad").fill("E2E Öğretmen");
    await page.getByLabel("E-posta").fill(teacherEmail);
    await page.getByRole("button", { name: "Öğretmen hesabı oluştur" }).click();

    await expect(page.getByText("Öğretmen hesabı oluşturuldu")).toBeVisible();

    const passwordCell = page
      .locator("dt", { hasText: "Geçici parola" })
      .locator("xpath=following-sibling::dd[1]");

    teacherTemporaryPassword = (await passwordCell.textContent())?.trim() ?? "";

    expect(teacherTemporaryPassword.length).toBeGreaterThan(0);
  });
});

test.describe("Öğretmen temel akışı", () => {
  test("öğretmen geçici parolayla giriş yapar, parola değiştirir ve yalnızca kendi panelini görür", async ({
    page,
  }) => {
    expect(teacherTemporaryPassword).not.toBe("");

    await loginAs(page, teacherEmail, teacherTemporaryPassword);

    await expect(
      page.getByRole("heading", { name: "Kendi parolanızı belirleyin" }),
    ).toBeVisible();

    const newPassword = "TeacherE2ePass456!";
    // exact:true şart — "Yeni parola" alt dizesi "Yeni parola tekrar"
    // etiketiyle de eşleşip strict-mode ihlaline yol açıyordu.
    await page.getByLabel("Yeni parola", { exact: true }).fill(newPassword);
    await page.getByLabel("Yeni parola tekrar").fill(newPassword);
    await page.getByRole("button", { name: "Parolamı belirle" }).click();

    // Öğretmen /ogretmen-paneli'ne düşer.
    await expect(page).toHaveURL(/\/ogretmen-paneli/);

    // Öğretmenin kendi programı görünür; admin-only ekranlar (Öğrenciler,
    // Ödemeler, MEB Yönetimi) sidebar'da HİÇ yer almaz — teacher'ın
    // başka öğretmenin öğrencisini/kurumun finans verisini göremediği
    // garantisinin UI seviyesindeki tamamlayıcısı (asıl garanti RLS'te,
    // bkz. supabase/tests/database/role_data_minimization.test.sql).
    await expect(page.getByRole("link", { name: "Programım" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Öğrenciler" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Ödemeler" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "MEB Yönetimi" })).toHaveCount(0);
  });
});

// Giriş sonrası sunucu, requireProfile()'ın kararına göre /kurulum,
// /hesap-erisimi, /mfa-kur, /parola-yenile veya doğrudan bir panele
// yönlendirir — hangisi olduğu senaryoya göre değişir, bu yüzden burada
// yalnızca /giris'ten AYRILDIĞINI bekliyoruz (her çağıran kendi hedef
// sayfasını ayrıca doğrular). Giriş başarısızsa (yanlış parola, rate
// limit, NEXT_PUBLIC_SUPABASE_* ortam değişkenleri CI'da doğru
// aktarılmamış vb.) sunucu ?error=... ile /giris'te kalır — bu durumda
// ekrandaki gerçek hata mesajını ve o anki URL'yi test hatasına
// taşıyoruz ki CI logunda yalnızca "heading bulunamadı" değil, asıl
// neden görünsün.
async function loginAs(page: Page, email: string, password: string) {
  await page.goto("/giris");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Parola").fill(password);
  await page.getByRole("button", { name: "Giriş yap" }).click();

  try {
    await page.waitForURL((url) => !url.pathname.startsWith("/giris"), {
      timeout: 15_000,
    });
  } catch {
    const errorText = await page
      .locator("main")
      .innerText()
      .catch(() => "(sayfa içeriği okunamadı)");
    throw new Error(
      `loginAs(${email}): giriş sonrası /giris'ten ayrılamadı (mevcut URL: ${page.url()}).\n` +
        `Sayfa içeriği:\n${errorText}`,
    );
  }
}

async function completeMfaEnrollment(page: Page) {
  await page.getByRole("button", { name: "Kuruluma başla" }).click();

  const secretText = await page.getByTestId("mfa-secret").textContent();
  const secret = secretText?.split(":").pop()?.trim() ?? "";
  expect(secret.length).toBeGreaterThan(0);

  const totp = new OTPAuth.TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });

  await page.getByLabel("Uygulamadaki 6 haneli kod").fill(totp.generate());
  await page.getByRole("button", { name: "Doğrula ve etkinleştir" }).click();

  await expect(page.getByTestId("mfa-recovery-code")).toBeVisible();

  await page
    .getByRole("checkbox", {
      name: "Kurtarma kodunu güvenli bir yere kaydettim.",
    })
    .check();

  await page.getByRole("button", { name: "Panele geç" }).click();
}
