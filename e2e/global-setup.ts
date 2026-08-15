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

  // Yerel/CI'a ait geçici Supabase örneğinin dışına asla bağlanmıyoruz —
  // url her zaman `supabase start` çıktısından (localhost) geliyor, bu
  // fonksiyon production/staging bir projeye karşı çalıştırılamaz.

  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Admin akışının /kurulum'a düşmesi, sistemde HİÇ kurum/profil
  // bulunmamasına bağlı (bkz. src/lib/auth.ts'teki requireProfile).
  // `supabase db reset` seed.sql'i de çalıştırırsa (E2E job'unda
  // --no-seed kullanılmalı) demo kurum has_any_organization()'ı true'ya
  // çevirip admin'i /hesap-erisimi'ne düşürür ve test burada, gerçek
  // nedeni gizleyen bir "heading bulunamadı" timeout'undan ÖNCE, net bir
  // hatayla durur.
  // `{ count: "exact", head: true }` bir HTTP HEAD isteği üretir; HEAD
  // yanıtları HTTP spesifikasyonu gereği hata durumunda bile hiçbir body
  // taşımaz, bu yüzden postgrest-js hata mesajını/kodunu dolduramıyor ve
  // (varsa) gerçek nedeni gizleyen boş bir `error.message` ile karşılaşılıyor.
  // Bunun yerine body her zaman dolu gelen normal bir GET kullanıyoruz.
  const { data: organizationRows, error: organizationsError } = await admin
    .from("organizations")
    .select("id");

  if (organizationsError) {
    throw new Error(
      `E2E ön koşul kontrolü başarısız: organizations tablosu okunamadı: ${organizationsError.message}`,
    );
  }

  if (organizationRows.length !== 0) {
    throw new Error(
      `E2E ön koşul kontrolü başarısız: organizations tablosunda ${organizationRows.length} kayıt var, 0 bekleniyordu. ` +
        "Bu genellikle `supabase db reset`in seed.sql'i de çalıştırdığı (E2E job'unda --no-seed eksik) anlamına gelir.",
    );
  }

  const { data: profileRows, error: profilesError } = await admin.from("profiles").select("id");

  if (profilesError) {
    throw new Error(
      `E2E ön koşul kontrolü başarısız: profiles tablosu okunamadı: ${profilesError.message}`,
    );
  }

  if (profileRows.length !== 0) {
    throw new Error(
      `E2E ön koşul kontrolü başarısız: profiles tablosunda ${profileRows.length} kayıt var, 0 bekleniyordu. ` +
        "Veritabanı gerçekten boş bir `db reset`ten gelmiyor olabilir.",
    );
  }

  const { data: hasAnyOrganization, error: hasAnyOrganizationError } = await admin.rpc(
    "has_any_organization",
  );

  if (hasAnyOrganizationError) {
    throw new Error(
      `E2E ön koşul kontrolü başarısız: has_any_organization() çağrılamadı: ${hasAnyOrganizationError.message}`,
    );
  }

  if (hasAnyOrganization !== false) {
    throw new Error(
      `E2E ön koşul kontrolü başarısız: has_any_organization() ${hasAnyOrganization} döndürdü, false bekleniyordu. ` +
        "/kurulum akışı bu değer false olmadan test edilemez.",
    );
  }

  const { data: createdUser, error: createUserError } = await admin.auth.admin.createUser({
    email: E2E_ADMIN_EMAIL,
    password: E2E_ADMIN_PASSWORD,
    email_confirm: true,
  });

  if (createUserError && !createUserError.message.toLocaleLowerCase("tr-TR").includes("already")) {
    throw new Error(`E2E admin kullanıcısı oluşturulamadı: ${createUserError.message}`);
  }

  // "already registered" durumunda createdUser boş dönüyor — kullanıcıyı
  // e-postayla arayıp gerçek durumunu (onaylı mı, profili var mı) kontrol
  // ediyoruz. Bu yalnızca yerelde tekrar tekrar çalıştırırken devreye
  // girer; taze bir CI veritabanında createdUser doğrudan dolu gelir.
  let adminUser = createdUser?.user ?? null;

  if (!adminUser) {
    const { data: listedUsers, error: listUsersError } = await admin.auth.admin.listUsers();

    if (listUsersError) {
      throw new Error(`E2E admin kullanıcısı doğrulanamadı: ${listUsersError.message}`);
    }

    adminUser = listedUsers.users.find((user) => user.email === E2E_ADMIN_EMAIL) ?? null;
  }

  if (!adminUser) {
    throw new Error(
      `E2E ön koşul kontrolü başarısız: ${E2E_ADMIN_EMAIL} auth.users içinde bulunamadı.`,
    );
  }

  if (!adminUser.email_confirmed_at) {
    throw new Error(
      `E2E ön koşul kontrolü başarısız: ${E2E_ADMIN_EMAIL} e-postası onaylı değil (email_confirmed_at boş). ` +
        "Giriş akışı e-posta onayı olmadan çalışmaz.",
    );
  }

  const { data: adminProfile, error: adminProfileError } = await admin
    .from("profiles")
    .select("id")
    .eq("id", adminUser.id)
    .maybeSingle();

  if (adminProfileError) {
    throw new Error(
      `E2E ön koşul kontrolü başarısız: ${E2E_ADMIN_EMAIL} profili kontrol edilemedi: ${adminProfileError.message}`,
    );
  }

  if (adminProfile) {
    throw new Error(
      `E2E ön koşul kontrolü başarısız: ${E2E_ADMIN_EMAIL} için zaten bir uygulama profili var. ` +
        "/kurulum akışı yalnızca henüz profili olmayan bir admin ile test edilebilir.",
    );
  }
}
