import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { SettingsAlert } from "@/components/settings/SettingsAlert";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatTry } from "@/lib/utils";
import {
  addCompensationAdjustment,
  approveCompensation,
  createCompensationRule,
  endCompensationRule,
  markCompensationPaid,
} from "../actions";

const compensationTypeLabels: Record<string, string> = {
  per_lesson: "Ders başına sabit",
  per_minute: "Dakika başına",
  per_student: "Öğrenci başına",
  monthly_salary: "Sabit aylık maaş",
};

const scenarioLabels: Record<string, string> = {
  regular: "Normal ders",
  institution_cancelled: "Kurum iptali",
  teacher_absence: "Öğretmen devamsızlığı",
  makeup: "Telafi dersi",
  monthly_salary: "Aylık maaş",
  adjustment: "Düzeltme",
};

type Rule = {
  id: string;
  compensation_type: string;
  rate_amount: number;
  cancellation_rate_amount: number | null;
  makeup_rate_amount: number | null;
  effective_from: string;
  effective_to: string | null;
  note: string | null;
};

type WorkLog = {
  id: string;
  work_date: string;
  scenario: string | null;
  compensation_type: string | null;
  minutes_worked: number | null;
  student_count: number | null;
  rate_snapshot: number | null;
  total_amount: number;
  direction: number;
  approved_at: string | null;
  paid_at: string | null;
  note: string | null;
};

type PageProps = {
  params: Promise<{ teacherId: string }>;
  searchParams: Promise<{ month?: string; success?: string; error?: string }>;
};

export default async function TeacherCompensationPage({ params, searchParams }: PageProps) {
  const profile = await requireRole(["admin"]);
  const { teacherId } = await params;
  const search = await searchParams;

  const month = isMonthValue(search.month ?? "") ? search.month! : getCurrentMonthInIstanbul();
  const monthStart = `${month}-01`;

  const supabase = await createClient();

  const { data: teacher, error: teacherError } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("id", teacherId)
    .eq("organization_id", profile.organizationId)
    .eq("role", "teacher")
    .maybeSingle();

  if (teacherError) {
    console.error("Öğretmen bulunamadı:", teacherError);
  }

  if (!teacher) {
    notFound();
  }

  const [{ data: rules, error: rulesError }, { data: workLogs, error: workLogsError }] =
    await Promise.all([
      supabase
        .from("teacher_compensation_rules")
        .select(
          "id, compensation_type, rate_amount, cancellation_rate_amount, makeup_rate_amount, effective_from, effective_to, note",
        )
        .eq("teacher_profile_id", teacherId)
        .order("effective_from", { ascending: false }),
      supabase
        .from("teacher_work_logs")
        .select(
          "id, work_date, scenario, compensation_type, minutes_worked, student_count, rate_snapshot, total_amount, direction, approved_at, paid_at, note",
        )
        .eq("teacher_profile_id", teacherId)
        .eq("period_start", monthStart)
        .order("work_date", { ascending: true }),
    ]);

  if (rulesError) console.error("Hakediş kuralları alınamadı:", rulesError);
  if (workLogsError) console.error("Hakediş kayıtları alınamadı:", workLogsError);

  const ruleList = (rules ?? []) as Rule[];
  const logList = (workLogs ?? []) as WorkLog[];

  const openRule = ruleList.find((rule) => rule.effective_to === null);

  let pendingTotal = 0;
  let approvedTotal = 0;
  let paidTotal = 0;

  for (const log of logList) {
    const signed = Number(log.total_amount) * log.direction;

    if (log.paid_at) paidTotal += signed;
    else if (log.approved_at) approvedTotal += signed;
    else pendingTotal += signed;
  }

  return (
    <>
      <PageHeader title={teacher.full_name} description="Hakediş kuralları ve aylık dökümü." />

      <div className="mb-6">
        <Link href="/hakedis" className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-100">
          ← Hakediş
        </Link>
      </div>

      <SettingsAlert success={search.success} error={search.error} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="mb-1 text-base font-semibold text-ink">Ücret kuralları</h2>

          <p className="mb-4 text-xs leading-5 text-muted">
            Her zaman en fazla bir açık uçlu (bitiş tarihi olmayan) kural olabilir. Ücret
            değiştiğinde mevcut kuralı sonlandırıp yenisini başlatın.
          </p>

          {ruleList.length === 0 ? (
            <p className="mb-4 text-sm text-muted">Henüz bir kural yok.</p>
          ) : (
            <ul className="mb-4 space-y-2">
              {ruleList.map((rule) => (
                <li key={rule.id} className="rounded-lg border border-line p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-ink">
                      {compensationTypeLabels[rule.compensation_type] ?? rule.compensation_type}
                    </span>
                    <span className="font-semibold text-ink">{formatTry(rule.rate_amount)}</span>
                  </div>

                  <p className="mt-1 text-xs text-muted">
                    {formatDate(rule.effective_from)} —{" "}
                    {rule.effective_to ? formatDate(rule.effective_to) : "açık uçlu"}
                  </p>

                  {(rule.cancellation_rate_amount || rule.makeup_rate_amount) && (
                    <p className="mt-1 text-xs text-muted">
                      {rule.cancellation_rate_amount
                        ? `Kurum iptali: ${formatTry(rule.cancellation_rate_amount)}`
                        : ""}
                      {rule.cancellation_rate_amount && rule.makeup_rate_amount ? " · " : ""}
                      {rule.makeup_rate_amount ? `Telafi: ${formatTry(rule.makeup_rate_amount)}` : ""}
                    </p>
                  )}

                  {rule.effective_to === null && (
                    <form action={endCompensationRule} className="mt-2 flex items-end gap-2">
                      <input type="hidden" name="teacherId" value={teacherId} />
                      <input type="hidden" name="ruleId" value={rule.id} />

                      <label className="text-xs font-medium text-muted">
                        Bitiş tarihi
                        <input
                          name="effectiveTo"
                          type="date"
                          required
                          className="mt-1 block rounded-lg border border-line bg-panel px-2 py-1.5 text-xs outline-none transition focus:border-terra-500"
                        />
                      </label>

                      <button
                        type="submit"
                        className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-fill"
                      >
                        Sonlandır
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}

          {!openRule && (
            <details open={ruleList.length === 0}>
              <summary className="cursor-pointer text-xs font-medium text-brand-700 dark:text-brand-100">
                Yeni kural ekle
              </summary>

              <form action={createCompensationRule} className="mt-3 grid gap-2">
                <input type="hidden" name="teacherId" value={teacherId} />

                <label className="text-xs font-medium text-muted">
                  Ücret modeli
                  <select
                    name="compensationType"
                    required
                    className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                  >
                    <option value="per_lesson">Ders başına sabit</option>
                    <option value="per_minute">Dakika başına</option>
                    <option value="per_student">Öğrenci başına</option>
                    <option value="monthly_salary">Sabit aylık maaş</option>
                  </select>
                </label>

                <label className="text-xs font-medium text-muted">
                  Tutar
                  <input
                    name="rateAmount"
                    type="text"
                    required
                    placeholder="0.00"
                    className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                  />
                </label>

                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs font-medium text-muted">
                    Başlangıç
                    <input
                      name="effectiveFrom"
                      type="date"
                      required
                      className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                    />
                  </label>

                  <label className="text-xs font-medium text-muted">
                    Bitiş (opsiyonel)
                    <input
                      name="effectiveTo"
                      type="date"
                      className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs font-medium text-muted">
                    Kurum iptali tutarı (opsiyonel)
                    <input
                      name="cancellationRateAmount"
                      type="text"
                      placeholder="Boş = 0"
                      className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                    />
                  </label>

                  <label className="text-xs font-medium text-muted">
                    Telafi tutarı (opsiyonel)
                    <input
                      name="makeupRateAmount"
                      type="text"
                      placeholder="Boş = normal tutar"
                      className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                    />
                  </label>
                </div>

                <label className="text-xs font-medium text-muted">
                  Not
                  <input
                    name="note"
                    type="text"
                    className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                  />
                </label>

                <button
                  type="submit"
                  className="justify-self-start rounded-lg bg-terra-700 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-terra-700/20 transition hover:bg-terra-700/90"
                >
                  Kuralı ekle
                </button>
              </form>
            </details>
          )}
        </Card>

        <Card className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-ink">{month} dökümü</h2>

            <form method="get" className="flex items-center gap-2">
              <input
                name="month"
                type="month"
                defaultValue={month}
                className="rounded-lg border border-line bg-panel px-2 py-1.5 text-xs outline-none transition focus:border-terra-500"
              />
              <button
                type="submit"
                className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-fill"
              >
                Git
              </button>
            </form>
          </div>

          <div className="mb-4 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-lg border border-line p-2">
              <p className="text-muted">Bekleyen</p>
              <p className="mt-1 font-semibold text-honey-700 dark:text-honey-500">
                {formatTry(pendingTotal)}
              </p>
            </div>
            <div className="rounded-lg border border-line p-2">
              <p className="text-muted">Onaylı</p>
              <p className="mt-1 font-semibold text-ink">{formatTry(approvedTotal)}</p>
            </div>
            <div className="rounded-lg border border-line p-2">
              <p className="text-muted">Ödendi</p>
              <p className="mt-1 font-semibold text-emerald-700 dark:text-emerald-400">
                {formatTry(paidTotal)}
              </p>
            </div>
          </div>

          <div className="mb-4 flex gap-2">
            {pendingTotal !== 0 && (
              <form action={approveCompensation}>
                <input type="hidden" name="teacherId" value={teacherId} />
                <input type="hidden" name="periodStart" value={monthStart} />
                <input type="hidden" name="redirectTo" value={`/hakedis/${teacherId}?month=${month}`} />

                <button
                  type="submit"
                  className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-fill"
                >
                  Bu ayı onayla
                </button>
              </form>
            )}

            {approvedTotal !== 0 && (
              <form action={markCompensationPaid}>
                <input type="hidden" name="teacherId" value={teacherId} />
                <input type="hidden" name="periodStart" value={monthStart} />
                <input type="hidden" name="redirectTo" value={`/hakedis/${teacherId}?month=${month}`} />

                <button
                  type="submit"
                  className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-fill"
                >
                  Ödendi işaretle
                </button>
              </form>
            )}
          </div>

          {logList.length === 0 ? (
            <p className="text-sm text-muted">Bu ay için hakediş kaydı yok.</p>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-line uppercase tracking-wide text-muted">
                    <th className="py-2 pr-2">Tarih</th>
                    <th className="py-2 pr-2">Senaryo</th>
                    <th className="py-2 pr-2 text-right">Tutar</th>
                    <th className="py-2">Durum</th>
                  </tr>
                </thead>

                <tbody>
                  {logList.map((log) => (
                    <tr key={log.id} className="border-b border-line/60">
                      <td className="py-2 pr-2 whitespace-nowrap text-muted">
                        {formatDate(log.work_date)}
                      </td>
                      <td className="py-2 pr-2">
                        {scenarioLabels[log.scenario ?? ""] ?? log.scenario}
                        {log.note ? ` — ${log.note}` : ""}
                      </td>
                      <td
                        className={`py-2 pr-2 text-right font-semibold ${
                          log.direction === 1
                            ? "text-emerald-700 dark:text-emerald-400"
                            : "text-rose-700 dark:text-rose-400"
                        }`}
                      >
                        {log.direction === 1 ? "+" : "-"}
                        {formatTry(log.total_amount)}
                      </td>
                      <td className="py-2">
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
      </div>

      <Card className="mt-6 p-6">
        <h2 className="mb-1 text-base font-semibold text-ink">Düzeltme / ek ödeme ekle</h2>

        <p className="mb-4 text-xs leading-5 text-muted">
          Otomatik üretime dahil olmayan bonus, kesinti veya düzeltmeler için. Mevcut
          kayıtlar asla değiştirilmez — düzeltme her zaman yeni bir satır olarak eklenir.
        </p>

        <form action={addCompensationAdjustment} className="grid gap-2 sm:grid-cols-4">
          <input type="hidden" name="teacherId" value={teacherId} />
          <input type="hidden" name="periodStart" value={monthStart} />

          <label className="text-xs font-medium text-muted">
            Tutar
            <input
              name="amount"
              type="text"
              required
              placeholder="0.00"
              className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
            />
          </label>

          <label className="text-xs font-medium text-muted">
            Yön
            <select
              name="direction"
              className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
            >
              <option value="1">Ekleme (+)</option>
              <option value="-1">Kesinti (-)</option>
            </select>
          </label>

          <label className="text-xs font-medium text-muted sm:col-span-2">
            Açıklama
            <input
              name="note"
              type="text"
              required
              minLength={3}
              className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
            />
          </label>

          <div className="sm:col-span-4">
            <button
              type="submit"
              className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink transition hover:bg-fill"
            >
              Düzeltmeyi ekle
            </button>
          </div>
        </form>
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    dateStyle: "medium",
  }).format(new Date(`${value}T00:00:00.000Z`));
}
