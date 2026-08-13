import { redirect } from "next/navigation";
import { requirePasswordChangeProfile } from "@/lib/auth";
import { AuthBrandHeader } from "@/components/auth/auth-brand-header";
import { PasswordForm } from "./password-form";

export default async function PasswordChangePage() {
  const profile = await requirePasswordChangeProfile();

  if (!profile.mustChangePassword) {
    redirect(profile.role === "teacher" ? "/ogretmen-paneli" : "/");
  }

  return (
    <main className="grid min-h-screen place-items-center bg-surface px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-border bg-surface p-7 shadow-sm">
        <AuthBrandHeader />

        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-strong">
          İlk giriş
        </p>

        <h1 className="mt-3 text-2xl font-bold">Kendi parolanızı belirleyin</h1>

        <p className="mt-2 text-sm leading-6 text-text-secondary">
          Merhaba {profile.fullName}. Geçici parolanızla giriş yaptınız. Hesabınızı kullanmaya
          başlamadan önce yalnızca sizin bileceğiniz yeni bir parola oluşturun.
        </p>

        <PasswordForm />
      </div>
    </main>
  );
}
