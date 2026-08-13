"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function generateTeacherCompensation(formData: FormData) {
  await requireRole(["admin"]);

  const month = readText(formData, "month");

  if (!isMonthValue(month)) {
    redirect(`/hakedis?error=${encodeURIComponent("Geçerli bir ay seçmelisiniz.")}`);
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("generate_teacher_compensation", {
    p_month_start: `${month}-01`,
  });

  if (error) {
    console.error("Aylık hakediş oluşturulamadı:", error);

    redirect(
      `/hakedis?month=${month}&error=${encodeURIComponent(getDatabaseErrorMessage(error.message))}`,
    );
  }

  const result = (data ?? [])[0] as
    { created_count: number; existing_count: number; skipped_no_rule_count: number } | undefined;

  const messageParts = [`${result?.created_count ?? 0} yeni hakediş satırı oluşturuldu.`];

  if (result && result.existing_count > 0) {
    messageParts.push(`${result.existing_count} kayıt zaten mevcuttu.`);
  }

  if (result && result.skipped_no_rule_count > 0) {
    messageParts.push(
      `${result.skipped_no_rule_count} oturum, ücret kuralı bulunamadığı için atlandı.`,
    );
  }

  revalidatePath("/hakedis");

  redirect(`/hakedis?month=${month}&success=${encodeURIComponent(messageParts.join(" "))}`);
}

export async function createCompensationRule(formData: FormData) {
  await requireRole(["admin"]);

  const teacherId = readText(formData, "teacherId");
  const compensationType = readText(formData, "compensationType");
  const rateAmount = parseMoney(readText(formData, "rateAmount"));
  const effectiveFrom = readText(formData, "effectiveFrom");
  const effectiveTo = readText(formData, "effectiveTo");
  const cancellationRateAmount = readText(formData, "cancellationRateAmount");
  const makeupRateAmount = readText(formData, "makeupRateAmount");
  const note = readText(formData, "note");

  const redirectBase = `/hakedis/${teacherId}`;

  if (rateAmount === null || rateAmount < 0) {
    redirect(`${redirectBase}?error=${encodeURIComponent("Geçerli bir tutar girin.")}`);
  }

  if (!effectiveFrom) {
    redirect(`${redirectBase}?error=${encodeURIComponent("Başlangıç tarihi seçilmelidir.")}`);
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("create_teacher_compensation_rule", {
    p_teacher_profile_id: teacherId,
    p_compensation_type: compensationType,
    p_rate_amount: rateAmount,
    p_effective_from: effectiveFrom,
    p_effective_to: effectiveTo || null,
    p_cancellation_rate_amount: cancellationRateAmount ? parseMoney(cancellationRateAmount) : null,
    p_makeup_rate_amount: makeupRateAmount ? parseMoney(makeupRateAmount) : null,
    p_note: note || null,
  });

  if (error) {
    console.error("Hakediş kuralı oluşturulamadı:", error);

    redirect(`${redirectBase}?error=${encodeURIComponent(getDatabaseErrorMessage(error.message))}`);
  }

  revalidatePath(`/hakedis/${teacherId}`);

  redirect(`${redirectBase}?success=${encodeURIComponent("Hakediş kuralı oluşturuldu.")}`);
}

export async function endCompensationRule(formData: FormData) {
  await requireRole(["admin"]);

  const teacherId = readText(formData, "teacherId");
  const ruleId = readText(formData, "ruleId");
  const effectiveTo = readText(formData, "effectiveTo");

  const redirectBase = `/hakedis/${teacherId}`;

  if (!effectiveTo) {
    redirect(`${redirectBase}?error=${encodeURIComponent("Bitiş tarihi seçilmelidir.")}`);
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("end_teacher_compensation_rule", {
    p_rule_id: ruleId,
    p_effective_to: effectiveTo,
  });

  if (error) {
    console.error("Hakediş kuralı sonlandırılamadı:", error);

    redirect(`${redirectBase}?error=${encodeURIComponent(getDatabaseErrorMessage(error.message))}`);
  }

  revalidatePath(`/hakedis/${teacherId}`);

  redirect(`${redirectBase}?success=${encodeURIComponent("Hakediş kuralı sonlandırıldı.")}`);
}

export async function approveCompensation(formData: FormData) {
  await requireRole(["admin"]);

  const teacherId = readText(formData, "teacherId");
  const periodStart = readText(formData, "periodStart");
  const redirectTo = readText(formData, "redirectTo") || "/hakedis";

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("approve_teacher_compensation", {
    p_teacher_profile_id: teacherId,
    p_period_start: periodStart,
  });

  if (error) {
    console.error("Hakediş onaylanamadı:", error);

    redirect(`${redirectTo}?error=${encodeURIComponent(getDatabaseErrorMessage(error.message))}`);
  }

  revalidatePath("/hakedis");
  revalidatePath(`/hakedis/${teacherId}`);

  redirect(`${redirectTo}?success=${encodeURIComponent(`${data ?? 0} hakediş satırı onaylandı.`)}`);
}

export async function markCompensationPaid(formData: FormData) {
  await requireRole(["admin"]);

  const teacherId = readText(formData, "teacherId");
  const periodStart = readText(formData, "periodStart");
  const redirectTo = readText(formData, "redirectTo") || "/hakedis";

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("mark_teacher_compensation_paid", {
    p_teacher_profile_id: teacherId,
    p_period_start: periodStart,
  });

  if (error) {
    console.error("Hakediş ödemesi işaretlenemedi:", error);

    redirect(`${redirectTo}?error=${encodeURIComponent(getDatabaseErrorMessage(error.message))}`);
  }

  revalidatePath("/hakedis");
  revalidatePath(`/hakedis/${teacherId}`);

  redirect(
    `${redirectTo}?success=${encodeURIComponent(`${data ?? 0} hakediş satırı ödendi olarak işaretlendi.`)}`,
  );
}

export async function addCompensationAdjustment(formData: FormData) {
  await requireRole(["admin"]);

  const teacherId = readText(formData, "teacherId");
  const periodStart = readText(formData, "periodStart");
  const amount = parseMoney(readText(formData, "amount"));
  const direction = readText(formData, "direction");
  const note = readText(formData, "note");

  const redirectBase = `/hakedis/${teacherId}`;

  if (amount === null || amount <= 0) {
    redirect(`${redirectBase}?error=${encodeURIComponent("Geçerli bir tutar girin.")}`);
  }

  if (note.length < 3) {
    redirect(`${redirectBase}?error=${encodeURIComponent("Düzeltme için bir açıklama girin.")}`);
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("add_compensation_adjustment", {
    p_teacher_profile_id: teacherId,
    p_period_start: periodStart,
    p_amount: amount,
    p_direction: direction === "-1" ? -1 : 1,
    p_note: note,
  });

  if (error) {
    console.error("Hakediş düzeltmesi eklenemedi:", error);

    redirect(`${redirectBase}?error=${encodeURIComponent(getDatabaseErrorMessage(error.message))}`);
  }

  revalidatePath("/hakedis");
  revalidatePath(`/hakedis/${teacherId}`);

  redirect(`${redirectBase}?success=${encodeURIComponent("Düzeltme eklendi.")}`);
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

function isMonthValue(value: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function getDatabaseErrorMessage(message: string) {
  const safeMessages = [
    "Aylık hakediş oluşturma yetkiniz bulunmuyor.",
    "Hakedişlerin oluşturulacağı ay seçilmelidir.",
    "Hakediş kuralı oluşturma yetkiniz bulunmuyor.",
    "Geçerli bir ücret modeli seçilmelidir.",
    "Geçerli bir tutar girilmelidir.",
    "Başlangıç tarihi seçilmelidir.",
    "Bitiş tarihi başlangıç tarihinden önce olamaz.",
    "Öğretmen hesabı bulunamadı.",
    "Bu öğretmen için seçilen tarih aralığıyla çakışan bir kural zaten var.",
    "Hakediş kuralı düzenleme yetkiniz bulunmuyor.",
    "Hakediş kuralı bulunamadı.",
    "Hakediş onaylama yetkiniz bulunmuyor.",
    "Hakediş ödemesi işaretleme yetkiniz bulunmuyor.",
    "Ödenmiş işaretlenecek onaylı bir hakediş bulunamadı.",
    "Hakediş düzeltmesi ekleme yetkiniz bulunmuyor.",
    "Geçerli bir yön (ekleme/kesinti) seçilmelidir.",
    "Dönem seçilmelidir.",
    "Düzeltme için bir açıklama girilmelidir.",
  ];

  const matched = safeMessages.find((item) => message.includes(item));

  if (matched) {
    return matched;
  }

  if (process.env.NODE_ENV === "development") {
    return `Veritabanı hatası: ${message}`;
  }

  return "İşlem gerçekleştirilemedi.";
}
