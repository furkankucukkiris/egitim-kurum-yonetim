"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type CreateStudentState = {
  error: string | null;
};

export async function createStudent(
  _previousState: CreateStudentState,
  formData: FormData,
): Promise<CreateStudentState> {
  const profile = await requireRole(["admin", "finance"]);

  const studentPhoto = formData.get("studentPhoto");

  const studentIdentityNumber = normalizeIdentityNumber(
    readText(formData, "studentIdentityNumber"),
  );

  const guardianIdentityNumber = normalizeIdentityNumber(
    readText(formData, "guardianIdentityNumber"),
  );

  const studentFirstName = readText(
    formData,
    "studentFirstName",
  );

  const studentLastName = readText(
    formData,
    "studentLastName",
  );

  const birthDate = readText(
    formData,
    "birthDate",
  );

  const registrationDate = readText(
    formData,
    "registrationDate",
  );

  const studentNotes = readText(
    formData,
    "studentNotes",
  );

  const guardianFullName = readText(
    formData,
    "guardianFullName",
  );

  const guardianPhone = readText(
    formData,
    "guardianPhone",
  );

  const guardianSecondaryPhone = readText(
    formData,
    "guardianSecondaryPhone",
  );

  const guardianEmail = readText(
    formData,
    "guardianEmail",
  );

  const relationship = readText(
    formData,
    "relationship",
  );

  /*
   * Burada yalnızca biçim kontrolü yapıyoruz.
   * Matematiksel kontrol veya resmî kimlik doğrulaması yapılmıyor.
   */
  if (!isValidIdentityNumberFormat(studentIdentityNumber)) {
    return {
      error:
        "Öğrenci T.C. kimlik numarası 11 rakamdan oluşmalı ve sıfırla başlamamalıdır.",
    };
  }

  if (!isValidIdentityNumberFormat(guardianIdentityNumber)) {
    return {
      error:
        "Veli T.C. kimlik numarası 11 rakamdan oluşmalı ve sıfırla başlamamalıdır.",
    };
  }

  if (studentIdentityNumber === guardianIdentityNumber) {
    return {
      error:
        "Öğrenci ve veli T.C. kimlik numaraları aynı olamaz.",
    };
  }

  if (studentFirstName.length < 2) {
    return {
      error:
        "Öğrenci adı en az 2 karakter olmalıdır.",
    };
  }

  if (studentLastName.length < 2) {
    return {
      error:
        "Öğrenci soyadı en az 2 karakter olmalıdır.",
    };
  }

  if (guardianFullName.length < 2) {
    return {
      error:
        "Veli adı en az 2 karakter olmalıdır.",
    };
  }

  const phoneDigits = guardianPhone.replace(/\D/g, "");

  if (phoneDigits.length < 10) {
    return {
      error:
        "Geçerli bir veli telefon numarası girin.",
    };
  }

  if (
    guardianEmail &&
    !isValidEmail(guardianEmail)
  ) {
    return {
      error:
        "Geçerli bir e-posta adresi girin.",
    };
  }

  if (
    birthDate &&
    !isIsoDate(birthDate)
  ) {
    return {
      error:
        "Doğum tarihi geçerli değil.",
    };
  }

  if (
    !registrationDate ||
    !isIsoDate(registrationDate)
  ) {
    return {
      error:
        "Kayıt tarihi geçerli değil.",
    };
  }

  const supabase = await createClient();

  const { data: studentId, error } = await supabase.rpc(
    "create_student_with_guardian",
    {
      p_student_identity_number:
        studentIdentityNumber,

      p_student_first_name:
        studentFirstName,

      p_student_last_name:
        studentLastName,

      p_guardian_identity_number:
        guardianIdentityNumber,

      p_guardian_full_name:
        guardianFullName,

      p_guardian_phone:
        guardianPhone,

      p_birth_date:
        birthDate || null,

      p_registration_date:
        registrationDate,

      p_student_notes:
        studentNotes || null,

      p_guardian_secondary_phone:
        guardianSecondaryPhone || null,

      p_guardian_email:
        guardianEmail || null,

      p_relationship:
        relationship || "Veli",
    },
  );

  if (error) {
    console.error(
      "Öğrenci kaydı oluşturulamadı:",
      {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      },
    );

    return {
      error: getDatabaseErrorMessage(error),
    };
  }

  if (studentPhoto instanceof File && studentPhoto.size > 0 && studentId) {
    const path = `${profile.organizationId}/${studentId}/photo.png`;

    const { error: uploadError } = await supabase.storage
      .from("student-photos")
      .upload(path, studentPhoto, { upsert: true, contentType: "image/png" });

    if (uploadError) {
      console.error("Öğrenci fotoğrafı yüklenemedi:", uploadError);
    } else {
      const { error: linkError } = await supabase.rpc("set_student_photo", {
        p_student_id: studentId,
        p_photo_path: path,
      });

      if (linkError) {
        console.error("Öğrenci fotoğrafı kaydına bağlanamadı:", linkError);
      }
    }
  }

  revalidatePath("/ogrenciler");

  redirect(`/ogrenciler/${studentId}/kayit-formu?created=true`);
}

function readText(
  formData: FormData,
  name: string,
) {
  return String(formData.get(name) ?? "").trim();
}

function normalizeIdentityNumber(value: string) {
  return value.replace(/\D/g, "");
}

function isValidIdentityNumberFormat(value: string) {
  return /^[1-9][0-9]{10}$/.test(value);
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    value,
  );
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(
    `${value}T00:00:00.000Z`,
  );

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

function getDatabaseErrorMessage(error: {
  code?: string;
  message: string;
  details?: string | null;
  hint?: string | null;
}) {
  if (
    error.message.includes(
      "Bu T.C. kimlik numarasıyla kayıtlı bir öğrenci zaten var.",
    )
  ) {
    return "Bu T.C. kimlik numarasıyla kayıtlı bir öğrenci zaten var.";
  }

  if (
    error.message.includes(
      "Öğrenci ve veli T.C. kimlik numaraları aynı olamaz.",
    )
  ) {
    return "Öğrenci ve veli T.C. kimlik numaraları aynı olamaz.";
  }

  if (
    error.code === "23505"
  ) {
    return "Aynı T.C. kimlik numarasıyla daha önce bir kayıt oluşturulmuş.";
  }

  if (
    process.env.NODE_ENV === "development"
  ) {
    return [
      `Veritabanı hatası: ${error.message}`,
      error.details
        ? `Ayrıntı: ${error.details}`
        : null,
      error.hint
        ? `Öneri: ${error.hint}`
        : null,
    ]
      .filter(Boolean)
      .join(" ");
  }

  return "Öğrenci kaydı oluşturulamadı.";
}