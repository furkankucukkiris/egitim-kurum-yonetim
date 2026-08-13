import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AuthBrandHeader } from "@/components/auth/auth-brand-header";
import { Signature } from "@/components/branding/signature";
import { login } from "./actions";

type LoginPageProps = {
  searchParams: Promise<{
    error?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error } = await searchParams;

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();

  if (claimsData?.claims?.sub) {
    redirect("/");
  }

  return (
    <main className="grid min-h-screen place-items-center bg-background px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-border bg-surface p-7 shadow-sm">
        <AuthBrandHeader />

        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-strong">
          Güvenli giriş
        </p>

        <h1 className="mt-3 text-2xl font-bold text-text-primary">Kurum hesabı</h1>

        <p className="mt-2 text-sm leading-6 text-text-secondary">
          Kurum yönetim sistemine erişmek için e-posta ve parolanızla giriş yapın.
        </p>

        {error && (
          <div className="mt-5 flex items-start gap-2 rounded-xl bg-danger-soft p-3 text-sm text-danger">
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              className="mt-0.5 h-4 w-4 shrink-0"
              aria-hidden
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm0-11a1 1 0 0 1 1 1v4a1 1 0 1 1-2 0V8a1 1 0 0 1 1-1Zm0 8a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2Z"
                clipRule="evenodd"
              />
            </svg>
            <span>{error}</span>
          </div>
        )}

        <form action={login} className="mt-6 space-y-4">
          <label className="block text-sm font-medium text-text-primary">
            E-posta
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              className="mt-2 w-full rounded-xl border border-border bg-surface px-4 py-3 text-text-primary outline-none placeholder:text-text-disabled focus:border-primary focus-visible:ring-2 focus-visible:ring-focus-ring"
            />
          </label>

          <label className="block text-sm font-medium text-text-primary">
            Parola
            <input
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="current-password"
              className="mt-2 w-full rounded-xl border border-border bg-surface px-4 py-3 text-text-primary outline-none placeholder:text-text-disabled focus:border-primary focus-visible:ring-2 focus-visible:ring-focus-ring"
            />
          </label>

          <button
            type="submit"
            className="w-full rounded-xl border border-primary bg-primary px-4 py-3 font-semibold text-on-primary transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Giriş yap
          </button>
        </form>
      </div>

      <Signature className="mt-6" />
    </main>
  );
}
