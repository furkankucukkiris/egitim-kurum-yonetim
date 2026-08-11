import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/stat-card";
import { MonthlyRevenueChart, type MonthlyDatum } from "@/components/reports/MonthlyRevenueChart";
import { CashFlowTrendChart, type CashFlowDatum } from "@/components/reports/CashFlowTrendChart";
import { CourseDistributionPie, type DistributionSlice } from "@/components/reports/CourseDistributionPie";
import { StatusRatioBar, type StatusRatioDatum } from "@/components/reports/StatusRatioBar";
import { ReportFilters, type ReportCourseOption } from "@/components/reports/ReportFilters";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatTry } from "@/lib/utils";

// Raporlar ekranı iki bağımsız, muhasebesel olarak ayrı rapora
// bölünmüştür:
//   Tahakkuk performansı — get_accrual_report_monthly/_by_course,
//   period_start esaslı ("hangi ay ne kadar tahakkuk etti, ne kadarı
//   tahsil edildi").
//   Nakit akışı — get_cash_flow_report_monthly/_by_method,
//   received_at / iade tarihi / gider ödeme tarihi esaslı ("bu ay
//   kasaya gerçekten ne kadar para girdi/çıktı").
// Her iki rapor da aynı RPC'leri /raporlar/export route'unun
// kullandığı kaynaktan çağırır (src/lib/reports/export.ts) — ekranda
// görülen toplamlarla dışa aktarılan toplamlar hiçbir zaman
// farklılaşmaz (supabase/migrations/20260811140000_add_financial_reports.sql).

type AccrualMonthlyRow = {
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

type AccrualCourseRow = {
  course_id: string;
  course_name: string;
  accrued: number | string;
  collected: number | string;
  open_count: number;
  partial_count: number;
  overdue_count: number;
  paid_count: number;
};

type CashFlowMonthlyRow = {
  month_start: string;
  cash_in: number | string;
  refunds: number | string;
  expenses_paid: number | string;
  net_cash: number | string;
};

type CashFlowMethodRow = {
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

const MAX_RANGE_MONTHS = 35;

type ProspectConversionRow = {
  total_prospects: number;
  new_count: number;
  follow_up_count: number;
  appointment_count: number;
  trial_attended_count: number;
  enrolled_count: number;
  declined_count: number;
  conversion_rate: number | string;
};

type ProspectLeadSourceRow = {
  lead_source: string;
  prospect_count: number;
  enrolled_count: number;
  conversion_rate: number | string;
};

type ProspectCourseDemandRow = {
  course_id: string;
  course_name: string;
  interested_count: number;
  enrolled_count: number;
};

const leadSourceLabels: Record<string, string> = {
  referral: "Tavsiye",
  social_media: "Sosyal Medya",
  website: "Web Sitesi",
  walk_in: "Yürüyerek Geldi",
  phone_call: "Telefon",
  advertisement: "Reklam",
  other: "Diğer",
};

type ReportsPageProps = {
  searchParams: Promise<{
    view?: string;
    range?: string;
    start?: string;
    end?: string;
    course?: string;
    status?: string;
    method?: string;
    month?: string;
    pstart?: string;
    pend?: string;
  }>;
};

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const profile = await requireRole(["admin"]);
  const params = await searchParams;

  const view =
    params.view === "nakit"
      ? "nakit"
      : params.view === "karlilik"
        ? "karlilik"
        : params.view === "adaylar"
          ? "adaylar"
          : "tahakkuk";
  const courseId = params.course ?? "";
  const studentStatus = params.status ?? "";
  const method = view === "nakit" ? (params.method ?? "") : "";

  const currentMonth = getCurrentMonthInIstanbul();
  const profitabilityMonth = isMonthValue(params.month) ? params.month : currentMonth;

  const today = getCurrentDateInIstanbul();
  const prospectStartDate = isDateValue(params.pstart) ? params.pstart : addDays(today, -90);
  const prospectEndDate = isDateValue(params.pend) ? params.pend : today;

  let range: "last6" | "last12" | "custom";
  let startMonth: string;
  let endMonth: string;

  if (isMonthValue(params.start) && isMonthValue(params.end) && params.start! <= params.end!) {
    range = "custom";
    startMonth = params.start!;
    endMonth = params.end!;

    if (monthsBetween(startMonth, endMonth) > MAX_RANGE_MONTHS) {
      startMonth = addMonths(endMonth, -MAX_RANGE_MONTHS);
    }
  } else if (params.range === "last12") {
    range = "last12";
    endMonth = currentMonth;
    startMonth = addMonths(currentMonth, -11);
  } else {
    range = "last6";
    endMonth = currentMonth;
    startMonth = addMonths(currentMonth, -5);
  }

  const supabase = await createClient();

  const coursesResult = await supabase
    .from("courses")
    .select("id, name")
    .eq("organization_id", profile.organizationId)
    .order("name");

  if (coursesResult.error) {
    console.error("Ders listesi alınamadı:", coursesResult.error);
  }

  const courseOptions = (coursesResult.data ?? []) as unknown as ReportCourseOption[];

  const exportQuery = new URLSearchParams({
    start: startMonth,
    end: endMonth,
    ...(courseId ? { course: courseId } : {}),
    ...(studentStatus ? { status: studentStatus } : {}),
    ...(method ? { method } : {}),
  });

  return (
    <>
      <PageHeader
        title="Raporlar"
        description="Tahakkuk performansı ve nakit akışı, birbirinden bağımsız iki rapor olarak."
      />

      <div className="mb-6 flex gap-2 border-b border-line">
        <TabLink
          href={buildViewHref("tahakkuk", { range, startMonth, endMonth, courseId, studentStatus, method })}
          active={view === "tahakkuk"}
        >
          Tahakkuk Performansı
        </TabLink>
        <TabLink
          href={buildViewHref("nakit", { range, startMonth, endMonth, courseId, studentStatus, method })}
          active={view === "nakit"}
        >
          Nakit Akışı
        </TabLink>
        <TabLink href={`/raporlar?view=karlilik&month=${profitabilityMonth}`} active={view === "karlilik"}>
          Kârlılık
        </TabLink>
        <TabLink
          href={`/raporlar?view=adaylar&pstart=${prospectStartDate}&pend=${prospectEndDate}`}
          active={view === "adaylar"}
        >
          Aday Öğrenciler
        </TabLink>
      </div>

      {view === "karlilik" ? (
        <ProfitabilityReportView month={profitabilityMonth} />
      ) : view === "adaylar" ? (
        <ProspectReportView startDate={prospectStartDate} endDate={prospectEndDate} />
      ) : (
        <>
          <ReportFilters
            view={view}
            range={range}
            startMonth={startMonth}
            endMonth={endMonth}
            courseId={courseId}
            studentStatus={studentStatus}
            method={method}
            courseOptions={courseOptions}
            showMethodFilter={view === "nakit"}
          />

          {view === "tahakkuk" ? (
            <AccrualReportView
              startMonth={startMonth}
              endMonth={endMonth}
              courseId={courseId}
              studentStatus={studentStatus}
              exportQuery={exportQuery}
            />
          ) : (
            <CashFlowReportView
              startMonth={startMonth}
              endMonth={endMonth}
              courseId={courseId}
              studentStatus={studentStatus}
              method={method}
              exportQuery={exportQuery}
            />
          )}
        </>
      )}
    </>
  );
}

type ProfitabilitySummaryRow = {
  revenue_accrued: number | string;
  direct_expenses: number | string;
  indirect_expenses: number | string;
  total_expenses: number | string;
  expenses_paid_cash: number | string;
  gross_result: number | string;
  net_result: number | string;
};

type CourseMarginRow = {
  course_id: string;
  course_name: string;
  revenue: number | string;
  direct_expenses: number | string;
  contribution_margin: number | string;
};

async function ProfitabilityReportView({ month }: { month: string }) {
  const supabase = await createClient();

  const [summaryResult, marginsResult] = await Promise.all([
    supabase.rpc("get_monthly_profitability_summary", { p_month_start: `${month}-01` }),
    supabase.rpc("get_course_contribution_margins", { p_month_start: `${month}-01` }),
  ]);

  if (summaryResult.error) {
    console.error("Kârlılık özeti alınamadı:", summaryResult.error);
  }

  if (marginsResult.error) {
    console.error("Ders katkı payı alınamadı:", marginsResult.error);
  }

  const summary = ((summaryResult.data ?? []) as unknown as ProfitabilitySummaryRow[])[0];
  const margins = (marginsResult.data ?? []) as unknown as CourseMarginRow[];

  return (
    <>
      <form method="get" className="mb-6 flex items-end gap-3">
        <input type="hidden" name="view" value="karlilik" />

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

      {summary && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="p-5">
            <p className="text-sm font-medium text-muted">Gelir (tahakkuk)</p>
            <p className="mt-3 text-2xl font-bold tracking-tight text-ink">
              {formatTry(Number(summary.revenue_accrued))}
            </p>
          </Card>

          <Card className="p-5">
            <p className="text-sm font-medium text-muted">Toplam gider</p>
            <p className="mt-3 text-2xl font-bold tracking-tight text-ink">
              {formatTry(Number(summary.total_expenses))}
            </p>
            <p className="mt-1 text-xs text-muted">
              Doğrudan {formatTry(Number(summary.direct_expenses))} · Dolaylı{" "}
              {formatTry(Number(summary.indirect_expenses))}
            </p>
          </Card>

          <Card className="p-5">
            <p className="text-sm font-medium text-muted">Brüt sonuç</p>
            <p
              className={`mt-3 text-2xl font-bold tracking-tight ${
                Number(summary.gross_result) >= 0
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-rose-700 dark:text-rose-400"
              }`}
            >
              {formatTry(Number(summary.gross_result))}
            </p>
            <p className="mt-1 text-xs text-muted">Gelir − doğrudan ders gideri</p>
          </Card>

          <Card className="p-5">
            <p className="text-sm font-medium text-muted">Net sonuç</p>
            <p
              className={`mt-3 text-2xl font-bold tracking-tight ${
                Number(summary.net_result) >= 0
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-rose-700 dark:text-rose-400"
              }`}
            >
              {formatTry(Number(summary.net_result))}
            </p>
            <p className="mt-1 text-xs text-muted">Gelir − tüm giderler</p>
          </Card>
        </div>
      )}

      <Card className="p-6">
        <h2 className="mb-1 text-base font-semibold text-ink">Ders bazlı katkı payı</h2>

        <p className="mb-4 text-xs leading-5 text-muted">
          Her dersin bu ayki geliri eksi yalnızca o derse doğrudan bağlanmış giderler.
        </p>

        {margins.length === 0 ? (
          <p className="text-sm text-muted">Bu ay için gelir veya doğrudan gider kaydı yok.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                <th className="py-2 pr-4">Ders</th>
                <th className="py-2 pr-4 text-right">Gelir</th>
                <th className="py-2 pr-4 text-right">Doğrudan gider</th>
                <th className="py-2 text-right">Katkı payı</th>
              </tr>
            </thead>

            <tbody>
              {margins.map((row) => (
                <tr key={row.course_id} className="border-b border-line/60">
                  <td className="py-2 pr-4">{row.course_name}</td>
                  <td className="py-2 pr-4 text-right">{formatTry(Number(row.revenue))}</td>
                  <td className="py-2 pr-4 text-right">{formatTry(Number(row.direct_expenses))}</td>
                  <td
                    className={`py-2 text-right font-semibold ${
                      Number(row.contribution_margin) >= 0
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-rose-700 dark:text-rose-400"
                    }`}
                  >
                    {formatTry(Number(row.contribution_margin))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

async function ProspectReportView({
  startDate,
  endDate,
}: {
  startDate: string;
  endDate: string;
}) {
  const supabase = await createClient();

  const [conversionResult, leadSourceResult, courseDemandResult] = await Promise.all([
    supabase.rpc("get_prospect_conversion_report", {
      p_start_date: startDate,
      p_end_date: endDate,
    }),
    supabase.rpc("get_prospect_lead_source_report", {
      p_start_date: startDate,
      p_end_date: endDate,
    }),
    supabase.rpc("get_prospect_course_demand_report", {
      p_start_date: startDate,
      p_end_date: endDate,
    }),
  ]);

  if (conversionResult.error) {
    console.error("Dönüşüm raporu alınamadı:", conversionResult.error);
  }

  if (leadSourceResult.error) {
    console.error("Kaynak performans raporu alınamadı:", leadSourceResult.error);
  }

  if (courseDemandResult.error) {
    console.error("Ders talebi raporu alınamadı:", courseDemandResult.error);
  }

  const conversion = ((conversionResult.data ?? []) as unknown as ProspectConversionRow[])[0];
  const leadSources = (leadSourceResult.data ?? []) as unknown as ProspectLeadSourceRow[];
  const courseDemand = (courseDemandResult.data ?? []) as unknown as ProspectCourseDemandRow[];

  return (
    <>
      <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
        <input type="hidden" name="view" value="adaylar" />

        <label className="text-xs font-medium text-muted">
          Başlangıç
          <input
            name="pstart"
            type="date"
            defaultValue={startDate}
            className="mt-1 block rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
          />
        </label>

        <label className="text-xs font-medium text-muted">
          Bitiş
          <input
            name="pend"
            type="date"
            defaultValue={endDate}
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

      {conversion && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="p-5">
            <p className="text-sm font-medium text-muted">Toplam aday</p>
            <p className="mt-3 text-2xl font-bold tracking-tight text-ink">
              {conversion.total_prospects}
            </p>
          </Card>

          <Card className="p-5">
            <p className="text-sm font-medium text-muted">Kayıt olan</p>
            <p className="mt-3 text-2xl font-bold tracking-tight text-emerald-700 dark:text-emerald-400">
              {conversion.enrolled_count}
            </p>
          </Card>

          <Card className="p-5">
            <p className="text-sm font-medium text-muted">Dönüşüm oranı</p>
            <p className="mt-3 text-2xl font-bold tracking-tight text-ink">
              %{Number(conversion.conversion_rate)}
            </p>
          </Card>

          <Card className="p-5">
            <p className="text-sm font-medium text-muted">Reddedilen</p>
            <p className="mt-3 text-2xl font-bold tracking-tight text-rose-700 dark:text-rose-400">
              {conversion.declined_count}
            </p>
          </Card>
        </div>
      )}

      {conversion && (
        <p className="mb-6 text-xs text-muted">
          Yeni: {conversion.new_count} · Takip gerekli: {conversion.follow_up_count} · Randevu
          planlandı: {conversion.appointment_count} · Deneme dersine katıldı:{" "}
          {conversion.trial_attended_count}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="mb-1 text-base font-semibold text-ink">Kaynak performansı</h2>

          <p className="mb-4 text-xs leading-5 text-muted">
            Aday öğrencinin geldiği kaynağa göre dönüşüm oranı.
          </p>

          {leadSources.length === 0 ? (
            <p className="text-sm text-muted">Bu aralıkta aday öğrenci kaydı yok.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 pr-4">Kaynak</th>
                  <th className="py-2 pr-4 text-right">Aday sayısı</th>
                  <th className="py-2 pr-4 text-right">Kayıt olan</th>
                  <th className="py-2 text-right">Dönüşüm</th>
                </tr>
              </thead>

              <tbody>
                {leadSources.map((row) => (
                  <tr key={row.lead_source} className="border-b border-line/60">
                    <td className="py-2 pr-4">{leadSourceLabels[row.lead_source] ?? row.lead_source}</td>
                    <td className="py-2 pr-4 text-right">{row.prospect_count}</td>
                    <td className="py-2 pr-4 text-right">{row.enrolled_count}</td>
                    <td className="py-2 text-right font-semibold">%{Number(row.conversion_rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card className="p-6">
          <h2 className="mb-1 text-base font-semibold text-ink">Ders bazlı talep</h2>

          <p className="mb-4 text-xs leading-5 text-muted">
            Aday öğrencilerin ilgi gösterdiği dersler ve bunlardan kayda dönüşenler.
          </p>

          {courseDemand.length === 0 ? (
            <p className="text-sm text-muted">Bu aralıkta ders ilgisi kaydı yok.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 pr-4">Ders</th>
                  <th className="py-2 pr-4 text-right">İlgilenen</th>
                  <th className="py-2 text-right">Kayıt olan</th>
                </tr>
              </thead>

              <tbody>
                {courseDemand.map((row) => (
                  <tr key={row.course_id} className="border-b border-line/60">
                    <td className="py-2 pr-4">{row.course_name}</td>
                    <td className="py-2 pr-4 text-right">{row.interested_count}</td>
                    <td className="py-2 text-right font-semibold">{row.enrolled_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}

async function AccrualReportView({
  startMonth,
  endMonth,
  courseId,
  studentStatus,
  exportQuery,
}: {
  startMonth: string;
  endMonth: string;
  courseId: string;
  studentStatus: string;
  exportQuery: URLSearchParams;
}) {
  const supabase = await createClient();

  const [monthlyResult, courseResult] = await Promise.all([
    supabase.rpc("get_accrual_report_monthly", {
      p_start_month: `${startMonth}-01`,
      p_end_month: `${endMonth}-01`,
      p_course_id: courseId || null,
      p_student_status: studentStatus || null,
    }),
    supabase.rpc("get_accrual_report_by_course", {
      p_start_month: `${startMonth}-01`,
      p_end_month: `${endMonth}-01`,
      p_course_id: courseId || null,
      p_student_status: studentStatus || null,
    }),
  ]);

  if (monthlyResult.error) {
    console.error("Tahakkuk raporu (aylık) alınamadı:", monthlyResult.error);
  }

  if (courseResult.error) {
    console.error("Tahakkuk raporu (ders bazlı) alınamadı:", courseResult.error);
  }

  const monthly = (monthlyResult.data ?? []) as unknown as AccrualMonthlyRow[];
  const byCourse = (courseResult.data ?? []) as unknown as AccrualCourseRow[];

  const totals = monthly.reduce(
    (acc, row) => ({
      accrued: acc.accrued + Number(row.accrued),
      collected: acc.collected + Number(row.collected),
      open: acc.open + Number(row.open_amount),
      partial: acc.partial + Number(row.partial_amount),
      overdue: acc.overdue + Number(row.overdue_amount),
      paid: acc.paid + Number(row.paid_amount),
      openCount: acc.openCount + row.open_count,
      partialCount: acc.partialCount + row.partial_count,
      overdueCount: acc.overdueCount + row.overdue_count,
      paidCount: acc.paidCount + row.paid_count,
    }),
    {
      accrued: 0,
      collected: 0,
      open: 0,
      partial: 0,
      overdue: 0,
      paid: 0,
      openCount: 0,
      partialCount: 0,
      overdueCount: 0,
      paidCount: 0,
    },
  );

  const chartData: MonthlyDatum[] = monthly.map((row) => ({
    monthLabel: formatMonthShort(row.month_start),
    collected: Number(row.collected),
    pending: Math.max(0, Number(row.accrued) - Number(row.collected)),
  }));

  const ratioSegments: StatusRatioDatum[] = [
    { key: "paid", label: "Ödendi", amount: totals.paid, count: totals.paidCount },
    { key: "partial", label: "Kısmi", amount: totals.partial, count: totals.partialCount },
    { key: "overdue", label: "Gecikmiş", amount: totals.overdue, count: totals.overdueCount },
    { key: "open", label: "Açık", amount: totals.open, count: totals.openCount },
  ];

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Toplam Tahakkuk"
          value={formatTry(totals.accrued)}
          detail={`${formatMonthYearFromKey(startMonth)} – ${formatMonthYearFromKey(endMonth)}`}
        />
        <StatCard
          label="Toplam Tahsilat"
          value={formatTry(totals.collected)}
          detail={
            totals.accrued > 0
              ? `%${Math.round((totals.collected / totals.accrued) * 100)} tahsilat oranı`
              : "Veri yok"
          }
        />
        <StatCard
          label="Açık + Gecikmiş Bakiye"
          value={formatTry(totals.open + totals.overdue)}
          detail={`${totals.openCount + totals.overdueCount} dönem`}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <h3 className="font-semibold text-ink">Aylık tahakkuk / tahsilat</h3>
          <p className="mt-1 text-sm text-muted">
            {formatMonthYearFromKey(startMonth)} – {formatMonthYearFromKey(endMonth)}
          </p>
          <div className="mt-5">
            <MonthlyRevenueChart data={chartData} />
          </div>
        </Card>

        <Card>
          <h3 className="font-semibold text-ink">Açık / kısmi / gecikmiş / ödenen dağılımı</h3>
          <p className="mt-1 text-sm text-muted">Seçili aralığın toplamı</p>
          <div className="mt-5">
            <StatusRatioBar segments={ratioSegments} />
          </div>
        </Card>
      </div>

      <div className="mb-3 mt-6 flex items-center justify-between">
        <h3 className="font-semibold text-ink">Ders bazlı tahakkuk ve tahsilat başarısı</h3>
        <a
          href={`/raporlar/export?type=accrual&${exportQuery.toString()}`}
          className="rounded-xl border border-line bg-panel px-4 py-2.5 text-sm font-semibold text-brand-700 shadow-sm transition hover:bg-fill dark:text-brand-100"
        >
          CSV olarak dışa aktar
        </a>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-panel shadow-sm">
        {byCourse.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">
            Seçili aralık ve filtrelerde tahakkuk kaydı yok.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="bg-fill text-xs uppercase text-muted">
                <tr>
                  <th className="px-5 py-3">Ders</th>
                  <th className="px-5 py-3">Tahakkuk</th>
                  <th className="px-5 py-3">Tahsilat</th>
                  <th className="px-5 py-3">Tahsilat oranı</th>
                  <th className="px-5 py-3">Açık / Kısmi / Gecikmiş / Ödenen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {byCourse.map((course) => {
                  const accrued = Number(course.accrued);
                  const collected = Number(course.collected);
                  const rate = accrued > 0 ? Math.round((collected / accrued) * 100) : 0;

                  return (
                    <tr key={course.course_id}>
                      <td className="px-5 py-4 font-semibold text-ink">{course.course_name}</td>
                      <td className="px-5 py-4 text-ink">{formatTry(accrued)}</td>
                      <td className="px-5 py-4 text-ink">{formatTry(collected)}</td>
                      <td className="px-5 py-4">
                        <div className="h-2 w-32 rounded-full bg-fill">
                          <div
                            className="h-2 rounded-full bg-terra-500"
                            style={{ width: `${Math.min(100, rate)}%` }}
                          />
                        </div>
                      </td>
                      <td className="px-5 py-4 text-muted">
                        {course.open_count} / {course.partial_count} / {course.overdue_count} /{" "}
                        {course.paid_count}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {byCourse.length > 0 && (
        <p className="mt-2 text-xs text-muted">
          Ders kırılımı toplamı: {formatTry(byCourse.reduce((sum, c) => sum + Number(c.accrued), 0))}{" "}
          tahakkuk — üstteki &ldquo;Toplam Tahakkuk&rdquo; ile aynı kaynaktan (aynı ay/filtre kümesi),
          birebir eşleşir.
        </p>
      )}
    </>
  );
}

async function CashFlowReportView({
  startMonth,
  endMonth,
  courseId,
  studentStatus,
  method,
  exportQuery,
}: {
  startMonth: string;
  endMonth: string;
  courseId: string;
  studentStatus: string;
  method: string;
  exportQuery: URLSearchParams;
}) {
  const supabase = await createClient();

  const [monthlyResult, methodResult] = await Promise.all([
    supabase.rpc("get_cash_flow_report_monthly", {
      p_start_month: `${startMonth}-01`,
      p_end_month: `${endMonth}-01`,
      p_course_id: courseId || null,
      p_method: method || null,
      p_student_status: studentStatus || null,
    }),
    supabase.rpc("get_cash_flow_report_by_method", {
      p_start_month: `${startMonth}-01`,
      p_end_month: `${endMonth}-01`,
      p_course_id: courseId || null,
      p_student_status: studentStatus || null,
    }),
  ]);

  if (monthlyResult.error) {
    console.error("Nakit akışı raporu (aylık) alınamadı:", monthlyResult.error);
  }

  if (methodResult.error) {
    console.error("Nakit akışı raporu (yöntem bazlı) alınamadı:", methodResult.error);
  }

  const monthly = (monthlyResult.data ?? []) as unknown as CashFlowMonthlyRow[];
  const byMethod = (methodResult.data ?? []) as unknown as CashFlowMethodRow[];

  const totals = monthly.reduce(
    (acc, row) => ({
      cashIn: acc.cashIn + Number(row.cash_in),
      refunds: acc.refunds + Number(row.refunds),
      expenses: acc.expenses + Number(row.expenses_paid),
      net: acc.net + Number(row.net_cash),
    }),
    { cashIn: 0, refunds: 0, expenses: 0, net: 0 },
  );

  const chartData: CashFlowDatum[] = monthly.map((row) => ({
    monthLabel: formatMonthShort(row.month_start),
    cashIn: Number(row.cash_in),
    refunds: Number(row.refunds),
    net: Number(row.net_cash),
  }));

  const distributionData: DistributionSlice[] = byMethod
    .filter((row) => Number(row.cash_in) > 0)
    .map((row) => ({
      label: methodLabels[row.method] ?? row.method,
      value: Number(row.cash_in),
    }));

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Nakit Girişi"
          value={formatTry(totals.cashIn)}
          detail={`${formatMonthYearFromKey(startMonth)} – ${formatMonthYearFromKey(endMonth)}`}
        />
        <StatCard label="İadeler" value={formatTry(totals.refunds)} detail="Aynı aralıkta yapılan iadeler" />
        <StatCard label="Giderler" value={formatTry(totals.expenses)} detail="Ödenmiş giderler" />
        <StatCard
          label="Net Nakit Girişi"
          value={formatTry(totals.net)}
          detail="Nakit − iade − gider"
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <h3 className="font-semibold text-ink">Aylık nakit girişi / iade</h3>
          <p className="mt-1 text-sm text-muted">
            {formatMonthYearFromKey(startMonth)} – {formatMonthYearFromKey(endMonth)}
          </p>
          <div className="mt-5">
            <CashFlowTrendChart data={chartData} />
          </div>
        </Card>

        <Card>
          <h3 className="font-semibold text-ink">Ödeme yöntemi dağılımı</h3>
          <p className="mt-1 text-sm text-muted">Nakit girişine göre pay</p>
          <div className="mt-5">
            <CourseDistributionPie
              data={distributionData}
              ariaLabel="Ödeme yöntemine göre nakit dağılımı"
            />
          </div>
        </Card>
      </div>

      <div className="mb-3 mt-6 flex items-center justify-between">
        <h3 className="font-semibold text-ink">Ödeme yöntemi bazlı nakit akışı</h3>
        <a
          href={`/raporlar/export?type=cash&${exportQuery.toString()}`}
          className="rounded-xl border border-line bg-panel px-4 py-2.5 text-sm font-semibold text-brand-700 shadow-sm transition hover:bg-fill dark:text-brand-100"
        >
          CSV olarak dışa aktar
        </a>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-panel shadow-sm">
        {byMethod.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">
            Seçili aralık ve filtrelerde nakit hareketi yok.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-fill text-xs uppercase text-muted">
                <tr>
                  <th className="px-5 py-3">Yöntem</th>
                  <th className="px-5 py-3">Nakit girişi</th>
                  <th className="px-5 py-3">İade</th>
                  <th className="px-5 py-3">Net</th>
                  <th className="px-5 py-3">İşlem sayısı</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {byMethod.map((row) => (
                  <tr key={row.method}>
                    <td className="px-5 py-4 font-semibold text-ink">
                      {methodLabels[row.method] ?? row.method}
                    </td>
                    <td className="px-5 py-4 text-ink">{formatTry(Number(row.cash_in))}</td>
                    <td className="px-5 py-4 text-muted">{formatTry(Number(row.refunds))}</td>
                    <td className="px-5 py-4 font-semibold text-ink">
                      {formatTry(Number(row.net_cash))}
                    </td>
                    <td className="px-5 py-4 text-muted">{row.payment_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {byMethod.length > 0 && (
        <p className="mt-2 text-xs text-muted">
          Yöntem kırılımı toplamı:{" "}
          {formatTry(byMethod.reduce((sum, m) => sum + Number(m.cash_in), 0))} nakit girişi — üstteki
          &ldquo;Nakit Girişi&rdquo; ile aynı kaynaktan (aynı ay/filtre kümesi), birebir eşleşir.
        </p>
      )}
    </>
  );
}

function TabLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`-mb-px border-b-2 px-4 py-3 text-sm font-semibold transition ${
        active
          ? "border-terra-700 text-terra-700 dark:text-terra-500"
          : "border-transparent text-muted hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}

function buildViewHref(
  view: "tahakkuk" | "nakit",
  filters: {
    range: string;
    startMonth: string;
    endMonth: string;
    courseId: string;
    studentStatus: string;
    method: string;
  },
) {
  const next = new URLSearchParams({ view });

  if (filters.range === "custom") {
    next.set("start", filters.startMonth);
    next.set("end", filters.endMonth);
  } else {
    next.set("range", filters.range);
  }

  if (filters.courseId) next.set("course", filters.courseId);
  if (filters.studentStatus) next.set("status", filters.studentStatus);
  if (view === "nakit" && filters.method) next.set("method", filters.method);

  return `/raporlar?${next.toString()}`;
}

function formatMonthYearFromKey(monthKey: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    month: "long",
    year: "numeric",
  }).format(new Date(`${monthKey}-01T00:00:00.000Z`));
}

function formatMonthShort(dateValue: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    month: "short",
    year: "2-digit",
  }).format(new Date(`${dateValue}T00:00:00.000Z`));
}

function getCurrentMonthInIstanbul() {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  return today.slice(0, 7);
}

function isMonthValue(value: string | undefined): value is string {
  return !!value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function isDateValue(value: string | undefined): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function getCurrentDateInIstanbul() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function addMonths(monthKey: string, amount: number) {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthsBetween(startKey: string, endKey: string) {
  const [startYear, startMonth] = startKey.split("-").map(Number);
  const [endYear, endMonth] = endKey.split("-").map(Number);
  return (endYear - startYear) * 12 + (endMonth - startMonth);
}
