import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Raporlar ekranının CSV dışa aktarımı. Ekranda gösterilen sayılarla
// dışa aktarılan sayıların ASLA farklılaşmaması için, burası ekranın
// kullandığı AYNI RPC'leri çağırır (get_accrual_report_monthly/
// _by_course, get_cash_flow_report_monthly/_by_method) — toplamları
// yeniden hesaplamaz, yalnızca aynı satırları CSV'ye çevirir.

export type ReportFilterParams = {
  startMonth: string;
  endMonth: string;
  courseId: string | null;
  studentStatus: string | null;
  method: string | null;
};

type AccrualMonthlyRpcRow = {
  month_start: string;
  accrued: number | string;
  collected: number | string;
  open_amount: number | string;
  partial_amount: number | string;
  overdue_amount: number | string;
  paid_amount: number | string;
  open_count: number;
  partial_count: number;
  overdue_count: number;
  paid_count: number;
};

type AccrualCourseRpcRow = {
  course_id: string;
  course_name: string;
  accrued: number | string;
  collected: number | string;
  open_count: number;
  partial_count: number;
  overdue_count: number;
  paid_count: number;
};

type CashFlowMonthlyRpcRow = {
  month_start: string;
  cash_in: number | string;
  refunds: number | string;
  expenses_paid: number | string;
  net_cash: number | string;
};

type CashFlowMethodRpcRow = {
  method: string;
  cash_in: number | string;
  refunds: number | string;
  net_cash: number | string;
  payment_count: number;
};

const methodLabels: Record<string, string> = {
  cash: "Nakit",
  bank_transfer: "Havale",
  card: "Kart",
  online: "Online",
  other: "Diğer",
};

export async function fetchAccrualReportExportData(
  supabase: SupabaseClient,
  params: ReportFilterParams,
) {
  const [monthlyResult, courseResult] = await Promise.all([
    supabase.rpc("get_accrual_report_monthly", {
      p_start_month: params.startMonth,
      p_end_month: params.endMonth,
      p_course_id: params.courseId,
      p_student_status: params.studentStatus,
    }),
    supabase.rpc("get_accrual_report_by_course", {
      p_start_month: params.startMonth,
      p_end_month: params.endMonth,
      p_course_id: params.courseId,
      p_student_status: params.studentStatus,
    }),
  ]);

  if (monthlyResult.error) {
    throw monthlyResult.error;
  }

  if (courseResult.error) {
    throw courseResult.error;
  }

  return {
    monthly: (monthlyResult.data ?? []) as AccrualMonthlyRpcRow[],
    byCourse: (courseResult.data ?? []) as AccrualCourseRpcRow[],
  };
}

export async function fetchCashFlowReportExportData(
  supabase: SupabaseClient,
  params: ReportFilterParams,
) {
  const [monthlyResult, methodResult] = await Promise.all([
    supabase.rpc("get_cash_flow_report_monthly", {
      p_start_month: params.startMonth,
      p_end_month: params.endMonth,
      p_course_id: params.courseId,
      p_method: params.method,
      p_student_status: params.studentStatus,
    }),
    supabase.rpc("get_cash_flow_report_by_method", {
      p_start_month: params.startMonth,
      p_end_month: params.endMonth,
      p_course_id: params.courseId,
      p_student_status: params.studentStatus,
    }),
  ]);

  if (monthlyResult.error) {
    throw monthlyResult.error;
  }

  if (methodResult.error) {
    throw methodResult.error;
  }

  return {
    monthly: (monthlyResult.data ?? []) as CashFlowMonthlyRpcRow[],
    byMethod: (methodResult.data ?? []) as CashFlowMethodRpcRow[],
  };
}

function escapeCsvField(value: string | number) {
  const text = String(value);

  if (/[",;\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function toCsvLine(values: Array<string | number>) {
  return values.map(escapeCsvField).join(";");
}

function formatMonthLabel(monthStart: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    month: "long",
    year: "numeric",
  }).format(new Date(`${monthStart}T00:00:00.000Z`));
}

/**
 * Excel'in tr-TR ayarlarıyla (ondalık ayracı virgül) doğru açması
 * için ";" ayraç, UTF-8 BOM Türkçe karakterlerin bozulmadan
 * görünmesi için kullanılıyor — /odemeler dışa aktarımıyla aynı
 * kural (src/lib/payments/export.ts).
 */
const CSV_BOM = String.fromCharCode(0xfeff);

export function accrualReportToCsv(data: {
  monthly: AccrualMonthlyRpcRow[];
  byCourse: AccrualCourseRpcRow[];
}): string {
  const lines: string[] = [];

  lines.push(toCsvLine(["TAHAKKUK PERFORMANSI — AYLIK KIRILIM"]));
  lines.push(
    toCsvLine([
      "Ay",
      "Tahakkuk (TL)",
      "Tahsilat (TL)",
      "Açık (TL)",
      "Kısmi (TL)",
      "Gecikmiş (TL)",
      "Ödenen (TL)",
      "Açık (adet)",
      "Kısmi (adet)",
      "Gecikmiş (adet)",
      "Ödenen (adet)",
    ]),
  );

  for (const row of data.monthly) {
    lines.push(
      toCsvLine([
        formatMonthLabel(row.month_start),
        Number(row.accrued),
        Number(row.collected),
        Number(row.open_amount),
        Number(row.partial_amount),
        Number(row.overdue_amount),
        Number(row.paid_amount),
        row.open_count,
        row.partial_count,
        row.overdue_count,
        row.paid_count,
      ]),
    );
  }

  lines.push("");
  lines.push(toCsvLine(["DERS BAZLI TAHAKKUK VE TAHSİLAT"]));
  lines.push(
    toCsvLine([
      "Ders",
      "Tahakkuk (TL)",
      "Tahsilat (TL)",
      "Açık (adet)",
      "Kısmi (adet)",
      "Gecikmiş (adet)",
      "Ödenen (adet)",
    ]),
  );

  for (const row of data.byCourse) {
    lines.push(
      toCsvLine([
        row.course_name,
        Number(row.accrued),
        Number(row.collected),
        row.open_count,
        row.partial_count,
        row.overdue_count,
        row.paid_count,
      ]),
    );
  }

  return CSV_BOM + lines.join("\r\n");
}

export function cashFlowReportToCsv(data: {
  monthly: CashFlowMonthlyRpcRow[];
  byMethod: CashFlowMethodRpcRow[];
}): string {
  const lines: string[] = [];

  lines.push(toCsvLine(["NAKİT AKIŞI — AYLIK KIRILIM"]));
  lines.push(toCsvLine(["Ay", "Nakit Girişi (TL)", "İade (TL)", "Gider (TL)", "Net Nakit (TL)"]));

  for (const row of data.monthly) {
    lines.push(
      toCsvLine([
        formatMonthLabel(row.month_start),
        Number(row.cash_in),
        Number(row.refunds),
        Number(row.expenses_paid),
        Number(row.net_cash),
      ]),
    );
  }

  lines.push("");
  lines.push(toCsvLine(["ÖDEME YÖNTEMİ DAĞILIMI"]));
  lines.push(toCsvLine(["Yöntem", "Nakit Girişi (TL)", "İade (TL)", "Net (TL)", "İşlem Sayısı"]));

  for (const row of data.byMethod) {
    lines.push(
      toCsvLine([
        methodLabels[row.method] ?? row.method,
        Number(row.cash_in),
        Number(row.refunds),
        Number(row.net_cash),
        row.payment_count,
      ]),
    );
  }

  return CSV_BOM + lines.join("\r\n");
}
