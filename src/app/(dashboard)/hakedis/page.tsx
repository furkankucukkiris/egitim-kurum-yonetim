import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { SettingsAlert } from "@/components/settings/SettingsAlert";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatTry } from "@/lib/utils";
import { approveCompensation, generateTeacherCompensation, markCompensationPaid } from "./actions";

type CompensationPageProps = {
  searchParams: Promise<{
    month?: string;
    success?: string;
    error?: string;
  }>;
};

type WorkLogRow = {
  teacher_profile_id: string;
  total_amount: number;
  direction: number;
  approved_at: string | null;
  paid_at: string | null;
  scenario: string | null;
};

type TeacherRow = {
  id: string;
  full_name: string;
};

type TeacherSummary = {
  teacherId: string;
  teacherName: string;
  entryCount: number;
  pending: number;
  approved: number;
  paid: number;
  total: number;
};

export default async function CompensationPage({ searchParams }: CompensationPageProps) {
  const profile = await requireRole(["admin"]);
  const params = await searchParams;

  const month = isMonthValue(params.month ?? "") ? params.month! : getCurrentMonthInIstanbul();
  const monthStart = `${month}-01`;

  const supabase = await createClient();

  const [{ data: workLogs, error: workLogsError }, { data: teachers, error: teachersError }] =
    await Promise.all([
      supabase
        .from("teacher_work_logs")
        .select("teacher_profile_id, total_amount, direction, approved_at, paid_at, scenario")
        .eq("organization_id", profile.organizationId)
        .eq("period_start", monthStart),
      supabase
        .from("profiles")
        .select("id, full_name")
        .eq("organization_id", profile.organizationId)
        .eq("role", "teacher")
        .order("full_name"),
    ]);

  if (workLogsError) console.error("Hakediş kayıtları alınamadı:", workLogsError);
  if (teachersError) console.error("Öğretmen listesi alınamadı:", teachersError);

  const rows = (workLogs ?? []) as WorkLogRow[];
  const teacherList = (teachers ?? []) as TeacherRow[];

  const summaries: TeacherSummary[] = teacherList.map((teacher) => {
    const teacherRows = rows.filter((row) => row.teacher_profile_id === teacher.id);

    let pending = 0;
    let approved = 0;
    let paid = 0;

    for (const row of teacherRows) {
      const signed = Number(row.total_amount) * row.direction;

      if (row.paid_at) {
        paid += signed;
      } else if (row.approved_at) {
        approved += signed;
      } else {
        pending += signed;
      }
    }

    return {
      teacherId: teacher.id,
      teacherName: teacher.full_name,
      entryCount: teacherRows.length,
      pending,
      approved,
      paid,
      total: pending + approved + paid,
    };
  });

  return (
    <>
      <PageHeader
        title="Hakediş"
        description="Öğretmen hakedişleri, onay ve ödeme takibi."
      />

      <SettingsAlert success={params.success} error={params.error} />

      <form method="get" className="mb-6 flex items-end gap-3">
        <label className="text-xs font-medium text-muted">
          Ay
          <input
            name="month"
            type="month"
            defaultValue={month}
            className="mt-1 block rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
          />
        </label>

        <button
          type="submit"
          className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink transition hover:bg-fill"
        >
          Görüntüle
        </button>
      </form>

      <Card className="mb-6 p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink">{month} hakediş üretimi</h2>
            <p className="mt-1 text-xs leading-5 text-muted">
              Tamamlanmış (yoklaması kilitli) ve iptal edilmiş oturumlardan hakediş
              satırları oluşturur. Aynı oturum için tekrar çalıştırılırsa mükerrer
              satır eklenmez.
            </p>
          </div>

          <form action={generateTeacherCompensation}>
            <input type="hidden" name="month" value={month} />

            <button
              type="submit"
              className="rounded-lg bg-terra-700 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-terra-700/20 transition hover:bg-terra-700/90"
            >
              Bu ayın hakedişini oluştur
            </button>
          </form>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="mb-4 text-base font-semibold text-ink">{month} öğretmen özeti</h2>

        {summaries.length === 0 ? (
          <p className="text-sm text-muted">Henüz aktif öğretmen yok.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 pr-4">Öğretmen</th>
                  <th className="py-2 pr-4 text-right">Kayıt</th>
                  <th className="py-2 pr-4 text-right">Bekleyen</th>
                  <th className="py-2 pr-4 text-right">Onaylı</th>
                  <th className="py-2 pr-4 text-right">Ödendi</th>
                  <th className="py-2 pr-4 text-right">Toplam</th>
                  <th className="py-2" />
                </tr>
              </thead>

              <tbody>
                {summaries.map((summary) => (
                  <tr key={summary.teacherId} className="border-b border-line/60">
                    <td className="py-3 pr-4">
                      <Link
                        href={`/hakedis/${summary.teacherId}?month=${month}`}
                        className="font-medium text-ink hover:underline"
                      >
                        {summary.teacherName}
                      </Link>
                    </td>

                    <td className="py-3 pr-4 text-right text-muted">{summary.entryCount}</td>

                    <td className="py-3 pr-4 text-right">
                      {summary.pending !== 0 ? (
                        <StatusBadge label={formatTry(summary.pending)} tone="warning" />
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>

                    <td className="py-3 pr-4 text-right">
                      {summary.approved !== 0 ? (
                        <StatusBadge label={formatTry(summary.approved)} tone="neutral" />
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>

                    <td className="py-3 pr-4 text-right">
                      {summary.paid !== 0 ? (
                        <StatusBadge label={formatTry(summary.paid)} tone="success" />
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>

                    <td className="py-3 pr-4 text-right font-semibold text-ink">
                      {formatTry(summary.total)}
                    </td>

                    <td className="py-3 text-right">
                      <div className="flex justify-end gap-2">
                        {summary.pending !== 0 && (
                          <form action={approveCompensation}>
                            <input type="hidden" name="teacherId" value={summary.teacherId} />
                            <input type="hidden" name="periodStart" value={monthStart} />
                            <input type="hidden" name="redirectTo" value={`/hakedis?month=${month}`} />

                            <button
                              type="submit"
                              className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-fill"
                            >
                              Onayla
                            </button>
                          </form>
                        )}

                        {summary.approved !== 0 && (
                          <form action={markCompensationPaid}>
                            <input type="hidden" name="teacherId" value={summary.teacherId} />
                            <input type="hidden" name="periodStart" value={monthStart} />
                            <input type="hidden" name="redirectTo" value={`/hakedis?month=${month}`} />

                            <button
                              type="submit"
                              className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-fill"
                            >
                              Ödendi işaretle
                            </button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function isMonthValue(value: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function getCurrentMonthInIstanbul() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date())
    .replace("/", "-");
}
