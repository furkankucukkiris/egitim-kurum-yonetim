"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const DOCUMENT_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
const MAX_DOCUMENT_SIZE_BYTES = 5 * 1024 * 1024;

export async function createExpenseCategory(formData: FormData) {
  const profile = await requireRole(["admin"]);

  const name = readText(formData, "name");
  const isDirectCourseCost = formData.get("isDirectCourseCost") === "on";

  if (name.length < 2) {
    redirect(`/giderler?error=${encodeURIComponent("Kategori adı en az 2 karakter olmalıdır.")}`);
  }

  const supabase = await createClient();

  const { error } = await supabase.from("expense_categories").insert({
    organization_id: profile.organizationId,
    name,
    is_direct_course_cost: isDirectCourseCost,
  });

  if (error) {
    console.error("Masraf kategorisi oluşturulamadı:", error);

    redirect(
      `/giderler?error=${encodeURIComponent(
        error.code === "23505" ? "Bu adla bir kategori zaten var." : "Kategori oluşturulamadı.",
      )}`,
    );
  }

  revalidatePath("/giderler");

  redirect(`/giderler?success=${encodeURIComponent("Masraf kategorisi oluşturuldu.")}`);
}

export async function createExpense(formData: FormData) {
  await requireRole(["admin"]);

  const categoryId = readText(formData, "categoryId");
  const courseId = readText(formData, "courseId");
  const amount = parseMoney(readText(formData, "amount"));
  const expenseDate = readText(formData, "expenseDate");
  const dueDate = readText(formData, "dueDate");
  const vendorName = readText(formData, "vendorName");
  const note = readText(formData, "note");

  if (!categoryId) {
    redirect(`/giderler/yeni?error=${encodeURIComponent("Bir kategori seçin.")}`);
  }

  if (amount === null || amount <= 0) {
    redirect(`/giderler/yeni?error=${encodeURIComponent("Geçerli bir tutar girin.")}`);
  }

  if (!expenseDate) {
    redirect(`/giderler/yeni?error=${encodeURIComponent("Masraf tarihi seçilmelidir.")}`);
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("create_expense", {
    p_category_id: categoryId,
    p_amount: amount,
    p_expense_date: expenseDate,
    p_due_date: dueDate || null,
    p_course_id: courseId || null,
    p_vendor_name: vendorName || null,
    p_note: note || null,
  });

  if (error) {
    console.error("Masraf oluşturulamadı:", error);

    redirect(`/giderler/yeni?error=${encodeURIComponent(getDatabaseErrorMessage(error.message))}`);
  }

  revalidatePath("/giderler");

  redirect(`/giderler/${data}?success=${encodeURIComponent("Masraf oluşturuldu.")}`);
}

export async function updateExpenseDetails(formData: FormData) {
  await requireRole(["admin"]);

  const expenseId = readText(formData, "expenseId");
  const categoryId = readText(formData, "categoryId");
  const courseId = readText(formData, "courseId");
  const amount = parseMoney(readText(formData, "amount"));
  const expenseDate = readText(formData, "expenseDate");
  const dueDate = readText(formData, "dueDate");
  const vendorName = readText(formData, "vendorName");
  const note = readText(formData, "note");

  const redirectBase = `/giderler/${expenseId}`;

  if (amount === null || amount <= 0) {
    redirect(`${redirectBase}?error=${encodeURIComponent("Geçerli bir tutar girin.")}`);
  }

  if (!expenseDate) {
    redirect(`${redirectBase}?error=${encodeURIComponent("Masraf tarihi seçilmelidir.")}`);
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("update_expense_details", {
    p_expense_id: expenseId,
    p_category_id: categoryId,
    p_amount: amount,
    p_expense_date: expenseDate,
    p_due_date: dueDate || null,
    p_course_id: courseId || null,
    p_vendor_name: vendorName || null,
    p_note: note || null,
  });

  if (error) {
    console.error("Masraf güncellenemedi:", error);

    redirect(`${redirectBase}?error=${encodeURIComponent(getDatabaseErrorMessage(error.message))}`);
  }

  revalidatePath(`/giderler/${expenseId}`);
  revalidatePath("/giderler");

  redirect(`${redirectBase}?success=${encodeURIComponent("Masraf güncellendi.")}`);
}

export async function recordExpensePayment(formData: FormData) {
  await requireRole(["admin"]);

  const expenseId = readText(formData, "expenseId");
  const paidAt = readText(formData, "paidAt");
  const paymentMethod = readText(formData, "paymentMethod");
  const cashAccountId = readText(formData, "cashAccountId");

  const redirectBase = `/giderler/${expenseId}`;

  if (!paidAt) {
    redirect(`${redirectBase}?error=${encodeURIComponent("Ödeme tarihi seçilmelidir.")}`);
  }

  const validMethods = ["cash", "bank_transfer", "card", "online", "other"];

  if (!validMethods.includes(paymentMethod)) {
    redirect(`${redirectBase}?error=${encodeURIComponent("Geçerli bir ödeme yöntemi seçin.")}`);
  }

  if (paymentMethod === "cash" && !cashAccountId) {
    redirect(
      `${redirectBase}?error=${encodeURIComponent("Nakit ödeme için bir kasa hesabı seçin.")}`,
    );
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("record_expense_payment", {
    p_expense_id: expenseId,
    p_paid_at: new Date(paidAt).toISOString(),
    p_payment_method: paymentMethod,
    p_cash_account_id: paymentMethod === "cash" ? cashAccountId : null,
  });

  if (error) {
    console.error("Masraf ödemesi kaydedilemedi:", error);

    redirect(`${redirectBase}?error=${encodeURIComponent(getDatabaseErrorMessage(error.message))}`);
  }

  revalidatePath(`/giderler/${expenseId}`);
  revalidatePath("/giderler");

  redirect(`${redirectBase}?success=${encodeURIComponent("Masraf ödemesi kaydedildi.")}`);
}

export async function cancelExpense(formData: FormData) {
  await requireRole(["admin"]);

  const expenseId = readText(formData, "expenseId");
  const reason = readText(formData, "reason");

  const redirectBase = `/giderler/${expenseId}`;

  if (reason.length < 3) {
    redirect(`${redirectBase}?error=${encodeURIComponent("İptal için bir açıklama girin.")}`);
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("cancel_expense", {
    p_expense_id: expenseId,
    p_reason: reason,
  });

  if (error) {
    console.error("Masraf iptal edilemedi:", error);

    redirect(`${redirectBase}?error=${encodeURIComponent(getDatabaseErrorMessage(error.message))}`);
  }

  revalidatePath(`/giderler/${expenseId}`);
  revalidatePath("/giderler");

  redirect(`${redirectBase}?success=${encodeURIComponent("Masraf iptal edildi.")}`);
}

export async function uploadExpenseDocument(formData: FormData) {
  const profile = await requireRole(["admin"]);

  const expenseId = readText(formData, "expenseId");
  const documentFile = formData.get("document");

  const redirectBase = `/giderler/${expenseId}`;

  if (!(documentFile instanceof File) || documentFile.size === 0) {
    redirect(`${redirectBase}?error=${encodeURIComponent("Bir dosya seçin.")}`);
  }

  if (!DOCUMENT_TYPES.includes(documentFile.type)) {
    redirect(
      `${redirectBase}?error=${encodeURIComponent("Belge yalnızca PNG, JPEG, WEBP veya PDF olabilir.")}`,
    );
  }

  if (documentFile.size > MAX_DOCUMENT_SIZE_BYTES) {
    redirect(`${redirectBase}?error=${encodeURIComponent("Belge en fazla 5 MB olabilir.")}`);
  }

  const supabase = await createClient();

  const extension =
    documentFile.type === "application/pdf" ? "pdf" : documentFile.type.split("/")[1];
  const path = `${profile.organizationId}/${expenseId}-${Date.now()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from("expense-documents")
    .upload(path, documentFile, { contentType: documentFile.type });

  if (uploadError) {
    console.error("Belge yüklenemedi:", uploadError);

    redirect(
      `${redirectBase}?error=${encodeURIComponent("Belge yüklenemedi. Lütfen tekrar deneyin.")}`,
    );
  }

  const { error } = await supabase.rpc("set_expense_document", {
    p_expense_id: expenseId,
    p_document_path: path,
  });

  if (error) {
    console.error("Belge masrafa bağlanamadı:", error);

    await supabase.storage.from("expense-documents").remove([path]);

    redirect(`${redirectBase}?error=${encodeURIComponent(getDatabaseErrorMessage(error.message))}`);
  }

  revalidatePath(`/giderler/${expenseId}`);

  redirect(`${redirectBase}?success=${encodeURIComponent("Belge yüklendi.")}`);
}

export async function createRecurringExpenseTemplate(formData: FormData) {
  await requireRole(["admin"]);

  const categoryId = readText(formData, "categoryId");
  const courseId = readText(formData, "courseId");
  const amount = parseMoney(readText(formData, "amount"));
  const dueDay = Number(readText(formData, "dueDay"));
  const vendorName = readText(formData, "vendorName");
  const paymentMethod = readText(formData, "paymentMethod");
  const note = readText(formData, "note");

  if (!categoryId) {
    redirect(`/giderler?error=${encodeURIComponent("Bir kategori seçin.")}`);
  }

  if (amount === null || amount <= 0) {
    redirect(`/giderler?error=${encodeURIComponent("Geçerli bir tutar girin.")}`);
  }

  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 28) {
    redirect(`/giderler?error=${encodeURIComponent("Vade günü 1 ile 28 arasında olmalıdır.")}`);
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("create_recurring_expense_template", {
    p_category_id: categoryId,
    p_amount: amount,
    p_due_day: dueDay,
    p_course_id: courseId || null,
    p_vendor_name: vendorName || null,
    p_payment_method: paymentMethod || null,
    p_note: note || null,
  });

  if (error) {
    console.error("Tekrarlayan masraf şablonu oluşturulamadı:", error);

    redirect(`/giderler?error=${encodeURIComponent(getDatabaseErrorMessage(error.message))}`);
  }

  revalidatePath("/giderler");

  redirect(`/giderler?success=${encodeURIComponent("Tekrarlayan masraf şablonu oluşturuldu.")}`);
}

export async function setRecurringExpenseTemplateActive(formData: FormData) {
  await requireRole(["admin"]);

  const templateId = readText(formData, "templateId");
  const isActive = readText(formData, "isActive") === "true";

  const supabase = await createClient();

  const { error } = await supabase.rpc("set_recurring_expense_template_active", {
    p_template_id: templateId,
    p_is_active: isActive,
  });

  if (error) {
    console.error("Şablon durumu değiştirilemedi:", error);

    redirect(`/giderler?error=${encodeURIComponent(getDatabaseErrorMessage(error.message))}`);
  }

  revalidatePath("/giderler");

  redirect(
    `/giderler?success=${encodeURIComponent(
      isActive ? "Şablon aktifleştirildi." : "Şablon pasife alındı.",
    )}`,
  );
}

export async function generateMonthlyExpenses(formData: FormData) {
  await requireRole(["admin"]);

  const month = readText(formData, "month");

  if (!isMonthValue(month)) {
    redirect(`/giderler?error=${encodeURIComponent("Geçerli bir ay seçmelisiniz.")}`);
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("generate_monthly_expenses", {
    p_month_start: `${month}-01`,
  });

  if (error) {
    console.error("Aylık masraflar oluşturulamadı:", error);

    redirect(
      `/giderler?month=${month}&error=${encodeURIComponent(getDatabaseErrorMessage(error.message))}`,
    );
  }

  const result = (data ?? [])[0] as { created_count: number; existing_count: number } | undefined;

  const messageParts = [`${result?.created_count ?? 0} yeni masraf oluşturuldu.`];

  if (result && result.existing_count > 0) {
    messageParts.push(`${result.existing_count} kayıt zaten mevcuttu.`);
  }

  revalidatePath("/giderler");

  redirect(`/giderler?month=${month}&success=${encodeURIComponent(messageParts.join(" "))}`);
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
    "Masraf ekleme yetkiniz bulunmuyor.",
    "Masraf düzenleme yetkiniz bulunmuyor.",
    "Masraf ödemesi kaydetme yetkiniz bulunmuyor.",
    "Masraf iptal etme yetkiniz bulunmuyor.",
    "Belge ekleme yetkiniz bulunmuyor.",
    "Tekrarlayan masraf şablonu oluşturma yetkiniz bulunmuyor.",
    "Şablon durumu değiştirme yetkiniz bulunmuyor.",
    "Aylık masraf oluşturma yetkiniz bulunmuyor.",
    "Geçerli bir tutar girilmelidir.",
    "Masraf tarihi seçilmelidir.",
    "Masraf kategorisi bulunamadı.",
    "Ders bulunamadı.",
    "Masraf kaydı bulunamadı.",
    "Yalnızca ödenmemiş (planlı) masraflar düzenlenebilir.",
    "Yalnızca planlı masraflar ödenmiş olarak işaretlenebilir.",
    "Geçerli bir ödeme yöntemi seçilmelidir.",
    "Ödeme tarihi seçilmelidir.",
    "Nakit ödeme için bir kasa hesabı seçilmelidir.",
    "Kasa hesabı bulunamadı.",
    "İptal için bir açıklama girilmelidir.",
    "Bu masraf zaten iptal edilmiş.",
    "Vade günü 1 ile 28 arasında olmalıdır.",
    "Şablon bulunamadı.",
    "Oturumların oluşturulacağı ay seçilmelidir.",
    "Masrafların oluşturulacağı ay seçilmelidir.",
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
