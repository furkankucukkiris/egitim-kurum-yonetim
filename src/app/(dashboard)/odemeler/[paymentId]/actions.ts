"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function refundPayment(formData: FormData) {
  await requireRole(["admin"]);

  const paymentId = readText(formData, "paymentId");
  const reason = readText(formData, "reason");
  const refundType = readText(formData, "refundType") || "refund";
  const amount = parseMoney(readText(formData, "amount"));

  const redirectBase = `/odemeler/${paymentId}`;

  if (!paymentId) {
    redirect(`/odemeler?error=${encodeURIComponent("Ödeme bilgisi bulunamadı.")}`);
  }

  if (amount === null || amount <= 0) {
    redirect(`${redirectBase}?error=${encodeURIComponent("Geçerli bir tutar girin.")}`);
  }

  if (reason.length < 3) {
    redirect(
      `${redirectBase}?error=${encodeURIComponent(
        "İade/ters işlem gerekçesi en az 3 karakter olmalıdır.",
      )}`,
    );
  }

  if (refundType !== "refund" && refundType !== "reversal") {
    redirect(`${redirectBase}?error=${encodeURIComponent("Geçersiz iade türü.")}`);
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("refund_payment", {
    p_payment_id: paymentId,
    p_amount: amount,
    p_reason: reason,
    p_refund_type: refundType,
  });

  if (error) {
    console.error("Ödeme iadesi/ters işlem kaydedilemedi:", error);

    redirect(`${redirectBase}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(`/odemeler/${paymentId}`);
  revalidatePath("/odemeler");
  revalidatePath("/");

  redirect(
    `${redirectBase}?success=${encodeURIComponent(
      refundType === "refund" ? "İade kaydedildi." : "Ters işlem kaydedildi.",
    )}`,
  );
}

export async function allocateAdvance(formData: FormData) {
  await requireRole(["admin"]);

  const paymentId = readText(formData, "paymentId");
  const accrualId = readText(formData, "accrualId");
  const amount = parseMoney(readText(formData, "amount"));

  const redirectBase = `/odemeler/${paymentId}`;

  if (!paymentId) {
    redirect(`/odemeler?error=${encodeURIComponent("Ödeme bilgisi bulunamadı.")}`);
  }

  if (!accrualId) {
    redirect(`${redirectBase}?error=${encodeURIComponent("Uygulanacak tahakkuk seçilmelidir.")}`);
  }

  if (amount === null || amount <= 0) {
    redirect(`${redirectBase}?error=${encodeURIComponent("Geçerli bir tutar girin.")}`);
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("allocate_student_advance", {
    p_payment_id: paymentId,
    p_accrual_id: accrualId,
    p_amount: amount,
  });

  if (error) {
    console.error("Avans dağıtılamadı:", error);

    redirect(`${redirectBase}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(`/odemeler/${paymentId}`);
  revalidatePath("/odemeler");
  revalidatePath("/");

  redirect(`${redirectBase}?success=${encodeURIComponent("Avans tahakkuka uygulandı.")}`);
}

function parseMoney(value: string) {
  const normalized = value.replace(/\s/g, "").replace(",", ".");

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    return null;
  }

  const amount = Number(normalized);

  return Number.isFinite(amount) ? amount : null;
}

function readText(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}
