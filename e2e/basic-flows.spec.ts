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
test.describe.configure({ mode: "serial" });

const teacherEmail = `e2e-ogretmen-${Date.now()}@example.test`;
let teacherTemporaryPassword = "";

test.describe("Admin temel akışı", () => {
  test("ilk kurulum, MFA ve öğretmen hesabı oluşturma", async ({
    page,
  }) => {
    await page.goto("/giris");
    await page.getByLabel("E-posta").fill(E2E_ADMIN_EMAIL);
    await page.getByLabel("Parola").fill(E2E_ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Giriş yap" }).click();

    // Henüz hiçbir kurum/profil yok → /kurulum'a yönlendirilir.
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
    await expect(page.getByRole("link", { name: "Öğrenciler" })).toBeVisible();

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

    await page.goto("/giris");
    await page.getByLabel("E-posta").fill(teacherEmail);
    await page.getByLabel("Parola").fill(teacherTemporaryPassword);
    await page.getByRole("button", { name: "Giriş yap" }).click();

    await expect(
      page.getByRole("heading", { name: "Kendi parolanızı belirleyin" }),
    ).toBeVisible();

    const newPassword = "TeacherE2ePass456!";
    await page.getByLabel("Yeni parola").fill(newPassword);
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
