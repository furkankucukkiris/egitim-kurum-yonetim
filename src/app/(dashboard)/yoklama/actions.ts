"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type GenerationResult = {
  created_count: number;
  existing_count: number;
  skipped_group_count: number;
  first_session_date: string | null;
};

export async function generateMonthlySessions(
  formData: FormData,
) {
  await requireRole(["admin"]);

  const month = String(
    formData.get("month") ?? "",
  ).trim();

  if (!isMonthValue(month)) {
    redirect(
      `/yoklama?error=${encodeURIComponent(
        "Geçerli bir ay seçmelisiniz.",
      )}`,
    );
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc(
    "generate_monthly_lesson_sessions",
    {
      p_month_start: `${month}-01`,
    },
  );

  if (error) {
    console.error(
      "Aylık ders oturumları oluşturulamadı:",
      error,
    );

    redirect(
      `/yoklama?date=${month}-01&error=${encodeURIComponent(
        getDatabaseErrorMessage(
          error.message,
        ),
      )}`,
    );
  }

  const result = (
    (data ?? []) as GenerationResult[]
  )[0] ?? {
    created_count: 0,
    existing_count: 0,
    skipped_group_count: 0,
    first_session_date: null,
  };

  const messageParts = [
    `${result.created_count} yeni ders oturumu oluşturuldu.`,
  ];

  if (result.existing_count > 0) {
    messageParts.push(
      `${result.existing_count} oturum daha önce oluşturulmuştu.`,
    );
  }

  if (result.skipped_group_count > 0) {
    messageParts.push(
      `${result.skipped_group_count} programda aktif öğretmen bulunmadığı için oturum oluşturulmadı.`,
    );
  }

  revalidatePath("/yoklama");

  const targetDate =
    result.first_session_date ??
    `${month}-01`;

  redirect(
    `/yoklama?date=${targetDate}&success=${encodeURIComponent(
      messageParts.join(" "),
    )}`,
  );
}

function isMonthValue(value: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(
    value,
  );
}

function getDatabaseErrorMessage(
  message: string,
) {
  const safeMessages = [
    "Oturumların oluşturulacağı ay seçilmelidir.",
    "Aylık ders oturumu oluşturma yetkiniz bulunmuyor.",
  ];

  const matchedMessage = safeMessages.find(
    (item) => message.includes(item),
  );

  if (matchedMessage) {
    return matchedMessage;
  }

  if (process.env.NODE_ENV === "development") {
    return `Veritabanı hatası: ${message}`;
  }

  return "Aylık ders oturumları oluşturulamadı.";
}
