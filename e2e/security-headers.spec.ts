import { expect, test } from "@playwright/test";

// Bağımsız/durumsuz bir kontrol — basic-flows.spec.ts'teki stateful
// serial akışa dahil DEĞİL, bu yüzden playwright.config.ts'teki global
// CI retry'sine (1) tabi kalması güvenli: bu test hiçbir kalıcı veri
// oluşturmaz, tekrar denenmesi hiçbir şeyi bozmaz.
//
// webServer `npm run build && npm run start` çalıştırdığından
// (playwright.config.ts) NODE_ENV=production'dır — next.config.ts'deki
// CSP header'ı yalnızca bu modda eklenir; burada onun gerçekten
// production build çıktısında döndüğünü doğruluyoruz.
test("production build güvenlik header'larını döndürür", async ({ request }) => {
  const response = await request.get("/giris");

  expect(response.status()).toBeLessThan(400);

  const headers = response.headers();

  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["permissions-policy"]).toContain("camera=()");

  expect(headers["content-security-policy"]).toBeTruthy();
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["content-security-policy"]).toContain("default-src 'self'");
});
