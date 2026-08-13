"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function createProspect(formData: FormData) {
  await requireRole(["admin"]);

  const studentFirstName = readText(formData, "studentFirstName");
  const studentLastName = readText(formData, "studentLastName");
  const guardianName = readText(formData, "guardianName");
  const phone = readText(formData, "phone");
  const leadSource = readText(formData, "leadSource");
  const initialContactDate = readText(formData, "initialContactDate");
  const assignedProfileId = readText(formData, "assignedProfileId");
  const notes = readText(formData, "notes");
  const courseIds = formData.getAll("courseIds").map(String).filter(Boolean);

  const supabase = await createClient();

  const { data: prospectId, error } = await supabase.rpc("create_prospect", {
    p_student_first_name: studentFirstName,
    p_student_last_name: studentLastName,
    p_guardian_name: guardianName,
    p_phone: phone,
    p_lead_source: leadSource,
    p_initial_contact_date: initialContactDate || null,
    p_assigned_profile_id: assignedProfileId || null,
    p_course_ids: courseIds.length > 0 ? courseIds : null,
    p_notes: notes || null,
  });

  if (error) {
    console.error("Aday öğrenci oluşturulamadı:", error);

    redirect(`/aday-ogrenciler?error=${encodeURIComponent(getDatabaseErrorMessage(error))}`);
  }

  revalidatePath("/aday-ogrenciler");

  redirect(
    `/aday-ogrenciler/${prospectId}?success=${encodeURIComponent("Aday öğrenci oluşturuldu.")}`,
  );
}

export async function updateProspect(formData: FormData) {
  await requireRole(["admin"]);

  const prospectId = readText(formData, "prospectId");
  const studentFirstName = readText(formData, "studentFirstName");
  const studentLastName = readText(formData, "studentLastName");
  const guardianName = readText(formData, "guardianName");
  const phone = readText(formData, "phone");
  const leadSource = readText(formData, "leadSource");
  const assignedProfileId = readText(formData, "assignedProfileId");
  const notes = readText(formData, "notes");
  const courseIds = formData.getAll("courseIds").map(String).filter(Boolean);

  const supabase = await createClient();

  const { error } = await supabase.rpc("update_prospect", {
    p_prospect_id: prospectId,
    p_student_first_name: studentFirstName,
    p_student_last_name: studentLastName,
    p_guardian_name: guardianName,
    p_phone: phone,
    p_lead_source: leadSource,
    p_assigned_profile_id: assignedProfileId || null,
    p_course_ids: courseIds.length > 0 ? courseIds : null,
    p_notes: notes || null,
  });

  if (error) {
    console.error("Aday öğrenci güncellenemedi:", error);

    redirect(
      `/aday-ogrenciler/${prospectId}?error=${encodeURIComponent(getDatabaseErrorMessage(error))}`,
    );
  }

  revalidatePath(`/aday-ogrenciler/${prospectId}`);
  revalidatePath("/aday-ogrenciler");

  redirect(
    `/aday-ogrenciler/${prospectId}?success=${encodeURIComponent("Aday öğrenci güncellendi.")}`,
  );
}

export async function updateProspectStatus(formData: FormData) {
  await requireRole(["admin"]);

  const prospectId = readText(formData, "prospectId");
  const status = readText(formData, "status");
  const declineReason = readText(formData, "declineReason");
  const nextFollowUpDate = readText(formData, "nextFollowUpDate");

  const supabase = await createClient();

  const { error } = await supabase.rpc("update_prospect_status", {
    p_prospect_id: prospectId,
    p_status: status,
    p_decline_reason: declineReason || null,
    p_next_follow_up_date: nextFollowUpDate || null,
  });

  if (error) {
    console.error("Aday öğrenci durumu güncellenemedi:", error);

    redirect(
      `/aday-ogrenciler/${prospectId}?error=${encodeURIComponent(getDatabaseErrorMessage(error))}`,
    );
  }

  revalidatePath(`/aday-ogrenciler/${prospectId}`);
  revalidatePath("/aday-ogrenciler");
  revalidatePath("/");

  redirect(`/aday-ogrenciler/${prospectId}?success=${encodeURIComponent("Durum güncellendi.")}`);
}

export async function scheduleTrialLesson(formData: FormData) {
  await requireRole(["admin"]);

  const prospectId = readText(formData, "prospectId");
  const courseId = readText(formData, "courseId");
  const teacherProfileId = readText(formData, "teacherProfileId");
  const date = readText(formData, "date");
  const startTime = readText(formData, "startTime");
  const endTime = readText(formData, "endTime");
  const roomName = readText(formData, "roomName");

  const startsAt = toIstanbulTimestamp(date, startTime);
  const endsAt = toIstanbulTimestamp(date, endTime);

  if (!courseId) {
    redirect(`/aday-ogrenciler/${prospectId}?error=${encodeURIComponent("Bir ders seçin.")}`);
  }

  if (!startsAt || !endsAt) {
    redirect(
      `/aday-ogrenciler/${prospectId}?error=${encodeURIComponent("Geçerli bir tarih ve saat girin.")}`,
    );
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("schedule_prospect_trial_lesson", {
    p_prospect_id: prospectId,
    p_course_id: courseId,
    p_teacher_profile_id: teacherProfileId || null,
    p_starts_at: startsAt,
    p_ends_at: endsAt,
    p_room_name: roomName || null,
  });

  if (error) {
    console.error("Deneme dersi planlanamadı:", error);

    redirect(
      `/aday-ogrenciler/${prospectId}?error=${encodeURIComponent(getDatabaseErrorMessage(error))}`,
    );
  }

  revalidatePath(`/aday-ogrenciler/${prospectId}`);
  revalidatePath("/aday-ogrenciler");
  revalidatePath("/");
  revalidatePath("/ogretmen-paneli");

  redirect(
    `/aday-ogrenciler/${prospectId}?success=${encodeURIComponent("Deneme dersi planlandı.")}`,
  );
}

export async function cancelTrialLesson(formData: FormData) {
  await requireRole(["admin"]);

  const prospectId = readText(formData, "prospectId");
  const reason = readText(formData, "reason");

  const supabase = await createClient();

  const { error } = await supabase.rpc("cancel_prospect_trial_lesson", {
    p_prospect_id: prospectId,
    p_reason: reason,
  });

  if (error) {
    console.error("Deneme dersi iptal edilemedi:", error);

    redirect(
      `/aday-ogrenciler/${prospectId}?error=${encodeURIComponent(getDatabaseErrorMessage(error))}`,
    );
  }

  revalidatePath(`/aday-ogrenciler/${prospectId}`);
  revalidatePath("/aday-ogrenciler");
  revalidatePath("/");
  revalidatePath("/ogretmen-paneli");

  redirect(
    `/aday-ogrenciler/${prospectId}?success=${encodeURIComponent("Deneme dersi iptal edildi.")}`,
  );
}

export async function convertProspectToStudent(formData: FormData) {
  await requireRole(["admin"]);

  const prospectId = readText(formData, "prospectId");
  const studentIdentityNumber = normalizeIdentityNumber(
    readText(formData, "studentIdentityNumber"),
  );
  const guardianIdentityNumber = normalizeIdentityNumber(
    readText(formData, "guardianIdentityNumber"),
  );
  const birthDate = readText(formData, "birthDate");
  const registrationDate = readText(formData, "registrationDate");
  const guardianSecondaryPhone = readText(formData, "guardianSecondaryPhone");
  const guardianEmail = readText(formData, "guardianEmail");
  const relationship = readText(formData, "relationship");

  if (!isValidIdentityNumberFormat(studentIdentityNumber)) {
    redirect(
      `/aday-ogrenciler/${prospectId}?error=${encodeURIComponent(
        "Öğrenci T.C. kimlik numarası 11 rakamdan oluşmalı ve sıfırla başlamamalıdır.",
      )}`,
    );
  }

  if (!isValidIdentityNumberFormat(guardianIdentityNumber)) {
    redirect(
      `/aday-ogrenciler/${prospectId}?error=${encodeURIComponent(
        "Veli T.C. kimlik numarası 11 rakamdan oluşmalı ve sıfırla başlamamalıdır.",
      )}`,
    );
  }

  const supabase = await createClient();

  const { data: studentId, error } = await supabase.rpc("convert_prospect_to_student", {
    p_prospect_id: prospectId,
    p_student_identity_number: studentIdentityNumber,
    p_guardian_identity_number: guardianIdentityNumber,
    p_birth_date: birthDate || null,
    p_registration_date: registrationDate || null,
    p_guardian_secondary_phone: guardianSecondaryPhone || null,
    p_guardian_email: guardianEmail || null,
    p_relationship: relationship || "Veli",
  });

  if (error) {
    console.error("Aday öğrenci dönüştürülemedi:", error);

    redirect(
      `/aday-ogrenciler/${prospectId}?error=${encodeURIComponent(getDatabaseErrorMessage(error))}`,
    );
  }

  revalidatePath(`/aday-ogrenciler/${prospectId}`);
  revalidatePath("/aday-ogrenciler");
  revalidatePath("/ogrenciler");

  redirect(
    `/ogrenciler/${studentId}?success=${encodeURIComponent("Aday öğrenci, öğrenciye dönüştürüldü.")}`,
  );
}

function readText(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function normalizeIdentityNumber(value: string) {
  return value.replace(/\D/g, "");
}

function isValidIdentityNumberFormat(value: string) {
  return /^[1-9][0-9]{10}$/.test(value);
}

function toIstanbulTimestamp(date: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    return null;
  }

  return `${date}T${time}:00+03:00`;
}

// P0001, plpgsql'deki `raise exception '...'`in varsayılan kodudur — bu
// modüldeki tüm RPC'ler yalnızca kendi yazdığımız Türkçe metinleri bu
// kodla fırlatır (program çakışması mesajı öğretmen/derslik/saat içerir,
// sabit bir allowlist'e sığmaz) — enrollment-actions.ts'deki ile aynı yaklaşım.
function getDatabaseErrorMessage(error: { message: string; code?: string | null }) {
  if (error.code === "P0001") {
    return error.message;
  }

  if (process.env.NODE_ENV === "development") {
    return `Veritabanı hatası: ${error.message}`;
  }

  return "İşlem gerçekleştirilemedi.";
}
