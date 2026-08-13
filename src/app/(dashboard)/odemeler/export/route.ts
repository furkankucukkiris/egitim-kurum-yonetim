import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchMonthlyPaymentsExportRows, paymentsExportRowsToCsv } from "@/lib/payments/export";

export async function GET(request: Request) {
  const profile = await requireRole(["admin"]);

  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month") ?? "";

  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return new Response("Geçerli bir ay belirtilmelidir (örn. 2026-04).", {
      status: 400,
    });
  }

  const supabase = await createClient();

  let rows;

  try {
    rows = await fetchMonthlyPaymentsExportRows(supabase, profile.organizationId, `${month}-01`);
  } catch (error) {
    console.error("Ödeme dışa aktarımı için veri alınamadı:", error);

    return new Response("Veri alınamadı.", { status: 500 });
  }

  const csv = paymentsExportRowsToCsv(rows);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="odemeler-${month}.csv"`,
    },
  });
}
