import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Signature } from "@/components/branding/signature";
import { login } from "./actions";

type LoginPageProps = {
  searchParams: Promise<{
    error?: string;
  }>;
};

const institution = process.env.NEXT_PUBLIC_INSTITUTION_NAME ?? "Eğitim Kurumu";

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error } = await searchParams;

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();

  if (claimsData?.claims?.sub) {
    redirect("/");
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <section className="flex flex-col justify-between bg-sidebar px-8 py-10 text-sidebar-text sm:px-12 lg:px-14 lg:py-14">
        <div className="animate-reveal">
          <div className="h-px w-10 bg-accent" />

          <h1 className="mt-8 max-w-md text-3xl font-semibold leading-[1.15] tracking-[-0.01em] sm:text-4xl">
            {institution}
          </h1>

          <p className="mt-5 max-w-sm text-sm leading-6 text-sidebar-muted">
            Öğrenci, yoklama, ödeme ve öğretmen hakediş kayıtlarınızı tek panelden yönetin.
          </p>
        </div>

        <div className="mt-10 hidden lg:block">
          <Signature variant="sidebar" />
        </div>
      </section>

      <section className="flex items-center justify-center px-6 py-12 sm:px-12">
        <div className="animate-reveal w-full max-w-sm" style={{ animationDelay: "80ms" }}>
          <h2 className="text-xl font-semibold text-text-primary">Hesabınıza giriş yapın</h2>

          <p className="mt-2 text-sm leading-6 text-text-secondary">
            Kurum yönetim panelinize erişmek için e-posta ve parolanızı girin.
          </p>

          {error && (
            <div className="mt-6 flex items-start gap-2 rounded-xl bg-danger-soft p-3 text-sm text-danger">
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

          <form action={login} className="mt-8 space-y-5">
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
              className="w-full rounded-xl bg-primary px-4 py-3 font-semibold text-on-primary transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-primary-hover active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Giriş yap
            </button>
          </form>

          <div className="mt-10 lg:hidden">
            <Signature />
          </div>
        </div>
      </section>
    </main>
  );
}
