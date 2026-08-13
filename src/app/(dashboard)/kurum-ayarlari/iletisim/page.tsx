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

export default async function ContactSettingsPage({ searchParams }: ContactSettingsPageProps) {
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
        <p className="mb-5 text-sm text-text-secondary">
          Bu bilgiler kayıt formu gibi çıktılarda ve gelecekte eklenecek resmi belgelerde
          kullanılır.
        </p>

        <form action={updateContactInfo} className="space-y-5">
          <label className="block text-sm font-medium">
            Resmi ünvan
            <input
              name="legalName"
              type="text"
              defaultValue={organization?.legal_name ?? ""}
              placeholder="Kurumun resmi/ticari ünvanı"
              className="mt-2 w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm outline-none transition focus:border-primary"
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
              className="mt-2 w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm outline-none transition focus:border-primary"
            />
          </label>

          <label className="block text-sm font-medium">
            Telefon
            <input
              name="phone"
              type="tel"
              defaultValue={organization?.phone ?? ""}
              placeholder="0212 000 00 00"
              className="mt-2 w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm outline-none transition focus:border-primary"
            />
          </label>

          <label className="block text-sm font-medium">
            E-posta
            <input
              name="email"
              type="email"
              defaultValue={organization?.email ?? ""}
              placeholder="kurum@ornek.com"
              className="mt-2 w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm outline-none transition focus:border-primary"
            />
          </label>

          <button
            type="submit"
            className="rounded-xl bg-primary shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring px-5 py-3 text-sm font-semibold text-on-primary transition hover:bg-primary-hover"
          >
            Kaydet
          </button>
        </form>
      </Card>
    </>
  );
}
