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

export default async function GeneralSettingsPage({
  searchParams,
}: GeneralSettingsPageProps) {
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
              className="mt-2 w-full rounded-xl border border-line bg-panel px-4 py-3 text-sm outline-none transition focus:border-terra-500"
            />
          </label>

          <LogoField currentLogoUrl={profile.organizationLogoUrl} />

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
