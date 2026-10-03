"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { isIsoDate, isMonthValue, parseMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export async function generateMonthlyAccruals(formData: FormData) {
  await requireRole(["admin"]);

  const month = readText(formData, "month");

  if (!isMonthValue(month)) {
    redirect(`/odemeler?error=${encodeURIComponent("Geçerli bir ay seçmelisiniz.")}`);
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("generate_monthly_accruals", {
    p_month_start: `${month}-01`,
  });

  if (error) {
    console.error("Aylık tahakkuklar oluşturulamadı:", error);

    redirect(
      `/odemeler?month=${month}&error=${encodeURIComponent(
        getDatabaseErrorMessage(error),
      )}`,
    );
  }

  const result = (data ?? [])[0] as { created_count: number; existing_count: number } | undefined;

  const messageParts = [`${result?.created_count ?? 0} yeni tahakkuk oluşturuldu.`];

  if (result && result.existing_count > 0) {
    messageParts.push(`${result.existing_count} kayıt zaten mevcuttu.`);
  }

  revalidatePath("/odemeler");

  redirect(`/odemeler?month=${month}&success=${encodeURIComponent(messageParts.join(" "))}`);
}

// Kurumda hiç kasa hesabı yoksa ilk nakit tahsilatta varsayılan bir
// "Ana Kasa" açılır — aksi halde nakit tahsilat hiç kaydedilemiyordu.
const DEFAULT_CASH_ACCOUNT_NAME = "Ana Kasa";

export async function recordPayment(formData: FormData) {
  const profile = await requireRole(["admin"]);

  const studentId = readText(formData, "studentId");
  const courseId = readText(formData, "courseId");
  const month = readText(formData, "month");
  const method = readText(formData, "method");
  const note = readText(formData, "note");
  const receivedOn = readText(formData, "receivedOn");
  let cashAccountId = readText(formData, "cashAccountId");

  const amount = parseMoney(readText(formData, "amount"));

  const redirectBase = isMonthValue(month) ? `/odemeler?month=${month}` : "/odemeler?";

  if (!studentId || !courseId) {
    redirect(
      `${redirectBase}&error=${encodeURIComponent("Öğrenci veya ders bilgisi bulunamadı.")}`,
    );
  }

  if (amount === null || amount <= 0) {
    redirect(`${redirectBase}&error=${encodeURIComponent("Geçerli bir tutar girin.")}`);
  }

  const validMethods = ["cash", "bank_transfer", "card", "online", "other"];

  if (!validMethods.includes(method)) {
    redirect(`${redirectBase}&error=${encodeURIComponent("Geçerli bir ödeme yöntemi seçin.")}`);
  }

  if (receivedOn && !isIsoDate(receivedOn)) {
    redirect(`${redirectBase}&error=${encodeURIComponent("Geçerli bir tahsilat tarihi girin.")}`);
  }

  const supabase = await createClient();

  if (method === "cash" && !cashAccountId) {
    const { data: accounts } = await supabase
      .from("cash_accounts")
      .select("id")
      .eq("organization_id", profile.organizationId)
      .eq("is_active", true);

    if ((accounts ?? []).length > 0) {
      redirect(
        `${redirectBase}&error=${encodeURIComponent("Nakit ödeme için bir kasa hesabı seçin.")}`,
      );
    }

    const { data: created, error: createError } = await supabase
      .from("cash_accounts")
      .insert({ organization_id: profile.organizationId, name: DEFAULT_CASH_ACCOUNT_NAME })
      .select("id")
      .single();

    if (createError || !created) {
      console.error("Varsayılan kasa hesabı açılamadı:", createError);

      redirect(
        `${redirectBase}&error=${encodeURIComponent(
          "Kasa hesabı bulunamadı. Kurum Ayarları → Kasa & Banka'dan bir kasa hesabı ekleyin.",
        )}`,
      );
    }

    cashAccountId = created.id;
  }

  const { error } = await supabase.rpc("record_payment_for_course", {
    p_student_id: studentId,
    p_course_id: courseId,
    p_amount: amount,
    p_method: method,
    p_note: note || null,
    p_cash_account_id: method === "cash" ? cashAccountId : null,
    p_received_on: receivedOn || null,
  });

  if (error) {
    console.error("Ödeme kaydedilemedi:", error);

    redirect(`${redirectBase}&error=${encodeURIComponent(getDatabaseErrorMessage(error))}`);
  }

  revalidatePath("/odemeler");
  revalidatePath("/");

  redirect(`${redirectBase}&success=${encodeURIComponent("Tahsilat kaydedildi.")}`);
}

function readText(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

// P0001 = plpgsql `raise exception` — RPC'lerimiz yalnızca kendi Türkçe
// mesajlarını bu kodla fırlatır (bkz. enrollment-actions.ts).
function getDatabaseErrorMessage(error: { message: string; code?: string | null }) {
  if (error.code === "P0001") {
    return error.message;
  }

  const message = error.message;

  const safeMessages = [
    "Aylık tahakkuk oluşturma yetkiniz bulunmuyor.",
    "Tahakkukların oluşturulacağı ay seçilmelidir.",
    "Ödeme kaydetme yetkiniz bulunmuyor.",
    "Geçerli bir tutar girilmelidir.",
    "Geçerli bir ödeme yöntemi seçilmelidir.",
    "Öğrenci kaydı bulunamadı.",
    "Öğrencinin bu derste kaydı bulunamadı.",
    "Nakit ödeme için bir kasa hesabı seçilmelidir.",
    "Kasa hesabı bulunamadı.",
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
