"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type UpdateStudentState = {
  error: string | null;
};

export async function updateStudent(
  _previousState: UpdateStudentState,
  formData: FormData,
): Promise<UpdateStudentState> {
  await requireRole(["admin", "finance"]);

  const studentId = readText(formData, "studentId");
  const primaryGuardianId = readText(
    formData,
    "primaryGuardianId",
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

  const mayReceiveFinancialMessages =
    formData.get("mayReceiveFinancialMessages") === "on";

  if (!studentId || !primaryGuardianId) {
    return {
      error:
        "Öğrenci veya veli kimliği bulunamadı.",
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

  if (
    guardianPhone.replace(/\D/g, "").length < 10
  ) {
    return {
      error:
        "Geçerli bir veli telefonu girin.",
    };
  }

  if (
    guardianEmail &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
      guardianEmail,
    )
  ) {
    return {
      error:
        "Geçerli bir e-posta adresi girin.",
    };
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc(
    "update_student_and_primary_guardian",
    {
      p_student_id: studentId,
      p_primary_guardian_id: primaryGuardianId,

      p_student_first_name: studentFirstName,
      p_student_last_name: studentLastName,
      p_birth_date: birthDate || null,
      p_registration_date: registrationDate,
      p_student_notes: studentNotes || null,

      p_guardian_full_name: guardianFullName,
      p_guardian_phone: guardianPhone,
      p_guardian_secondary_phone:
        guardianSecondaryPhone || null,
      p_guardian_email: guardianEmail || null,
      p_relationship: relationship || "Veli",
      p_may_receive_financial_messages:
        mayReceiveFinancialMessages,
    },
  );

  if (error) {
    console.error(
      "Öğrenci güncellenemedi:",
      error,
    );

    return {
      error:
        process.env.NODE_ENV === "development"
          ? `Veritabanı hatası: ${error.message}`
          : "Öğrenci bilgileri güncellenemedi.",
    };
  }

  revalidatePath("/ogrenciler");
  revalidatePath(`/ogrenciler/${studentId}`);

  redirect(
    `/ogrenciler/${studentId}?success=${encodeURIComponent(
      "Öğrenci ve veli bilgileri güncellendi.",
    )}`,
  );
}

export async function archiveStudent(
  formData: FormData,
) {
  await requireRole(["admin", "finance"]);

  const studentId = readText(
    formData,
    "studentId",
  );

  const exitReason = readText(
    formData,
    "exitReason",
  );

  if (!studentId) {
    redirect("/ogrenciler");
  }

  if (exitReason.length < 3) {
    redirect(
      `/ogrenciler/${studentId}?error=${encodeURIComponent(
        "Arşivleme nedeni en az 3 karakter olmalıdır.",
      )}`,
    );
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc(
    "archive_student",
    {
      p_student_id: studentId,
      p_exit_reason: exitReason,
    },
  );

  if (error) {
    console.error(
      "Öğrenci arşivlenemedi:",
      error,
    );

    redirect(
      `/ogrenciler/${studentId}?error=${encodeURIComponent(
        process.env.NODE_ENV === "development"
          ? error.message
          : "Öğrenci arşivlenemedi.",
      )}`,
    );
  }

  revalidatePath("/ogrenciler");

  redirect(
    `/ogrenciler?success=${encodeURIComponent(
      "Öğrenci arşivlendi.",
    )}`,
  );
}

type AddGuardianState = {
  error: string | null;
};

export async function addGuardian(
  _previousState: AddGuardianState,
  formData: FormData,
): Promise<AddGuardianState> {
  await requireRole(["admin", "finance"]);

  const studentId = readText(
    formData,
    "studentId",
  );

  const identityNumber = readText(
    formData,
    "guardianIdentityNumber",
  ).replace(/\D/g, "");

  const fullName = readText(
    formData,
    "guardianFullName",
  );

  const phone = readText(
    formData,
    "guardianPhone",
  );

  const secondaryPhone = readText(
    formData,
    "guardianSecondaryPhone",
  );

  const email = readText(
    formData,
    "guardianEmail",
  );

  const relationship = readText(
    formData,
    "relationship",
  );

  const isPrimary =
    formData.get("isPrimary") === "on";

  const mayReceiveFinancialMessages =
    formData.get(
      "mayReceiveFinancialMessages",
    ) === "on";

  if (!studentId) {
    return {
      error:
        "Öğrenci kimliği bulunamadı.",
    };
  }

  if (!/^[1-9][0-9]{10}$/.test(identityNumber)) {
    return {
      error:
        "Veli T.C. kimlik numarası 11 rakamdan oluşmalı ve sıfırla başlamamalıdır.",
    };
  }

  if (fullName.length < 2) {
    return {
      error:
        "Veli adı en az 2 karakter olmalıdır.",
    };
  }

  if (phone.replace(/\D/g, "").length < 10) {
    return {
      error:
        "Geçerli bir veli telefon numarası girin.",
    };
  }

  if (
    email &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return {
      error:
        "Geçerli bir e-posta adresi girin.",
    };
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc(
    "add_student_guardian",
    {
      p_student_id: studentId,

      p_guardian_identity_number:
        identityNumber,

      p_guardian_full_name:
        fullName,

      p_guardian_phone:
        phone,

      p_guardian_secondary_phone:
        secondaryPhone || null,

      p_guardian_email:
        email || null,

      p_relationship:
        relationship || "Veli",

      p_is_primary:
        isPrimary,

      p_may_receive_financial_messages:
        mayReceiveFinancialMessages,
    },
  );

  if (error) {
    console.error(
      "Veli eklenemedi:",
      error,
    );

    return {
      error:
        process.env.NODE_ENV === "development"
          ? `Veritabanı hatası: ${error.message}`
          : "Veli eklenemedi.",
    };
  }

  revalidatePath(
    `/ogrenciler/${studentId}`,
  );

  redirect(
    `/ogrenciler/${studentId}?success=${encodeURIComponent(
      "Veli bağlantısı başarıyla oluşturuldu.",
    )}`,
  );
}

export async function setPrimaryGuardian(
  formData: FormData,
) {
  await requireRole(["admin", "finance"]);

  const studentId = readText(
    formData,
    "studentId",
  );

  const guardianId = readText(
    formData,
    "guardianId",
  );

  if (!studentId || !guardianId) {
    redirect("/ogrenciler");
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc(
    "set_primary_student_guardian",
    {
      p_student_id: studentId,
      p_guardian_id: guardianId,
    },
  );

  if (error) {
    console.error(
      "Birincil veli değiştirilemedi:",
      error,
    );

    redirect(
      `/ogrenciler/${studentId}?error=${encodeURIComponent(
        process.env.NODE_ENV === "development"
          ? error.message
          : "Birincil veli değiştirilemedi.",
      )}`,
    );
  }

  revalidatePath(
    `/ogrenciler/${studentId}`,
  );

  revalidatePath("/ogrenciler");

  redirect(
    `/ogrenciler/${studentId}?success=${encodeURIComponent(
      "Birincil veli değiştirildi.",
    )}`,
  );
}

export async function removeGuardian(
  formData: FormData,
) {
  await requireRole(["admin", "finance"]);

  const studentId = readText(
    formData,
    "studentId",
  );

  const guardianId = readText(
    formData,
    "guardianId",
  );

  if (!studentId || !guardianId) {
    redirect("/ogrenciler");
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc(
    "remove_student_guardian",
    {
      p_student_id: studentId,
      p_guardian_id: guardianId,
    },
  );

  if (error) {
    console.error(
      "Veli bağlantısı kaldırılamadı:",
      error,
    );

    redirect(
      `/ogrenciler/${studentId}?error=${encodeURIComponent(
        process.env.NODE_ENV === "development"
          ? error.message
          : "Veli bağlantısı kaldırılamadı.",
      )}`,
    );
  }

  revalidatePath(
    `/ogrenciler/${studentId}`,
  );

  revalidatePath("/ogrenciler");

  redirect(
    `/ogrenciler/${studentId}?success=${encodeURIComponent(
      "Veli bağlantısı kaldırıldı.",
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