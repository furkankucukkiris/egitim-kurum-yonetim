"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function cancelSession(formData: FormData) {
  await requireRole(["admin"]);

  const lessonSessionId = readText(formData, "lessonSessionId");
  const date = readText(formData, "date");
  const reason = readText(formData, "reason");
  const cancellationKind = readText(formData, "cancellationKind") || "institution";

  if (!lessonSessionId) {
    redirect(errorRedirect(date, "Oturum bilgisi bulunamadı."));
  }

  if (reason.length < 3) {
    redirect(errorRedirect(date, "İptal gerekçesi en az 3 karakter olmalıdır."));
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("cancel_lesson_session", {
    p_lesson_session_id: lessonSessionId,
    p_reason: reason,
    p_cancellation_kind: cancellationKind,
  });

  if (error) {
    console.error("Ders oturumu iptal edilemedi:", error);
    redirect(errorRedirect(date, error.message));
  }

  revalidatePath("/yoklama");
  redirect(successRedirect(date, "Ders oturumu iptal edildi."));
}

export async function rescheduleSession(formData: FormData) {
  await requireRole(["admin"]);

  const lessonSessionId = readText(formData, "lessonSessionId");
  const date = readText(formData, "date");
  const reason = readText(formData, "reason");
  const newDate = readText(formData, "newDate");
  const newStartTime = readText(formData, "newStartTime");
  const newEndTime = readText(formData, "newEndTime");

  if (!lessonSessionId) {
    redirect(errorRedirect(date, "Oturum bilgisi bulunamadı."));
  }

  if (reason.length < 3) {
    redirect(errorRedirect(date, "Yeniden planlama gerekçesi en az 3 karakter olmalıdır."));
  }

  const newStartsAt = toIstanbulTimestamp(newDate, newStartTime);
  const newEndsAt = toIstanbulTimestamp(newDate, newEndTime);

  if (!newStartsAt || !newEndsAt) {
    redirect(errorRedirect(date, "Geçerli bir yeni tarih ve saat girilmelidir."));
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("reschedule_lesson_session", {
    p_lesson_session_id: lessonSessionId,
    p_new_starts_at: newStartsAt,
    p_new_ends_at: newEndsAt,
    p_reason: reason,
  });

  if (error) {
    console.error("Ders oturumu yeniden planlanamadı:", error);
    await logRejectedSchedulingAttempt(supabase, "lesson_sessions", "reschedule_rejected", error, {
      lessonSessionId,
      newStartsAt,
      newEndsAt,
    });
    redirect(errorRedirect(date, error.message));
  }

  revalidatePath("/yoklama");
  redirect(successRedirect(date, "Ders oturumu yeniden planlandı."));
}

export async function requestSessionChange(formData: FormData) {
  await requireRole(["admin", "teacher"]);

  const lessonSessionId = readText(formData, "lessonSessionId");
  const date = readText(formData, "date");
  const requestType = readText(formData, "requestType");
  const reason = readText(formData, "reason");
  const proposedDate = readText(formData, "proposedDate");
  const proposedStartTime = readText(formData, "proposedStartTime");
  const proposedEndTime = readText(formData, "proposedEndTime");

  if (!lessonSessionId) {
    redirect(errorRedirect(date, "Oturum bilgisi bulunamadı."));
  }

  if (requestType !== "cancel" && requestType !== "reschedule") {
    redirect(errorRedirect(date, "Geçersiz talep türü."));
  }

  if (reason.length < 3) {
    redirect(errorRedirect(date, "Talep gerekçesi en az 3 karakter olmalıdır."));
  }

  let proposedStartsAt: string | null = null;
  let proposedEndsAt: string | null = null;

  if (requestType === "reschedule") {
    proposedStartsAt = toIstanbulTimestamp(proposedDate, proposedStartTime);
    proposedEndsAt = toIstanbulTimestamp(proposedDate, proposedEndTime);

    if (!proposedStartsAt || !proposedEndsAt) {
      redirect(
        errorRedirect(date, "Yeniden planlama talebi için önerilen tarih/saat girilmelidir."),
      );
    }
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("request_session_change", {
    p_lesson_session_id: lessonSessionId,
    p_request_type: requestType,
    p_reason: reason,
    p_proposed_starts_at: proposedStartsAt,
    p_proposed_ends_at: proposedEndsAt,
  });

  if (error) {
    console.error("Değişiklik talebi oluşturulamadı:", error);
    redirect(errorRedirect(date, error.message));
  }

  revalidatePath("/yoklama");
  redirect(successRedirect(date, "Talebiniz yöneticiye iletildi."));
}

export async function reviewSessionChangeRequest(formData: FormData) {
  await requireRole(["admin"]);

  const requestId = readText(formData, "requestId");
  const date = readText(formData, "date");
  const approve = readText(formData, "approve") === "true";
  const reviewNote = readText(formData, "reviewNote");

  if (!requestId) {
    redirect(errorRedirect(date, "Talep bilgisi bulunamadı."));
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("review_session_change_request", {
    p_request_id: requestId,
    p_approve: approve,
    p_review_note: reviewNote || null,
  });

  if (error) {
    console.error("Değişiklik talebi değerlendirilemedi:", error);
    redirect(errorRedirect(date, error.message));
  }

  revalidatePath("/yoklama");
  redirect(
    successRedirect(date, approve ? "Talep onaylandı ve uygulandı." : "Talep reddedildi."),
  );
}

export async function scheduleMakeupIntoSession(formData: FormData) {
  await requireRole(["admin"]);

  const creditId = readText(formData, "creditId");
  const date = readText(formData, "date");
  const targetLessonSessionId = readText(formData, "targetLessonSessionId");

  if (!creditId || !targetLessonSessionId) {
    redirect(errorRedirect(date, "Telafi veya hedef oturum bilgisi eksik."));
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("schedule_makeup", {
    p_credit_id: creditId,
    p_target_lesson_session_id: targetLessonSessionId,
  });

  if (error) {
    console.error("Telafi planlanamadı:", error);
    await logRejectedSchedulingAttempt(supabase, "makeup_credits", "makeup_rejected", error, {
      creditId,
      targetLessonSessionId,
    });
    redirect(errorRedirect(date, error.message));
  }

  revalidatePath("/yoklama");
  redirect(successRedirect(date, "Telafi, seçilen gruba eklendi."));
}

export async function scheduleMakeupNewSession(formData: FormData) {
  await requireRole(["admin"]);

  const creditId = readText(formData, "creditId");
  const date = readText(formData, "date");
  const teacherProfileId = readText(formData, "teacherProfileId");
  const roomName = readText(formData, "roomName");
  const newDate = readText(formData, "newDate");
  const newStartTime = readText(formData, "newStartTime");
  const newEndTime = readText(formData, "newEndTime");

  if (!creditId) {
    redirect(errorRedirect(date, "Telafi hakkı bilgisi bulunamadı."));
  }

  if (!teacherProfileId) {
    redirect(errorRedirect(date, "Telafi oturumu için öğretmen seçilmelidir."));
  }

  const newStartsAt = toIstanbulTimestamp(newDate, newStartTime);
  const newEndsAt = toIstanbulTimestamp(newDate, newEndTime);

  if (!newStartsAt || !newEndsAt) {
    redirect(errorRedirect(date, "Geçerli bir tarih ve saat girilmelidir."));
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("schedule_makeup", {
    p_credit_id: creditId,
    p_new_teacher_profile_id: teacherProfileId,
    p_new_room_name: roomName || null,
    p_new_starts_at: newStartsAt,
    p_new_ends_at: newEndsAt,
  });

  if (error) {
    console.error("Telafi oturumu oluşturulamadı:", error);
    await logRejectedSchedulingAttempt(supabase, "lesson_sessions", "makeup_new_session_rejected", error, {
      creditId,
      teacherProfileId,
      newStartsAt,
      newEndsAt,
    });
    redirect(errorRedirect(date, error.message));
  }

  revalidatePath("/yoklama");
  redirect(successRedirect(date, "Yeni telafi oturumu oluşturuldu."));
}

export async function cancelMakeupCredit(formData: FormData) {
  await requireRole(["admin"]);

  const creditId = readText(formData, "creditId");
  const date = readText(formData, "date");
  const reason = readText(formData, "reason");

  if (!creditId) {
    redirect(errorRedirect(date, "Telafi hakkı bilgisi bulunamadı."));
  }

  if (reason.length < 3) {
    redirect(errorRedirect(date, "İptal gerekçesi en az 3 karakter olmalıdır."));
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("cancel_makeup_credit", {
    p_credit_id: creditId,
    p_reason: reason,
  });

  if (error) {
    console.error("Telafi hakkı iptal edilemedi:", error);
    redirect(errorRedirect(date, error.message));
  }

  revalidatePath("/yoklama");
  redirect(successRedirect(date, "Telafi hakkı iptal edildi."));
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;
type RpcError = { message: string; code?: string | null };

// Reddedilen bir çakışma/kapasite girişimini AYRI bir istekte kaydeder
// (birincil RPC'nin rollback olan transaction'ından bağımsız — bkz.
// src/app/(dashboard)/program/actions.ts'teki aynı desen). Yalnızca
// RPC'nin kendi bilinçli reddi (P0001) için çağrılır.
async function logRejectedSchedulingAttempt(
  supabase: SupabaseServerClient,
  tableName: string,
  action: string,
  error: RpcError,
  payload: unknown,
) {
  if (error.code !== "P0001") {
    return;
  }

  const { error: logError } = await supabase.rpc("log_rejected_scheduling_attempt", {
    p_table_name: tableName,
    p_action: action,
    p_reason: error.message,
    p_payload: payload as Record<string, unknown>,
  });

  if (logError) {
    console.error("Reddedilen işlem kaydedilemedi:", logError);
  }
}

function toIstanbulTimestamp(date: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    return null;
  }

  return `${date}T${time}:00+03:00`;
}

function errorRedirect(date: string, message: string) {
  return `/yoklama?date=${date}&error=${encodeURIComponent(message)}`;
}

function successRedirect(date: string, message: string) {
  return `/yoklama?date=${date}&success=${encodeURIComponent(message)}`;
}

function readText(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}
