import { redirect } from "next/navigation";
import { requireMfaGateBypassProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AuthBrandHeader } from "@/components/auth/auth-brand-header";
import { MfaEnrollForm } from "./mfa-enroll-form";

export default async function MfaSetupPage() {
  const profile = await requireMfaGateBypassProfile();

  if (profile.role !== "admin") {
    redirect("/");
  }

  const supabase = await createClient();

  const { data: factorsData } = await supabase.auth.mfa.listFactors();

  const hasVerifiedFactor = factorsData?.totp?.some((factor) => factor.status === "verified");

  if (hasVerifiedFactor) {
    redirect("/mfa-dogrula");
  }

  return (
    <main className="grid min-h-screen place-items-center bg-surface px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-border bg-surface p-7 shadow-sm">
        <AuthBrandHeader />

        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-strong">
          Zorunlu güvenlik adımı
        </p>

        <h1 className="mt-3 text-2xl font-bold">İki adımlı doğrulama kurulumu</h1>

        <p className="mt-2 text-sm leading-6 text-text-secondary">
          Merhaba {profile.fullName}. Gerçek öğrenci ve veli verisi taşıyan bir yönetici hesabı
          olduğu için iki adımlı doğrulama zorunludur.
        </p>

        <MfaEnrollForm />
      </div>
    </main>
  );
}
