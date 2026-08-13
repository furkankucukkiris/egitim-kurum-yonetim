import { Card } from "@/components/ui/Card";
import { SettingsAlert } from "@/components/settings/SettingsAlert";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { updateRegistrationTemplates } from "../actions";

type BelgelerPageProps = {
  searchParams: Promise<{
    success?: string;
    error?: string;
  }>;
};

export default async function BelgelerPage({ searchParams }: BelgelerPageProps) {
  const profile = await requireRole(["admin"]);
  const params = await searchParams;

  const supabase = await createClient();

  const { data: organization, error } = await supabase
    .from("organizations")
    .select("registration_institution_rules_text, registration_kvkk_notice_text")
    .eq("id", profile.organizationId)
    .single();

  if (error) {
    console.error("Kurum belge ayarları alınamadı:", error);
  }

  return (
    <>
      <SettingsAlert success={params.success} error={params.error} />

      <Card className="max-w-2xl p-6">
        <h2 className="text-lg font-bold">Resmî kayıt formu şablon metinleri</h2>

        <p className="mt-1 text-sm text-text-secondary">
          Bu metinler resmî kayıt formunda aynen basılır. Hukuki içerik bu ekrandan üretilmez —
          kurumunuzun onayladığı metni buraya girin.
        </p>

        <form action={updateRegistrationTemplates} className="mt-5 space-y-5">
          <label className="block text-sm font-medium">
            Kurum kuralları metni
            <textarea
              name="institutionRulesText"
              rows={8}
              defaultValue={organization?.registration_institution_rules_text ?? ""}
              placeholder="Kurumun devam, ödeme, disiplin vb. kurallarını buraya yazın."
              className="mt-2 w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm outline-none transition focus:border-primary"
            />
          </label>

          <label className="block text-sm font-medium">
            KVKK aydınlatma metni
            <textarea
              name="kvkkNoticeText"
              rows={8}
              defaultValue={organization?.registration_kvkk_notice_text ?? ""}
              placeholder="Kurumun onaylı KVKK aydınlatma metnini buraya yazın."
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
