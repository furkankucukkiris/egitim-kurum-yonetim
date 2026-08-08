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
      <div className="rounded-3xl border border-line bg-panel p-7 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-honey-700 dark:text-honey-500">
          İlk kurulum
        </p>

        <h2 className="mt-3 text-2xl font-bold">
          Kurum hesabını oluşturun
        </h2>

        <p className="mt-2 text-sm leading-6 text-muted">
          Bu işlem yalnızca bir kez gerçekleştirilebilir. Oturum açan
          kullanıcı kurumun ilk yöneticisi olarak kaydedilecektir.
        </p>

        {error && (
          <div className="mt-5 rounded-xl bg-rose-50 dark:bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-400">
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
              className="mt-2 w-full rounded-xl border border-line px-4 py-3 outline-none focus:border-terra-500"
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
              className="mt-2 w-full rounded-xl border border-line px-4 py-3 outline-none focus:border-terra-500"
            />
          </label>

          <button
            type="submit"
            className="w-full rounded-xl bg-terra-700 shadow-sm shadow-terra-700/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-500/50 px-4 py-3 font-semibold text-white hover:bg-terra-700/90"
          >
            Kurulumu tamamla
          </button>
        </form>
      </div>
    </div>
  );
}