"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function redeemMfaRecoveryCode(formData: FormData) {
  const supabase = await createClient();

  const code = String(formData.get("code") ?? "").trim();

  if (!code) {
    redirect(`/mfa-kurtar?error=${encodeURIComponent("Kurtarma kodu girin.")}`);
  }

  const { data: isValid, error } = await supabase.rpc("verify_and_consume_admin_recovery_code", {
    p_code: code,
  });

  if (error || !isValid) {
    redirect(
      `/mfa-kurtar?error=${encodeURIComponent(
        "Kurtarma kodu geçersiz veya daha önce kullanılmış.",
      )}`,
    );
  }

  const { data: factorsData } = await supabase.auth.mfa.listFactors();

  for (const factor of factorsData?.totp ?? []) {
    await supabase.auth.mfa.unenroll({ factorId: factor.id });
  }

  redirect("/mfa-kur");
}
