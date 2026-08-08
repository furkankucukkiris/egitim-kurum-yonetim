"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function addSessionComment(formData: FormData) {
  const profile = await requireRole(["admin", "teacher"]);

  const lessonSessionId = String(formData.get("lessonSessionId") ?? "").trim();
  const date = String(formData.get("date") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();

  if (!lessonSessionId) {
    redirect(
      `/yoklama?date=${date}&error=${encodeURIComponent("Oturum bilgisi bulunamadı.")}`,
    );
  }

  if (body.length < 1 || body.length > 2000) {
    redirect(
      `/yoklama?date=${date}&error=${encodeURIComponent(
        "Yorum 1-2000 karakter arasında olmalıdır.",
      )}`,
    );
  }

  const supabase = await createClient();

  const { error } = await supabase.from("lesson_session_comments").insert({
    organization_id: profile.organizationId,
    lesson_session_id: lessonSessionId,
    author_profile_id: profile.id,
    body,
  });

  if (error) {
    console.error("Yorum eklenemedi:", error);

    redirect(
      `/yoklama?date=${date}&error=${encodeURIComponent("Yorum eklenemedi.")}`,
    );
  }

  revalidatePath("/yoklama");

  redirect(
    `/yoklama?date=${date}&success=${encodeURIComponent("Yorum eklendi.")}`,
  );
}

export async function deleteSessionComment(formData: FormData) {
  await requireRole(["admin"]);

  const commentId = String(formData.get("commentId") ?? "").trim();
  const date = String(formData.get("date") ?? "").trim();

  if (!commentId) {
    redirect(
      `/yoklama?date=${date}&error=${encodeURIComponent("Yorum bulunamadı.")}`,
    );
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("lesson_session_comments")
    .delete()
    .eq("id", commentId);

  if (error) {
    console.error("Yorum silinemedi:", error);

    redirect(
      `/yoklama?date=${date}&error=${encodeURIComponent("Yorum silinemedi.")}`,
    );
  }

  revalidatePath("/yoklama");

  redirect(
    `/yoklama?date=${date}&success=${encodeURIComponent("Yorum silindi.")}`,
  );
}
