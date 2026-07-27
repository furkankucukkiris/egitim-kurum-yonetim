"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type ClassGroupActionState = {
  error: string | null;
};

export async function createClassGroup(
  _previousState: ClassGroupActionState,
  formData: FormData,
): Promise<ClassGroupActionState> {
  await requireRole(["admin"]);

  const values = readAndValidateGroup(formData);

  if ("error" in values) {
    return values;
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc(
    "create_class_group",
    {
      p_name: values.name,
      p_course_id: values.courseId,
      p_teacher_profile_id:
        values.teacherProfileId || null,
      p_room_name: values.roomName || null,
      p_capacity: values.capacity,
      p_weekday: values.weekday,
      p_start_time: values.startTime,
      p_duration_minutes:
        values.durationMinutes,
      p_starts_on: values.startsOn,
      p_ends_on: values.endsOn || null,
    },
  );

  if (error) {
    console.error(
      "Ders seansı oluşturulamadı:",
      error,
    );

    return {
      error: getDatabaseErrorMessage(
        error.message,
      ),
    };
  }

  revalidatePath("/program");

  redirect(
    `/program?success=${encodeURIComponent(
      "Ders seansı oluşturuldu.",
    )}`,
  );
}

export async function updateClassGroup(
  _previousState: ClassGroupActionState,
  formData: FormData,
): Promise<ClassGroupActionState> {
  await requireRole(["admin"]);

  const groupId = readText(
    formData,
    "groupId",
  );

  if (!groupId) {
    return {
      error: "Ders seansı kimliği bulunamadı.",
    };
  }

  const values = readAndValidateGroup(
    formData,
    false,
  );

  if ("error" in values) {
    return values;
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc(
    "update_class_group",
    {
      p_group_id: groupId,
      p_name: values.name,
      p_teacher_profile_id:
        values.teacherProfileId || null,
      p_room_name: values.roomName || null,
      p_capacity: values.capacity,
      p_weekday: values.weekday,
      p_start_time: values.startTime,
      p_duration_minutes:
        values.durationMinutes,
      p_starts_on: values.startsOn,
      p_ends_on: values.endsOn || null,
    },
  );

  if (error) {
    console.error(
      "Ders seansı güncellenemedi:",
      error,
    );

    return {
      error: getDatabaseErrorMessage(
        error.message,
      ),
    };
  }

  revalidatePath("/program");
  revalidatePath(`/program/${groupId}`);

  redirect(
    `/program?success=${encodeURIComponent(
      "Ders seansı güncellendi.",
    )}`,
  );
}

export async function setClassGroupActive(
  formData: FormData,
) {
  await requireRole(["admin"]);

  const groupId = readText(
    formData,
    "groupId",
  );

  const isActive =
    readText(formData, "isActive") === "true";

  if (!groupId) {
    redirect("/program");
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc(
    "set_class_group_active",
    {
      p_group_id: groupId,
      p_is_active: isActive,
    },
  );

  if (error) {
    console.error(
      "Seans durumu değiştirilemedi:",
      error,
    );

    redirect(
      `/program?error=${encodeURIComponent(
        getDatabaseErrorMessage(
          error.message,
        ),
      )}`,
    );
  }

  revalidatePath("/program");

  redirect(
    `/program?success=${encodeURIComponent(
      isActive
        ? "Ders seansı aktifleştirildi."
        : "Ders seansı pasife alındı.",
    )}`,
  );
}

function readAndValidateGroup(
  formData: FormData,
  requireCourse = true,
):
  | {
      name: string;
      courseId: string;
      teacherProfileId: string;
      roomName: string;
      capacity: number;
      weekday: number;
      startTime: string;
      durationMinutes: number;
      startsOn: string;
      endsOn: string;
    }
  | ClassGroupActionState {
  const name = readText(formData, "name");

  const courseId = readText(
    formData,
    "courseId",
  );

  const teacherProfileId = readText(
    formData,
    "teacherProfileId",
  );

  const roomName = readText(
    formData,
    "roomName",
  );

  const capacity = Number(
    readText(formData, "capacity"),
  );

  const weekday = Number(
    readText(formData, "weekday"),
  );

  const startTime = readText(
    formData,
    "startTime",
  );

  const durationMinutes = Number(
    readText(formData, "durationMinutes"),
  );

  const startsOn = readText(
    formData,
    "startsOn",
  );

  const endsOn = readText(
    formData,
    "endsOn",
  );

  if (name.length < 2) {
    return {
      error:
        "Seans adı en az 2 karakter olmalıdır.",
    };
  }

  if (requireCourse && !courseId) {
    return {
      error: "Bir ders seçmelisiniz.",
    };
  }

  if (
    !Number.isInteger(capacity) ||
    capacity < 1 ||
    capacity > 100
  ) {
    return {
      error:
        "Kapasite 1 ile 100 arasında olmalıdır.",
    };
  }

  if (
    !Number.isInteger(weekday) ||
    weekday < 1 ||
    weekday > 7
  ) {
    return {
      error:
        "Geçerli bir ders günü seçin.",
    };
  }

  if (
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(
      startTime,
    )
  ) {
    return {
      error:
        "Geçerli bir başlangıç saati girin.",
    };
  }

  if (
    !Number.isInteger(durationMinutes) ||
    durationMinutes < 15 ||
    durationMinutes > 480
  ) {
    return {
      error:
        "Ders süresi 15 ile 480 dakika arasında olmalıdır.",
    };
  }

  if (!isIsoDate(startsOn)) {
    return {
      error:
        "Program başlangıç tarihi geçerli değil.",
    };
  }

  if (
    endsOn &&
    !isIsoDate(endsOn)
  ) {
    return {
      error:
        "Program bitiş tarihi geçerli değil.",
    };
  }

  if (
    endsOn &&
    endsOn < startsOn
  ) {
    return {
      error:
        "Program bitiş tarihi başlangıç tarihinden önce olamaz.",
    };
  }

  return {
    name,
    courseId,
    teacherProfileId,
    roomName,
    capacity,
    weekday,
    startTime,
    durationMinutes,
    startsOn,
    endsOn,
  };
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

function readText(
  formData: FormData,
  name: string,
) {
  return String(
    formData.get(name) ?? "",
  ).trim();
}

function getDatabaseErrorMessage(
  message: string,
) {
  const safeMessages = [
    "Bu ders için aynı isimde bir seans zaten bulunuyor.",
    "Ders kaydı bulunamadı.",
    "Pasif bir ders için yeni seans oluşturulamaz.",
    "Seçilen öğretmen bulunamadı veya aktif değil.",
    "Kapasite mevcut öğrenci sayısından daha düşük olamaz.",
  ];

  const matchedMessage = safeMessages.find(
    (item) => message.includes(item),
  );

  if (matchedMessage) {
    return matchedMessage;
  }

  if (
    process.env.NODE_ENV === "development"
  ) {
    return `Veritabanı hatası: ${message}`;
  }

  return "Ders programı işlemi tamamlanamadı.";
}