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
    <main className="grid min-h-screen place-items-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
        <div className="mb-6 grid h-12 w-12 place-items-center rounded-2xl bg-amber-400 font-black text-slate-950">
          ŞS
        </div>

        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
          Güvenli giriş
        </p>

        <h1 className="mt-3 text-2xl font-bold">
          Yönetim hesabı
        </h1>

        <p className="mt-2 text-sm leading-6 text-slate-500">
          Kurum yönetim sistemine erişmek için e-posta ve parolanızla
          giriş yapın.
        </p>

        {error && (
          <div className="mt-5 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
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
              className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-slate-400"
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
              className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-slate-400"
            />
          </label>

          <button
            type="submit"
            className="w-full rounded-xl bg-slate-950 px-4 py-3 font-semibold text-white transition hover:bg-slate-800"
          >
            Giriş yap
          </button>
        </form>
      </div>
    </main>
  );
}