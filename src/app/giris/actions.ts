"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function login(formData: FormData) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    redirect(
      "/giris?error=Supabase bağlantısı henüz yapılandırılmadı",
    );
  }

  const supabase = await createClient();

  const email = String(formData.get("email") || "");
  const password = String(formData.get("password") || "");

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    redirect(`/giris?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/kurulum");
}