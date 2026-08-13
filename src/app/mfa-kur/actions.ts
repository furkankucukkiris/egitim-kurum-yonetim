"use server";

import { createClient } from "@/lib/supabase/server";

export async function storeMfaRecoveryCode(code: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("store_admin_mfa_recovery_code", { p_code: code });

  if (error) {
    console.error("MFA kurtarma kodu kaydedilemedi:", error);

    return {
      ok: false,
      error: "Kurtarma kodu kaydedilemedi. Lütfen tekrar deneyin.",
    };
  }

  return { ok: true };
}
