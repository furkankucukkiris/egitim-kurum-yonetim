"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type TeacherAccountActionState = {
  error: string | null;
  credentials: {
    email: string;
    temporaryPassword: string;
  } | null;
};

export type TeacherPasswordActionState = {
  error: string | null;
  credentials: {
    email: string;
    temporaryPassword: string;
  } | null;
};

export async function createTeacherAccount(
  _previousState: TeacherAccountActionState,
  formData: FormData,
): Promise<TeacherAccountActionState> {
  await requireRole(["admin"]);

  const fullName = readText(formData, "fullName");

  const email = readText(formData, "email").toLowerCase();

  const phone = readText(formData, "phone");

  if (fullName.length < 2) {
    return {
      error: "Öğretmen adı en az 2 karakter olmalıdır.",
      credentials: null,
    };
  }

  if (!isEmail(email)) {
    return {
      error: "Geçerli bir e-posta adresi girilmelidir.",
      credentials: null,
    };
  }

  const temporaryPassword = createTemporaryPassword();

  let adminClient;

  try {
    adminClient = createAdminClient();
  } catch (error) {
    console.error("Supabase yönetici istemcisi oluşturulamadı:", error);

    return {
      error: "Öğretmen hesabı oluşturma anahtarı sunucuda tanımlı değil.",
      credentials: null,
    };
  }

  const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
    email,
    password: temporaryPassword,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
    },
  });

  if (authError || !authData.user) {
    console.error("Öğretmen Auth hesabı oluşturulamadı:", authError);

    return {
      error: getAuthErrorMessage(authError?.message ?? ""),
      credentials: null,
    };
  }

  const supabase = await createClient();

  const { error: profileError } = await supabase.rpc("create_teacher_profile", {
    p_user_id: authData.user.id,
    p_email: email,
    p_full_name: fullName,
    p_phone: phone || null,
  });

  if (profileError) {
    console.error("Öğretmen profili oluşturulamadı:", profileError);

    const { error: cleanupError } = await adminClient.auth.admin.deleteUser(authData.user.id);

    if (cleanupError) {
      console.error("Eksik öğretmen Auth hesabı temizlenemedi:", cleanupError);
    }

    return {
      error: getDatabaseErrorMessage(profileError.message),
      credentials: null,
    };
  }

  revalidatePath("/ogretmenler");
  revalidatePath("/program");

  return {
    error: null,
    credentials: {
      email,
      temporaryPassword,
    },
  };
}

export async function setTeacherActive(formData: FormData) {
  await requireRole(["admin"]);

  const teacherId = readText(formData, "teacherId");

  const isActive = readText(formData, "isActive") === "true";

  if (!teacherId) {
    redirect("/ogretmenler");
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("set_teacher_active", {
    p_teacher_profile_id: teacherId,
    p_is_active: isActive,
  });

  if (error) {
    console.error("Öğretmen hesabı durumu değiştirilemedi:", error);

    redirect(`/ogretmenler?error=${encodeURIComponent(getDatabaseErrorMessage(error.message))}`);
  }

  revalidatePath("/ogretmenler");
  revalidatePath("/program");

  redirect(
    `/ogretmenler?success=${encodeURIComponent(
      isActive ? "Öğretmen hesabı aktifleştirildi." : "Öğretmen hesabı pasife alındı.",
    )}`,
  );
}

export async function resetTeacherPassword(
  _previousState: TeacherPasswordActionState,
  formData: FormData,
): Promise<TeacherPasswordActionState> {
  await requireRole(["admin"]);

  const teacherId = readText(formData, "teacherId");

  if (!teacherId) {
    return {
      error: "Öğretmen hesabı kimliği bulunamadı.",
      credentials: null,
    };
  }

  const supabase = await createClient();

  const { data: teacher, error: teacherError } = await supabase
    .from("profiles")
    .select("id, email")
    .eq("id", teacherId)
    .eq("role", "teacher")
    .maybeSingle();

  if (teacherError || !teacher || !teacher.email) {
    console.error("Parolası yenilenecek öğretmen bulunamadı:", teacherError);

    return {
      error: "Geçerli e-posta adresi olan öğretmen hesabı bulunamadı.",
      credentials: null,
    };
  }

  let adminClient;

  try {
    adminClient = createAdminClient();
  } catch (error) {
    console.error("Supabase yönetici istemcisi oluşturulamadı:", error);

    return {
      error: "Öğretmen parolası yenileme anahtarı sunucuda tanımlı değil.",
      credentials: null,
    };
  }

  const { error: requirementError } = await supabase.rpc("set_teacher_requires_password_change", {
    p_teacher_profile_id: teacherId,
  });

  if (requirementError) {
    console.error("Parola değiştirme zorunluluğu ayarlanamadı:", requirementError);

    return {
      error: getDatabaseErrorMessage(requirementError.message),
      credentials: null,
    };
  }

  const temporaryPassword = createTemporaryPassword();

  const { error: passwordError } = await adminClient.auth.admin.updateUserById(teacherId, {
    password: temporaryPassword,
  });

  if (passwordError) {
    console.error("Öğretmen geçici parolası yenilenemedi:", passwordError);

    return {
      error: "Yeni geçici parola oluşturulamadı.",
      credentials: null,
    };
  }

  revalidatePath("/ogretmenler");

  return {
    error: null,
    credentials: {
      email: teacher.email,
      temporaryPassword,
    },
  };
}

function createTemporaryPassword() {
  return `${randomBytes(12).toString("base64url")}Aa7!`;
}

function readText(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function getAuthErrorMessage(message: string) {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("already") ||
    normalized.includes("registered") ||
    normalized.includes("exists")
  ) {
    return "Bu e-posta adresiyle daha önce bir kullanıcı hesabı oluşturulmuş.";
  }

  if (normalized.includes("email") && normalized.includes("invalid")) {
    return "E-posta adresi geçerli değil.";
  }

  if (process.env.NODE_ENV === "development") {
    return `Supabase Auth hatası: ${message}`;
  }

  return "Öğretmen kullanıcı hesabı oluşturulamadı.";
}

function getDatabaseErrorMessage(message: string) {
  const safeMessages = [
    "Bu e-posta adresiyle daha önce bir hesap oluşturulmuş.",
    "Öğretmen hesabı bulunamadı.",
  ];

  const matchedMessage = safeMessages.find((item) => message.includes(item));

  if (matchedMessage) {
    return matchedMessage;
  }

  if (process.env.NODE_ENV === "development") {
    return `Veritabanı hatası: ${message}`;
  }

  return "Öğretmen hesabı işlemi tamamlanamadı.";
}
