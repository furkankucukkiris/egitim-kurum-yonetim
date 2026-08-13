"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function addWaitlistEntry(formData: FormData) {
  await requireRole(["admin"]);

  const classGroupId = readText(formData, "classGroupId");
  const studentId = readText(formData, "studentId");
  const prospectId = readText(formData, "prospectId");
  const priority = Number(readText(formData, "priority") || "0");
  const applicationDate = readText(formData, "applicationDate");
  const preferredWeekdays = formData
    .getAll("preferredWeekdays")
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= 7);
  const preferredTimeStart = readText(formData, "preferredTimeStart");
  const preferredTimeEnd = readText(formData, "preferredTimeEnd");
  const notes = readText(formData, "notes");

  if (!classGroupId) {
    redirect(`/bekleme-listesi?error=${encodeURIComponent("Bir ders seansı seçin.")}`);
  }

  if (Boolean(studentId) === Boolean(prospectId)) {
    redirect(
      `/bekleme-listesi?error=${encodeURIComponent("Bir öğrenci veya bir aday öğrenci seçin (yalnızca birini).")}`,
    );
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("add_waitlist_entry", {
    p_class_group_id: classGroupId,
    p_student_id: studentId || null,
    p_prospect_id: prospectId || null,
    p_priority: Number.isFinite(priority) ? priority : 0,
    p_application_date: applicationDate || null,
    p_preferred_weekdays: preferredWeekdays,
    p_preferred_time_start: preferredTimeStart || null,
    p_preferred_time_end: preferredTimeEnd || null,
    p_notes: notes || null,
  });

  if (error) {
    console.error("Bekleme listesine eklenemedi:", error);

    redirect(`/bekleme-listesi?error=${encodeURIComponent(getDatabaseErrorMessage(error))}`);
  }

  revalidatePath("/bekleme-listesi");
  revalidatePath("/program");
  revalidatePath("/");

  redirect(`/bekleme-listesi?success=${encodeURIComponent("Bekleme listesine eklendi.")}`);
}

export async function updateWaitlistEntry(formData: FormData) {
  await requireRole(["admin"]);

  const entryId = readText(formData, "entryId");
  const priority = Number(readText(formData, "priority") || "0");
  const applicationDate = readText(formData, "applicationDate");
  const preferredWeekdays = formData
    .getAll("preferredWeekdays")
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= 7);
  const preferredTimeStart = readText(formData, "preferredTimeStart");
  const preferredTimeEnd = readText(formData, "preferredTimeEnd");
  const notes = readText(formData, "notes");

  const supabase = await createClient();

  const { error } = await supabase.rpc("update_waitlist_entry", {
    p_waitlist_entry_id: entryId,
    p_priority: Number.isFinite(priority) ? priority : 0,
    p_application_date: applicationDate || null,
    p_preferred_weekdays: preferredWeekdays,
    p_preferred_time_start: preferredTimeStart || null,
    p_preferred_time_end: preferredTimeEnd || null,
    p_notes: notes || null,
  });

  if (error) {
    console.error("Bekleme kaydı güncellenemedi:", error);

    redirect(`/bekleme-listesi?error=${encodeURIComponent(getDatabaseErrorMessage(error))}`);
  }

  revalidatePath("/bekleme-listesi");

  redirect(`/bekleme-listesi?success=${encodeURIComponent("Bekleme kaydı güncellendi.")}`);
}

export async function offerSeat(formData: FormData) {
  await requireRole(["admin"]);

  const entryId = readText(formData, "entryId");

  const supabase = await createClient();

  const { error } = await supabase.rpc("offer_waitlist_seat", {
    p_waitlist_entry_id: entryId,
    p_offer_expires_at: null,
  });

  if (error) {
    console.error("Teklif verilemedi:", error);

    redirect(`/bekleme-listesi?error=${encodeURIComponent(getDatabaseErrorMessage(error))}`);
  }

  revalidatePath("/bekleme-listesi");

  redirect(`/bekleme-listesi?success=${encodeURIComponent("Teklif verildi.")}`);
}

export async function resolveOffer(formData: FormData) {
  await requireRole(["admin"]);

  const entryId = readText(formData, "entryId");
  const resolution = readText(formData, "resolution");
  const declineReason = readText(formData, "declineReason");

  const supabase = await createClient();

  const { error } = await supabase.rpc("resolve_waitlist_offer", {
    p_waitlist_entry_id: entryId,
    p_resolution: resolution,
    p_decline_reason: declineReason || null,
  });

  if (error) {
    console.error("Teklif yanıtı kaydedilemedi:", error);

    redirect(`/bekleme-listesi?error=${encodeURIComponent(getDatabaseErrorMessage(error))}`);
  }

  revalidatePath("/bekleme-listesi");

  redirect(`/bekleme-listesi?success=${encodeURIComponent("Yanıt kaydedildi.")}`);
}

export async function cancelEntry(formData: FormData) {
  await requireRole(["admin"]);

  const entryId = readText(formData, "entryId");
  const reason = readText(formData, "reason");

  const supabase = await createClient();

  const { error } = await supabase.rpc("cancel_waitlist_entry", {
    p_waitlist_entry_id: entryId,
    p_reason: reason || null,
  });

  if (error) {
    console.error("Bekleme kaydı iptal edilemedi:", error);

    redirect(`/bekleme-listesi?error=${encodeURIComponent(getDatabaseErrorMessage(error))}`);
  }

  revalidatePath("/bekleme-listesi");
  revalidatePath("/program");

  redirect(`/bekleme-listesi?success=${encodeURIComponent("Bekleme kaydı iptal edildi.")}`);
}

export async function enrollFromWaitlist(formData: FormData) {
  await requireRole(["admin"]);

  const entryId = readText(formData, "entryId");
  const startsOn = readText(formData, "startsOn");
  const listMonthlyFee = readText(formData, "listMonthlyFee");
  const dueDay = readText(formData, "dueDay");

  if (!startsOn) {
    redirect(
      `/bekleme-listesi?error=${encodeURIComponent("Kayıt başlangıç tarihi seçilmelidir.")}`,
    );
  }

  const fee = parseMoney(listMonthlyFee);

  if (fee === null || fee < 0) {
    redirect(
      `/bekleme-listesi?error=${encodeURIComponent("Geçerli bir aylık ücret girilmelidir.")}`,
    );
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("enroll_from_waitlist", {
    p_waitlist_entry_id: entryId,
    p_starts_on: startsOn,
    p_ends_on: null,
    p_list_monthly_fee: fee,
    p_discount_type: null,
    p_discount_value: null,
    p_due_day: dueDay ? Number(dueDay) : 5,
    p_notes: "Bekleme listesinden kaydedildi.",
    p_meb_status: "unchecked",
    p_meb_registration_number: null,
    p_meb_valid_from: null,
    p_meb_valid_until: null,
    p_meb_non_registration_reason: null,
    p_meb_note: null,
  });

  if (error) {
    console.error("Bekleme listesinden kayıt oluşturulamadı:", error);

    redirect(`/bekleme-listesi?error=${encodeURIComponent(getDatabaseErrorMessage(error))}`);
  }

  revalidatePath("/bekleme-listesi");
  revalidatePath("/program");
  revalidatePath("/");
  revalidatePath("/ogrenciler");

  redirect(`/bekleme-listesi?success=${encodeURIComponent("Öğrenci derse kaydedildi.")}`);
}

function readText(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function parseMoney(value: string) {
  const normalized = value.replace(/\s/g, "").replace(",", ".");

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    return null;
  }

  const amount = Number(normalized);

  return Number.isFinite(amount) ? amount : null;
}

// P0001, plpgsql'deki `raise exception '...'`in varsayılan kodudur — bu
// modüldeki RPC'ler (create_enrollment_with_meb_registration dahil, o da
// enroll_from_waitlist içinden çağrılıyor) yalnızca kendi yazdığımız
// Türkçe metinleri bu kodla fırlatır — bazıları (çakışma mesajı gibi)
// dinamik olduğundan sabit bir allowlist'e sığmaz; aynı yaklaşım
// enrollment-actions.ts ve aday-ogrenciler/actions.ts'de de kullanılıyor.
function getDatabaseErrorMessage(error: { message: string; code?: string | null }) {
  if (error.code === "P0001") {
    return error.message;
  }

  if (process.env.NODE_ENV === "development") {
    return `Veritabanı hatası: ${error.message}`;
  }

  return "İşlem gerçekleştirilemedi.";
}
