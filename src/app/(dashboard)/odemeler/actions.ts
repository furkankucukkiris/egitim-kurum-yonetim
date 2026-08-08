"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function generateMonthlyAccruals(formData: FormData) {
  await requireRole(["admin", "finance"]);

  const month = readText(formData, "month");

  if (!isMonthValue(month)) {
    redirect(
      `/odemeler?error=${encodeURIComponent("Geçerli bir ay seçmelisiniz.")}`,
    );
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("generate_monthly_accruals", {
    p_month_start: `${month}-01`,
  });

  if (error) {
    console.error("Aylık tahakkuklar oluşturulamadı:", error);

    redirect(
      `/odemeler?month=${month}&error=${encodeURIComponent(
        getDatabaseErrorMessage(error.message),
      )}`,
    );
  }

  const result = (data ?? [])[0] as
    | { created_count: number; existing_count: number }
    | undefined;

  const messageParts = [
    `${result?.created_count ?? 0} yeni tahakkuk oluşturuldu.`,
  ];

  if (result && result.existing_count > 0) {
    messageParts.push(`${result.existing_count} kayıt zaten mevcuttu.`);
  }

  revalidatePath("/odemeler");

  redirect(
    `/odemeler?month=${month}&success=${encodeURIComponent(
      messageParts.join(" "),
    )}`,
  );
}

export async function recordPayment(formData: FormData) {
  await requireRole(["admin", "finance"]);

  const studentId = readText(formData, "studentId");
  const courseId = readText(formData, "courseId");
  const month = readText(formData, "month");
  const method = readText(formData, "method");
  const note = readText(formData, "note");

  const amount = parseMoney(readText(formData, "amount"));

  const redirectBase = isMonthValue(month)
    ? `/odemeler?month=${month}`
    : "/odemeler";

  if (!studentId || !courseId) {
    redirect(
      `${redirectBase}&error=${encodeURIComponent(
        "Öğrenci veya ders bilgisi bulunamadı.",
      )}`,
    );
  }

  if (amount === null || amount <= 0) {
    redirect(
      `${redirectBase}&error=${encodeURIComponent(
        "Geçerli bir tutar girin.",
      )}`,
    );
  }

  const validMethods = ["cash", "bank_transfer", "card", "online", "other"];

  if (!validMethods.includes(method)) {
    redirect(
      `${redirectBase}&error=${encodeURIComponent(
        "Geçerli bir ödeme yöntemi seçin.",
      )}`,
    );
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("record_payment_for_course", {
    p_student_id: studentId,
    p_course_id: courseId,
    p_amount: amount,
    p_method: method,
    p_note: note || null,
  });

  if (error) {
    console.error("Ödeme kaydedilemedi:", error);

    redirect(
      `${redirectBase}&error=${encodeURIComponent(
        getDatabaseErrorMessage(error.message),
      )}`,
    );
  }

  revalidatePath("/odemeler");

  redirect(
    `${redirectBase}&success=${encodeURIComponent("Ödeme kaydedildi.")}`,
  );
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

function readText(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function getDatabaseErrorMessage(message: string) {
  const safeMessages = [
    "Aylık tahakkuk oluşturma yetkiniz bulunmuyor.",
    "Tahakkukların oluşturulacağı ay seçilmelidir.",
    "Ödeme kaydetme yetkiniz bulunmuyor.",
    "Geçerli bir tutar girilmelidir.",
    "Geçerli bir ödeme yöntemi seçilmelidir.",
    "Öğrenci kaydı bulunamadı.",
    "Öğrencinin bu derste kaydı bulunamadı.",
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
