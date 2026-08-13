"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type CourseActionState = {
  error: string | null;
};

export async function createCourse(
  _previousState: CourseActionState,
  formData: FormData,
): Promise<CourseActionState> {
  await requireRole(["admin"]);

  const values = readAndValidateCourse(formData);

  if ("error" in values) {
    return values;
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("create_course", {
    p_name: values.name,
    p_code: values.code || null,
    p_course_type: values.courseType,
    p_default_duration_minutes: values.durationMinutes,
    p_default_monthly_fee: values.monthlyFee,
  });

  if (error) {
    console.error("Ders oluşturulamadı:", error);

    return {
      error: getDatabaseErrorMessage(error.message),
    };
  }

  revalidatePath("/dersler");

  redirect(`/dersler?success=${encodeURIComponent("Ders tanımı oluşturuldu.")}`);
}

export async function updateCourse(
  _previousState: CourseActionState,
  formData: FormData,
): Promise<CourseActionState> {
  await requireRole(["admin"]);

  const courseId = readText(formData, "courseId");

  if (!courseId) {
    return {
      error: "Ders kimliği bulunamadı.",
    };
  }

  const values = readAndValidateCourse(formData);

  if ("error" in values) {
    return values;
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("update_course", {
    p_course_id: courseId,
    p_name: values.name,
    p_code: values.code || null,
    p_course_type: values.courseType,
    p_default_duration_minutes: values.durationMinutes,
    p_default_monthly_fee: values.monthlyFee,
  });

  if (error) {
    console.error("Ders güncellenemedi:", error);

    return {
      error: getDatabaseErrorMessage(error.message),
    };
  }

  revalidatePath("/dersler");
  revalidatePath(`/dersler/${courseId}`);

  redirect(`/dersler?success=${encodeURIComponent("Ders bilgileri güncellendi.")}`);
}

export async function setCourseActive(formData: FormData) {
  await requireRole(["admin"]);

  const courseId = readText(formData, "courseId");

  const isActive = readText(formData, "isActive") === "true";

  if (!courseId) {
    redirect("/dersler");
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("set_course_active", {
    p_course_id: courseId,
    p_is_active: isActive,
  });

  if (error) {
    console.error("Ders durumu değiştirilemedi:", error);

    redirect(`/dersler?error=${encodeURIComponent(getDatabaseErrorMessage(error.message))}`);
  }

  revalidatePath("/dersler");

  redirect(
    `/dersler?success=${encodeURIComponent(
      isActive ? "Ders tekrar aktifleştirildi." : "Ders pasife alındı.",
    )}`,
  );
}

function readAndValidateCourse(formData: FormData):
  | {
      name: string;
      code: string;
      courseType: "individual" | "group";
      durationMinutes: number;
      monthlyFee: number;
    }
  | CourseActionState {
  const name = readText(formData, "name");
  const code = readText(formData, "code");

  const rawCourseType = readText(formData, "courseType");

  const durationMinutes = Number(readText(formData, "durationMinutes"));

  const monthlyFee = parseMoney(readText(formData, "monthlyFee"));

  if (name.length < 2) {
    return {
      error: "Ders adı en az 2 karakter olmalıdır.",
    };
  }

  if (rawCourseType !== "individual" && rawCourseType !== "group") {
    return {
      error: "Geçerli bir ders türü seçin.",
    };
  }

  if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 480) {
    return {
      error: "Ders süresi 15 ile 480 dakika arasında olmalıdır.",
    };
  }

  if (monthlyFee === null || monthlyFee < 0) {
    return {
      error: "Geçerli bir aylık ücret girin.",
    };
  }

  return {
    name,
    code,
    courseType: rawCourseType,
    durationMinutes,
    monthlyFee,
  };
}

function parseMoney(value: string) {
  const normalized = value.replace(/\s/g, "").replace(",", ".");

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    return null;
  }

  const amount = Number(normalized);

  return Number.isFinite(amount) ? amount : null;
}

function readText(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function getDatabaseErrorMessage(message: string) {
  if (message.includes("Aynı ders adı veya ders koduyla")) {
    return "Aynı ders adı veya ders koduyla daha önce bir kayıt oluşturulmuş.";
  }

  if (process.env.NODE_ENV === "development") {
    return `Veritabanı hatası: ${message}`;
  }

  return "Ders işlemi tamamlanamadı.";
}
