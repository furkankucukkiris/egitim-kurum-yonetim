import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AppRole = "admin" | "finance" | "teacher" | "viewer";

export type CurrentProfile = {
  id: string;
  organizationId: string;
  organizationName: string;
  organizationLogoUrl: string | null;
  fullName: string;
  email: string | null;
  role: AppRole;
  mustChangePassword: boolean;
};

export async function requireProfile(): Promise<CurrentProfile> {
  return loadProfile(false);
}

export async function requirePasswordChangeProfile(): Promise<CurrentProfile> {
  return loadProfile(true);
}

async function loadProfile(
  allowRequiredPasswordChange: boolean,
): Promise<CurrentProfile> {
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
    .select(`
      id,
      organization_id,
      full_name,
      email,
      role,
      is_active,
      must_change_password
    `)
    .eq("id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (profileError || !profile) {
    // Bu kullanıcının hiç profili yoksa (yeni bir kurum için
    // oluşturulmuş yeni bir kullanıcı olabilir — sistemde başka
    // kurumlar olsa bile) kendi kurulumuna yönlendirilir. Profili
    // var ama pasifse (RLS bunu normal sorgudan gizler) hesap
    // erişimi ekranı gösterilir.
    const { data: hasOwnProfile } = await supabase.rpc(
      "current_user_profile_exists",
    );

    redirect(hasOwnProfile ? "/hesap-erisimi" : "/kurulum");
  }

  const {
    data: organization,
    error: organizationError,
  } = await supabase
    .from("organizations")
    .select("name, logo_path")
    .eq("id", profile.organization_id)
    .single();

  if (organizationError || !organization) {
    redirect("/hesap-erisimi");
  }

  if (
    profile.must_change_password &&
    !allowRequiredPasswordChange
  ) {
    redirect("/parola-yenile");
  }

  const organizationLogoUrl = organization.logo_path
    ? supabase.storage
        .from("organization-logos")
        .getPublicUrl(organization.logo_path).data.publicUrl
    : null;

  return {
    id: profile.id,
    organizationId: profile.organization_id,
    organizationName: organization.name,
    organizationLogoUrl,
    fullName: profile.full_name,
    email: profile.email,
    role: profile.role as AppRole,
    mustChangePassword:
      profile.must_change_password,
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
