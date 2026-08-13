import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LogoField } from "@/components/settings/LogoField";
import { AuthBrandHeader } from "@/components/auth/auth-brand-header";
import { Signature } from "@/components/branding/signature";
import { completeInitialSetup } from "./actions";

type SetupPageProps = {
  searchParams: Promise<{
    error?: string;
  }>;
};

export default async function SetupPage({ searchParams }: SetupPageProps) {
  const { error } = await searchParams;
  const supabase = await createClient();

  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (!userId) {
    redirect("/giris");
  }

  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();

  if (existingProfile) {
    redirect("/");
  }

  // Bu sayfa yalnızca sistemde hiç kurum yokken (gerçek ilk kurulum)
  // gösterilebilir. Bu kontrol, /lib/auth.ts içindeki yönlendirme
  // mantığından bağımsız olarak burada da uygulanır — arayüz
  // yönlendirmesine güvenilmez, /kurulum'a doğrudan gidilse bile
  // sunucu tarafında engellenir.
  const { data: systemBootstrapped } = await supabase.rpc("has_any_organization");

  if (systemBootstrapped) {
    redirect("/hesap-erisimi");
  }

  return (
    <div className="mx-auto max-w-xl py-10">
      <div className="rounded-3xl border border-border bg-surface p-7 shadow-sm">
        <AuthBrandHeader />

        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-strong">
          İlk kurulum
        </p>

        <h2 className="mt-3 text-2xl font-bold">Kurum hesabını oluşturun</h2>

        <p className="mt-2 text-sm leading-6 text-text-secondary">
          Bu işlem yalnızca bir kez gerçekleştirilebilir. Oturum açan kullanıcı kurumun ilk
          yöneticisi olarak kaydedilecektir.
        </p>

        {error && (
          <div className="mt-5 rounded-xl bg-danger-soft p-3 text-sm text-danger">{error}</div>
        )}

        <form action={completeInitialSetup} className="mt-6 space-y-5">
          <label className="block text-sm font-medium">
            Kurum adı
            <input
              name="organizationName"
              type="text"
              required
              minLength={2}
              defaultValue="Şermin Şahin Kişisel Gelişim Kursu"
              className="mt-2 w-full rounded-xl border border-border px-4 py-3 outline-none focus:border-primary"
            />
          </label>

          <label className="block text-sm font-medium">
            Yönetici adı soyadı
            <input
              name="fullName"
              type="text"
              required
              minLength={2}
              placeholder="Adınız ve soyadınız"
              className="mt-2 w-full rounded-xl border border-border px-4 py-3 outline-none focus:border-primary"
            />
          </label>

          <LogoField currentLogoUrl={null} />

          <button
            type="submit"
            className="w-full rounded-xl bg-primary shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring px-4 py-3 font-semibold text-on-primary hover:bg-primary-hover"
          >
            Kurulumu tamamla
          </button>
        </form>
      </div>

      <Signature className="mt-6" />
    </div>
  );
}
