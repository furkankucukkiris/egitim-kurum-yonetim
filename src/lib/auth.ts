import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AppRole = "admin" | "finance" | "teacher" | "viewer";

export type CurrentProfile = {
  id: string;
  organizationId: string;
  organizationName: string;
  fullName: string;
  role: AppRole;
};

export async function requireProfile(): Promise<CurrentProfile> {
  const supabase = await createClient();

  const {
    data: claimsData,
    error: claimsError,
  } = await supabase.auth.getClaims();

  const userId = claimsData?.claims?.sub;

  if (claimsError || !userId) {
    redirect("/giris");
  }

  const {
    data: profile,
    error: profileError,
  } = await supabase
    .from("profiles")
    .select("id, organization_id, full_name, role, is_active")
    .eq("id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (profileError || !profile) {
    redirect(
      `/giris?error=${encodeURIComponent(
        "Hesabınız aktif bir kurum profiline bağlı değil.",
      )}`,
    );
  }

  const {
    data: organization,
    error: organizationError,
  } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", profile.organization_id)
    .single();

  if (organizationError || !organization) {
    redirect(
      `/giris?error=${encodeURIComponent(
        "Kurum bilgisi bulunamadı.",
      )}`,
    );
  }

  return {
    id: profile.id,
    organizationId: profile.organization_id,
    organizationName: organization.name,
    fullName: profile.full_name,
    role: profile.role as AppRole,
  };
}

export async function requireRole(
  allowedRoles: AppRole[],
): Promise<CurrentProfile> {
  const profile = await requireProfile();

  if (!allowedRoles.includes(profile.role)) {
    redirect("/yetkisiz");
  }

  return profile;
}