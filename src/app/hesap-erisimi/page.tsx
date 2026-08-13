import Link from "next/link";
import { logout } from "@/app/auth/actions";
import { createClient } from "@/lib/supabase/server";
import { AuthBrandHeader } from "@/components/auth/auth-brand-header";

export default async function AccountAccessPage() {
  const supabase = await createClient();

  const { data: claimsData } = await supabase.auth.getClaims();

  const hasSession = Boolean(claimsData?.claims?.sub);

  return (
    <main className="grid min-h-screen place-items-center bg-surface px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-border bg-surface p-7 shadow-sm">
        <AuthBrandHeader />

        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-strong">
          Hesap erişimi
        </p>

        <h1 className="mt-3 text-2xl font-bold">Aktif kurum profili bulunamadı</h1>

        <p className="mt-2 text-sm leading-6 text-text-secondary">
          Bu oturum aktif bir kurum profiline bağlı değil veya hesap yönetici tarafından pasife
          alınmış. Kurum yöneticinizle iletişime geçin.
        </p>

        {hasSession ? (
          <form action={logout} className="mt-6">
            <button
              type="submit"
              className="w-full rounded-xl bg-primary shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring px-4 py-3 font-semibold text-on-primary transition hover:bg-primary-hover"
            >
              Oturumu kapat
            </button>
          </form>
        ) : (
          <Link
            href="/giris"
            className="mt-6 block w-full rounded-xl bg-primary shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring px-4 py-3 text-center font-semibold text-on-primary transition hover:bg-primary-hover"
          >
            Giriş ekranına dön
          </Link>
        )}
      </div>
    </main>
  );
}
