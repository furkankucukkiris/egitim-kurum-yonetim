import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatTry } from "@/lib/utils";

const scenarioLabels: Record<string, string> = {
  regular: "Normal ders",
  institution_cancelled: "Kurum iptali",
  teacher_absence: "Öğretmen devamsızlığı",
  makeup: "Telafi dersi",
  monthly_salary: "Aylık maaş",
  adjustment: "Düzeltme",
};

type WorkLog = {
  id: string;
  work_date: string;
  scenario: string | null;
  total_amount: number;
  direction: number;
  approved_at: string | null;
  paid_at: string | null;
  note: string | null;
};

type PageProps = {
  searchParams: Promise<{ month?: string }>;
};

export default async function MyCompensationPage({ searchParams }: PageProps) {
  const profile = await requireRole(["teacher"]);
  const search = await searchParams;

  const month = isMonthValue(search.month ?? "") ? search.month! : getCurrentMonthInIstanbul();
  const monthStart = `${month}-01`;

  const supabase = await createClient();

  // RLS (teacher_work_logs_select) bu sorguyu zaten yalnızca kendi
  // satırlarımla sınırlıyor — admin ekranındaki (/hakedis) ile AYNI
  // tablo ve sütunlar, ekstra bir "kendi verim" filtresi eklemeye
  // gerek yok, RLS zaten garanti ediyor.
  const { data: workLogs, error } = await supabase
    .from("teacher_work_logs")
    .select("id, work_date, scenario, total_amount, direction, approved_at, paid_at, note")
    .eq("period_start", monthStart)
    .order("work_date", { ascending: true });

  if (error) {
    console.error("Hakediş kayıtlarım alınamadı:", error);
  }

  const logs = (workLogs ?? []) as WorkLog[];

  let pendingTotal = 0;
  let approvedTotal = 0;
  let paidTotal = 0;

  for (const log of logs) {
    const signed = Number(log.total_amount) * log.direction;

    if (log.paid_at) paidTotal += signed;
    else if (log.approved_at) approvedTotal += signed;
    else pendingTotal += signed;
  }

  return (
    <>
      <PageHeader title="Hakedişim" description="Ders ve hakediş dökümünüz." />

      <div className="mb-6">
        <Link
          href="/ogretmen-paneli"
          className="text-xs font-medium text-primary hover:underline text-primary"
        >
          ← Programım
        </Link>
      </div>

      <form method="get" className="mb-6 flex items-end gap-3">
        <label className="text-xs font-medium text-text-secondary">
          Ay
          <input
            name="month"
            type="month"
            defaultValue={month}
            className="mt-1 block rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
          />
        </label>

        <button
          type="submit"
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-primary transition hover:bg-surface-muted"
        >
          Görüntüle
        </button>
      </form>

      <div className="mb-6 grid grid-cols-3 gap-4">
        <Card className="p-4 text-center">
          <p className="text-xs text-text-secondary">Bekleyen</p>
          <p className="mt-1 text-lg font-bold text-accent-strong">
            {formatTry(pendingTotal)}
          </p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-xs text-text-secondary">Onaylı</p>
          <p className="mt-1 text-lg font-bold text-text-primary">{formatTry(approvedTotal)}</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-xs text-text-secondary">Ödendi</p>
          <p className="mt-1 text-lg font-bold text-success">{formatTry(paidTotal)}</p>
        </Card>
      </div>

      <Card className="p-6">
        <h2 className="mb-4 text-base font-semibold text-text-primary">{month} dökümü</h2>

        {logs.length === 0 ? (
          <p className="text-sm text-text-secondary">Bu ay için hakediş kaydı yok.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-text-secondary">
                  <th className="py-2 pr-4">Tarih</th>
                  <th className="py-2 pr-4">Senaryo</th>
                  <th className="py-2 pr-4 text-right">Tutar</th>
                  <th className="py-2">Durum</th>
                </tr>
              </thead>

              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-border/60">
                    <td className="py-3 pr-4 whitespace-nowrap text-xs text-text-secondary">
                      {formatDate(log.work_date)}
                    </td>

                    <td className="py-3 pr-4">
                      {scenarioLabels[log.scenario ?? ""] ?? log.scenario}
                      {log.note ? ` — ${log.note}` : ""}
                    </td>

                    <td
                      className={`py-3 pr-4 text-right font-semibold ${
                        log.direction === 1 ? "text-success" : "text-danger"
                      }`}
                    >
                      {log.direction === 1 ? "+" : "-"}
                      {formatTry(log.total_amount)}
                    </td>

                    <td className="py-3">
                      {log.paid_at ? (
                        <StatusBadge label="Ödendi" tone="success" />
                      ) : log.approved_at ? (
                        <StatusBadge label="Onaylı" tone="neutral" />
                      ) : (
                        <StatusBadge label="Bekliyor" tone="warning" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="mt-4 text-xs text-text-secondary">
        {profile.fullName} — yalnızca kendi kayıtlarınızı görüntülüyorsunuz.
      </p>
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    dateStyle: "medium",
  }).format(new Date(`${value}T00:00:00.000Z`));
}
