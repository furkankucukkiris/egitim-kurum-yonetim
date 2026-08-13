"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function login(formData: FormData) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    redirect(`/giris?error=${encodeURIComponent("Supabase bağlantısı henüz yapılandırılmadı.")}`);
  }

  const supabase = await createClient();

  const email = String(formData.get("email") ?? "")
    .trim()
    .toLocaleLowerCase("tr-TR");

  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    redirect(`/giris?error=${encodeURIComponent("E-posta ve parola zorunludur.")}`);
  }

  const { error: rateLimitError } = await supabase.rpc("check_login_rate_limit", {
    p_email: email,
  });

  if (rateLimitError) {
    redirect(`/giris?error=${encodeURIComponent(rateLimitError.message)}`);
  }

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  await supabase.rpc("record_login_attempt", {
    p_email: email,
    p_succeeded: !error,
  });

  if (error) {
    redirect(`/giris?error=${encodeURIComponent("E-posta veya parola hatalı.")}`);
  }

  redirect("/");
}
