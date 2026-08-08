import { Card } from "@/components/ui/Card";
import { SettingsAlert } from "@/components/settings/SettingsAlert";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { updateContactInfo } from "../actions";

type ContactSettingsPageProps = {
  searchParams: Promise<{
    success?: string;
    error?: string;
  }>;
};

export default async function ContactSettingsPage({
  searchParams,
}: ContactSettingsPageProps) {
  const profile = await requireRole(["admin"]);
  const params = await searchParams;

  const supabase = await createClient();

  const { data: organization, error } = await supabase
    .from("organizations")
    .select("legal_name, tax_number, phone, email")
    .eq("id", profile.organizationId)
    .single();

  if (error) {
    console.error("Kurum iletişim bilgileri alınamadı:", error);
  }

  return (
    <>
      <SettingsAlert success={params.success} error={params.error} />

      <Card className="max-w-xl p-6">
        <p className="mb-5 text-sm text-muted">
          Bu bilgiler kayıt formu gibi çıktılarda ve gelecekte eklenecek
          resmi belgelerde kullanılır.
        </p>

        <form action={updateContactInfo} className="space-y-5">
          <label className="block text-sm font-medium">
            Resmi ünvan

            <input
              name="legalName"
              type="text"
              defaultValue={organization?.legal_name ?? ""}
              placeholder="Kurumun resmi/ticari ünvanı"
              className="mt-2 w-full rounded-xl border border-line bg-panel px-4 py-3 text-sm outline-none transition focus:border-terra-500"
            />
          </label>

          <label className="block text-sm font-medium">
            Vergi numarası

            <input
              name="taxNumber"
              type="text"
              inputMode="numeric"
              defaultValue={organization?.tax_number ?? ""}
              placeholder="İsteğe bağlı"
              className="mt-2 w-full rounded-xl border border-line bg-panel px-4 py-3 text-sm outline-none transition focus:border-terra-500"
            />
          </label>

          <label className="block text-sm font-medium">
            Telefon

            <input
              name="phone"
              type="tel"
              defaultValue={organization?.phone ?? ""}
              placeholder="0212 000 00 00"
              className="mt-2 w-full rounded-xl border border-line bg-panel px-4 py-3 text-sm outline-none transition focus:border-terra-500"
            />
          </label>

          <label className="block text-sm font-medium">
            E-posta

            <input
              name="email"
              type="email"
              defaultValue={organization?.email ?? ""}
              placeholder="kurum@ornek.com"
              className="mt-2 w-full rounded-xl border border-line bg-panel px-4 py-3 text-sm outline-none transition focus:border-terra-500"
            />
          </label>

          <button
            type="submit"
            className="rounded-xl bg-terra-700 shadow-sm shadow-terra-700/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-500/50 px-5 py-3 text-sm font-semibold text-white transition hover:bg-terra-700/90"
          >
            Kaydet
          </button>
        </form>
      </Card>
    </>
  );
}
