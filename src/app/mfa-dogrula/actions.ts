"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function verifyMfaChallenge(formData: FormData) {
  const supabase = await createClient();

  const code = String(formData.get("code") ?? "").trim();

  const { data: factorsData } = await supabase.auth.mfa.listFactors();

  const factor = factorsData?.totp?.find((item) => item.status === "verified");

  if (!factor) {
    redirect("/mfa-kur");
  }

  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
    factorId: factor.id,
  });

  if (challengeError || !challenge) {
    redirect(
      `/mfa-dogrula?error=${encodeURIComponent("Doğrulama başlatılamadı. Lütfen tekrar deneyin.")}`,
    );
  }

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId: factor.id,
    challengeId: challenge.id,
    code,
  });

  if (verifyError) {
    redirect(`/mfa-dogrula?error=${encodeURIComponent("Kod hatalı veya süresi doldu.")}`);
  }

  redirect("/");
}
