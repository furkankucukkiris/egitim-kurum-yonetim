"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { dispatchPendingNotifications } from "@/lib/notifications/dispatch";
import { createClient } from "@/lib/supabase/server";

export type SubscriptionInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string;
};

// İstemci bileşeninden doğrudan çağrılır (form değil); sonuç döner.
export async function savePushSubscription(input: SubscriptionInput) {
  await requireProfile();

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_push_subscription", {
    p_endpoint: input.endpoint,
    p_p256dh: input.p256dh,
    p_auth: input.auth,
    p_user_agent: input.userAgent,
  });

  if (error) {
    console.error("Bildirim aboneliği kaydedilemedi:", error);
    return { ok: false as const, error: "Bu cihaz kaydedilemedi." };
  }

  revalidatePath("/bildirimler");
  return { ok: true as const };
}

export async function deletePushSubscription(endpoint: string) {
  await requireProfile();

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_push_subscription", { p_endpoint: endpoint });

  if (error) {
    console.error("Bildirim aboneliği silinemedi:", error);
    return { ok: false as const, error: "Bu cihazın kaydı silinemedi." };
  }

  revalidatePath("/bildirimler");
  return { ok: true as const };
}

export async function saveNotificationSettings(formData: FormData) {
  await requireProfile();

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_my_notification_settings", {
    p_lesson_reminder: formData.get("lessonReminder") === "on",
    p_attendance_reminder: formData.get("attendanceReminder") === "on",
    p_request_updates: formData.get("requestUpdates") === "on",
  });

  if (error) {
    console.error("Bildirim tercihleri kaydedilemedi:", error);
    redirect(`/bildirimler?error=${encodeURIComponent("Tercihler kaydedilemedi.")}`);
  }

  revalidatePath("/bildirimler");
  redirect(`/bildirimler?success=${encodeURIComponent("Tercihler kaydedildi.")}`);
}

export async function sendTestNotification() {
  await requireProfile();

  const supabase = await createClient();
  const { error } = await supabase.rpc("enqueue_test_notification");

  if (error) {
    console.error("Deneme bildirimi oluşturulamadı:", error);
    return {
      ok: false as const,
      error: error.code === "P0001" ? error.message : "Deneme bildirimi gönderilemedi.",
    };
  }

  const result = await dispatchPendingNotifications();

  if (result.delivered === 0) {
    return {
      ok: false as const,
      error:
        "Bildirim gönderilemedi. Sunucuda bildirim anahtarları tanımlı olmayabilir veya cihazın izni kaldırılmış olabilir.",
    };
  }

  return { ok: true as const };
}
