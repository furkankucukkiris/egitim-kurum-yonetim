import { requireMfaGateBypassProfile } from "@/lib/auth";
import { redeemMfaRecoveryCode } from "./actions";

type MfaRecoveryPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function MfaRecoveryPage({ searchParams }: MfaRecoveryPageProps) {
  const profile = await requireMfaGateBypassProfile();
  const { error } = await searchParams;

  return (
    <main className="grid min-h-screen place-items-center bg-surface px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-border bg-surface p-7 shadow-sm">
        <div className="mb-6 grid h-12 w-12 place-items-center rounded-2xl bg-accent-soft font-black text-on-accent">
          ŞS
        </div>

        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-strong">
          Kurtarma
        </p>

        <h1 className="mt-3 text-2xl font-bold">Merhaba {profile.fullName}</h1>

        <p className="mt-2 text-sm leading-6 text-text-secondary">
          Kurulum sırasında size gösterilen tek seferlik kurtarma kodunu girin. Bu kod
          kullanıldığında mevcut authenticator kaydınız kaldırılır ve yeniden kurulum yapmanız
          istenir.
        </p>

        {error && (
          <div className="mt-5 rounded-xl bg-danger-soft p-3 text-sm text-danger">{error}</div>
        )}

        <form action={redeemMfaRecoveryCode} className="mt-6 space-y-4">
          <label className="block text-sm font-medium">
            Kurtarma kodu
            <input
              name="code"
              required
              autoFocus
              placeholder="XXXXX-XXXXX"
              className="mt-2 w-full rounded-xl border border-border px-4 py-3 text-center text-lg tracking-widest outline-none focus:border-primary"
            />
          </label>

          <button
            type="submit"
            className="w-full rounded-xl bg-primary shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring px-4 py-3 font-semibold text-on-primary transition hover:bg-primary-hover"
          >
            Kurtarma kodunu kullan
          </button>
        </form>
      </div>
    </main>
  );
}
