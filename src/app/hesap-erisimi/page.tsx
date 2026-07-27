import Link from "next/link";
import { logout } from "@/app/auth/actions";
import { createClient } from "@/lib/supabase/server";

export default async function AccountAccessPage() {
  const supabase = await createClient();

  const { data: claimsData } =
    await supabase.auth.getClaims();

  const hasSession = Boolean(
    claimsData?.claims?.sub,
  );

  return (
    <main className="grid min-h-screen place-items-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
        <div className="mb-6 grid h-12 w-12 place-items-center rounded-2xl bg-amber-400 font-black text-slate-950">
          ŞS
        </div>

        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
          Hesap erişimi
        </p>

        <h1 className="mt-3 text-2xl font-bold">
          Aktif kurum profili bulunamadı
        </h1>

        <p className="mt-2 text-sm leading-6 text-slate-500">
          Bu oturum aktif bir kurum profiline bağlı
          değil veya hesap yönetici tarafından pasife
          alınmış. Kurum yöneticinizle iletişime geçin.
        </p>

        {hasSession ? (
          <form
            action={logout}
            className="mt-6"
          >
            <button
              type="submit"
              className="w-full rounded-xl bg-slate-950 px-4 py-3 font-semibold text-white transition hover:bg-slate-800"
            >
              Oturumu kapat
            </button>
          </form>
        ) : (
          <Link
            href="/giris"
            className="mt-6 block w-full rounded-xl bg-slate-950 px-4 py-3 text-center font-semibold text-white transition hover:bg-slate-800"
          >
            Giriş ekranına dön
          </Link>
        )}
      </div>
    </main>
  );
}
