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
    <main className="grid min-h-screen place-items-center bg-surface px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-line bg-panel p-7 shadow-sm">
        <div className="mb-6 grid h-12 w-12 place-items-center rounded-2xl bg-honey-500 font-black text-brand-900">
          ŞS
        </div>

        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-honey-700 dark:text-honey-500">
          Hesap erişimi
        </p>

        <h1 className="mt-3 text-2xl font-bold">
          Aktif kurum profili bulunamadı
        </h1>

        <p className="mt-2 text-sm leading-6 text-muted">
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
              className="w-full rounded-xl bg-terra-700 shadow-sm shadow-terra-700/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-500/50 px-4 py-3 font-semibold text-white transition hover:bg-terra-700/90"
            >
              Oturumu kapat
            </button>
          </form>
        ) : (
          <Link
            href="/giris"
            className="mt-6 block w-full rounded-xl bg-terra-700 shadow-sm shadow-terra-700/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-500/50 px-4 py-3 text-center font-semibold text-white transition hover:bg-terra-700/90"
          >
            Giriş ekranına dön
          </Link>
        )}
      </div>
    </main>
  );
}
