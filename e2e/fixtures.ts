// E2E testleri arasında paylaşılan sabitler. Sabit bir e-posta
// kullanılır — her CI çalıştırması taze bir yerel Supabase örneğine
// (`supabase start` + `db reset`) karşı çalıştığı için çakışma
// riski yok; yerelde tekrar tekrar çalıştırmak için global-setup
// "already registered" hatasını yutuyor.

export const E2E_ADMIN_EMAIL = "e2e-admin@example.test";
export const E2E_ADMIN_PASSWORD = "E2eAdminPass123!";
export const E2E_ORGANIZATION_NAME = "E2E Test Kurumu";
export const E2E_ADMIN_FULL_NAME = "E2E Yönetici";
