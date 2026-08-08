import { PageHeader } from "@/components/page-header";
import { SettingsTabs } from "@/components/settings/SettingsTabs";
import { requireRole } from "@/lib/auth";

export default async function KurumAyarlariLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole(["admin"]);

  return (
    <>
      <PageHeader
        title="Kurum Ayarları"
        description="Kurumunun temel bilgilerini, iletişim kanallarını ve otomasyon ayarlarını yönetin."
      />

      <SettingsTabs />

      {children}
    </>
  );
}
