"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function generateRegistrationForm(formData: FormData) {
  await requireRole(["admin"]);

  const studentId = String(formData.get("studentId") ?? "").trim();
  const enrollmentId = String(formData.get("enrollmentId") ?? "").trim();

  if (!studentId) {
    redirect("/ogrenciler");
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("generate_student_registration_form", {
    p_student_id: studentId,
    p_enrollment_id: enrollmentId || null,
  });

  if (error) {
    console.error("Resmî kayıt formu oluşturulamadı:", error);

    redirect(
      `/ogrenciler/${studentId}/kayit-formu?error=${encodeURIComponent(
        error.code === "P0001" ? error.message : "Resmî kayıt formu oluşturulamadı.",
      )}`,
    );
  }

  revalidatePath(`/ogrenciler/${studentId}/kayit-formu`);

  redirect(
    `/ogrenciler/${studentId}/kayit-formu?success=${encodeURIComponent(
      "Resmî kayıt formu oluşturuldu.",
    )}`,
  );
}

export async function logRegistrationFormPrint(formId: string) {
  await requireRole(["admin"]);

  const supabase = await createClient();

  const { error } = await supabase.rpc("log_registration_form_print", { p_form_id: formId });

  if (error) {
    console.error("Basım kaydı oluşturulamadı:", error);
  }
}
