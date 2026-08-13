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

  const { error } = await supabase.rpc("create_class_group", {
    p_name: values.name,
    p_course_id: values.courseId,
    p_teacher_profile_id: values.teacherProfileId || null,
    p_room_name: values.roomName || null,
    p_capacity: values.capacity,
    p_weekday: values.weekday,
    p_start_time: values.startTime,
    p_duration_minutes: values.durationMinutes,
    p_starts_on: values.startsOn,
    p_ends_on: values.endsOn || null,
  });

  if (error) {
    console.error("Ders seansı oluşturulamadı:", error);

    await logRejectedSchedulingAttempt(supabase, "class_groups", "create_rejected", error, values);

    return {
      error: getDatabaseErrorMessage(error),
    };
  }

  revalidatePath("/program");

  const warning = values.teacherProfileId
    ? await checkMebPermitWarning(supabase, values.teacherProfileId, values.courseId)
    : null;

  redirect(
    `/program?success=${encodeURIComponent(
      "Ders seansı oluşturuldu.",
    )}${warning ? `&warning=${encodeURIComponent(warning)}` : ""}`,
  );
}

export async function updateClassGroup(
  _previousState: ClassGroupActionState,
  formData: FormData,
): Promise<ClassGroupActionState> {
  await requireRole(["admin"]);

  const groupId = readText(formData, "groupId");

  if (!groupId) {
    return {
      error: "Ders seansı kimliği bulunamadı.",
    };
  }

  const values = readAndValidateGroup(formData, false);

  if ("error" in values) {
    return values;
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("update_class_group", {
    p_group_id: groupId,
    p_name: values.name,
    p_teacher_profile_id: values.teacherProfileId || null,
    p_room_name: values.roomName || null,
    p_capacity: values.capacity,
    p_weekday: values.weekday,
    p_start_time: values.startTime,
    p_duration_minutes: values.durationMinutes,
    p_starts_on: values.startsOn,
    p_ends_on: values.endsOn || null,
  });

  if (error) {
    console.error("Ders seansı güncellenemedi:", error);

    await logRejectedSchedulingAttempt(supabase, "class_groups", "update_rejected", error, {
      groupId,
      ...values,
    });

    return {
      error: getDatabaseErrorMessage(error),
    };
  }

  revalidatePath("/program");
  revalidatePath(`/program/${groupId}`);

  const courseId = await getClassGroupCourseId(supabase, groupId);

  const warning =
    values.teacherProfileId && courseId
      ? await checkMebPermitWarning(supabase, values.teacherProfileId, courseId)
      : null;

  redirect(
    `/program?success=${encodeURIComponent(
      "Ders seansı güncellendi.",
    )}${warning ? `&warning=${encodeURIComponent(warning)}` : ""}`,
  );
}

export async function setClassGroupActive(formData: FormData) {
  await requireRole(["admin"]);

  const groupId = readText(formData, "groupId");

  const isActive = readText(formData, "isActive") === "true";

  if (!groupId) {
    redirect("/program");
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("set_class_group_active", {
    p_group_id: groupId,
    p_is_active: isActive,
  });

  if (error) {
    console.error("Seans durumu değiştirilemedi:", error);

    redirect(`/program?error=${encodeURIComponent(getDatabaseErrorMessage(error))}`);
  }

  revalidatePath("/program");

  redirect(
    `/program?success=${encodeURIComponent(
      isActive ? "Ders seansı aktifleştirildi." : "Ders seansı pasife alındı.",
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

  const courseId = readText(formData, "courseId");

  const teacherProfileId = readText(formData, "teacherProfileId");

  const roomName = readText(formData, "roomName");

  const capacity = Number(readText(formData, "capacity"));

  const weekday = Number(readText(formData, "weekday"));

  const startTime = readText(formData, "startTime");

  const durationMinutes = Number(readText(formData, "durationMinutes"));

  const startsOn = readText(formData, "startsOn");

  const endsOn = readText(formData, "endsOn");

  if (name.length < 2) {
    return {
      error: "Seans adı en az 2 karakter olmalıdır.",
    };
  }

  if (requireCourse && !courseId) {
    return {
      error: "Bir ders seçmelisiniz.",
    };
  }

  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100) {
    return {
      error: "Kapasite 1 ile 100 arasında olmalıdır.",
    };
  }

  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
    return {
      error: "Geçerli bir ders günü seçin.",
    };
  }

  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(startTime)) {
    return {
      error: "Geçerli bir başlangıç saati girin.",
    };
  }

  if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 480) {
    return {
      error: "Ders süresi 15 ile 480 dakika arasında olmalıdır.",
    };
  }

  if (!isIsoDate(startsOn)) {
    return {
      error: "Program başlangıç tarihi geçerli değil.",
    };
  }

  if (endsOn && !isIsoDate(endsOn)) {
    return {
      error: "Program bitiş tarihi geçerli değil.",
    };
  }

  if (endsOn && endsOn < startsOn) {
    return {
      error: "Program bitiş tarihi başlangıç tarihinden önce olamaz.",
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

  const date = new Date(`${value}T00:00:00.000Z`);

  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function readText(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

type RpcError = {
  message: string;
  code?: string | null;
};

// P0001, plpgsql'deki `raise exception '...'`in varsayılan kodudur —
// bu depodaki RPC'ler yalnızca kendi yazdığımız Türkçe metinleri bu
// kodla fırlatır (çakışma/kapasite/MEB mesajları dahil, isim/tarih
// içerdikleri için sabit bir allowlist'e sığmazlar). Farklı bir kod
// (örn. 42501 yetki reddi, 23505 mevcut allowlist'teki statik
// mesajlarla) geldiğinde eski davranış (allowlist + prod'da genel
// mesaj) korunur.
function getDatabaseErrorMessage(error: RpcError) {
  if (error.code === "P0001") {
    return error.message;
  }

  const safeMessages = [
    "Bu ders için aynı isimde bir seans zaten bulunuyor.",
    "Ders kaydı bulunamadı.",
    "Pasif bir ders için yeni seans oluşturulamaz.",
    "Seçilen öğretmen bulunamadı veya aktif değil.",
    "Kapasite mevcut öğrenci sayısından daha düşük olamaz.",
  ];

  const matchedMessage = safeMessages.find((item) => error.message.includes(item));

  if (matchedMessage) {
    return matchedMessage;
  }

  if (process.env.NODE_ENV === "development") {
    return `Veritabanı hatası: ${error.message}`;
  }

  return "Ders programı işlemi tamamlanamadı.";
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// Reddedilen bir zamanlama girişimini AYRI bir istek olarak kaydeder
// (log_rejected_scheduling_attempt) — birincil RPC hatası nedeniyle
// zaten rollback olmuş transaction'dan bağımsız, kendi transaction'ında
// commit olur. Yalnızca RPC'nin kendi bilinçli reddi (P0001) için
// çağrılır; beklenmeyen sistem hatalarında (örn. bağlantı sorunu)
// audit_logs'u kirletmemek için sessizce atlanır.
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

// Kurum politikası 'warn' iken create_class_group/update_class_group
// MEB izin uyarısını sessizce audit_logs'a yazar ama başarı akışını
// bozmaz — bu, kullanıcıya göstermek için AYNI merkezi kontrolü
// (check_teacher_meb_permit) ikinci, salt-okunur bir çağrıyla tekrar
// sorar.
async function checkMebPermitWarning(
  supabase: SupabaseServerClient,
  teacherProfileId: string,
  courseId: string,
) {
  const { data, error } = await supabase.rpc("check_teacher_meb_permit", {
    p_teacher_profile_id: teacherProfileId,
    p_course_id: courseId,
  });

  if (error) {
    console.error("MEB izni kontrol edilemedi:", error);
    return null;
  }

  return (data as string | null) ?? null;
}

async function getClassGroupCourseId(supabase: SupabaseServerClient, groupId: string) {
  const { data, error } = await supabase
    .from("class_groups")
    .select("course_id")
    .eq("id", groupId)
    .single();

  if (error || !data) {
    return null;
  }

  return (data as { course_id: string }).course_id;
}
