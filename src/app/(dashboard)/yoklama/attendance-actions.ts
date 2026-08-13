"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type AttendanceEntry = {
  student_id: string;
  status:
    "present" | "absent" | "excused" | "makeup_due" | "makeup_completed" | "institution_cancelled";
  note?: string;
  notify_guardian?: boolean;
};

export async function markAttendance(formData: FormData) {
  await requireRole(["admin", "teacher"]);

  const lessonSessionId = readText(formData, "lessonSessionId");
  const date = readText(formData, "date");
  const entriesRaw = readText(formData, "entries");

  if (!lessonSessionId) {
    redirect(`/yoklama?date=${date}&error=${encodeURIComponent("Oturum bilgisi bulunamadı.")}`);
  }

  let entries: AttendanceEntry[];

  try {
    entries = JSON.parse(entriesRaw || "[]");
  } catch {
    entries = [];
  }

  if (!Array.isArray(entries) || entries.length === 0) {
    redirect(
      `/yoklama?date=${date}&error=${encodeURIComponent(
        "En az bir öğrenci için yoklama girilmelidir.",
      )}`,
    );
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("mark_attendance", {
    p_lesson_session_id: lessonSessionId,
    p_entries: entries,
  });

  if (error) {
    console.error("Yoklama kaydedilemedi:", error);

    redirect(`/yoklama?date=${date}&error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/yoklama");

  redirect(`/yoklama?date=${date}&success=${encodeURIComponent("Yoklama kaydedildi.")}`);
}

export async function lockSessionAttendance(formData: FormData) {
  await requireRole(["admin"]);

  const lessonSessionId = readText(formData, "lessonSessionId");
  const date = readText(formData, "date");

  if (!lessonSessionId) {
    redirect(`/yoklama?date=${date}&error=${encodeURIComponent("Oturum bilgisi bulunamadı.")}`);
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("lock_session_attendance", {
    p_lesson_session_id: lessonSessionId,
  });

  if (error) {
    console.error("Yoklama kilitlenemedi:", error);

    redirect(`/yoklama?date=${date}&error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/yoklama");

  redirect(`/yoklama?date=${date}&success=${encodeURIComponent("Yoklama kilitlendi.")}`);
}

export async function unlockSessionAttendance(formData: FormData) {
  await requireRole(["admin"]);

  const lessonSessionId = readText(formData, "lessonSessionId");
  const date = readText(formData, "date");
  const reason = readText(formData, "reason");

  if (!lessonSessionId) {
    redirect(`/yoklama?date=${date}&error=${encodeURIComponent("Oturum bilgisi bulunamadı.")}`);
  }

  if (reason.length < 3) {
    redirect(
      `/yoklama?date=${date}&error=${encodeURIComponent(
        "Kilidi açma gerekçesi en az 3 karakter olmalıdır.",
      )}`,
    );
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("unlock_session_attendance", {
    p_lesson_session_id: lessonSessionId,
    p_reason: reason,
  });

  if (error) {
    console.error("Yoklama kilidi açılamadı:", error);

    redirect(`/yoklama?date=${date}&error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/yoklama");

  redirect(`/yoklama?date=${date}&success=${encodeURIComponent("Yoklama kilidi açıldı.")}`);
}

function readText(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}
