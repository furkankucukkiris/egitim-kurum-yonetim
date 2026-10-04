import { AppShell } from "@/components/app-shell";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const profile = await requireProfile();

  // Yönetici için açık talep sayısı, öğretmen için görülmemiş yanıtı olan
  // konu sayısı. Sayaç alınamazsa menü sayaçsız gösterilir.
  const supabase = await createClient();
  const { data: requestBadge, error: requestBadgeError } = await supabase.rpc(
    "teacher_request_badge_count",
  );

  if (requestBadgeError) {
    console.error("Talep sayacı alınamadı:", requestBadgeError);
  }

  return (
    <AppShell
      institution={profile.organizationName}
      institutionLogoUrl={profile.organizationLogoUrl}
      userName={profile.fullName}
      userRole={profile.role}
      badges={{ "/talepler": typeof requestBadge === "number" ? requestBadge : 0 }}
    >
      {children}
    </AppShell>
  );
}
