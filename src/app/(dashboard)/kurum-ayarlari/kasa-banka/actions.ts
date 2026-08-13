"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const RECEIPT_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
const MAX_RECEIPT_SIZE_BYTES = 5 * 1024 * 1024;

export async function createCashAccount(formData: FormData) {
  const profile = await requireRole(["admin"]);

  const name = readText(formData, "name");

  if (name.length < 2) {
    redirect(
      `/kurum-ayarlari/kasa-banka?error=${encodeURIComponent("Kasa adı en az 2 karakter olmalıdır.")}`,
    );
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("cash_accounts")
    .insert({ organization_id: profile.organizationId, name });

  if (error) {
    console.error("Kasa hesabı oluşturulamadı:", error);

    redirect(
      `/kurum-ayarlari/kasa-banka?error=${encodeURIComponent(
        error.code === "23505"
          ? "Bu adla bir kasa hesabı zaten var."
          : "Kasa hesabı oluşturulamadı.",
      )}`,
    );
  }

  revalidatePath("/kurum-ayarlari/kasa-banka");

  redirect(`/kurum-ayarlari/kasa-banka?success=${encodeURIComponent("Kasa hesabı oluşturuldu.")}`);
}

export async function setCashAccountActive(formData: FormData) {
  const profile = await requireRole(["admin"]);

  const cashAccountId = readText(formData, "cashAccountId");
  const isActive = readText(formData, "isActive") === "true";

  const supabase = await createClient();

  const { error } = await supabase
    .from("cash_accounts")
    .update({ is_active: isActive })
    .eq("id", cashAccountId)
    .eq("organization_id", profile.organizationId);

  if (error) {
    console.error("Kasa hesabı durumu değiştirilemedi:", error);

    redirect(
      `/kurum-ayarlari/kasa-banka?error=${encodeURIComponent("Kasa hesabı durumu değiştirilemedi.")}`,
    );
  }

  revalidatePath("/kurum-ayarlari/kasa-banka");

  redirect(
    `/kurum-ayarlari/kasa-banka?success=${encodeURIComponent(
      isActive ? "Kasa hesabı aktifleştirildi." : "Kasa hesabı pasife alındı.",
    )}`,
  );
}

export async function createBankAccount(formData: FormData) {
  const profile = await requireRole(["admin"]);

  const bankName = readText(formData, "bankName");
  const accountName = readText(formData, "accountName");
  const iban = readText(formData, "iban").replace(/\s/g, "").toUpperCase();

  if (bankName.length < 2) {
    redirect(
      `/kurum-ayarlari/kasa-banka?error=${encodeURIComponent("Banka adı en az 2 karakter olmalıdır.")}`,
    );
  }

  if (iban && !/^TR\d{24}$/.test(iban)) {
    redirect(
      `/kurum-ayarlari/kasa-banka?error=${encodeURIComponent("IBAN, TR ile başlayan 26 karakter olmalıdır.")}`,
    );
  }

  const supabase = await createClient();

  const { error } = await supabase.from("bank_accounts").insert({
    organization_id: profile.organizationId,
    bank_name: bankName,
    account_name: accountName || null,
    iban: iban || null,
  });

  if (error) {
    console.error("Banka hesabı oluşturulamadı:", error);

    redirect(
      `/kurum-ayarlari/kasa-banka?error=${encodeURIComponent("Banka hesabı oluşturulamadı.")}`,
    );
  }

  revalidatePath("/kurum-ayarlari/kasa-banka");

  redirect(`/kurum-ayarlari/kasa-banka?success=${encodeURIComponent("Banka hesabı oluşturuldu.")}`);
}

export async function setBankAccountActive(formData: FormData) {
  const profile = await requireRole(["admin"]);

  const bankAccountId = readText(formData, "bankAccountId");
  const isActive = readText(formData, "isActive") === "true";

  const supabase = await createClient();

  const { error } = await supabase
    .from("bank_accounts")
    .update({ is_active: isActive })
    .eq("id", bankAccountId)
    .eq("organization_id", profile.organizationId);

  if (error) {
    console.error("Banka hesabı durumu değiştirilemedi:", error);

    redirect(
      `/kurum-ayarlari/kasa-banka?error=${encodeURIComponent("Banka hesabı durumu değiştirilemedi.")}`,
    );
  }

  revalidatePath("/kurum-ayarlari/kasa-banka");

  redirect(
    `/kurum-ayarlari/kasa-banka?success=${encodeURIComponent(
      isActive ? "Banka hesabı aktifleştirildi." : "Banka hesabı pasife alındı.",
    )}`,
  );
}

export async function createBankDeposit(formData: FormData) {
  const profile = await requireRole(["admin"]);

  const cashAccountId = readText(formData, "cashAccountId");
  const bankAccountId = readText(formData, "bankAccountId");
  const depositedAt = readText(formData, "depositedAt");
  const note = readText(formData, "note");
  const movementIds = formData.getAll("movementIds").map(String).filter(Boolean);
  const receiptFile = formData.get("receipt");

  const redirectBase = `/kurum-ayarlari/kasa-banka/${cashAccountId}`;

  if (!cashAccountId || !bankAccountId) {
    redirect(`${redirectBase}?error=${encodeURIComponent("Kasa ve banka hesabı seçilmelidir.")}`);
  }

  if (movementIds.length === 0) {
    redirect(
      `${redirectBase}?error=${encodeURIComponent("Yatırıma dahil edilecek en az bir hareket seçilmelidir.")}`,
    );
  }

  if (!depositedAt) {
    redirect(`${redirectBase}?error=${encodeURIComponent("Yatırım tarihi seçilmelidir.")}`);
  }

  const supabase = await createClient();

  let receiptPath: string | null = null;

  if (receiptFile instanceof File && receiptFile.size > 0) {
    if (!RECEIPT_TYPES.includes(receiptFile.type)) {
      redirect(
        `${redirectBase}?error=${encodeURIComponent("Makbuz yalnızca PNG, JPEG, WEBP veya PDF olabilir.")}`,
      );
    }

    if (receiptFile.size > MAX_RECEIPT_SIZE_BYTES) {
      redirect(
        `${redirectBase}?error=${encodeURIComponent("Makbuz dosyası en fazla 5 MB olabilir.")}`,
      );
    }

    const extension =
      receiptFile.type === "application/pdf" ? "pdf" : receiptFile.type.split("/")[1];
    const path = `${profile.organizationId}/${Date.now()}-makbuz.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from("bank-deposit-receipts")
      .upload(path, receiptFile, { contentType: receiptFile.type });

    if (uploadError) {
      console.error("Makbuz yüklenemedi:", uploadError);

      redirect(
        `${redirectBase}?error=${encodeURIComponent("Makbuz yüklenemedi. Lütfen tekrar deneyin.")}`,
      );
    }

    receiptPath = path;
  }

  const { error } = await supabase.rpc("create_bank_deposit", {
    p_cash_account_id: cashAccountId,
    p_bank_account_id: bankAccountId,
    p_deposited_at: new Date(depositedAt).toISOString(),
    p_cash_movement_ids: movementIds,
    p_note: note || null,
    p_receipt_path: receiptPath,
  });

  if (error) {
    console.error("Banka yatırımı oluşturulamadı:", error);

    if (receiptPath) {
      await supabase.storage.from("bank-deposit-receipts").remove([receiptPath]);
    }

    redirect(`${redirectBase}?error=${encodeURIComponent(getDatabaseErrorMessage(error.message))}`);
  }

  revalidatePath(`/kurum-ayarlari/kasa-banka/${cashAccountId}`);
  revalidatePath("/kurum-ayarlari/kasa-banka");

  redirect(`${redirectBase}?success=${encodeURIComponent("Banka yatırımı kaydedildi.")}`);
}

export async function recordCashCountAdjustment(formData: FormData) {
  await requireRole(["admin"]);

  const cashAccountId = readText(formData, "cashAccountId");
  const countedAmount = parseMoney(readText(formData, "countedAmount"));
  const reason = readText(formData, "reason");

  const redirectBase = `/kurum-ayarlari/kasa-banka/${cashAccountId}`;

  if (countedAmount === null || countedAmount < 0) {
    redirect(`${redirectBase}?error=${encodeURIComponent("Geçerli bir sayım tutarı girin.")}`);
  }

  if (reason.length < 3) {
    redirect(`${redirectBase}?error=${encodeURIComponent("Sayım farkı için bir açıklama girin.")}`);
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("record_cash_count_adjustment", {
    p_cash_account_id: cashAccountId,
    p_counted_amount: countedAmount,
    p_reason: reason,
  });

  if (error) {
    console.error("Kasa sayımı kaydedilemedi:", error);

    redirect(`${redirectBase}?error=${encodeURIComponent(getDatabaseErrorMessage(error.message))}`);
  }

  const result = (data ?? [])[0] as { delta: number } | undefined;

  revalidatePath(`/kurum-ayarlari/kasa-banka/${cashAccountId}`);
  revalidatePath("/kurum-ayarlari/kasa-banka");

  redirect(
    `${redirectBase}?success=${encodeURIComponent(
      !result || result.delta === 0
        ? "Sayım defterle uyumlu — düzeltme gerekmedi."
        : `Sayım kaydedildi — ${result.delta > 0 ? "+" : ""}${result.delta.toFixed(2)}₺ düzeltme eklendi.`,
    )}`,
  );
}

export async function reverseCashMovement(formData: FormData) {
  await requireRole(["admin"]);

  const cashAccountId = readText(formData, "cashAccountId");
  const movementId = readText(formData, "movementId");
  const reason = readText(formData, "reason");

  const redirectBase = `/kurum-ayarlari/kasa-banka/${cashAccountId}`;

  if (reason.length < 3) {
    redirect(`${redirectBase}?error=${encodeURIComponent("Ters kayıt için bir açıklama girin.")}`);
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("reverse_cash_movement", {
    p_movement_id: movementId,
    p_reason: reason,
  });

  if (error) {
    console.error("Ters kayıt oluşturulamadı:", error);

    redirect(`${redirectBase}?error=${encodeURIComponent(getDatabaseErrorMessage(error.message))}`);
  }

  revalidatePath(`/kurum-ayarlari/kasa-banka/${cashAccountId}`);
  revalidatePath("/kurum-ayarlari/kasa-banka");

  redirect(`${redirectBase}?success=${encodeURIComponent("Ters kayıt oluşturuldu.")}`);
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

function getDatabaseErrorMessage(message: string) {
  const safeMessages = [
    "Banka yatırımı oluşturma yetkiniz bulunmuyor.",
    "En az bir kasa hareketi seçilmelidir.",
    "Yatırım tarihi seçilmelidir.",
    "Kasa hesabı bulunamadı.",
    "Banka hesabı bulunamadı.",
    "Seçilen hareketlerden biri artık uygun değil (başka kasaya ait, negatif yönlü veya zaten yatırılmış olabilir).",
    "Kasa sayımı kaydetme yetkiniz bulunmuyor.",
    "Geçerli bir sayım tutarı girilmelidir.",
    "Sayım farkı için bir açıklama girilmelidir.",
    "Kasa hareketi ters kaydı oluşturma yetkiniz bulunmuyor.",
    "Ters kayıt için bir açıklama girilmelidir.",
    "Kasa hareketi bulunamadı.",
    "Bu hareket için zaten bir ters kayıt oluşturulmuş.",
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
