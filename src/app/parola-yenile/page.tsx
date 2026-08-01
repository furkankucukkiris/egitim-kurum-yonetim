import { redirect } from "next/navigation";
import {
  requirePasswordChangeProfile,
} from "@/lib/auth";
import { PasswordForm } from "./password-form";

export default async function PasswordChangePage() {
  const profile =
    await requirePasswordChangeProfile();

  if (!profile.mustChangePassword) {
    redirect(
      profile.role === "teacher"
        ? "/ogretmen-paneli"
        : "/",
    );
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
        <div className="mb-6 grid h-12 w-12 place-items-center rounded-2xl bg-amber-400 font-black text-slate-950">
          ŞS
        </div>

        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
          İlk giriş
        </p>

        <h1 className="mt-3 text-2xl font-bold">
          Kendi parolanızı belirleyin
        </h1>

        <p className="mt-2 text-sm leading-6 text-slate-500">
          Merhaba {profile.fullName}. Geçici
          parolanızla giriş yaptınız. Hesabınızı
          kullanmaya başlamadan önce yalnızca sizin
          bileceğiniz yeni bir parola oluşturun.
        </p>

        <PasswordForm />
      </div>
    </main>
  );
}
