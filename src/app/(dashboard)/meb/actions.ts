"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function updateCourseMebInfo(
  formData: FormData,
) {
  await requireRole(["admin"]);

  const courseId = readText(
    formData,
    "courseId",
  );

  const status = readText(
    formData,
    "status",
  );

  if (!courseId) {
    redirect("/meb");
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc(
    "set_course_meb_info",
    {
      p_course_id: courseId,
      p_status: status,

      p_program_name:
        readText(
          formData,
          "programName",
        ) || null,

      p_program_code:
        readText(
          formData,
          "programCode",
        ) || null,

      p_approval_number:
        readText(
          formData,
          "approvalNumber",
        ) || null,

      p_valid_from:
        readText(
          formData,
          "validFrom",
        ) || null,

      p_valid_until:
        readText(
          formData,
          "validUntil",
        ) || null,

      p_note:
        readText(
          formData,
          "note",
        ) || null,
    },
  );

  if (error) {
    console.error(
      "Ders MEB bilgisi güncellenemedi:",
      error,
    );

    redirect(
      `/meb?error=${encodeURIComponent(
        process.env.NODE_ENV === "development"
          ? error.message
          : "Ders MEB bilgisi güncellenemedi.",
      )}`,
    );
  }

  revalidatePath("/meb");
  revalidatePath("/program");
  revalidatePath("/meb-yoklama");

  redirect(
    `/meb?success=${encodeURIComponent(
      "Dersin MEB bilgileri güncellendi.",
    )}`,
  );
}

export async function updateTeacherCourseMeb(
  formData: FormData,
) {
  await requireRole(["admin"]);

  const teacherProfileId = readText(
    formData,
    "teacherProfileId",
  );

  const courseId = readText(
    formData,
    "courseId",
  );

  if (!teacherProfileId || !courseId) {
    redirect(
      `/meb?error=${encodeURIComponent(
        "Öğretmen veya ders bilgisi bulunamadı.",
      )}`,
    );
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc(
    "set_teacher_course_meb_authorization",
    {
      p_teacher_profile_id:
        teacherProfileId,

      p_course_id:
        courseId,

      p_status:
        readText(
          formData,
          "status",
        ),

      p_document_number:
        readText(
          formData,
          "documentNumber",
        ) || null,

      p_valid_from:
        readText(
          formData,
          "validFrom",
        ) || null,

      p_valid_until:
        readText(
          formData,
          "validUntil",
        ) || null,

      p_note:
        readText(
          formData,
          "note",
        ) || null,
    },
  );

  if (error) {
    console.error(
      "Öğretmen MEB yetkisi güncellenemedi:",
      error,
    );

    redirect(
      `/meb?error=${encodeURIComponent(
        process.env.NODE_ENV === "development"
          ? error.message
          : "Öğretmen MEB yetkisi güncellenemedi.",
      )}`,
    );
  }

  revalidatePath("/meb");
  revalidatePath("/program");
  revalidatePath("/meb-yoklama");

  redirect(
    `/meb?success=${encodeURIComponent(
      "Öğretmen-ders MEB yetkisi güncellendi.",
    )}`,
  );
}

function readText(
  formData: FormData,
  name: string,
) {
  return String(
    formData.get(name) ?? "",
  ).trim();
}