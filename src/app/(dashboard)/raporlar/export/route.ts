import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  fetchAccrualReportExportData,
  fetchCashFlowReportExportData,
  accrualReportToCsv,
  cashFlowReportToCsv,
} from "@/lib/reports/export";

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(request: Request) {
  await requireRole(["admin"]);

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") ?? "";
  const start = searchParams.get("start") ?? "";
  const end = searchParams.get("end") ?? "";
  const course = searchParams.get("course");
  const status = searchParams.get("status");
  const method = searchParams.get("method");

  if (type !== "accrual" && type !== "cash") {
    return new Response("Geçerli bir rapor türü belirtilmelidir.", { status: 400 });
  }

  if (!MONTH_PATTERN.test(start) || !MONTH_PATTERN.test(end)) {
    return new Response("Geçerli bir tarih aralığı belirtilmelidir.", { status: 400 });
  }

  const supabase = await createClient();

  const params = {
    startMonth: `${start}-01`,
    endMonth: `${end}-01`,
    courseId: course || null,
    studentStatus: status || null,
    method: method || null,
  };

  try {
    if (type === "accrual") {
      const data = await fetchAccrualReportExportData(supabase, params);
      const csv = accrualReportToCsv(data);

      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="tahakkuk-raporu-${start}_${end}.csv"`,
        },
      });
    }

    const data = await fetchCashFlowReportExportData(supabase, params);
    const csv = cashFlowReportToCsv(data);

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="nakit-akisi-raporu-${start}_${end}.csv"`,
      },
    });
  } catch (error) {
    console.error("Rapor dışa aktarımı için veri alınamadı:", error);

    return new Response("Veri alınamadı.", { status: 500 });
  }
}
