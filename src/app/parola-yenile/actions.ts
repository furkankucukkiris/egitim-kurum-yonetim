"use server";

import { redirect } from "next/navigation";
import { requirePasswordChangeProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type PasswordActionState = {
  error: string | null;
};

export async function changeRequiredPassword(
  _previousState: PasswordActionState,
  formData: FormData,
): Promise<PasswordActionState> {
  const profile = await requirePasswordChangeProfile();

  if (!profile.mustChangePassword) {
    redirect(profile.role === "teacher" ? "/ogretmen-paneli" : "/");
  }

  const password = String(formData.get("password") ?? "");

  const passwordConfirmation = String(formData.get("passwordConfirmation") ?? "");

  if (!isStrongPassword(password)) {
    return {
      error: "Parola en az 12 karakter olmalı; büyük harf, küçük harf ve rakam içermelidir.",
    };
  }

  if (password !== passwordConfirmation) {
    return {
      error: "Parola tekrarları eşleşmiyor.",
    };
  }

  const supabase = await createClient();

  const { error: passwordError } = await supabase.auth.updateUser({
    password,
  });

  if (passwordError) {
    console.error("Parola güncellenemedi:", passwordError);

    return {
      error: "Parola güncellenemedi. Lütfen farklı bir parola deneyin.",
    };
  }

  const { error: profileError } = await supabase.rpc("complete_required_password_change");

  if (profileError) {
    console.error("Parola zorunluluğu kaldırılamadı:", profileError);

    return {
      error: "Parola değiştirildi ancak hesap kurulumu tamamlanamadı. Lütfen tekrar deneyin.",
    };
  }

  redirect(profile.role === "teacher" ? "/ogretmen-paneli" : "/");
}

function isStrongPassword(password: string) {
  return (
    password.length >= 12 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password)
  );
}
