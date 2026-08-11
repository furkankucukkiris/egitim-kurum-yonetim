"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
const MAX_SIZE_BYTES = 2 * 1024 * 1024;

export async function updateOrganizationSettings(formData: FormData) {
  const profile = await requireRole(["admin"]);

  const name = String(formData.get("organizationName") ?? "").trim();
  const logoFile = formData.get("logo");

  if (name.length < 2) {
    redirect(
      `/kurum-ayarlari/genel?error=${encodeURIComponent("Kurum adı en az 2 karakter olmalıdır.")}`,
    );
  }

  const supabase = await createClient();

  let logoPath: string | undefined;

  if (logoFile instanceof File && logoFile.size > 0) {
    if (!ALLOWED_TYPES.includes(logoFile.type)) {
      redirect(
        `/kurum-ayarlari/genel?error=${encodeURIComponent(
          "Logo yalnızca PNG, JPEG, WEBP veya SVG olabilir.",
        )}`,
      );
    }

    if (logoFile.size > MAX_SIZE_BYTES) {
      redirect(
        `/kurum-ayarlari/genel?error=${encodeURIComponent("Logo dosyası en fazla 2 MB olabilir.")}`,
      );
    }

    const extension = logoFile.type.split("/")[1] === "svg+xml" ? "svg" : logoFile.type.split("/")[1];
    const path = `${profile.id}/logo-${Date.now()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from("organization-logos")
      .upload(path, logoFile, { upsert: true, contentType: logoFile.type });

    if (uploadError) {
      console.error("Logo yüklenemedi:", uploadError);

      redirect(
        `/kurum-ayarlari/genel?error=${encodeURIComponent("Logo yüklenemedi. Lütfen tekrar deneyin.")}`,
      );
    }

    logoPath = path;
  }

  const updatePayload: { name: string; logo_path?: string } = { name };

  if (logoPath) {
    updatePayload.logo_path = logoPath;
  }

  const { error: updateError } = await supabase
    .from("organizations")
    .update(updatePayload)
    .eq("id", profile.organizationId);

  if (updateError) {
    console.error("Kurum ayarları güncellenemedi:", updateError);

    redirect(
      `/kurum-ayarlari/genel?error=${encodeURIComponent("Kurum ayarları güncellenemedi.")}`,
    );
  }

  revalidatePath("/kurum-ayarlari/genel");
  revalidatePath("/", "layout");

  redirect(
    `/kurum-ayarlari/genel?success=${encodeURIComponent("Kurum ayarları güncellendi.")}`,
  );
}

export async function updateContactInfo(formData: FormData) {
  const profile = await requireRole(["admin"]);

  const legalName = String(formData.get("legalName") ?? "").trim();
  const taxNumber = String(formData.get("taxNumber") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLocaleLowerCase("tr-TR");

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    redirect(
      `/kurum-ayarlari/iletisim?error=${encodeURIComponent("Geçerli bir e-posta adresi girin.")}`,
    );
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("organizations")
    .update({
      legal_name: legalName || null,
      tax_number: taxNumber || null,
      phone: phone || null,
      email: email || null,
    })
    .eq("id", profile.organizationId);

  if (error) {
    console.error("Kurum iletişim bilgileri güncellenemedi:", error);

    redirect(
      `/kurum-ayarlari/iletisim?error=${encodeURIComponent("İletişim bilgileri güncellenemedi.")}`,
    );
  }

  revalidatePath("/kurum-ayarlari/iletisim");

  redirect(
    `/kurum-ayarlari/iletisim?success=${encodeURIComponent("İletişim bilgileri güncellendi.")}`,
  );
}

export async function updateWhatsappSettings(formData: FormData) {
  const profile = await requireRole(["admin"]);

  const reminderDay = Number(formData.get("reminderDay"));

  if (!Number.isInteger(reminderDay) || reminderDay < 1 || reminderDay > 28) {
    redirect(
      `/kurum-ayarlari/whatsapp?error=${encodeURIComponent("Gönderim günü 1 ile 28 arasında olmalıdır.")}`,
    );
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("organizations")
    .update({
      whatsapp_reminder_day: reminderDay,
    })
    .eq("id", profile.organizationId);

  if (error) {
    console.error("WhatsApp ayarları güncellenemedi:", error);

    redirect(
      `/kurum-ayarlari/whatsapp?error=${encodeURIComponent("WhatsApp ayarları güncellenemedi.")}`,
    );
  }

  revalidatePath("/kurum-ayarlari/whatsapp");

  redirect(
    `/kurum-ayarlari/whatsapp?success=${encodeURIComponent("WhatsApp ayarları güncellendi.")}`,
  );
}

export async function updateAutomationSettings(formData: FormData) {
  const profile = await requireRole(["admin"]);

  const enabled = formData.get("enabled") === "on";
  const sessionsDay = Number(formData.get("sessionsDay"));
  const accrualsDay = Number(formData.get("accrualsDay"));

  if (!Number.isInteger(sessionsDay) || sessionsDay < 1 || sessionsDay > 28) {
    redirect(
      `/kurum-ayarlari/otomasyon?error=${encodeURIComponent(
        "Ders oturumu üretim günü 1 ile 28 arasında olmalıdır.",
      )}`,
    );
  }

  if (!Number.isInteger(accrualsDay) || accrualsDay < 1 || accrualsDay > 28) {
    redirect(
      `/kurum-ayarlari/otomasyon?error=${encodeURIComponent(
        "Tahakkuk üretim günü 1 ile 28 arasında olmalıdır.",
      )}`,
    );
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("organizations")
    .update({
      monthly_automation_enabled: enabled,
      sessions_generation_day: sessionsDay,
      accruals_generation_day: accrualsDay,
    })
    .eq("id", profile.organizationId);

  if (error) {
    console.error("Otomasyon ayarları güncellenemedi:", error);

    redirect(
      `/kurum-ayarlari/otomasyon?error=${encodeURIComponent(
        "Otomasyon ayarları güncellenemedi.",
      )}`,
    );
  }

  revalidatePath("/kurum-ayarlari/otomasyon");

  redirect(
    `/kurum-ayarlari/otomasyon?success=${encodeURIComponent(
      "Otomasyon ayarları güncellendi.",
    )}`,
  );
}

export async function retryAutomationJob(formData: FormData) {
  const profile = await requireRole(["admin"]);

  const jobType = String(formData.get("jobType") ?? "").trim();
  const period = String(formData.get("period") ?? "").trim();

  if (!["lesson_sessions", "accruals"].includes(jobType)) {
    redirect(
      `/kurum-ayarlari/otomasyon?error=${encodeURIComponent("Geçersiz iş türü.")}`,
    );
  }

  if (!/^\d{4}-\d{2}-01$/.test(period)) {
    redirect(
      `/kurum-ayarlari/otomasyon?error=${encodeURIComponent("Geçersiz dönem.")}`,
    );
  }

  let adminClient;

  try {
    adminClient = createAdminClient();
  } catch (error) {
    console.error("Supabase yönetici istemcisi oluşturulamadı:", error);

    redirect(
      `/kurum-ayarlari/otomasyon?error=${encodeURIComponent(
        "Yeniden deneme anahtarı sunucuda tanımlı değil.",
      )}`,
    );
  }

  const { error } = await adminClient.rpc("run_monthly_automation_job", {
    p_organization_id: profile.organizationId,
    p_job_type: jobType,
    p_period: period,
    p_triggered_by: "manual_retry",
    p_triggered_by_profile_id: profile.id,
  });

  if (error) {
    console.error("Otomasyon işi yeniden denenemedi:", error);

    redirect(
      `/kurum-ayarlari/otomasyon?error=${encodeURIComponent(
        "İşlem yeniden denenemedi.",
      )}`,
    );
  }

  revalidatePath("/kurum-ayarlari/otomasyon");

  redirect(
    `/kurum-ayarlari/otomasyon?success=${encodeURIComponent(
      "İş yeniden başlatıldı.",
    )}`,
  );
}
