import { defineConfig, devices } from "@playwright/test";

// E2E testleri gerçek bir Supabase örneği ister — yerel geliştirmede
// `npx supabase start` sonrası, CI'da ise `.github/workflows/ci.yml`
// bunu otomatik yapar. Uygulama sunucusunun kendisini Playwright
// başlatıp bekliyor (webServer) — CI adımında ayrıca "start server,
// wait for it" yazmaya gerek kalmıyor.
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  // "github" tek başına playwright-report/ üretmiyor (yalnızca PR
  // annotation'ları basıyor) — bu yüzden CI'da artifact olarak
  // yüklenecek bir HTML raporu da açıkça isteniyor.
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,

  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: "npm run build && npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
