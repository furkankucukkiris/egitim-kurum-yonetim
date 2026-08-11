import { Card } from "@/components/ui/Card";
import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import { SettingsAlert } from "@/components/settings/SettingsAlert";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { retryAutomationJob, updateAutomationSettings } from "../actions";

type AutomationSettingsPageProps = {
  searchParams: Promise<{
    success?: string;
    error?: string;
  }>;
};

type JobRun = {
  id: string;
  job_type: "lesson_sessions" | "accruals";
  period: string;
  status: "running" | "succeeded" | "failed";
  started_at: string;
  finished_at: string | null;
  counts: Record<string, number> | null;
  error_summary: string | null;
  triggered_by: "schedule" | "manual_retry";
};

const jobTypeLabels: Record<JobRun["job_type"], string> = {
  lesson_sessions: "Ders oturumları",
  accruals: "Tahakkuklar",
};

const statusLabels: Record<JobRun["status"], string> = {
  running: "Çalışıyor",
  succeeded: "Başarılı",
  failed: "Başarısız",
};

const statusTones: Record<JobRun["status"], BadgeTone> = {
  running: "warning",
  succeeded: "success",
  failed: "danger",
};

export default async function AutomationSettingsPage({
  searchParams,
}: AutomationSettingsPageProps) {
  const profile = await requireRole(["admin"]);
  const params = await searchParams;

  const supabase = await createClient();

  const { data: organization, error: organizationError } = await supabase
    .from("organizations")
    .select(
      "monthly_automation_enabled, sessions_generation_day, accruals_generation_day",
    )
    .eq("id", profile.organizationId)
    .single();

  if (organizationError) {
    console.error("Otomasyon ayarları alınamadı:", organizationError);
  }

  const { data: jobRuns, error: jobRunsError } = await supabase
    .from("automation_job_runs")
    .select(
      "id, job_type, period, status, started_at, finished_at, counts, error_summary, triggered_by",
    )
    .eq("organization_id", profile.organizationId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (jobRunsError) {
    console.error("Otomasyon iş geçmişi alınamadı:", jobRunsError);
  }

  return (
    <>
      <SettingsAlert success={params.success} error={params.error} />

      <Card className="mb-6 max-w-xl p-6">
        <h2 className="mb-1 text-base font-semibold text-ink">
          Otomatik üretim ayarları
        </h2>

        <p className="mb-5 text-xs leading-5 text-muted">
          Her gün kontrol edilir; kurumun yerel tarihinde ayın bu gününe
          gelindiğinde, gelecek ayın kayıtları otomatik oluşturulur. Elle
          oluşturma butonları (Yoklama ve Ödemeler ekranlarında) acil
          durum yedeği olarak çalışmaya devam eder.
        </p>

        <form action={updateAutomationSettings} className="space-y-5">
          <label className="flex items-center gap-3 text-sm font-medium">
            <input
              name="enabled"
              type="checkbox"
              defaultChecked={
                organization?.monthly_automation_enabled ?? true
              }
              className="h-4 w-4 rounded border-line text-terra-700 focus:ring-terra-500/50"
            />
            Otomatik üretim etkin
          </label>

          <label className="block text-sm font-medium">
            Ders oturumu üretim günü

            <input
              name="sessionsDay"
              type="number"
              min={1}
              max={28}
              required
              defaultValue={organization?.sessions_generation_day ?? 25}
              className="mt-2 w-32 rounded-xl border border-line bg-panel px-4 py-3 text-sm outline-none transition focus:border-terra-500"
            />

            <span className="mt-2 block text-xs leading-5 text-muted">
              Her ayın bu gününde, gelecek ayın ders oturumları
              oluşturulur (1-28 arası).
            </span>
          </label>

          <label className="block text-sm font-medium">
            Tahakkuk üretim günü

            <input
              name="accrualsDay"
              type="number"
              min={1}
              max={28}
              required
              defaultValue={organization?.accruals_generation_day ?? 25}
              className="mt-2 w-32 rounded-xl border border-line bg-panel px-4 py-3 text-sm outline-none transition focus:border-terra-500"
            />

            <span className="mt-2 block text-xs leading-5 text-muted">
              Her ayın bu gününde, gelecek ayın tahakkukları oluşturulur
              (1-28 arası).
            </span>
          </label>

          <button
            type="submit"
            className="rounded-xl bg-terra-700 shadow-sm shadow-terra-700/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-500/50 px-5 py-3 text-sm font-semibold text-white transition hover:bg-terra-700/90"
          >
            Kaydet
          </button>
        </form>
      </Card>

      <Card className="p-6">
        <h2 className="mb-1 text-base font-semibold text-ink">
          Otomasyon geçmişi
        </h2>

        <p className="mb-5 text-xs leading-5 text-muted">
          Son 20 çalıştırma denemesi (otomatik ve manuel yeniden denemeler
          dahil).
        </p>

        {!jobRuns || jobRuns.length === 0 ? (
          <p className="text-sm text-muted">
            Henüz bir otomasyon çalışması yok.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 pr-4">Tarih</th>
                  <th className="py-2 pr-4">Tür</th>
                  <th className="py-2 pr-4">Dönem</th>
                  <th className="py-2 pr-4">Durum</th>
                  <th className="py-2 pr-4">Sonuç</th>
                  <th className="py-2 pr-4">Kaynak</th>
                  <th className="py-2" />
                </tr>
              </thead>

              <tbody>
                {(jobRuns as JobRun[]).map((run) => (
                  <tr key={run.id} className="border-b border-line/60">
                    <td className="py-3 pr-4 whitespace-nowrap text-xs text-muted">
                      {formatDateTime(run.started_at)}
                    </td>

                    <td className="py-3 pr-4">{jobTypeLabels[run.job_type]}</td>

                    <td className="py-3 pr-4 whitespace-nowrap">
                      {formatMonthYear(run.period)}
                    </td>

                    <td className="py-3 pr-4">
                      <StatusBadge
                        label={statusLabels[run.status]}
                        tone={statusTones[run.status]}
                      />
                    </td>

                    <td className="py-3 pr-4 text-xs">
                      {run.status === "failed" && run.error_summary ? (
                        <span className="text-red-600 dark:text-red-400">
                          {run.error_summary}
                        </span>
                      ) : (
                        formatCounts(run.counts)
                      )}
                    </td>

                    <td className="py-3 pr-4 text-xs text-muted">
                      {run.triggered_by === "schedule"
                        ? "Otomatik"
                        : "Manuel yeniden deneme"}
                    </td>

                    <td className="py-3">
                      {run.status === "failed" && (
                        <form action={retryAutomationJob}>
                          <input
                            type="hidden"
                            name="jobType"
                            value={run.job_type}
                          />

                          <input
                            type="hidden"
                            name="period"
                            value={run.period}
                          />

                          <button
                            type="submit"
                            className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-fill"
                          >
                            Yeniden dene
                          </button>
                        </form>
                      )}
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

function formatCounts(counts: Record<string, number> | null) {
  if (!counts) {
    return "—";
  }

  const parts: string[] = [];

  if (typeof counts.created_count === "number") {
    parts.push(`${counts.created_count} yeni`);
  }

  if (typeof counts.existing_count === "number") {
    parts.push(`${counts.existing_count} mevcut`);
  }

  if (typeof counts.skipped_group_count === "number" && counts.skipped_group_count > 0) {
    parts.push(`${counts.skipped_group_count} atlanan program`);
  }

  return parts.length > 0 ? parts.join(", ") : "—";
}

function formatMonthYear(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
