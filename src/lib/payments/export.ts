import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Ödemeler ekranının CSV dışa aktarımı için temiz, düz veri servis
// katmanı. Arayüzden bağımsız — route handler bunu çağırıp CSV'ye
// çevirir, sayfa bileşeni bu dosyaya hiç bağımlı değildir.

export type PaymentsExportRow = {
  studentName: string;
  courseName: string;
  periodStart: string;
  status: string;
  netAmount: number;
  allocatedAmount: number;
  pendingAmount: number;
  dueDate: string;
};

type AccrualExportQueryRow = {
  net_amount: number;
  allocated_amount: number;
  status: string;
  due_date: string;
  period_start: string;
  enrollment: {
    student: { first_name: string; last_name: string } | null;
    course: { name: string } | null;
  } | null;
};

const statusLabels: Record<string, string> = {
  open: "Bekliyor",
  partial: "Kısmi",
  paid: "Ödendi",
  overdue: "Gecikmiş",
};

/**
 * Seçili ayın tahakkuk satırlarını (iptal/iade hariç) düz, dışa
 * aktarıma hazır satırlara çevirir. /odemeler sayfasındaki ders
 * kartlarıyla AYNI filtreyi kullanır (organization + period_start =
 * monthStart + status not in cancelled/refunded) — dışa aktarılan
 * veri ile ekranda görünen veri her zaman birebir aynıdır.
 */
export async function fetchMonthlyPaymentsExportRows(
  supabase: SupabaseClient,
  organizationId: string,
  monthStart: string,
): Promise<PaymentsExportRow[]> {
  const { data, error } = await supabase
    .from("accruals")
    .select(`
      net_amount, allocated_amount, status, due_date, period_start,
      enrollment:enrollments!inner (
        student:students!inner ( first_name, last_name ),
        course:courses!inner ( name )
      )
    `)
    .eq("organization_id", organizationId)
    .eq("period_start", monthStart)
    .not("status", "in", "(cancelled,refunded)");

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as unknown as AccrualExportQueryRow[];

  return rows
    .filter((row) => row.enrollment?.student && row.enrollment.course)
    .map((row) => {
      const netAmount = Number(row.net_amount);
      const allocatedAmount = Number(row.allocated_amount);

      return {
        studentName: `${row.enrollment!.student!.first_name} ${row.enrollment!.student!.last_name}`,
        courseName: row.enrollment!.course!.name,
        periodStart: row.period_start,
        status: statusLabels[row.status] ?? row.status,
        netAmount,
        allocatedAmount,
        pendingAmount: Math.max(0, netAmount - allocatedAmount),
        dueDate: row.due_date,
      };
    })
    .sort(
      (a, b) =>
        a.courseName.localeCompare(b.courseName, "tr-TR") ||
        a.studentName.localeCompare(b.studentName, "tr-TR"),
    );
}

const CSV_COLUMNS: { key: keyof PaymentsExportRow; label: string }[] = [
  { key: "studentName", label: "Öğrenci" },
  { key: "courseName", label: "Ders" },
  { key: "periodStart", label: "Dönem" },
  { key: "status", label: "Durum" },
  { key: "netAmount", label: "Tahakkuk (TL)" },
  { key: "allocatedAmount", label: "Tahsil Edilen (TL)" },
  { key: "pendingAmount", label: "Bekleyen (TL)" },
  { key: "dueDate", label: "Vade Tarihi" },
];

function escapeCsvField(value: string | number) {
  const text = String(value);

  if (/[",;\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

/**
 * Excel'in tr-TR ayarlarıyla (ondalık ayracı virgül) doğru açması
 * için ";" ayraç kullanılıyor; UTF-8 BOM Türkçe karakterlerin
 * bozulmadan görünmesini sağlıyor.
 */
export function paymentsExportRowsToCsv(rows: PaymentsExportRow[]): string {
  const lines = [CSV_COLUMNS.map((column) => escapeCsvField(column.label)).join(";")];

  for (const row of rows) {
    lines.push(
      CSV_COLUMNS.map((column) => escapeCsvField(row[column.key])).join(";"),
    );
  }

  return "\uFEFF" + lines.join("\r\n");
}
