import Link from "next/link";
import { requireMfaGateBypassProfile } from "@/lib/auth";
import { AuthBrandHeader } from "@/components/auth/auth-brand-header";
import { verifyMfaChallenge } from "./actions";

type MfaChallengePageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function MfaChallengePage({ searchParams }: MfaChallengePageProps) {
  const profile = await requireMfaGateBypassProfile();
  const { error } = await searchParams;

  return (
    <main className="grid min-h-screen place-items-center bg-surface px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-border bg-surface p-7 shadow-sm">
        <AuthBrandHeader />

        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-strong">
          İki adımlı doğrulama
        </p>

        <h1 className="mt-3 text-2xl font-bold">Merhaba {profile.fullName}</h1>

        <p className="mt-2 text-sm leading-6 text-text-secondary">
          Authenticator uygulamanızdaki 6 haneli kodu girin.
        </p>

        {error && (
          <div className="mt-5 rounded-xl bg-danger-soft p-3 text-sm text-danger">{error}</div>
        )}

        <form action={verifyMfaChallenge} className="mt-6 space-y-4">
          <label className="block text-sm font-medium">
            Doğrulama kodu
            <input
              name="code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              autoFocus
              autoComplete="one-time-code"
              className="mt-2 w-full rounded-xl border border-border px-4 py-3 text-center text-lg tracking-widest outline-none focus:border-primary"
            />
          </label>

          <button
            type="submit"
            className="w-full rounded-xl bg-primary shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring px-4 py-3 font-semibold text-on-primary transition hover:bg-primary-hover"
          >
            Doğrula
          </button>
        </form>

        <Link
          href="/mfa-kurtar"
          className="mt-4 block text-center text-sm font-semibold text-primary underline underline-offset-4 text-primary"
        >
          Kodu giremiyorum — kurtarma kodu ile giriş yap
        </Link>
      </div>
    </main>
  );
}
