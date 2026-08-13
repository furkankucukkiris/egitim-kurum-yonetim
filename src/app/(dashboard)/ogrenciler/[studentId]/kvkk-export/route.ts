import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type RouteParams = {
  params: Promise<{ studentId: string }>;
};

export async function GET(_request: Request, { params }: RouteParams) {
  await requireRole(["admin"]);

  const { studentId } = await params;

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("export_student_personal_data", {
    p_student_id: studentId,
  });

  if (error) {
    console.error("Kişisel veri paketi oluşturulamadı:", error);

    return new Response("Kişisel veri paketi oluşturulamadı.", {
      status: 500,
    });
  }

  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="ogrenci-${studentId}-kvkk-verisi.json"`,
    },
  });
}
