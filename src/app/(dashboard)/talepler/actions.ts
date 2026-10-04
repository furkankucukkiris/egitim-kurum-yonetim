"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { requireRole } from "@/lib/auth";
import { dispatchPendingNotifications } from "@/lib/notifications/dispatch";
import { createClient } from "@/lib/supabase/server";

function readText(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

// Sonuç mesajıyla birlikte listeye geri döner; mevcut filtre korunur.
function back(formData: FormData, kind: "success" | "error", message: string): never {
  const params = new URLSearchParams();
  const filter = readText(formData, "filter");
  const session = readText(formData, "returnSession");

  if (filter) params.set("durum", filter);
  if (session) params.set("seans", session);
  params.set(kind, message);

  redirect(`/talepler?${params.toString()}`);
}

// Tetikleyicilerin kuyruğa eklediği bildirimleri yanıt beklemeden gönder;
// burada gönderilemezse pg_cron bir dakika içinde tekrar dener.
function sendNotificationsAfterResponse() {
  after(async () => {
    try {
      await dispatchPendingNotifications();
    } catch (error) {
      console.error("Bildirimler gönderilemedi:", error);
    }
  });
}

// Veritabanı fonksiyonlarının raise ettiği Türkçe mesajlar (P0001)
// doğrudan kullanıcıya gösterilir; diğer hatalar genel mesaja düşer.
function errorMessage(error: { code?: string; message: string }, fallback: string) {
  return error.code === "P0001" ? error.message : fallback;
}

export async function createTeacherRequest(formData: FormData) {
  await requireRole(["teacher"]);

  const body = readText(formData, "body");
  const studentId = readText(formData, "studentId") || null;
  const lessonSessionId = readText(formData, "lessonSessionId") || null;

  if (body.length < 1 || body.length > 2000) {
    back(formData, "error", "Not 1-2000 karakter arasında olmalıdır.");
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("create_teacher_request", {
    p_body: body,
    p_student_id: studentId,
    p_lesson_session_id: lessonSessionId,
  });

  if (error) {
    console.error("Talep oluşturulamadı:", error);
    back(formData, "error", errorMessage(error, "Not kaydedilemedi."));
  }

  revalidatePath("/", "layout");
  sendNotificationsAfterResponse();
  back(formData, "success", "Notunuz yöneticiye iletildi.");
}

export async function replyTeacherRequest(formData: FormData) {
  await requireRole(["admin", "teacher"]);

  const requestId = readText(formData, "requestId");
  const body = readText(formData, "body");
  const resolve = readText(formData, "resolve") === "1";

  if (!requestId) {
    back(formData, "error", "Not veya talep bulunamadı.");
  }

  if (body.length < 1 || body.length > 2000) {
    back(formData, "error", "Yanıt 1-2000 karakter arasında olmalıdır.");
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("reply_teacher_request", {
    p_request_id: requestId,
    p_body: body,
    p_resolve: resolve,
  });

  if (error) {
    console.error("Yanıt kaydedilemedi:", error);
    back(formData, "error", errorMessage(error, "Yanıt kaydedilemedi."));
  }

  revalidatePath("/", "layout");
  sendNotificationsAfterResponse();
  back(formData, "success", resolve ? "Yanıt gönderildi, konu kapatıldı." : "Yanıt gönderildi.");
}

export async function setTeacherRequestStatus(formData: FormData) {
  await requireRole(["admin"]);

  const requestId = readText(formData, "requestId");
  const status = readText(formData, "status");

  if (!requestId || (status !== "open" && status !== "resolved")) {
    back(formData, "error", "Geçersiz işlem.");
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("set_teacher_request_status", {
    p_request_id: requestId,
    p_status: status,
  });

  if (error) {
    console.error("Talep durumu değiştirilemedi:", error);
    back(formData, "error", errorMessage(error, "Durum değiştirilemedi."));
  }

  revalidatePath("/", "layout");
  sendNotificationsAfterResponse();
  back(formData, "success", status === "resolved" ? "Konu kapatıldı." : "Konu yeniden açıldı.");
}
