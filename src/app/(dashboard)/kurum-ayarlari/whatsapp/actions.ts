"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getWhatsAppAdapter } from "@/lib/whatsapp/adapter";

export async function updateMessageTemplate(formData: FormData) {
  await requireRole(["admin"]);

  const templateId = readText(formData, "templateId");
  const bodyTemplate = readText(formData, "bodyTemplate");
  const isActive = formData.get("isActive") === "on";

  if (bodyTemplate.length < 10) {
    redirect(
      `/kurum-ayarlari/whatsapp?error=${encodeURIComponent("Mesaj şablonu en az 10 karakter olmalıdır.")}`,
    );
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("message_templates")
    .update({ body_template: bodyTemplate, is_active: isActive })
    .eq("id", templateId);

  if (error) {
    console.error("Mesaj şablonu güncellenemedi:", error);

    redirect(
      `/kurum-ayarlari/whatsapp?error=${encodeURIComponent("Mesaj şablonu güncellenemedi.")}`,
    );
  }

  revalidatePath("/kurum-ayarlari/whatsapp");

  redirect(`/kurum-ayarlari/whatsapp?success=${encodeURIComponent("Şablon güncellendi.")}`);
}

export async function generateUpcomingPaymentReminders(formData: FormData) {
  await requireRole(["admin"]);

  const month = readText(formData, "month");

  if (!isMonthValue(month)) {
    redirect(`/kurum-ayarlari/whatsapp?error=${encodeURIComponent("Geçerli bir ay seçmelisiniz.")}`);
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("generate_upcoming_payment_reminders", {
    p_period_start: `${month}-01`,
  });

  if (error) {
    console.error("Ödeme hatırlatma taslakları oluşturulamadı:", error);

    redirect(
      `/kurum-ayarlari/whatsapp?error=${encodeURIComponent(getDatabaseErrorMessage(error.message))}`,
    );
  }

  const result = (data ?? [])[0] as
    | {
        created_count: number;
        existing_count: number;
        skipped_no_consent_count: number;
        skipped_no_guardian_count: number;
      }
    | undefined;

  const messageParts = [`${result?.created_count ?? 0} yeni taslak oluşturuldu.`];

  if (result && result.existing_count > 0) {
    messageParts.push(`${result.existing_count} mesaj zaten mevcuttu.`);
  }

  if (result && result.skipped_no_consent_count > 0) {
    messageParts.push(`${result.skipped_no_consent_count} veli rıza vermediği için atlandı.`);
  }

  if (result && result.skipped_no_guardian_count > 0) {
    messageParts.push(`${result.skipped_no_guardian_count} öğrencinin kayıtlı velisi yok.`);
  }

  revalidatePath("/kurum-ayarlari/whatsapp");

  redirect(
    `/kurum-ayarlari/whatsapp?status=pending_approval&success=${encodeURIComponent(messageParts.join(" "))}`,
  );
}

export async function approveMessage(formData: FormData) {
  await requireRole(["admin"]);

  const messageId = readText(formData, "messageId");
  const redirectTo = buildQueueRedirect(formData);

  const supabase = await createClient();

  const { error } = await supabase.rpc("approve_outbound_message", {
    p_message_id: messageId,
  });

  if (error) {
    console.error("Mesaj onaylanamadı:", error);

    redirect(withParam(redirectTo, "error", getDatabaseErrorMessage(error.message)));
  }

  revalidatePath("/kurum-ayarlari/whatsapp");

  redirect(withParam(redirectTo, "success", "Mesaj onaylandı."));
}

export async function cancelMessage(formData: FormData) {
  await requireRole(["admin"]);

  const messageId = readText(formData, "messageId");
  const reason = readText(formData, "reason");
  const redirectTo = buildQueueRedirect(formData);

  const supabase = await createClient();

  const { error } = await supabase.rpc("cancel_outbound_message", {
    p_message_id: messageId,
    p_reason: reason || null,
  });

  if (error) {
    console.error("Mesaj iptal edilemedi:", error);

    redirect(withParam(redirectTo, "error", getDatabaseErrorMessage(error.message)));
  }

  revalidatePath("/kurum-ayarlari/whatsapp");

  redirect(withParam(redirectTo, "success", "Mesaj iptal edildi."));
}

export async function retryMessage(formData: FormData) {
  await requireRole(["admin"]);

  const messageId = readText(formData, "messageId");
  const redirectTo = buildQueueRedirect(formData);

  const supabase = await createClient();

  const { error } = await supabase.rpc("retry_outbound_message", {
    p_message_id: messageId,
  });

  if (error) {
    console.error("Mesaj yeniden kuyruğa alınamadı:", error);

    redirect(withParam(redirectTo, "error", getDatabaseErrorMessage(error.message)));
  }

  revalidatePath("/kurum-ayarlari/whatsapp");

  redirect(withParam(redirectTo, "success", "Mesaj tekrar onaylanmak üzere kuyruğa alındı."));
}

export async function sendMessage(formData: FormData) {
  await requireRole(["admin"]);

  const messageId = readText(formData, "messageId");
  const redirectTo = buildQueueRedirect(formData);

  const supabase = await createClient();

  const { data: message, error: fetchError } = await supabase
    .from("outbound_messages")
    .select("id, status, recipient_phone, rendered_body, idempotency_key")
    .eq("id", messageId)
    .single();

  if (fetchError || !message) {
    console.error("Mesaj kaydı bulunamadı:", fetchError);

    redirect(withParam(redirectTo, "error", "Mesaj kaydı bulunamadı."));
  }

  if (message.status !== "approved") {
    redirect(withParam(redirectTo, "error", "Yalnızca onaylanmış mesajlar gönderilebilir."));
  }

  const { error: sendingError } = await supabase.rpc("mark_outbound_message_sending", {
    p_message_id: messageId,
  });

  if (sendingError) {
    console.error("Mesaj gönderim durumuna alınamadı:", sendingError);

    redirect(withParam(redirectTo, "error", getDatabaseErrorMessage(sendingError.message)));
  }

  const adapter = getWhatsAppAdapter();

  const result = await adapter.send({
    to: message.recipient_phone,
    body: message.rendered_body,
    idempotencyKey: message.idempotency_key,
  });

  const { error: attemptError } = await supabase.rpc("record_delivery_attempt", {
    p_message_id: messageId,
    p_status: result.success ? "success" : "failed",
    p_provider: result.provider,
    p_provider_message_id: result.success ? result.providerMessageId : null,
    p_error_code: result.success ? null : result.errorCode,
    p_error_message: result.success ? null : result.errorMessage,
  });

  if (attemptError) {
    console.error("Gönderim denemesi kaydedilemedi:", attemptError);

    redirect(withParam(redirectTo, "error", getDatabaseErrorMessage(attemptError.message)));
  }

  revalidatePath("/kurum-ayarlari/whatsapp");

  if (result.success) {
    redirect(withParam(redirectTo, "success", "Mesaj gönderildi."));
  }

  if (result.errorCode === "provider_not_configured") {
    redirect(
      withParam(
        redirectTo,
        "success",
        "Mesaj kuyruğa alındı — WhatsApp gönderim entegrasyonu henüz aktif değil, bu yüzden gerçek gönderim yapılamadı.",
      ),
    );
  }

  redirect(withParam(redirectTo, "error", result.errorMessage));
}

function buildQueueRedirect(formData: FormData) {
  const status = readText(formData, "status");

  return status ? `/kurum-ayarlari/whatsapp?status=${status}` : "/kurum-ayarlari/whatsapp";
}

function withParam(url: string, key: string, value: string) {
  return `${url}${url.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
}

function readText(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function isMonthValue(value: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function getDatabaseErrorMessage(message: string) {
  const safeMessages = [
    "Hatırlatma oluşturma yetkiniz bulunmuyor.",
    "Mesaj onaylama yetkiniz bulunmuyor.",
    "Mesaj iptal etme yetkiniz bulunmuyor.",
    "Mesajı tekrar gönderme yetkiniz bulunmuyor.",
    "Mesaj gönderme yetkiniz bulunmuyor.",
    "Gönderim denemesi kaydetme yetkiniz bulunmuyor.",
    "Geçerli bir ay başlangıcı seçilmelidir.",
    "Mesaj kaydı bulunamadı.",
    "Yalnızca onay bekleyen mesajlar onaylanabilir.",
    "Bu durumdaki bir mesaj iptal edilemez.",
    "Yalnızca başarısız mesajlar tekrar denenebilir.",
    "Yalnızca onaylanmış mesajlar gönderilebilir.",
    "Yalnızca gönderim aşamasındaki mesajlar için deneme kaydedilebilir.",
  ];

  const matched = safeMessages.find((item) => message.includes(item));

  if (matched) {
    return matched;
  }

  if (process.env.NODE_ENV === "development") {
    return `Veritabanı hatası: ${message}`;
  }

  return "İşlem gerçekleştirilemedi.";
}
