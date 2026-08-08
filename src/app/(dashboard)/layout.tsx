import { AppShell } from "@/components/app-shell";
import { requireProfile } from "@/lib/auth";

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const profile = await requireProfile();

  return (
    <AppShell
      institution={profile.organizationName}
      institutionLogoUrl={profile.organizationLogoUrl}
      userName={profile.fullName}
      userRole={profile.role}
    >
      {children}
    </AppShell>
  );
}