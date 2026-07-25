import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { completeInitialSetup } from "./actions";

type SetupPageProps = {
  searchParams: Promise<{
    error?: string;
  }>;
};

export default async function SetupPage({
  searchParams,
}: SetupPageProps) {
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

  return (
    <div className="mx-auto max-w-xl py-10">
      <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
          İlk kurulum
        </p>

        <h2 className="mt-3 text-2xl font-bold">
          Kurum hesabını oluşturun
        </h2>

        <p className="mt-2 text-sm leading-6 text-slate-500">
          Bu işlem yalnızca bir kez gerçekleştirilebilir. Oturum açan
          kullanıcı kurumun ilk yöneticisi olarak kaydedilecektir.
        </p>

        {error && (
          <div className="mt-5 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
            {error}
          </div>
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
              className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-slate-400"
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
              className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-slate-400"
            />
          </label>

          <button
            type="submit"
            className="w-full rounded-xl bg-slate-950 px-4 py-3 font-semibold text-white hover:bg-slate-800"
          >
            Kurulumu tamamla
          </button>
        </form>
      </div>
    </div>
  );
}