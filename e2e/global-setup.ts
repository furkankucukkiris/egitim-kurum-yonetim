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

  // E2E, admin kurulum akışını test etmek için `has_any_organization()`'ı
  // false'a zorlamak amacıyla kullanıcı/organizasyon oluşturuyor ve bu
  // veriler kalıcı — yanlışlıkla gerçek bir production/staging projesine
  // karşı çalıştırılırsa geri dönüşü olmayan veri kirliliği yaratır. Bu
  // yüzden yalnızca yorum satırına güvenmek yerine kod seviyesinde sert
  // bir kapı var: URL, `supabase start`'ın ürettiği localhost/127.0.0.1
  // adresi DEĞİLSE, yalnızca `E2E_ALLOW_REMOTE_SUPABASE_URL` ortam
  // değişkeni AYNI URL'yle birebir eşleşiyorsa (kasıtlı, tek kullanımlık
  // bir izin) devam edilir — aksi halde global setup burada durur.
  assertNotProductionSupabaseUrl(url);

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
  //
  // organizations/profiles tablolarını service_role ile doğrudan
  // sorgulamıyoruz: service_role hiçbir yerde tablo GRANT'ına güvenmiyor
  // (mevcut kod yalnızca Admin Auth API'sini ve authenticated-context
  // RPC'leri kullanıyor), bu yüzden bu erişim garanti değil — nitekim
  // taze bir yerel `db reset`te gerçekten "permission denied" veriyordu.
  // has_any_organization() zaten SECURITY DEFINER + service_role'e açık
  // grant'li tek RPC; `false` dönmesi tek başına yeterli, çünkü
  // profiles.organization_id `not null references organizations(id)` —
  // kurum yoksa hiçbir profil de var olamaz (bkz. initial_schema.sql).
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

  // Admin'in zaten bir profili olup olmadığını ayrıca sorgulamıyoruz —
  // yukarıdaki has_any_organization()=false kontrolü, FK zinciri
  // yüzünden (profiles.organization_id -> organizations(id) not null)
  // sistemde hiçbir profilin var olamayacağını zaten kanıtlıyor.
}

function assertNotProductionSupabaseUrl(url: string) {
  let hostname: string;

  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new Error(`E2E ön koşul kontrolü başarısız: NEXT_PUBLIC_SUPABASE_URL geçersiz bir URL (${url}).`);
  }

  const isLocalhost = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";

  if (isLocalhost) {
    return;
  }

  // İzole, tek kullanımlık bir staging/disposable projeye karşı bilinçli
  // olarak çalıştırmak isteyenler için tek istisna: değişken hem tanımlı
  // hem de test edilen URL'yle BİREBİR aynı olmalı (kopyala-yapıştır
  // hatasına veya "bir yerde tanımlıydı" yanlışlıklarına karşı).
  const explicitlyAllowedUrl = process.env.E2E_ALLOW_REMOTE_SUPABASE_URL;

  if (explicitlyAllowedUrl && explicitlyAllowedUrl === url) {
    return;
  }

  throw new Error(
    `E2E ön koşul kontrolü başarısız: NEXT_PUBLIC_SUPABASE_URL (${url}) localhost değil. ` +
      "Bu test paketi kalıcı, geri alınamaz veri (kurum/kullanıcı/MFA factor'ü) oluşturur ve " +
      "yanlışlıkla production veya paylaşılan bir staging projesine karşı ÇALIŞTIRILMAMALIDIR. " +
      "Yalnızca `npx supabase start`'ın ürettiği yerel/CI örneğine karşı çalışacak şekilde " +
      "tasarlanmıştır. Bilerek izole, tek kullanımlık bir uzak projeye karşı çalıştırıyorsanız " +
      "`E2E_ALLOW_REMOTE_SUPABASE_URL` değişkenini bu URL'yle BİREBİR aynı değere ayarlayın.",
  );
}
