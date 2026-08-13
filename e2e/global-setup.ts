// Uygulama UI'sinde hiçbir self-service kayıt (signup) akışı yok —
// /kurulum sayfası bile önce oturum açmış olmayı şart koyuyor
// (bilinçli tek-kiracı kilidi, bkz. README). Bu yüzden E2E'nin ilk
// admin kullanıcısını Supabase Auth Admin API'siyle (service role,
// yalnızca yerel/CI'daki geçici Supabase örneğine karşı) önceden
// oluşturması gerekiyor — sonrası tamamen normal UI akışıyla ilerler.
import { createClient } from "@supabase/supabase-js";
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from "./fixtures";

export default async function globalSetup() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "E2E testleri için NEXT_PUBLIC_SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY " +
        "ortam değişkenleri (yerel/CI Supabase örneğinin bilgileri) gerekli. " +
        "`npx supabase start` sonrası `supabase status -o env` çıktısına bakın.",
    );
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error } = await admin.auth.admin.createUser({
    email: E2E_ADMIN_EMAIL,
    password: E2E_ADMIN_PASSWORD,
    email_confirm: true,
  });

  if (error && !error.message.toLocaleLowerCase("tr-TR").includes("already")) {
    throw new Error(`E2E admin kullanıcısı oluşturulamadı: ${error.message}`);
  }
}
