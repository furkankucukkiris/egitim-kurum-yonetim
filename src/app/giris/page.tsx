import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { login } from "./actions";

type LoginPageProps = {
  searchParams: Promise<{
    error?: string;
  }>;
};

export default async function LoginPage({
  searchParams,
}: LoginPageProps) {
  const { error } = await searchParams;

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();

  if (claimsData?.claims?.sub) {
    redirect("/");
  }

  return (
    <main className="grid min-h-screen place-items-center bg-surface px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-line bg-panel p-7 shadow-sm">
        <div className="mb-6 grid h-12 w-12 place-items-center rounded-2xl bg-honey-500 font-black text-brand-900">
          ŞS
        </div>

        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-honey-700 dark:text-honey-500">
          Güvenli giriş
        </p>

        <h1 className="mt-3 text-2xl font-bold">
          Kurum hesabı
        </h1>

        <p className="mt-2 text-sm leading-6 text-muted">
          Kurum yönetim sistemine erişmek için e-posta ve parolanızla
          giriş yapın.
        </p>

        {error && (
          <div className="mt-5 rounded-xl bg-rose-50 dark:bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-400">
            {error}
          </div>
        )}

        <form action={login} className="mt-6 space-y-4">
          <label className="block text-sm font-medium">
            E-posta

            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              className="mt-2 w-full rounded-xl border border-line px-4 py-3 outline-none focus:border-terra-500"
            />
          </label>

          <label className="block text-sm font-medium">
            Parola

            <input
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="current-password"
              className="mt-2 w-full rounded-xl border border-line px-4 py-3 outline-none focus:border-terra-500"
            />
          </label>

          <button
            type="submit"
            className="w-full rounded-xl bg-terra-700 shadow-sm shadow-terra-700/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-500/50 px-4 py-3 font-semibold text-white transition hover:bg-terra-700/90"
          >
            Giriş yap
          </button>
        </form>
      </div>
    </main>
  );
}
