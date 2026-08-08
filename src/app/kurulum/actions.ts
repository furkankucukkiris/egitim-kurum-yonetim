"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const ALLOWED_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
const MAX_LOGO_SIZE_BYTES = 2 * 1024 * 1024;

export async function completeInitialSetup(formData: FormData) {
  const organizationName = String(
    formData.get("organizationName") ?? "",
  ).trim();

  const fullName = String(formData.get("fullName") ?? "").trim();
  const logoFile = formData.get("logo");

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

  let logoPath: string | undefined;

  if (logoFile instanceof File && logoFile.size > 0) {
    if (!ALLOWED_LOGO_TYPES.includes(logoFile.type)) {
      redirect(
        `/kurulum?error=${encodeURIComponent(
          "Logo yalnızca PNG, JPEG, WEBP veya SVG olabilir.",
        )}`,
      );
    }

    if (logoFile.size > MAX_LOGO_SIZE_BYTES) {
      redirect(
        `/kurulum?error=${encodeURIComponent("Logo dosyası en fazla 2 MB olabilir.")}`,
      );
    }

    const extension =
      logoFile.type.split("/")[1] === "svg+xml" ? "svg" : logoFile.type.split("/")[1];
    const path = `${claimsData.claims.sub}/logo-${Date.now()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from("organization-logos")
      .upload(path, logoFile, { upsert: true, contentType: logoFile.type });

    if (uploadError) {
      console.error("Logo yüklenemedi:", uploadError);
    } else {
      logoPath = path;
    }
  }

  const { error } = await supabase.rpc("bootstrap_first_admin", {
    p_organization_name: organizationName,
    p_full_name: fullName,
    p_logo_path: logoPath ?? null,
  });

  if (error) {
    redirect(`/kurulum?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/");
}