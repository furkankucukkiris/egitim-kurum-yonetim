"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type EnrollmentActionState = {
  error: string | null;
};

export async function createEnrollment(
  _previousState: EnrollmentActionState,
  formData: FormData,
): Promise<EnrollmentActionState> {
  await requireRole(["admin"]);

  const studentId = readText(
    formData,
    "studentId",
  );

  const courseId = readText(
    formData,
    "courseId",
  );

  const classGroupId = readText(
    formData,
    "classGroupId",
  );

  const startsOn = readText(
    formData,
    "startsOn",
  );

  const endsOn = readText(
    formData,
    "endsOn",
  );

  const listMonthlyFee = parseMoney(
    readText(
      formData,
      "listMonthlyFee",
    ),
  );

  const discountType = readText(
    formData,
    "discountType",
  );

  const discountValue = parseMoney(
    readText(
      formData,
      "discountValue",
    ),
  );

  const dueDay = Number(
    readText(formData, "dueDay"),
  );

  const notes = readText(
    formData,
    "notes",
  );

  const mebStatus = readText(
    formData,
    "mebStatus",
  );

  const mebRegistrationNumber = readText(
    formData,
    "mebRegistrationNumber",
  );

  const mebValidFrom = readText(
    formData,
    "mebValidFrom",
  );

  const mebValidUntil = readText(
    formData,
    "mebValidUntil",
  );

  const mebNonRegistrationReason =
    readText(
      formData,
      "mebNonRegistrationReason",
    );

  const mebNote = readText(
    formData,
    "mebNote",
  );

  if (
    !studentId ||
    !courseId ||
    !classGroupId
  ) {
    return {
      error:
        "Öğrenci, ders veya seans bilgisi bulunamadı.",
    };
  }

  if (!isIsoDate(startsOn)) {
    return {
      error:
        "Ders başlangıç tarihi geçerli değil.",
    };
  }

  if (
    endsOn &&
    !isIsoDate(endsOn)
  ) {
    return {
      error:
        "Ders bitiş tarihi geçerli değil.",
    };
  }

  if (
    endsOn &&
    endsOn < startsOn
  ) {
    return {
      error:
        "Bitiş tarihi başlangıç tarihinden önce olamaz.",
    };
  }

  if (
    listMonthlyFee === null ||
    listMonthlyFee < 0
  ) {
    return {
      error:
        "Geçerli bir liste ücreti girin.",
    };
  }

  if (
    ![
      "none",
      "percent",
      "fixed",
    ].includes(discountType)
  ) {
    return {
      error:
        "Geçerli bir indirim türü seçin.",
    };
  }

  if (
    discountValue === null ||
    discountValue < 0
  ) {
    return {
      error:
        "Geçerli bir indirim değeri girin.",
    };
  }

  if (
    discountType === "percent" &&
    discountValue > 100
  ) {
    return {
      error:
        "Yüzde indirim 100 değerinden büyük olamaz.",
    };
  }

  if (
    discountType === "fixed" &&
    discountValue > listMonthlyFee
  ) {
    return {
      error:
        "Sabit indirim liste ücretinden büyük olamaz.",
    };
  }

  if (
    !Number.isInteger(dueDay) ||
    dueDay < 1 ||
    dueDay > 28
  ) {
    return {
      error:
        "Ödeme günü 1 ile 28 arasında olmalıdır.",
    };
  }

  const validMebStatuses = [
    "registered",
    "pending",
    "not_registered",
    "not_eligible",
    "rejected",
    "ended",
    "unchecked",
  ];

  if (
    !validMebStatuses.includes(
      mebStatus,
    )
  ) {
    return {
      error:
        "Geçerli bir MEB kayıt durumu seçin.",
    };
  }

  if (
    [
      "not_registered",
      "not_eligible",
      "rejected",
    ].includes(mebStatus) &&
    mebNonRegistrationReason.length < 3
  ) {
    return {
      error:
        "MEB kaydının neden yapılamadığını açıklayın.",
    };
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc(
    "create_enrollment_with_meb_registration",
    {
      p_student_id: studentId,
      p_course_id: courseId,
      p_class_group_id:
        classGroupId,

      p_starts_on: startsOn,
      p_ends_on: endsOn || null,

      p_list_monthly_fee:
        listMonthlyFee,

      p_discount_type:
        discountType,

      p_discount_value:
        discountValue,

      p_due_day: dueDay,
      p_notes: notes || null,

      p_meb_status: mebStatus,

      p_meb_registration_number:
        mebRegistrationNumber || null,

      p_meb_valid_from:
        mebValidFrom || null,

      p_meb_valid_until:
        mebValidUntil || null,

      p_meb_non_registration_reason:
        mebNonRegistrationReason || null,

      p_meb_note:
        mebNote || null,
    },
  );

  if (error) {
    console.error(
      "Ders kaydı oluşturulamadı:",
      {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      },
    );

    if (error.code === "P0001") {
      const { error: logError } = await supabase.rpc(
        "log_rejected_scheduling_attempt",
        {
          p_table_name: "enrollments",
          p_action: "enroll_rejected",
          p_reason: error.message,
          p_payload: { studentId, courseId, classGroupId },
        },
      );

      if (logError) {
        console.error("Reddedilen kayıt girişimi kaydedilemedi:", logError);
      }
    }

    return {
      error: getDatabaseErrorMessage(error),
    };
  }

  revalidatePath(
    `/ogrenciler/${studentId}`,
  );

  revalidatePath("/program");
  revalidatePath("/meb-yoklama");

  redirect(
    `/ogrenciler/${studentId}?success=${encodeURIComponent(
      "Öğrenci ders seansına kaydedildi.",
    )}`,
  );
}

export async function updateEnrollmentMeb(
  formData: FormData,
) {
  await requireRole(["admin"]);

  const studentId = readText(
    formData,
    "studentId",
  );

  const enrollmentId = readText(
    formData,
    "enrollmentId",
  );

  if (!studentId || !enrollmentId) {
    redirect("/ogrenciler");
  }

  const status = readText(
    formData,
    "mebStatus",
  );

  const reason = readText(
    formData,
    "mebNonRegistrationReason",
  );

  if (
    [
      "not_registered",
      "not_eligible",
      "rejected",
    ].includes(status) &&
    reason.length < 3
  ) {
    redirect(
      `/ogrenciler/${studentId}?error=${encodeURIComponent(
        "MEB kayıt eksikliği için açıklama girilmelidir.",
      )}`,
    );
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc(
    "set_enrollment_meb_registration",
    {
      p_enrollment_id:
        enrollmentId,

      p_status: status,

      p_registration_number:
        readText(
          formData,
          "mebRegistrationNumber",
        ) || null,

      p_valid_from:
        readText(
          formData,
          "mebValidFrom",
        ) || null,

      p_valid_until:
        readText(
          formData,
          "mebValidUntil",
        ) || null,

      p_non_registration_reason:
        reason || null,

      p_note:
        readText(
          formData,
          "mebNote",
        ) || null,
    },
  );

  if (error) {
    console.error(
      "Öğrenci MEB kaydı güncellenemedi:",
      error,
    );

    redirect(
      `/ogrenciler/${studentId}?error=${encodeURIComponent(
        process.env.NODE_ENV ===
          "development"
          ? error.message
          : "Öğrenci MEB kaydı güncellenemedi.",
      )}`,
    );
  }

  revalidatePath(
    `/ogrenciler/${studentId}`,
  );

  revalidatePath("/meb-yoklama");
  revalidatePath("/program");

  redirect(
    `/ogrenciler/${studentId}?success=${encodeURIComponent(
      "Öğrencinin ders bazlı MEB durumu güncellendi.",
    )}`,
  );
}

function parseMoney(value: string) {
  const normalized = value
    .replace(/\s/g, "")
    .replace(",", ".");

  if (
    !/^\d+(\.\d{1,2})?$/.test(
      normalized,
    )
  ) {
    return null;
  }

  const amount = Number(normalized);

  return Number.isFinite(amount)
    ? amount
    : null;
}

function isIsoDate(value: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      value,
    )
  ) {
    return false;
  }

  const date = new Date(
    `${value}T00:00:00.000Z`,
  );

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) ===
      value
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

type RpcError = {
  message: string;
  code?: string | null;
};

// P0001, plpgsql'deki `raise exception '...'`in varsayılan kodudur —
// bu depodaki RPC'ler yalnızca kendi yazdığımız Türkçe metinleri bu
// kodla fırlatır (program çakışması mesajı öğrenci/ders/seans adı
// içerdiği için sabit bir allowlist'e sığmaz).
function getDatabaseErrorMessage(error: RpcError) {
  if (error.code === "P0001") {
    return error.message;
  }

  const safeMessages = [
    "Öğrencinin bu derste zaten aktif veya dondurulmuş bir kaydı bulunuyor.",
    "Öğrencinin bu derste zaten açık bir kaydı bulunuyor.",
    "Seçilen ders seansında boş kontenjan bulunmuyor.",
    "Seçilen seans bu derse ait değil.",
    "Pasif bir derse öğrenci kaydedilemez.",
    "Pasif bir ders seansına öğrenci kaydedilemez.",
    "Yalnızca aktif öğrenciler yeni bir derse kaydedilebilir.",
    "Öğrenci kayıt tarihi seansın başlangıç tarihinden önce olamaz.",
    "Öğrenci kayıt tarihi seansın bitiş tarihinden sonra olamaz.",
  ];

  const matched = safeMessages.find(
    (item) =>
      error.message.includes(item),
  );

  if (matched) {
    return matched;
  }

  if (
    process.env.NODE_ENV ===
    "development"
  ) {
    return `Veritabanı hatası: ${error.message}`;
  }

  return "Öğrenci ders kaydı oluşturulamadı.";
}