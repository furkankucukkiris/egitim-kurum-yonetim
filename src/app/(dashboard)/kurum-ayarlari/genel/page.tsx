import { Card } from "@/components/ui/Card";
import { LogoField } from "@/components/settings/LogoField";
import { SettingsAlert } from "@/components/settings/SettingsAlert";
import { requireRole } from "@/lib/auth";
import { updateOrganizationSettings } from "../actions";

type GeneralSettingsPageProps = {
  searchParams: Promise<{
    success?: string;
    error?: string;
  }>;
};

export default async function GeneralSettingsPage({ searchParams }: GeneralSettingsPageProps) {
  const profile = await requireRole(["admin"]);
  const params = await searchParams;

  return (
    <>
      <SettingsAlert success={params.success} error={params.error} />

      <Card className="max-w-xl p-6">
        <form action={updateOrganizationSettings} className="space-y-5">
          <label className="block text-sm font-medium">
            Kurum adı
            <input
              name="organizationName"
              type="text"
              required
              minLength={2}
              defaultValue={profile.organizationName}
              className="mt-2 w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm outline-none transition focus:border-primary"
            />
          </label>

          <LogoField currentLogoUrl={profile.organizationLogoUrl} />

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
