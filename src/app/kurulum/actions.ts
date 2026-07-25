"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function completeInitialSetup(formData: FormData) {
  const organizationName = String(
    formData.get("organizationName") ?? "",
  ).trim();

  const fullName = String(formData.get("fullName") ?? "").trim();

  if (organizationName.length < 2) {
    redirect(
      `/kurulum?error=${encodeURIComponent(
        "Kurum adı en az 2 karakter olmalıdır.",
      )}`,
    );
  }

  if (fullName.length < 2) {
    redirect(
      `/kurulum?error=${encodeURIComponent(
        "Yönetici adı en az 2 karakter olmalıdır.",
      )}`,
    );
  }

  const supabase = await createClient();

  const {
    data: claimsData,
    error: claimsError,
  } = await supabase.auth.getClaims();

  if (claimsError || !claimsData?.claims?.sub) {
    redirect(
      `/giris?error=${encodeURIComponent(
        "Kurulum için önce giriş yapmalısınız.",
      )}`,
    );
  }

  const { error } = await supabase.rpc("bootstrap_first_admin", {
    p_organization_name: organizationName,
    p_full_name: fullName,
  });

  if (error) {
    redirect(`/kurulum?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/");
}