import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error("Supabase ortam değişkenleri tanımlı değil.");
  }

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          // httpOnly BİLEREK true değil: @supabase/ssr'nin browser
          // client'ı (bkz. src/lib/supabase/client.ts) oturumu YALNIZCA
          // document.cookie üzerinden okuyabiliyor — @supabase/ssr'nin
          // kendi DEFAULT_COOKIE_OPTIONS'ı da bu yüzden httpOnly:false.
          // httpOnly:true burada ayarlanınca client-side her auth
          // çağrısı (ör. MFA enroll) sub claim'i olmayan anon anahtarına
          // düşüp "invalid claim: missing sub claim" ile başarısız
          // oluyordu — hiçbir client component daha önce MFA kurulumuna
          // kadar gerçek bir auth çağrısı yapmadığı için fark edilmemişti.
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, {
              ...options,
              secure: process.env.NODE_ENV === "production",
              sameSite: "lax",
            }),
          );
        } catch {
          // Server Component içinden çağrıldığında cookie yazılamayabilir.
          // Oturum yenileme proxy.ts tarafından yapılır.
        }
      },
    },
  });
}
